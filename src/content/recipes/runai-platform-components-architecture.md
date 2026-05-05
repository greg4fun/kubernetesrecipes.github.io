---
title: "Run:ai Platform Backend Components"
description: "Overview of Run:ai backend StatefulSets and components on OpenShift: Thanos receive/query, Keycloak, NATS, Redis, PostgreSQL, workload controllers, and their resource requirements."
tags:
  - "runai"
  - "architecture"
  - "openshift"
  - "statefulset"
  - "observability"
category: "ai"
publishDate: "2026-05-05"
author: "Luca Berton"
difficulty: "intermediate"
relatedRecipes:
  - "runai-fsdp-training-mistral-gpu"
  - "runai-backend-architecture-openshift"
  - "openshift-gpu-node-resource-planning"
  - "thanos-receive-oom-crashloop-statefulset"
---

> 💡 **Quick Answer:** Run:ai backend deploys ~15 StatefulSets/Deployments in the `runai-backend` namespace covering GPU scheduling, metrics (Thanos), auth (Keycloak), messaging (NATS), storage (PostgreSQL/Redis), and workload management. Managed via ArgoCD with Helm values in a GitOps repo.

## The Problem

Understanding Run:ai backend components helps you:

- Right-size infrastructure nodes for the control plane
- Troubleshoot component failures (which piece is broken?)
- Plan for high availability
- Manage GitOps values for each component independently

## The Solution

### Backend Component Inventory

```text
Namespace: runai-backend

StatefulSets:
├── runai-backend-thanos-receive     (metrics ingestion from GPU nodes)
├── runai-backend-thanos-query       (PromQL queries for dashboards)
├── runai-backend-postgresql         (workload metadata, projects, quotas)
├── runai-backend-redis              (session cache, job queuing)
├── runai-backend-nats               (event bus between components)
└── runai-backend-keycloak           (SSO / authentication)

Deployments:
├── runai-backend-workload-controller  (job scheduling logic)
├── runai-backend-api-server           (REST API for CLI/UI)
├── runai-backend-frontend             (React dashboard UI)
├── runai-backend-grafana              (GPU metrics dashboards)
├── runai-backend-traefik              (ingress/routing)
└── runai-backend-redoc                (API documentation)
```

### Helm Values Structure (GitOps)

```yaml
# values.yaml for runai-backend chart
keycloak:
  tolerations: *tolerations

grafana:
  db:
    existingSecret: grafana-db-secret
    userKey: username
    passwordKey: password
  tolerations: *tolerations
  adminUser: admin
  adminPassword: admin        # Override in production!
  dbScheme: backend

traefik:
  tolerations: *tolerations

thanos:
  tolerations: *tolerations
  query:
    tolerations: *tolerations
  receive:
    tolerations: *tolerations
    resources:
      limits:
        cpu: 800m
        memory: 4Gi
      requests:
        cpu: 500m
        memory: 2Gi

nats:
  tolerations: *tolerations

redoc:
  tolerations: *tolerations

workloads:
  tolerations: *tolerations
```

### Component Dependencies

```text
User → Traefik (ingress) → Frontend (UI)
                         → API Server → PostgreSQL (metadata)
                                     → Redis (cache)
                                     → NATS (events)
                         → Keycloak (auth)
                         → Grafana → Thanos Query → Thanos Receive
                                                        ↑
GPU Nodes → DCGM Exporter → Prometheus → Remote Write → Thanos Receive
```

### Tolerations Pattern (Anchor/Alias)

```yaml
# Define once at top of values:
tolerations: &tolerations
  - key: "node-role.kubernetes.io/infra"
    operator: "Exists"
    effect: "NoSchedule"

# Reference everywhere via *tolerations alias
# This pins all Run:ai backend Pods to infra nodes
```

### Resource Requirements Summary

```text
Component                  CPU Req   Mem Req   CPU Lim   Mem Lim   Replicas
─────────────────────────────────────────────────────────────────────────────
thanos-receive             500m      2Gi       800m      4Gi       1
thanos-query               200m      512Mi     500m      1Gi       1
postgresql                 250m      512Mi     1000m     2Gi       1
redis                      100m      128Mi     500m      512Mi     1
nats                       100m      128Mi     500m      512Mi     1 (or 3)
keycloak                   500m      1Gi       1000m     2Gi       1
api-server                 200m      512Mi     500m      1Gi       2
workload-controller        200m      512Mi     500m      1Gi       2
frontend                   50m       128Mi     200m      256Mi     2
grafana                    100m      256Mi     500m      1Gi       1
traefik                    100m      128Mi     500m      512Mi     2
─────────────────────────────────────────────────────────────────────────────
TOTAL (approx)             ~3 cores  ~8Gi      ~7 cores  ~16Gi
```

### Health Check All Components

```bash
# Quick status check
oc get pods -n runai-backend -o wide

# Check StatefulSets
oc get sts -n runai-backend

# Check which components are unhealthy
oc get pods -n runai-backend --field-selector=status.phase!=Running

# Thanos Receive specifically
oc logs -n runai-backend runai-backend-thanos-receive-0 --tail=20

# Keycloak (auth issues)
oc logs -n runai-backend -l app=keycloak --tail=20

# API server
oc logs -n runai-backend -l app=runai-api-server --tail=20
```

### ArgoCD Application Structure

```yaml
apiVersion: argoproj.io/v1alpha1
kind: Application
metadata:
  name: runai-backend
  namespace: argocd
spec:
  project: default
  source:
    repoURL: https://gitlab.example.com/gitops/runai.git
    path: config/runai/backend
    targetRevision: main
    helm:
      valueFiles:
        - values.yaml
  destination:
    server: https://kubernetes.default.svc
    namespace: runai-backend
  syncPolicy:
    automated:
      prune: true
      selfHeal: true
    syncOptions:
      - CreateNamespace=true
```

## Common Issues

### Thanos Receive CrashLoopBackOff
- **Cause**: Memory limit too low for WAL replay
- **Fix**: Increase memory in GitOps values; see dedicated troubleshooting recipe

### Keycloak login fails
- **Cause**: PostgreSQL connection lost or secret rotation
- **Fix**: Check `grafana-db-secret` exists; verify PostgreSQL Pod is running

### Grafana shows no GPU metrics
- **Cause**: Thanos Receive down → no metrics ingested
- **Fix**: Fix Thanos Receive first; historical data may have gaps

### NATS message backlog
- **Cause**: Consumer (workload-controller) overwhelmed or crashed
- **Fix**: Check workload-controller logs; restart if stuck

## Best Practices

1. **Pin all backend Pods to infra nodes** via tolerations — keep GPU nodes clean
2. **Use YAML anchors** (`&tolerations` / `*tolerations`) to avoid repetition
3. **Never store passwords in values.yaml** — use `existingSecret` references
4. **Size Thanos Receive for your metrics volume** — 4Gi minimum for production
5. **Enable ArgoCD selfHeal** — auto-reverts manual drift
6. **Monitor the monitoring** — alert on Thanos Receive restarts

## Key Takeaways

- Run:ai backend has ~15 components totaling ~3 cores / 8Gi RAM minimum
- Thanos Receive is the most resource-hungry and crash-prone component
- All components use shared tolerations to pin to infra nodes
- ArgoCD manages lifecycle — all changes must go through Git
- Grafana connects to Thanos Query (not directly to Prometheus)
- Component failure impact: Thanos down = no dashboards; Keycloak down = no login; API down = no job submission
