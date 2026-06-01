---
title: "KEDA Event-Driven Autoscaling on Kubernetes"
description: "Deploy KEDA for event-driven autoscaling on Kubernetes. Scale deployments to zero based on queue depth, HTTP requests, cron schedules, Prometheus metrics, and external event sources like Kafka and RabbitMQ."
tags:
  - "keda"
  - "autoscaling"
  - "event-driven"
  - "scale-to-zero"
  - "serverless"
category: "autoscaling"
publishDate: "2026-06-01"
author: "Luca Berton"
difficulty: "intermediate"
relatedRecipes:
  - "kubernetes-hpa-custom-metrics-prometheus-adapter"
  - "kubernetes-vertical-pod-autoscaler-vpa"
  - "strimzi-kafka-operator-kubernetes"
---

> 💡 **Quick Answer:** KEDA (Kubernetes Event-Driven Autoscaling) extends HPA with 60+ scalers for event sources. Install with Helm, create a `ScaledObject` referencing your Deployment and trigger (queue depth, cron, Prometheus, HTTP), and KEDA handles scaling — including scale-to-zero. Pods spin up only when events arrive.

## The Problem

- Standard HPA can't scale to zero (minimum 1 replica)
- Need to scale based on external events: message queues, cron schedules, database rows
- Prometheus Adapter setup is complex for each new metric
- Idle workloads waste resources when no events to process
- Want serverless-like behavior without leaving Kubernetes

## The Solution

### Install KEDA

```bash
helm repo add kedacore https://kedacore.github.io/charts
helm repo update

helm install keda kedacore/keda \
  --namespace keda \
  --create-namespace \
  --version 2.16.0
```

### Scale on RabbitMQ Queue Depth

```yaml
apiVersion: keda.sh/v1alpha1
kind: ScaledObject
metadata:
  name: order-processor
  namespace: production
spec:
  scaleTargetRef:
    name: order-processor      # Deployment name
  minReplicaCount: 0           # Scale to zero!
  maxReplicaCount: 30
  pollingInterval: 15          # Check every 15s
  cooldownPeriod: 300          # Wait 5min before scaling to 0
  triggers:
    - type: rabbitmq
      metadata:
        host: "amqp://user:password@rabbitmq.production:5672/"
        queueName: orders
        queueLength: "10"      # 1 pod per 10 messages
---
apiVersion: apps/v1
kind: Deployment
metadata:
  name: order-processor
  namespace: production
spec:
  replicas: 0                  # Start at 0 — KEDA manages scaling
  selector:
    matchLabels:
      app: order-processor
  template:
    spec:
      containers:
        - name: worker
          image: registry.example.com/order-processor:v1
```

### Scale on Kafka Topic Lag

```yaml
apiVersion: keda.sh/v1alpha1
kind: ScaledObject
metadata:
  name: kafka-consumer
  namespace: production
spec:
  scaleTargetRef:
    name: kafka-consumer
  minReplicaCount: 0
  maxReplicaCount: 50
  triggers:
    - type: kafka
      metadata:
        bootstrapServers: "kafka-cluster.production:9092"
        consumerGroup: "my-consumer-group"
        topic: "events"
        lagThreshold: "100"       # Scale at 100 messages lag per partition
        activationLagThreshold: "5"  # Activate from 0 at 5 messages
```

### Scale on Cron Schedule

```yaml
apiVersion: keda.sh/v1alpha1
kind: ScaledObject
metadata:
  name: batch-job-scaler
  namespace: production
spec:
  scaleTargetRef:
    name: batch-processor
  minReplicaCount: 0
  maxReplicaCount: 10
  triggers:
    - type: cron
      metadata:
        timezone: "Europe/Amsterdam"
        start: "0 8 * * 1-5"     # 8 AM weekdays
        end: "0 18 * * 1-5"      # 6 PM weekdays
        desiredReplicas: "5"
```

### Scale on Prometheus Metric

```yaml
apiVersion: keda.sh/v1alpha1
kind: ScaledObject
metadata:
  name: api-scaler
  namespace: production
spec:
  scaleTargetRef:
    name: api-server
  minReplicaCount: 2             # Always keep 2 running
  maxReplicaCount: 20
  triggers:
    - type: prometheus
      metadata:
        serverAddress: "http://prometheus.monitoring:9090"
        query: 'sum(rate(http_requests_total{namespace="production",deployment="api-server"}[2m]))'
        threshold: "100"          # Scale when RPS > 100 per replica
        activationThreshold: "5"  # Don't activate from 0 until RPS > 5
```

