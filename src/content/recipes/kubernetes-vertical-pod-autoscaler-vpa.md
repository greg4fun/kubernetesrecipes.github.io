---
title: "Kubernetes Vertical Pod Autoscaler VPA Guide"
description: "Deploy and configure the Vertical Pod Autoscaler (VPA) on Kubernetes. Auto-adjust CPU and memory requests based on actual usage, right-size"
tags:
  - "vpa"
  - "autoscaling"
  - "resource-management"
  - "right-sizing"
  - "vertical-scaling"
category: "autoscaling"
publishDate: "2026-06-01"
author: "Luca Berton"
difficulty: "intermediate"
relatedRecipes:
  - "kubernetes-horizontal-pod-autoscaler-v2"
  - "kubernetes-oomkilled-troubleshooting-prevention"
---

> 💡 **Quick Answer:** The Vertical Pod Autoscaler (VPA) automatically adjusts pod CPU and memory requests/limits based on historical usage. Install with `./hack/vpa-up.sh` from the autoscaler repo, create a VPA resource targeting your Deployment, and set `updateMode: "Auto"` for automatic adjustment or `"Off"` for recommendations only.

## The Problem

- Developers guess resource requests — too low causes OOMKilled, too high wastes cluster capacity
- Manual right-sizing requires constant monitoring and adjustment
- Applications' resource needs change over time (traffic patterns, data growth)
- Over-provisioned clusters waste 40-60% of allocated resources
- Under-provisioned pods get throttled (CPU) or killed (memory)

## The Solution

### Install VPA

```bash
# Clone the autoscaler repo
git clone https://github.com/kubernetes/autoscaler.git
cd autoscaler/vertical-pod-autoscaler

# Install VPA components (admission controller, recommender, updater)
./hack/vpa-up.sh

# Verify
kubectl get pods -n kube-system | grep vpa
# vpa-admission-controller-xxx   1/1   Running   0   1m
# vpa-recommender-xxx            1/1   Running   0   1m
# vpa-updater-xxx                1/1   Running   0   1m
```

### VPA in Recommendation Mode (Safe Start)

```yaml
apiVersion: autoscaling.k8s.io/v1
kind: VerticalPodAutoscaler
metadata:
  name: my-app-vpa
  namespace: production
spec:
  targetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: my-app
  updatePolicy:
    updateMode: "Off"    # Only recommend, don't change pods
  resourcePolicy:
    containerPolicies:
      - containerName: "*"
        minAllowed:
          cpu: "50m"
          memory: "64Mi"
        maxAllowed:
          cpu: "4"
          memory: "8Gi"
        controlledResources: ["cpu", "memory"]
```

```bash
# Check recommendations
kubectl describe vpa my-app-vpa -n production
# Recommendation:
#   Container Recommendations:
#     Container Name: my-app
#     Lower Bound:    Cpu: 100m, Memory: 128Mi
#     Target:         Cpu: 250m, Memory: 384Mi   ← Use this
#     Upper Bound:    Cpu: 1000m, Memory: 1Gi
#     Uncapped Target: Cpu: 250m, Memory: 384Mi
```

### VPA in Auto Mode

```yaml
apiVersion: autoscaling.k8s.io/v1
kind: VerticalPodAutoscaler
metadata:
  name: my-app-vpa
  namespace: production
spec:
  targetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: my-app
  updatePolicy:
    updateMode: "Auto"       # Automatically adjust + restart pods
    minReplicas: 2           # Don't evict if fewer than 2 replicas
  resourcePolicy:
    containerPolicies:
      - containerName: app
        minAllowed:
          cpu: "100m"
          memory: "128Mi"
        maxAllowed:
          cpu: "2"
          memory: "4Gi"
        controlledResources: ["cpu", "memory"]
        controlledValues: RequestsAndLimits  # or RequestsOnly
```

### Update Modes

```text
Mode       │ Behavior
───────────┼─────────────────────────────────────────────────────────
Off        │ Only generates recommendations (no pod changes)
           │ Safe for production exploration
───────────┼─────────────────────────────────────────────────────────
Initial    │ Sets resources only at pod creation (no evictions)
           │ Good for Jobs and one-shot pods
───────────┼─────────────────────────────────────────────────────────
Auto       │ Evicts and recreates pods with new resource values
           │ Full automation (ensure PDB protects availability)
───────────┴─────────────────────────────────────────────────────────
```

### VPA with Multiple Containers

```yaml
apiVersion: autoscaling.k8s.io/v1
kind: VerticalPodAutoscaler
metadata:
  name: multi-container-vpa
spec:
  targetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: my-app
  updatePolicy:
    updateMode: "Auto"
  resourcePolicy:
    containerPolicies:
      - containerName: app
        minAllowed:
          cpu: "200m"
          memory: "256Mi"
        maxAllowed:
          cpu: "4"
          memory: "8Gi"
      - containerName: sidecar
        mode: "Off"    # Don't touch sidecar resources
      - containerName: init-container
        mode: "Off"    # Don't touch init containers
```

## Common Issues

### VPA evicting pods too frequently
- **Cause**: Small resource changes trigger unnecessary restarts
- **Fix**: Set `minReplicas` > 1; use PodDisruptionBudget; widen min/max range

### VPA and HPA conflict
- **Cause**: Both trying to adjust the same deployment — VPA changes requests, HPA scales replicas
- **Fix**: Use VPA for CPU/memory right-sizing + HPA for replica scaling on custom metrics (not CPU)

### "cannot use VPA with HPA on CPU"
- **Cause**: HPA targets CPU utilization percentage — VPA changes the denominator
- **Fix**: Use HPA with custom/external metrics (not `cpu`/`memory`) alongside VPA

### Recommendations show 0 after VPA creation
- **Cause**: VPA needs 24-48h of metrics history to generate reliable recommendations
- **Fix**: Wait for data collection; ensure metrics-server is running

## Best Practices

1. **Start with `Off` mode** — observe recommendations before enabling auto-adjustment
2. **Set min/max bounds** — prevent recommendations from going too low (OOM) or too high (waste)
3. **Use PodDisruptionBudgets** — protect availability when VPA evicts pods
4. **Don't combine VPA + HPA on CPU** — they conflict; use custom metrics with HPA
5. **`controlledValues: RequestsOnly`** — let limits float with a ratio to requests
6. **Monitor recommendation stability** — erratic recommendations indicate variable workloads (use HPA instead)

## Key Takeaways

- VPA auto-adjusts CPU/memory requests based on actual historical usage
- Install with `./hack/vpa-up.sh` from kubernetes/autoscaler repo
- Three modes: `Off` (recommend only), `Initial` (set at creation), `Auto` (evict + update)
- Recommendations include lower bound, target, and upper bound
- VPA + HPA: safe only when HPA uses custom metrics (not CPU/memory)
- Set `minAllowed`/`maxAllowed` to prevent extreme values
- `Auto` mode evicts pods — use PDB to maintain availability during restarts
