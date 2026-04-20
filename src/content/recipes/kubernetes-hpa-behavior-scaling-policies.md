---
title: "HPA Behavior and Scaling Policies"
description: "Configure HPA scaling behavior with stabilization windows, scaling policies, and rate limiting. Fine-tune scale-up and scale-down speed."
publishDate: "2026-04-20"
author: "Luca Berton"
category: "autoscaling"
difficulty: "advanced"
timeToComplete: "20 minutes"
kubernetesVersion: "1.28+"
tags:
  - hpa
  - autoscaling
  - scaling-policies
  - stabilization
relatedRecipes:
  - "horizontal-pod-autoscaler"
  - "hpa-custom-metrics"
  - "kubernetes-custom-metrics-autoscaling"
---

> 💡 **Quick Answer:** Use `spec.behavior` in HPA to control scaling speed. Set `stabilizationWindowSeconds` to prevent flapping, `policies` to limit scale rate (e.g., max 4 pods per 60s), and `selectPolicy: Min` for conservative scaling. Scale-up and scale-down have independent configs.

## The Problem

Default HPA scaling can be too aggressive (adding too many pods at once) or too slow (not responding fast enough to traffic spikes). You need fine-grained control over how fast pods scale up and down.

## The Solution

```yaml
apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata:
  name: webapp-hpa
  namespace: production
spec:
  scaleTargetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: webapp
  minReplicas: 3
  maxReplicas: 50
  metrics:
    - type: Resource
      resource:
        name: cpu
        target:
          type: Utilization
          averageUtilization: 70
  behavior:
    scaleUp:
      stabilizationWindowSeconds: 0
      policies:
        - type: Percent
          value: 100
          periodSeconds: 60
        - type: Pods
          value: 4
          periodSeconds: 60
      selectPolicy: Max
    scaleDown:
      stabilizationWindowSeconds: 300
      policies:
        - type: Percent
          value: 10
          periodSeconds: 60
      selectPolicy: Min
```

## Behavior Configuration Explained

### Scale-Up Policies

```yaml
behavior:
  scaleUp:
    # No stabilization — react immediately to load
    stabilizationWindowSeconds: 0
    policies:
      # Allow doubling replicas per minute
      - type: Percent
        value: 100
        periodSeconds: 60
      # OR add up to 4 pods per minute
      - type: Pods
        value: 4
        periodSeconds: 60
    # Use whichever policy allows MORE pods
    selectPolicy: Max
```

### Scale-Down Policies

```yaml
behavior:
  scaleDown:
    # Wait 5 minutes before scaling down (prevent flapping)
    stabilizationWindowSeconds: 300
    policies:
      # Remove max 10% of pods per minute
      - type: Percent
        value: 10
        periodSeconds: 60
    # Conservative: use policy allowing FEWER removals
    selectPolicy: Min
```

### Disable Scale-Down Entirely

```yaml
behavior:
  scaleDown:
    selectPolicy: Disabled
```

## Real-World Patterns

### Aggressive Scale-Up, Conservative Scale-Down

Best for web applications with bursty traffic:

```yaml
behavior:
  scaleUp:
    stabilizationWindowSeconds: 0
    policies:
      - type: Percent
        value: 200
        periodSeconds: 30
  scaleDown:
    stabilizationWindowSeconds: 600
    policies:
      - type: Pods
        value: 1
        periodSeconds: 300
```

### Gradual Scaling for Stateful Workloads

```yaml
behavior:
  scaleUp:
    stabilizationWindowSeconds: 120
    policies:
      - type: Pods
        value: 2
        periodSeconds: 120
  scaleDown:
    stabilizationWindowSeconds: 600
    policies:
      - type: Pods
        value: 1
        periodSeconds: 600
```

## Monitoring HPA Behavior

```bash
# Check current scaling decisions
kubectl describe hpa webapp-hpa

# Watch scaling events
kubectl get events --field-selector reason=SuccessfulRescale

# View HPA conditions
kubectl get hpa webapp-hpa -o jsonpath='{.status.conditions[*].message}'
```

## Common Issues

| Issue | Cause | Fix |
|-------|-------|-----|
| Flapping (scale up/down loop) | stabilizationWindow too short | Increase to 300-600s for scale-down |
| Slow response to spikes | stabilizationWindow too long on scale-up | Set to 0 for scale-up |
| Over-provisioning | selectPolicy: Max on scale-up | Use Percent policy with lower values |
| Pods never scale down | selectPolicy: Disabled | Remove or change to Min |

## Best Practices

1. **Always set stabilization for scale-down** — 300s minimum prevents flapping
2. **Use Percent for scale-up** — Scales proportionally regardless of current size
3. **Use Pods for scale-down** — Predictable, gradual reduction
4. **Monitor with events** — `SuccessfulRescale` events show actual scaling decisions
5. **Test with load generators** — Verify behavior before production

## Key Takeaways

- `behavior.scaleUp` and `behavior.scaleDown` are configured independently
- `stabilizationWindowSeconds` prevents rapid oscillation
- `selectPolicy: Max` = aggressive (more pods), `Min` = conservative (fewer changes)
- Multiple policies can be defined; `selectPolicy` picks which to apply
- Set scale-up stabilization to 0 for immediate response to traffic spikes
