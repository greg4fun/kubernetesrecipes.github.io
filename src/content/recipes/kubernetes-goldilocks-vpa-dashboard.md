---
title: "Goldilocks VPA Dashboard for Resource Optimization"
description: "Deploy Goldilocks to visualize VPA recommendations across all workloads and identify over-provisioned or under-provisioned containers with actionable right-sizing guidance."
tags:
  - "goldilocks"
  - "vpa"
  - "cost-optimization"
  - "resource-management"
  - "dashboard"
category: "autoscaling"
publishDate: "2026-05-06"
author: "Luca Berton"
difficulty: "beginner"
relatedRecipes:
  - "kubernetes-vpa-vertical-pod-autoscaler"
  - "kubernetes-resource-quota-limitrange"
  - "kubernetes-hpa-autoscaling"
---

> 💡 **Quick Answer:** Goldilocks creates VPA objects for every Deployment in labeled namespaces and provides a dashboard showing "just right" resource recommendations — identifying which containers are over-provisioned (wasting money) or under-provisioned (risking OOM).

## The Problem

- You have 200+ Deployments — which ones are over/under-provisioned?
- VPA recommendations exist but nobody reads `kubectl describe vpa` for each one
- Need a visual dashboard for platform teams to review resource efficiency
- Want to identify quick wins (containers requesting 4Gi but using 200Mi)

## The Solution

### Install Goldilocks

```bash
helm repo add fairwinds-stable https://charts.fairwinds.com/stable
helm install goldilocks fairwinds-stable/goldilocks \
  --namespace goldilocks --create-namespace \
  --set dashboard.enabled=true \
  --set vpa.enabled=true
```

### Enable for Namespaces

```bash
# Label namespaces to enable Goldilocks analysis
kubectl label namespace default goldilocks.fairwinds.com/enabled=true
kubectl label namespace production goldilocks.fairwinds.com/enabled=true
kubectl label namespace staging goldilocks.fairwinds.com/enabled=true

# Goldilocks auto-creates VPA (mode=Off) for every Deployment in labeled namespaces
```

### Access Dashboard

```bash
# Port-forward to dashboard
kubectl port-forward -n goldilocks svc/goldilocks-dashboard 8080:80

# Or expose via Ingress
kubectl apply -f - << 'INGRESS'
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: goldilocks
  namespace: goldilocks
spec:
  rules:
    - host: goldilocks.example.com
      http:
        paths:
          - path: /
            pathType: Prefix
            backend:
              service:
                name: goldilocks-dashboard
                port:
                  number: 80
INGRESS
```

### Dashboard Shows Per-Container

```text
┌─────────────────────────────────────────────────────────────────┐
│ Namespace: production                                           │
├─────────────────────────────────────────────────────────────────┤
│ Deployment: api-server                                         │
│ ┌─────────────┬──────────┬──────────┬──────────┬─────────────┐ │
│ │ Container   │ Current  │ Lower    │ Target   │ Upper       │ │
│ ├─────────────┼──────────┼──────────┼──────────┼─────────────┤ │
│ │ api (CPU)   │ 1000m    │ 50m      │ 150m     │ 500m        │ │
│ │ api (Mem)   │ 2Gi      │ 128Mi    │ 256Mi    │ 1Gi         │ │
│ │ → OVER-PROVISIONED: saving 850m CPU, 1.75Gi memory         │ │
│ ├─────────────┼──────────┼──────────┼──────────┼─────────────┤ │
│ │ sidecar     │ 100m     │ 10m      │ 25m      │ 100m        │ │
│ └─────────────┴──────────┴──────────┴──────────┴─────────────┘ │
├─────────────────────────────────────────────────────────────────┤
│ Deployment: worker                                             │
│ ┌─────────────┬──────────┬──────────┬──────────┬─────────────┐ │
│ │ worker(CPU) │ 200m     │ 300m     │ 800m     │ 2000m       │ │
│ │ worker(Mem) │ 512Mi    │ 1Gi      │ 2Gi      │ 4Gi         │ │
│ │ → UNDER-PROVISIONED: needs 600m more CPU, 1.5Gi more RAM   │ │
│ └─────────────┴──────────┴──────────┴──────────┴─────────────┘ │
└─────────────────────────────────────────────────────────────────┘
```

### Export Recommendations as YAML

```bash
# Get all VPA recommendations programmatically
kubectl get vpa -n production -o json | jq '
  .items[] |
  {
    deployment: .spec.targetRef.name,
    containers: [.status.recommendation.containerRecommendations[] |
      {
        name: .containerName,
        target_cpu: .target.cpu,
        target_memory: .target.memory,
        current_cpu: .lowerBound.cpu,
        upper_cpu: .upperBound.cpu
      }
    ]
  }
'
```

## Common Issues

### No recommendations showing
- **Cause**: VPA needs 24-48h of metrics; or metrics-server not installed
- **Fix**: Wait; verify `kubectl top pods` works

### Dashboard shows "No data"
- **Cause**: Namespace not labeled
- **Fix**: `kubectl label ns <name> goldilocks.fairwinds.com/enabled=true`

## Best Practices

1. **Enable on all non-system namespaces** — comprehensive visibility
2. **Review weekly** — top 10 over-provisioned workloads = quick cost wins
3. **Apply "Target" recommendations** — balanced between lower/upper bound
4. **Combine with VPA Auto** — Goldilocks shows, VPA applies
5. **Track savings** — before/after resource reduction per namespace

## Key Takeaways

- Goldilocks = VPA recommendations + web dashboard (visual)
- Label namespaces to enable; auto-creates VPA objects per Deployment
- Shows current vs recommended resources per container
- Identifies over-provisioned (wasting money) and under-provisioned (risking OOM)
- Typical finding: 40-60% of cluster resources are over-provisioned
- Use "Target" column as the recommended right-size value
- Apply recommendations gradually; monitor for OOM/throttling after changes
