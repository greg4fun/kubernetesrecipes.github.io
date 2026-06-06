---
title: "K8s Horizontal Scaling: Manual and Auto"
description: "Scale Kubernetes workloads horizontally with kubectl scale, HPA, and KEDA. Covers replica management and event-driven scaling strategies."
publishDate: "2026-05-02"
author: "Luca Berton"
category: "autoscaling"
difficulty: "intermediate"
timeToComplete: "10 minutes"
kubernetesVersion: "1.28+"
tags:
  - "autoscaling"
  - "hpa"
  - "scaling"
  - "keda"
  - "performance"
relatedRecipes:
  - "kubernetes-metrics-server-top"
  - "kubernetes-resource-quota-limitrange"
  - "kubernetes-qos-classes-guide"
---

> 💡 **Quick Answer:** Manual: `kubectl scale deployment/app --replicas=5`. Auto: HPA scales on CPU/memory (`kubectl autoscale deployment/app --min=2 --max=10 --cpu-percent=70`). Event-driven: KEDA scales on queue length, cron, Prometheus metrics. Combine HPA + PDB for safe scaling. For scale-to-zero, use KEDA — HPA minimum is 1.

## The Problem

Static replica counts waste resources or cause outages:

- Fixed replicas → over-provisioned during low traffic
- Fixed replicas → under-provisioned during peak
- Manual scaling → human latency, error-prone
- Need event-driven scaling (queue depth, scheduled traffic)

## The Solution

### Manual Scaling

```bash
# Scale deployment
kubectl scale deployment/web --replicas=5

# Scale statefulset
kubectl scale statefulset/db --replicas=3

# Scale replicaset directly (not recommended)
kubectl scale rs/web-abc123 --replicas=5

# Conditional scale (only if current replicas match)
kubectl scale deployment/web --replicas=5 --current-replicas=3

# Scale to zero (for non-production)
kubectl scale deployment/web --replicas=0
```

### HPA (CPU/Memory)

```yaml
apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata:
  name: web-hpa
spec:
  scaleTargetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: web
  minReplicas: 2
  maxReplicas: 20
  
  metrics:
  # CPU target
  - type: Resource
    resource:
      name: cpu
      target:
        type: Utilization
        averageUtilization: 70
  
  # Memory target
  - type: Resource
    resource:
      name: memory
      target:
        type: Utilization
        averageUtilization: 80
  
  behavior:
    scaleUp:
      stabilizationWindowSeconds: 60
      policies:
      - type: Percent
        value: 100               # Double replicas
        periodSeconds: 60
      - type: Pods
        value: 4                 # Or add 4 pods
        periodSeconds: 60
      selectPolicy: Max          # Use whichever adds more
    
    scaleDown:
      stabilizationWindowSeconds: 300   # Wait 5min before scaling down
      policies:
      - type: Percent
        value: 25                # Remove 25% of replicas
        periodSeconds: 60
      selectPolicy: Min          # Conservative scale-down
```

```bash
# Quick HPA creation
kubectl autoscale deployment/web --min=2 --max=10 --cpu-percent=70

# Monitor HPA
kubectl get hpa -w
# NAME      REFERENCE        TARGETS   MINPODS   MAXPODS   REPLICAS
# web-hpa   Deployment/web   45%/70%   2         20        3

# Detailed status
kubectl describe hpa web-hpa
```

### Custom Metrics HPA

```yaml
apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata:
  name: web-hpa
spec:
  scaleTargetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: web
  minReplicas: 2
  maxReplicas: 50
  
  metrics:
  # Prometheus custom metric (via prometheus-adapter)
  - type: Pods
    pods:
      metric:
        name: http_requests_per_second
      target:
        type: AverageValue
        averageValue: 100        # Scale when >100 rps per pod
  
  # External metric (e.g., queue length)
  - type: External
    external:
      metric:
        name: sqs_queue_length
        selector:
          matchLabels:
            queue: orders
      target:
        type: Value
        value: 50                # Scale when queue > 50
```

