---
title: "KEDA: Event-Driven Autoscaling for K8s"
description: "Scale Kubernetes workloads with KEDA based on events from Kafka, RabbitMQ, AWS SQS, Prometheus metrics, and cron schedules."
publishDate: "2026-05-03"
author: "Luca Berton"
category: "autoscaling"
difficulty: "intermediate"
timeToComplete: "12 minutes"
kubernetesVersion: "1.28+"
tags:
  - "keda"
  - "autoscaling"
  - "event-driven"
  - "scale-to-zero"
  - "serverless"
relatedRecipes:
  - "kubernetes-horizontal-scaling-patterns"
  - "kubernetes-prometheus-monitoring-guide"
---

> 💡 **Quick Answer:** KEDA extends HPA to scale on external events — Kafka lag, RabbitMQ queue depth, Prometheus metrics, cron schedules, and 60+ sources. Install: `helm install keda kedacore/keda -n keda --create-namespace`. Create a `ScaledObject` pointing to your deployment + trigger source. KEDA scales from 0→N and back to 0 when idle. Works alongside native HPA.

## The Problem

HPA only scales on CPU/memory — but real workloads need:

- Scale based on Kafka consumer lag (messages piling up)
- Scale based on queue depth (RabbitMQ, SQS, Azure Queue)
- Scale to zero when no work (save costs)
- Scale on custom Prometheus metrics
- Scale on cron schedule (business hours only)

## The Solution

### Install KEDA

```bash
helm repo add kedacore https://kedacore.github.io/charts
helm install keda kedacore/keda -n keda --create-namespace

# Verify
kubectl get pods -n keda
# keda-operator-xxx                Running
# keda-operator-metrics-xxx        Running
```

### Scale on Kafka Consumer Lag

```yaml
apiVersion: keda.sh/v1alpha1
kind: ScaledObject
metadata:
  name: kafka-consumer
  namespace: production
spec:
  scaleTargetRef:
    name: kafka-consumer           # Deployment name
  pollingInterval: 15              # Check every 15s
  cooldownPeriod: 300              # Wait 5min before scale-down
  minReplicaCount: 0               # Scale to zero!
  maxReplicaCount: 50
  triggers:
  - type: kafka
    metadata:
      bootstrapServers: kafka.default:9092
      consumerGroup: my-consumer-group
      topic: orders
      lagThreshold: "100"          # Scale up when lag > 100
      offsetResetPolicy: earliest
```

### Scale on RabbitMQ Queue Depth

```yaml
apiVersion: keda.sh/v1alpha1
kind: ScaledObject
metadata:
  name: order-processor
spec:
  scaleTargetRef:
    name: order-processor
  minReplicaCount: 0
  maxReplicaCount: 30
  triggers:
  - type: rabbitmq
    metadata:
      host: amqp://guest:guest@rabbitmq.default:5672/
      queueName: orders
      queueLength: "50"            # Scale when queue > 50 messages
```

### Scale on Prometheus Metrics

```yaml
apiVersion: keda.sh/v1alpha1
kind: ScaledObject
metadata:
  name: api-scaler
spec:
  scaleTargetRef:
    name: api-server
  minReplicaCount: 1               # Always keep 1 running
  maxReplicaCount: 20
  triggers:
  - type: prometheus
    metadata:
      serverAddress: http://prometheus.monitoring:9090
      metricName: http_requests_per_second
      query: sum(rate(http_requests_total{service="api"}[2m]))
      threshold: "100"             # Scale when RPS > 100
```

### Scale on AWS SQS Queue

```yaml
apiVersion: keda.sh/v1alpha1
kind: ScaledObject
metadata:
  name: sqs-processor
spec:
  scaleTargetRef:
    name: sqs-processor
  minReplicaCount: 0
  maxReplicaCount: 100
  triggers:
  - type: aws-sqs-queue
    metadata:
      queueURL: https://sqs.us-east-1.amazonaws.com/123456789/orders
      queueLength: "10"
      awsRegion: us-east-1
    authenticationRef:
      name: aws-credentials

---
apiVersion: keda.sh/v1alpha1
kind: TriggerAuthentication
metadata:
  name: aws-credentials
spec:
  secretTargetRef:
  - parameter: awsAccessKeyID
    name: aws-secret
    key: access-key
  - parameter: awsSecretAccessKey
    name: aws-secret
    key: secret-key
```

