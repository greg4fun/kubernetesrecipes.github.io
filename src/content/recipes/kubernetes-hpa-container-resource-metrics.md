---
title: "HPA Container Resource Metrics"
description: "Configure HPA to scale based on individual container metrics instead of pod-level averages. Target specific containers in multi-container pods."
publishDate: "2026-04-20"
author: "Luca Berton"
category: "autoscaling"
difficulty: "intermediate"
timeToComplete: "10 minutes"
kubernetesVersion: "1.30+"
tags:
  - hpa
  - autoscaling
  - container-metrics
  - multi-container
relatedRecipes:
  - "horizontal-pod-autoscaler"
  - "hpa-custom-metrics"
  - "kubernetes-sidecar-patterns"
---

> 💡 **Quick Answer:** Use `type: ContainerResource` in HPA metrics to scale based on a specific container's CPU/memory, ignoring sidecars. Set `container: app` to target only your main container. Requires K8s 1.30+ (stable in 1.30, beta since 1.27).

## The Problem

In multi-container pods (app + sidecar pattern), pod-level CPU/memory metrics include all containers. A logging sidecar consuming high CPU could trigger unnecessary scaling, or a sidecar masking the app container's actual load.

## The Solution

```yaml
apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata:
  name: webapp-hpa
spec:
  scaleTargetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: webapp
  minReplicas: 2
  maxReplicas: 20
  metrics:
    - type: ContainerResource
      containerResource:
        name: cpu
        container: app
        target:
          type: Utilization
          averageUtilization: 70
    - type: ContainerResource
      containerResource:
        name: memory
        container: app
        target:
          type: Utilization
          averageUtilization: 80
```

## Multi-Container Pod Example

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: webapp
spec:
  template:
    spec:
      containers:
        - name: app           # <-- HPA targets THIS container
          image: myapp:v2
          resources:
            requests:
              cpu: 500m
              memory: 256Mi
            limits:
              cpu: "2"
              memory: 1Gi
        - name: istio-proxy   # Sidecar — excluded from HPA
          image: istio/proxyv2:1.22
          resources:
            requests:
              cpu: 100m
              memory: 128Mi
        - name: fluentbit     # Logging sidecar — excluded
          image: fluent/fluent-bit:3.1
          resources:
            requests:
              cpu: 50m
              memory: 64Mi
```

## Comparison: Resource vs ContainerResource

```yaml
# Pod-level (includes ALL containers)
metrics:
  - type: Resource
    resource:
      name: cpu
      target:
        type: Utilization
        averageUtilization: 70

# Container-level (specific container only)
metrics:
  - type: ContainerResource
    containerResource:
      name: cpu
      container: app
      target:
        type: Utilization
        averageUtilization: 70
```

## Verify It Works

```bash
# Check which container metrics HPA reads
kubectl describe hpa webapp-hpa

# Output shows:
# Metrics: (current / target)
#   resource cpu on pods (as a percentage of request): 45% / 70%
#   container resource cpu on container "app" (as a percentage of request): 62% / 70%
```

## Common Issues

| Issue | Cause | Fix |
|-------|-------|-----|
| `FailedGetContainerResourceMetric` | Container name typo | Verify container name matches pod spec |
| Metrics not available | metrics-server version | Upgrade to metrics-server 0.6+ |
| Feature not working | K8s too old | Requires 1.27+ (beta), 1.30+ (stable) |
| Scaling on wrong container | Using `Resource` instead of `ContainerResource` | Switch metric type |

## Best Practices

1. **Always use ContainerResource for sidecar-injected workloads** — Istio, Vault, Fluentbit sidecars skew pod-level metrics
2. **Set resource requests on ALL containers** — ContainerResource calculates utilization from requests
3. **Combine with pod-level memory** — Use ContainerResource for CPU, Resource for memory if needed
4. **Name containers clearly** — The container name in HPA must exactly match the pod spec

## Key Takeaways

- `ContainerResource` isolates scaling decisions to a single container
- Essential for Istio/service mesh environments where sidecars consume significant CPU
- Requires Kubernetes 1.30+ for stable support
- Container name must exactly match the pod spec container name
- Still requires resource requests to be set for utilization-based targets