### KEDA (Event-Driven Autoscaling)

```yaml
# Install KEDA
# helm repo add kedacore https://kedacore.github.io/charts
# helm install keda kedacore/keda -n keda-system

apiVersion: keda.sh/v1alpha1
kind: ScaledObject
metadata:
  name: order-processor
spec:
  scaleTargetRef:
    name: order-processor       # Deployment name
  minReplicaCount: 0            # Scale to zero!
  maxReplicaCount: 50
  cooldownPeriod: 300
  
  triggers:
  # Scale on RabbitMQ queue length
  - type: rabbitmq
    metadata:
      queueName: orders
      host: amqp://rabbitmq.default:5672
      queueLength: "10"         # 1 pod per 10 messages
  
  # Scale on Prometheus metric
  - type: prometheus
    metadata:
      serverAddress: http://prometheus:9090
      metricName: http_requests_total
      query: sum(rate(http_requests_total{app="web"}[2m]))
      threshold: "100"
  
  # Scale on cron schedule
  - type: cron
    metadata:
      timezone: UTC
      start: "0 8 * * 1-5"     # Weekdays 8 AM
      end: "0 18 * * 1-5"      # Weekdays 6 PM
      desiredReplicas: "10"     # Business hours scaling

---
# Scale Jobs (for batch processing)
apiVersion: keda.sh/v1alpha1
kind: ScaledJob
metadata:
  name: batch-processor
spec:
  jobTargetRef:
    template:
      spec:
        containers:
        - name: processor
          image: batch:v1
        restartPolicy: Never
  triggers:
  - type: rabbitmq
    metadata:
      queueName: batch-jobs
      queueLength: "1"
  maxReplicaCount: 20
  successfulJobsHistoryLimit: 5
  failedJobsHistoryLimit: 3
```

### Scaling + PDB (Safe Scaling)

```yaml
# PodDisruptionBudget — protect during scale-down
apiVersion: policy/v1
kind: PodDisruptionBudget
metadata:
  name: web-pdb
spec:
  selector:
    matchLabels:
      app: web
  minAvailable: 2              # Always keep 2 running
  # Or: maxUnavailable: 1     # Allow 1 down at a time
```

### Scaling Strategy Comparison

```
Manual (kubectl scale):
  ✅ Simple, immediate
  ❌ Requires human intervention
  → Use for: one-time adjustments, emergencies

HPA (CPU/Memory):
  ✅ Built-in, no extra components
  ❌ Min 1 replica, lag on sudden spikes
  → Use for: steady web traffic

HPA (Custom Metrics):
  ✅ Scale on business metrics
  ❌ Requires metrics pipeline (Prometheus + adapter)
  → Use for: RPS-based scaling

KEDA:
  ✅ Scale to zero, 50+ event sources
  ❌ Extra component to manage
  → Use for: event-driven, queue-based, scheduled scaling
```

## Common Issues

**HPA shows "unknown" targets**

Metrics server not installed or pod has no resource requests. HPA needs requests to calculate utilization.

**Scaling too aggressive (flapping)**

Add stabilization windows in `behavior`. Scale-down stabilization of 300s prevents rapid fluctuations.

**KEDA not scaling to zero**

Check `minReplicaCount: 0` and `cooldownPeriod`. KEDA needs the trigger source to report 0 events.

## Best Practices

- **Always set resource requests** — HPA requires them for CPU/memory scaling
- **Use stabilization windows** — prevent flapping on bursty traffic
- **Combine HPA + PDB** — scale safely without dropping below minimum
- **KEDA for event-driven** — queues, cron, external metrics
- **Monitor actual vs desired** — `kubectl get hpa -w` to verify behavior

## Key Takeaways

- Manual: `kubectl scale` for immediate, one-time changes
- HPA: auto-scale on CPU/memory or custom metrics (min 1 replica)
- KEDA: event-driven scaling with scale-to-zero support (50+ triggers)
- Always set stabilization windows to prevent rapid scaling oscillation
- PDB ensures minimum availability during scale-down operations