### Scale on HTTP Traffic (KEDA HTTP Add-On)

```bash
# Install KEDA HTTP Add-On
helm install http-add-on kedacore/keda-add-ons-http \
  --namespace keda
```

```yaml
apiVersion: http.keda.sh/v1alpha1
kind: HTTPScaledObject
metadata:
  name: my-app
  namespace: production
spec:
  hosts:
    - "myapp.example.com"
  targetPendingRequests: 10      # Scale at 10 pending requests per replica
  scaleTargetRef:
    name: my-app
    kind: Deployment
    apiVersion: apps/v1
  replicas:
    min: 0
    max: 20
```

### ScaledJob (Scale Jobs Instead of Deployments)

```yaml
# One Job per queue message (process and exit)
apiVersion: keda.sh/v1alpha1
kind: ScaledJob
metadata:
  name: image-processor
  namespace: production
spec:
  jobTargetRef:
    template:
      spec:
        containers:
          - name: processor
            image: registry.example.com/image-processor:v1
        restartPolicy: Never
  pollingInterval: 10
  maxReplicaCount: 20
  successfulJobsHistoryLimit: 5
  failedJobsHistoryLimit: 3
  triggers:
    - type: rabbitmq
      metadata:
        host: "amqp://user:password@rabbitmq:5672/"
        queueName: images
        queueLength: "1"         # 1 job per message
```

### Authentication (TriggerAuthentication)

```yaml
apiVersion: v1
kind: Secret
metadata:
  name: rabbitmq-creds
  namespace: production
data:
  host: YW1xcDovL3VzZXI6cGFzc0ByYWJiaXRtcTo1NjcyLw==
---
apiVersion: keda.sh/v1alpha1
kind: TriggerAuthentication
metadata:
  name: rabbitmq-auth
  namespace: production
spec:
  secretTargetRef:
    - parameter: host
      name: rabbitmq-creds
      key: host
---
apiVersion: keda.sh/v1alpha1
kind: ScaledObject
metadata:
  name: order-processor
spec:
  scaleTargetRef:
    name: order-processor
  triggers:
    - type: rabbitmq
      authenticationRef:
        name: rabbitmq-auth
      metadata:
        queueName: orders
        queueLength: "10"
```

## Common Issues

### Pods not scaling from zero
- **Cause**: `activationThreshold` not met; or trigger misconfigured (can't reach queue)
- **Fix**: Check KEDA operator logs; verify trigger connectivity; lower activation threshold

### Scaling too aggressively (flapping)
- **Cause**: `cooldownPeriod` too short; metric is noisy
- **Fix**: Increase `cooldownPeriod` (300s+); add `stabilizationWindowSeconds` in advanced config

### KEDA and HPA conflict
- **Cause**: Both managing same Deployment
- **Fix**: Remove manual HPA — KEDA creates its own HPA internally

### Scale-to-zero not working
- **Cause**: `minReplicaCount` set > 0; or `cooldownPeriod` not elapsed
- **Fix**: Set `minReplicaCount: 0`; wait for cooldown; check trigger returns 0

## Best Practices

1. **Use `activationThreshold`** — prevents premature scale-from-zero (cold start cost)
2. **Set `cooldownPeriod` ≥ 300s** — prevents flapping to/from zero
3. **TriggerAuthentication for secrets** — don't put credentials in ScaledObject
4. **ScaledJob for one-shot processing** — better than long-running Deployment for batch
5. **Multiple triggers** — KEDA scales on the highest value across all triggers
6. **Monitor KEDA metrics** — `keda_metrics_adapter_*` Prometheus metrics available
7. **Start with `minReplicaCount: 1`** — add scale-to-zero after validating behavior

## Key Takeaways

- KEDA enables scale-to-zero and event-driven autoscaling (60+ scalers)
- `ScaledObject` targets a Deployment; `ScaledJob` creates Jobs per event
- Triggers: Kafka, RabbitMQ, Prometheus, Cron, HTTP, AWS SQS, Azure Queue, PostgreSQL, and more
- `pollingInterval` controls how often KEDA checks the trigger source
- `cooldownPeriod` prevents rapid scale-to-zero oscillation
- KEDA creates an HPA internally — don't create a separate HPA for the same workload
- `TriggerAuthentication` separates credentials from scaling config
