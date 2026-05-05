---
title: "Run:ai Backend Architecture on OpenShift"
description: "Understand the full Run:ai backend deployment on OpenShift with 40+ microservices including Keycloak, PostgreSQL, NATS, Thanos, Traefik, and workload management components."
tags:
  - "runai"
  - "openshift"
  - "architecture"
  - "platform-engineering"
  - "ai"
category: "ai"
publishDate: "2026-05-05"
author: "Luca Berton"
difficulty: "advanced"
relatedRecipes:
  - "runai-observability-opentelemetry-openshift"
  - "runai-distributed-training-openshift"
  - "nvidia-gpu-operator-gitops-openshift"
  - "openshift-gpu-node-resource-planning"
---

> 💡 **Quick Answer:** Run:ai backend on OpenShift deploys 40+ Pods in the `runai-backend` namespace including Keycloak (auth), PostgreSQL HA (4 replicas), NATS (3 replicas), Thanos (metrics), Traefik (routing), Grafana, and specialized services for workloads, scheduling, notifications, and policy enforcement.

## The Problem

Understanding what Run:ai deploys helps you:

- Troubleshoot when components fail
- Plan infrastructure node sizing
- Understand data flows (auth, metrics, scheduling)
- Manage upgrades and dependencies (Keycloak, PostgreSQL, NATS)

## The Solution

### Full Run:ai Backend Pod Inventory

```bash
oc project runai-backend
oc get pods

# NAME                                                   READY   STATUS
# --- Authentication & Identity ---
# keycloak-0                                             1/1     Running
# runai-backend-identity-manager-56c688f5c8-k4xks       1/1     Running

# --- Database (PostgreSQL HA) ---
# postgresdb-0                                          1/1     Running
# postgresdb-1                                          1/1     Running
# postgresdb-2                                          1/1     Running
# postgresdb-3                                          1/1     Running

# --- Messaging (NATS Cluster) ---
# runai-backend-nats-0                                  1/1     Running
# runai-backend-nats-1                                  1/1     Running
# runai-backend-nats-2                                  1/1     Running

# --- API & Frontend ---
# runai-backend-frontend-78b56b867d-gf2vp               1/1     Running
# runai-backend-backend-765d75bb7f-n895g                 1/1     Running
# runai-backend-traefik-765774f6f7-7lj6g                 1/1     Running
# runai-backend-cli-exposer-7f77c8cc-vztrx              1/1     Running

# --- Core Services ---
# runai-backend-cluster-service-5c98b998f8-wskx5        1/1     Running
# runai-backend-catalog-service-8595989f77-fk8v2        1/1     Running
# runai-backend-workloads-service-654f46fdcb-92mtb      1/1     Running
# runai-backend-workloads-helper-699f83c7df-cl7v2       1/1     Running
# runai-backend-workloads-manager-345c48845f-csc5w      1/1     Running

# --- Metrics & Observability ---
# runai-backend-grafana-d4d64bc54-f94hm                 2/2     Running
# runai-backend-metrics-service-b67fdff46-6b4qk         1/1     Running
# runai-backend-otelcollector-9b664b774-xnbvj           1/1     Running
# runai-backend-thanos-query-79974d8b15-nb1k7           1/1     Running
# runai-backend-thanos-receive-0                        0/1     Running
# runai-backend-diagnostics-service-b64665dc6-hmz6f     1/1     Running

# --- Policy & Authorization ---
# runai-backend-authorization-5d98686446-vmwjd          1/1     Running
# runai-backend-policy-service-746fd8f4c5-gnn69         1/1     Running
# runai-backend-tenants-manager-776656579d-9rdvw        2/2     Running

# --- Notifications ---
# runai-backend-notifications-proxy-865bb5b4fd-2vxh4    1/1     Running
# runai-backend-notifications-service-5cf69bbc74-bvxmc  1/1     Running

# --- Data Management ---
# runai-backend-datavolumes-67c4bfb59b-v2sbc            1/1     Running
# runai-backend-assets-service-778b7944bf-p5nqm         1/1     Running
# runai-backend-k8s-objects-tracker-85fbf46746-5tsjn    1/1     Running

# --- Audit & Compliance ---
# runai-backend-audit-service-5c457995dd-ppk1d          1/1     Running
# runai-backend-redoc-78896d97c5-6bxb1                  1/1     Running

# --- Organization & Multi-Tenancy ---
# runai-backend-org-unit-service-76bdf8fcc9-ppc9h       1/1     Running
# runai-backend-org-unit-helper-5fd4d57cfd-ft782        1/1     Running
# runai-backend-bff-service-6659b68d8c-sndr4            1/1     Running
```

### Architecture Diagram

