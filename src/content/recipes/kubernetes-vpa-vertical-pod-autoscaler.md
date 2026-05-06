---
title: "Vertical Pod Autoscaler (VPA) Guide"
description: "Configure Kubernetes Vertical Pod Autoscaler to automatically right-size container CPU and memory requests based on actual usage. Covers modes, recommendations, and production patterns."
tags:
  - "vpa"
  - "autoscaling"
  - "resource-management"
  - "cost-optimization"
  - "performance"
category: "autoscaling"
publishDate: "2026-05-06"
author: "Luca Berton"
difficulty: "intermediate"
relatedRecipes:
  - "kubernetes-hpa-autoscaling"
  - "kubernetes-resource-quota-limitrange"
  - "kubernetes-goldilocks-vpa-dashboard"
---

> 💡 **Quick Answer:** VPA monitors Pod resource usage over time and automatically adjusts CPU/memory requests to match actual consumption, eliminating over-provisioning (waste) and under-provisioning (OOM/throttling).

## The Problem

Static resource requests are almost always wrong:

- Over-provisioned: wasting 40-60% of cluster resources (industry average)
- Under-provisioned: OOMKilled or CPU-throttled under load
- Manual tuning doesn't scale (hundreds of workloads)
- Resource usage changes over time (traffic patterns, code changes)

## The Solution

### Install VPA

```bash
# Clone VPA repo
git clone https://github.com/kubernetes/autoscaler.git
cd autoscaler/vertical-pod-autoscaler

# Install VPA components
./hack/vpa-up.sh

# Or via Helm
helm repo add fairwinds-stable https://charts.fairwinds.com/stable
helm install vpa fairwinds-stable/vpa \
  --namespace vpa --create-namespace
```

### VPA Modes

```text
Mode            Behavior
─────────────────────────────────────────────────────
Off             Only generates recommendations (read-only)
Initial         Sets requests on Pod creation only (no restart)
Auto            Updates running Pods (evicts + recreates with new requests)
Recreate        Same as Auto (deprecated alias)
```

### Basic VPA Configuration

```yaml
apiVersion: autoscaling.k8s.io/v1
kind: VerticalPodAutoscaler
metadata:
  name: my-app-vpa
  namespace: default
spec:
  targetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: my-app
  updatePolicy:
    updateMode: "Auto"
  resourcePolicy:
    containerPolicies:
      - containerName: "*"
        minAllowed:
          cpu: 50m
          memory: 64Mi
        maxAllowed:
          cpu: 2000m
          memory: 4Gi
        controlledResources: ["cpu", "memory"]
        controlledValues: RequestsOnly
```

### Recommendation-Only Mode (Safe Start)

```yaml
apiVersion: autoscaling.k8s.io/v1
kind: VerticalPodAutoscaler
metadata:
  name: my-app-vpa
spec:
  targetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: my-app
  updatePolicy:
    updateMode: "Off"    # Only recommend, don't act
```

```bash
# Read recommendations
kubectl describe vpa my-app-vpa

# Output:
# Recommendation:
#   Container Recommendations:
#     Container Name: my-app
#     Lower Bound:    Cpu: 25m,  Memory: 128Mi
#     Target:         Cpu: 100m, Memory: 256Mi
#     Uncapped Target: Cpu: 100m, Memory: 256Mi
#     Upper Bound:    Cpu: 500m, Memory: 1Gi
```

### VPA with HPA (Combined)

```yaml
# VPA controls memory, HPA controls CPU scaling
apiVersion: autoscaling.k8s.io/v1
kind: VerticalPodAutoscaler
metadata:
  name: my-app-vpa
spec:
  targetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: my-app
  updatePolicy:
    updateMode: "Auto"
  resourcePolicy:
    containerPolicies:
      - containerName: my-app
        controlledResources: ["memory"]  # VPA only manages memory
        # CPU managed by HPA (replica scaling)
---
apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata:
  name: my-app-hpa
spec:
  scaleTargetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: my-app
  minReplicas: 2
  maxReplicas: 10
  metrics:
    - type: Resource
      resource:
        name: cpu
        target:
          type: Utilization
          averageUtilization: 70
```

### Production VPA Pattern

```yaml
apiVersion: autoscaling.k8s.io/v1
kind: VerticalPodAutoscaler
metadata:
  name: api-server-vpa
spec:
  targetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: api-server
  updatePolicy:
    updateMode: "Auto"
    minReplicas: 2    # Don't evict if < 2 replicas ready
  resourcePolicy:
    containerPolicies:
      - containerName: api-server
        minAllowed:
          cpu: 100m
          memory: 128Mi
        maxAllowed:
          cpu: 4000m
          memory: 8Gi
        controlledResources: ["cpu", "memory"]
        controlledValues: RequestsAndLimits
      - containerName: sidecar
        mode: "Off"    # Don't touch sidecar resources
```

### Monitor VPA Decisions

```bash
# Check all VPA recommendations
kubectl get vpa -A -o custom-columns=\
  'NAME:.metadata.name,MODE:.spec.updatePolicy.updateMode,CPU:.status.recommendation.containerRecommendations[0].target.cpu,MEM:.status.recommendation.containerRecommendations[0].target.memory'

# Watch for VPA evictions
kubectl get events --field-selector reason=EvictedByVPA -A

# Prometheus metrics
# vpa_recommender_recommendation_latency_seconds
# vpa_updater_evictions_total
# vpa_status_recommendation{resource="cpu|memory",bound="target|lower|upper"}
```

## Common Issues

### VPA keeps evicting Pods during peak traffic
- **Cause**: Auto mode evicts to apply new requests
- **Fix**: Use `minReplicas` in updatePolicy; or use "Initial" mode + rolling restart

### VPA and HPA conflict on CPU
- **Cause**: Both trying to manage CPU — HPA adds replicas, VPA increases per-Pod CPU
- **Fix**: Let HPA manage CPU (horizontal), VPA manage memory only

### Recommendations stuck at initial values
- **Cause**: Not enough metrics history (VPA needs 8+ hours of data)
- **Fix**: Wait 24-48h for stable recommendations; check metrics-server is running

### VPA sets requests too low
- **Cause**: Low traffic period skewed the recommendation
- **Fix**: Set `minAllowed` to prevent requests going below safe threshold

## Best Practices

1. **Start with "Off" mode** — read recommendations for 1 week before enabling Auto
2. **Set minAllowed/maxAllowed** — prevent extreme values
3. **Use VPA for memory, HPA for CPU** — best of both worlds
4. **Exclude sidecars** — `mode: "Off"` for istio-proxy, logging sidecars
5. **minReplicas: 2** in updatePolicy — prevents evicting last Pod
6. **controlledValues: RequestsOnly** — let limits float with LimitRange ratios

## Key Takeaways

- VPA right-sizes containers based on actual usage (target = P90 usage + buffer)
- Three modes: Off (recommend only), Initial (set on create), Auto (evict + recreate)
- Combine with HPA: VPA→memory, HPA→CPU for optimal scaling
- Needs 24-48h of metrics history for stable recommendations
- minAllowed/maxAllowed prevent VPA from setting extreme values
- Production: start Off, validate recommendations, then enable Auto
- Saves 30-50% cluster cost by eliminating over-provisioning