### Cron-Based Scaling

```yaml
apiVersion: keda.sh/v1alpha1
kind: ScaledObject
metadata:
  name: business-hours-scaler
spec:
  scaleTargetRef:
    name: web-frontend
  minReplicaCount: 1
  maxReplicaCount: 20
  triggers:
  # Scale up during business hours
  - type: cron
    metadata:
      timezone: America/New_York
      start: 0 8 * * 1-5           # 8 AM Mon-Fri
      end: 0 18 * * 1-5            # 6 PM Mon-Fri
      desiredReplicas: "10"
  # Combine with Prometheus for real-time adjustment
  - type: prometheus
    metadata:
      serverAddress: http://prometheus.monitoring:9090
      query: sum(rate(http_requests_total{app="web"}[5m]))
      threshold: "200"
```

### Multiple Triggers

```yaml
apiVersion: keda.sh/v1alpha1
kind: ScaledObject
metadata:
  name: multi-trigger
spec:
  scaleTargetRef:
    name: worker
  minReplicaCount: 0
  maxReplicaCount: 50
  triggers:
  # Scale on EITHER trigger (highest wins)
  - type: kafka
    metadata:
      bootstrapServers: kafka:9092
      consumerGroup: workers
      topic: tasks
      lagThreshold: "50"
  - type: cpu
    metricType: Utilization
    metadata:
      value: "70"
  - type: memory
    metricType: Utilization
    metadata:
      value: "80"
```

### ScaledJob (For Jobs Instead of Deployments)

```yaml
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
          image: batch-processor:v1
          command: [python, process.py]
        restartPolicy: Never
  pollingInterval: 30
  maxReplicaCount: 20
  successfulJobsHistoryLimit: 10
  failedJobsHistoryLimit: 5
  triggers:
  - type: rabbitmq
    metadata:
      host: amqp://rabbitmq.default:5672/
      queueName: batch-tasks
      queueLength: "1"            # One job per message
```

### Check Status

```bash
# List scaled objects
kubectl get scaledobjects -A
# NAME              SCALETARGET      MIN  MAX  TRIGGERS  READY  ACTIVE
# kafka-consumer    kafka-consumer   0    50   kafka     True   True

# Check HPA created by KEDA
kubectl get hpa -A
# KEDA creates and manages HPA resources automatically

# View scaling events
kubectl describe scaledobject kafka-consumer
```

## Common Issues

**Scale to zero not working**

`minReplicaCount` must be `0`. Also check `cooldownPeriod` — KEDA waits this many seconds before scaling to zero.

**Trigger "error connecting"**

Authentication issue to external system. Use `TriggerAuthentication` for credentials. Check network connectivity.

**Scaling too aggressively**

Increase `pollingInterval` (check frequency) and `cooldownPeriod` (scale-down delay). Adjust threshold values.

## Best Practices

- **Scale to zero** for batch workers and event processors — save costs
- **Keep minReplicaCount=1** for user-facing services (avoid cold start)
- **Combine triggers** — cron for baseline + metrics for burst
- **TriggerAuthentication** for secrets — don't embed credentials in ScaledObject
- **ScaledJob for one-shot tasks** — ScaledObject for long-running deployments

## Key Takeaways

- KEDA scales on 60+ event sources (Kafka, RabbitMQ, SQS, Prometheus, cron)
- Scales to zero and back — impossible with native HPA
- Creates and manages HPA resources automatically
- ScaledObject for Deployments, ScaledJob for batch Jobs
- Combines with native HPA — KEDA handles external metrics, HPA handles CPU/memory
