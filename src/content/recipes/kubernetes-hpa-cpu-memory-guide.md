---
title: "K8s HPA: Autoscale on CPU and Memory"
description: "Configure Kubernetes HorizontalPodAutoscaler to scale on CPU and memory utilization. Target utilization, minReplicas, maxReplicas, and scaling behavior."
publishDate: "2026-05-02"
author: "Luca Berton"
category: "autoscaling"
difficulty: "intermediate"
timeToComplete: "10 minutes"
kubernetesVersion: "1.28+"
tags:
  - "hpa"
  - "autoscaling"
  - "cpu"
  - "memory"
  - "cka"
relatedRecipes:
  - "horizontal-pod-autoscaler"
  - "hpa-custom-metrics"
  - "vertical-pod-autoscaler"
  - "kubernetes-keda-autoscaling-guide"
---

> 💡 **Quick Answer:** `kubectl autoscale deployment web --cpu-percent=70 --min=2 --max=10` creates an HPA that scales between 2-10 replicas targeting 70% CPU utilization. Pods MUST have CPU `requests` set — HPA calculates utilization as `current_usage / request`. Formula: `desiredReplicas = ceil(currentReplicas × (currentMetric / targetMetric))`.

## The Problem

Fixed replica counts waste resources or can't handle traffic spikes:

- 10 replicas at 3 AM = wasted compute
- 2 replicas during Black Friday = outage
- Manual scaling is slow and error-prone
- Need to balance cost vs performance automatically

## The Solution

### Create HPA

```bash
# Imperative (quick)
kubectl autoscale deployment web-app \
  --cpu-percent=70 \
  --min=2 \
  --max=20

# Check status
kubectl get hpa
# NAME      REFERENCE            TARGETS   MINPODS   MAXPODS   REPLICAS
# web-app   Deployment/web-app   23%/70%   2         20        3
```

### HPA YAML (autoscaling/v2)

```yaml
apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata:
  name: web-app-hpa
spec:
  scaleTargetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: web-app
  minReplicas: 2
  maxReplicas: 20
  metrics:
  # CPU utilization target
  - type: Resource
    resource:
      name: cpu
      target:
        type: Utilization
        averageUtilization: 70    # 70% of CPU request
  
  # Memory utilization target
  - type: Resource
    resource:
      name: memory
      target:
        type: Utilization
        averageUtilization: 80    # 80% of memory request
  
  # Scaling behavior
  behavior:
    scaleUp:
      stabilizationWindowSeconds: 60    # Wait 60s before scaling up
      policies:
      - type: Percent
        value: 100                      # Double replicas at most
        periodSeconds: 60
      - type: Pods
        value: 4                        # Add at most 4 pods
        periodSeconds: 60
      selectPolicy: Max                 # Use whichever adds more
    scaleDown:
      stabilizationWindowSeconds: 300   # Wait 5min before scaling down
      policies:
      - type: Percent
        value: 10                       # Remove 10% at a time
        periodSeconds: 60
```

### Prerequisites

```yaml
# Pods MUST have resource requests — HPA needs them!
containers:
- name: web
  image: myapp:v2
  resources:
    requests:
      cpu: 200m        # HPA: 70% of 200m = 140m target
      memory: 256Mi    # HPA: 80% of 256Mi = ~205Mi target
    limits:
      cpu: 500m
      memory: 512Mi
```

```bash
# metrics-server must be running
kubectl get pods -n kube-system | grep metrics-server
# If missing:
kubectl apply -f https://github.com/kubernetes-sigs/metrics-server/releases/latest/download/components.yaml

# Verify metrics
kubectl top pods
```

### How HPA Calculates Replicas

```
Current: 3 replicas, each using 180m CPU, request = 200m
Average utilization: 180m / 200m = 90%
Target: 70%

desiredReplicas = ceil(3 × (90 / 70)) = ceil(3.86) = 4

→ Scale up to 4 replicas
```

### Monitor HPA

```bash
# Current state
kubectl get hpa web-app-hpa
# NAME          TARGETS         MINPODS   MAXPODS   REPLICAS
# web-app-hpa   45%/70%,60%/80%   2        20        5

# Detailed status
kubectl describe hpa web-app-hpa
# Events:
#   Normal  SuccessfulRescale  4m   horizontal-pod-autoscaler  New size: 5; reason: cpu above target

# HPA conditions
kubectl get hpa web-app-hpa -o yaml | grep -A10 conditions
```

### Scaling on Multiple Metrics

```yaml
# HPA evaluates ALL metrics and picks the highest replica count
metrics:
- type: Resource
  resource:
    name: cpu
    target:
      type: Utilization
      averageUtilization: 70
- type: Resource
  resource:
    name: memory
    target:
      type: Utilization
      averageUtilization: 80

# If CPU says 5 replicas and memory says 8 replicas → 8 replicas
```

## Common Issues

**HPA shows `<unknown>/70%` for targets**

Pods don't have resource requests set, or metrics-server is not running. Add `resources.requests` to all containers.

**HPA not scaling down**

Default `stabilizationWindowSeconds` for scale-down is 300s (5 min). HPA waits to avoid flapping. Check `behavior.scaleDown`.

**HPA keeps scaling up and down (flapping)**

Set `stabilizationWindowSeconds` higher (5-10 min for scale-down). Or increase the gap between target and actual utilization.

**Memory-based HPA doesn't scale down**

Memory often doesn't decrease after load drops (JVM, Go GC). CPU-based HPA is more reliable for scale-down. Use memory HPA as a ceiling only.

## Best Practices

- **Always set CPU requests** on pods — HPA can't work without them
- **Target 70% CPU utilization** — leaves headroom for spikes
- **Use `behavior` to control scale speed** — fast up, slow down
- **Don't HPA on memory alone** — memory rarely decreases, causes thrashing
- **Combine with Cluster Autoscaler** — HPA scales pods, CA scales nodes

## Key Takeaways

- HPA scales pod replicas based on CPU/memory utilization or custom metrics
- Pods must have `resources.requests` set for utilization calculation
- metrics-server is required for CPU/memory based HPA
- Use `behavior` to control scaling speed and prevent flapping
- Scale up fast (60s window), scale down slow (300s window) for stability