```text
┌─────────────────────────────────────────────────────────────────┐
│                     Run:ai Backend Namespace                     │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ┌─────────┐    ┌───────────┐    ┌──────────────────┐          │
│  │ Traefik │───▶│ Frontend  │    │  CLI Exposer     │          │
│  │ (Route) │    │   (UI)    │    │  (runai CLI)     │          │
│  └────┬────┘    └───────────┘    └──────────────────┘          │
│       │                                                          │
│       ▼                                                          │
│  ┌─────────────────────────────────────────────┐                │
│  │              Backend API                     │                │
│  ├─────────────┬──────────────┬────────────────┤                │
│  │  Workloads  │   Cluster    │  Catalog       │                │
│  │  Service    │   Service    │  Service       │                │
│  │  + Helper   │              │                │                │
│  │  + Manager  │              │                │                │
│  └──────┬──────┴──────┬───────┴───────┬────────┘                │
│         │             │               │                          │
│         ▼             ▼               ▼                          │
│  ┌──────────┐  ┌───────────┐  ┌─────────────┐                  │
│  │PostgreSQL│  │   NATS    │  │  Keycloak   │                  │
│  │ 4-node   │  │  3-node   │  │   (Auth)    │                  │
│  │  HA      │  │  cluster  │  │             │                  │
│  └──────────┘  └───────────┘  └─────────────┘                  │
│                                                                  │
│  ┌──────────────────────────────────────────────┐               │
│  │            Observability Layer                 │               │
│  │  Grafana │ Thanos │ OTel Collector │ Diag    │               │
│  └──────────────────────────────────────────────┘               │
│                                                                  │
│  ┌──────────────────────────────────────────────┐               │
│  │          Policy & Multi-Tenancy               │               │
│  │  Authorization │ Policy │ Tenants │ Org-Unit │               │
│  └──────────────────────────────────────────────┘               │
└─────────────────────────────────────────────────────────────────┘
```

### Run:ai Cluster-Level Components

```bash
# Separate from backend — runs in 'runai' namespace
oc get pods -n runai

# NAME                                          READY   STATUS
# shared-objects-controller                      1/1     Running
# status-updater                                 1/1     Running
# workload-controller                            1/1     Running
# workload-exporter                              1/1     Running (2 replicas)
# workload-overseer                              1/1     Running
# runai-node-exporter (DaemonSet)                1/1     Running (per GPU node)
# runai-runtime-installer (DaemonSet)            1/1     Running (per node)
# runai-container-toolkit (DaemonSet)            1/1     Running (per node)
```

### Component Dependencies

```text
Component               Depends On          Purpose
────────────────────────────────────────────────────────────────
Frontend                Traefik, Backend    Web UI
Backend API             PostgreSQL, NATS    Core business logic
Keycloak                PostgreSQL          SSO / OIDC / RBAC
Cluster Service         NATS, Backend       Multi-cluster management
Workloads Service       PostgreSQL, NATS    Job submission/tracking
Metrics Service         Thanos              GPU utilization data
OTel Collector          Diagnostics         Telemetry export
Notifications           NATS                Alert routing
Policy Service          Authorization       Quota enforcement
Tenants Manager         PostgreSQL          Multi-tenancy isolation
```

### Health Checks

```bash
# Check all Pods are Running
oc get pods -n runai-backend --field-selector=status.phase!=Running

# Check Keycloak (auth)
oc exec -n runai-backend keycloak-0 -- \
  curl -s http://localhost:8080/health/ready

# Check PostgreSQL cluster
oc exec -n runai-backend postgresdb-0 -- \
  pg_isready -U postgres

# Check NATS cluster
oc exec -n runai-backend runai-backend-nats-0 -- \
  nats server check connection

# Check Thanos receive
oc logs -n runai-backend runai-backend-thanos-receive-0 --tail=10
```

### Common Errors from Terminal

```bash
# "error: the server doesn't have a resource type 'runai-backend'"
# → You tried: oc get runai-backend (wrong — it's a namespace, not a resource)
# Fix: oc project runai-backend && oc get pods

# "error: unknown command 'prokect' for 'oc'"
# → Typo: use 'oc project' not 'oc prokect'
```

## Common Issues

### Thanos receive 0/1 Ready
- **Cause**: Waiting for storage or ingestion pipeline initialization
- **Fix**: Check PVC bound; verify OTel collector is sending metrics

### PostgreSQL Pod restart loop
- **Cause**: Disk full or WAL files accumulated
- **Fix**: Check PVC usage; clean old WAL; verify backup cronjob runs

### NATS cluster split-brain
- **Cause**: Network partition between NATS replicas
- **Fix**: Check inter-Pod connectivity; NATS self-heals after partition resolves

### Keycloak failing authentication
- **Cause**: PostgreSQL connection lost or realm config corrupted
- **Fix**: Verify PostgreSQL health; check Keycloak logs for DB errors

## Best Practices

1. **Run backend on infra nodes** — don't compete with GPU workloads for resources
2. **PostgreSQL 4 replicas** — HA with 1 primary + 3 replicas for read scaling
3. **NATS 3 replicas** — quorum-based clustering for message reliability
4. **Monitor Thanos receive** — 0/1 Ready indicates metrics pipeline issues
5. **Separate namespaces** — `runai-backend` (control plane) vs `runai` (per-node agents)
6. **Keycloak backup** — export realms periodically for disaster recovery

## Key Takeaways

- Run:ai backend is 40+ microservices in `runai-backend` namespace
- Core dependencies: PostgreSQL (4-node HA), NATS (3-node cluster), Keycloak
- Observability: Grafana + Thanos + OTel Collector + Diagnostics service
- Cluster-level agents in `runai` namespace: workload-controller, node-exporter, runtime-installer
- Traefik handles ingress routing to frontend and API
- Multi-tenancy via tenants-manager + org-unit-service + authorization
- All managed via ArgoCD for GitOps reconciliation
