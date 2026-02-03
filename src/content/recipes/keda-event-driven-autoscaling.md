---
title: "How to Use KEDA for Event-Driven Autoscaling"
description: "Deploy KEDA for event-driven autoscaling in Kubernetes. Scale based on queue length, metrics, cron schedules, and external events."
category: "autoscaling"
difficulty: "intermediate"
publishDate: "2026-01-22"
tags: ["keda", "autoscaling", "event-driven", "scaling", "queues"]
---

> 💡 **Quick Answer:** Install KEDA with Helm (`helm install keda kedacore/keda -n keda`), then create `ScaledObject` resources defining triggers (Kafka, RabbitMQ, Prometheus, cron, etc.) and target deployment. KEDA scales to zero when idle and up based on event source metrics.
>
> **Key benefit:** Unlike HPA, KEDA can scale to zero replicas and supports 50+ event sources out of the box.
>
> **Gotcha:** Scale-to-zero has cold start latency; use `minReplicaCount: 1` for latency-sensitive workloads or configure `cooldownPeriod` appropriately.

# How to Use KEDA for Event-Driven Autoscaling

KEDA (Kubernetes Event-driven Autoscaling) extends Kubernetes HPA with event-driven triggers. Scale your workloads based on queue depth, metrics, cron schedules, and 50+ event sources.

## Install KEDA

```bash
# Using Helm
helm repo add kedacore https://kedacore.github.io/charts
helm repo update

helm install keda kedacore/keda \
  --namespace keda \
  --create-namespace \
  --set watchNamespace="" # Watch all namespaces
```

## Basic ScaledObject

```yaml
# scaled-object-basic.yaml
apiVersion: keda.sh/v1alpha1
kind: ScaledObject
metadata:
  name: worker-scaler
  namespace: default
spec:
  scaleTargetRef:
    name: worker-deployment
  pollingInterval: 30     # Check every 30 seconds
  cooldownPeriod: 300     # Wait 5 min before scaling down
  minReplicaCount: 1      # Minimum replicas
  maxReplicaCount: 100    # Maximum replicas
  triggers:
    - type: prometheus
      metadata:
        serverAddress: http://prometheus.monitoring:9090
        metricName: http_requests_total
        query: sum(rate(http_requests_total{app="worker"}[2m]))
        threshold: "100"
```

## Scale Based on RabbitMQ Queue

```yaml
# rabbitmq-scaler.yaml
apiVersion: keda.sh/v1alpha1
kind: ScaledObject
metadata:
  name: rabbitmq-consumer-scaler
spec:
  scaleTargetRef:
    name: rabbitmq-consumer
  pollingInterval: 15
  cooldownPeriod: 120
  minReplicaCount: 0      # Scale to zero when queue empty
  maxReplicaCount: 50
  triggers:
    - type: rabbitmq
      metadata:
        host: amqp://user:password@rabbitmq.default:5672/
        queueName: tasks
        queueLength: "10"  # 1 pod per 10 messages
---
apiVersion: v1
kind: Secret
metadata:
  name: rabbitmq-secret
data:
  host: YW1xcDovL3VzZXI6cGFzc3dvcmRAcmFiYml0bXEuZGVmYXVsdDo1NjcyLw==
```

```yaml
# Using secret reference
apiVersion: keda.sh/v1alpha1
kind: ScaledObject
metadata:
  name: rabbitmq-consumer-scaler
spec:
  scaleTargetRef:
    name: rabbitmq-consumer
  triggers:
    - type: rabbitmq
      authenticationRef:
        name: rabbitmq-trigger-auth
      metadata:
        queueName: tasks
        queueLength: "10"
---
apiVersion: keda.sh/v1alpha1
kind: TriggerAuthentication
metadata:
  name: rabbitmq-trigger-auth
spec:
  secretTargetRef:
    - parameter: host
      name: rabbitmq-secret
      key: host
```

## Scale Based on AWS SQS

```yaml
# sqs-scaler.yaml
apiVersion: keda.sh/v1alpha1
kind: ScaledObject
metadata:
  name: sqs-consumer-scaler
spec:
  scaleTargetRef:
    name: sqs-consumer
  minReplicaCount: 0
  maxReplicaCount: 30
  triggers:
    - type: aws-sqs-queue
      authenticationRef:
        name: aws-credentials
      metadata:
        queueURL: https://sqs.us-east-1.amazonaws.com/123456789/my-queue
        queueLength: "5"    # Target 5 messages per pod
        awsRegion: us-east-1
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

## Scale Based on Kafka Consumer Lag

```yaml
# kafka-scaler.yaml
apiVersion: keda.sh/v1alpha1
kind: ScaledObject
metadata:
  name: kafka-consumer-scaler
spec:
  scaleTargetRef:
    name: kafka-consumer
  pollingInterval: 10
  cooldownPeriod: 300
  minReplicaCount: 1
  maxReplicaCount: 20
  triggers:
    - type: kafka
      metadata:
        bootstrapServers: kafka-broker:9092
        consumerGroup: my-consumer-group
        topic: events
        lagThreshold: "100"     # Scale when lag > 100
        offsetResetPolicy: earliest
```

## Cron-Based Scaling

```yaml
# cron-scaler.yaml
apiVersion: keda.sh/v1alpha1
kind: ScaledObject
metadata:
  name: cron-scaler
spec:
  scaleTargetRef:
    name: web-app
  minReplicaCount: 2
  maxReplicaCount: 20
  triggers:
    # Scale up during business hours
    - type: cron
      metadata:
        timezone: America/New_York
        start: 0 8 * * 1-5    # 8 AM Mon-Fri
        end: 0 18 * * 1-5     # 6 PM Mon-Fri
        desiredReplicas: "10"
    # Scale up for weekend traffic
    - type: cron
      metadata:
        timezone: America/New_York
        start: 0 10 * * 0,6   # 10 AM Sat-Sun
        end: 0 22 * * 0,6     # 10 PM Sat-Sun
        desiredReplicas: "5"
```

## Multiple Triggers

```yaml
# multi-trigger-scaler.yaml
apiVersion: keda.sh/v1alpha1
kind: ScaledObject
metadata:
  name: multi-trigger-scaler
spec:
  scaleTargetRef:
    name: worker
  minReplicaCount: 1
  maxReplicaCount: 50
  triggers:
    # Scale based on CPU
    - type: cpu
      metricType: Utilization
      metadata:
        value: "70"
    # Scale based on memory
    - type: memory
      metricType: Utilization
      metadata:
        value: "80"
    # Scale based on queue
    - type: rabbitmq
      metadata:
        host: amqp://rabbitmq:5672/
        queueName: jobs
        queueLength: "20"
```

## Scale Jobs with ScaledJob

```yaml
# scaled-job.yaml
apiVersion: keda.sh/v1alpha1
kind: ScaledJob
metadata:
  name: batch-processor
spec:
  jobTargetRef:
    parallelism: 1
    completions: 1
    backoffLimit: 3
    template:
      spec:
        containers:
          - name: processor
            image: batch-processor:v1
            command: ["./process.sh"]
        restartPolicy: Never
  pollingInterval: 30
  successfulJobsHistoryLimit: 5
  failedJobsHistoryLimit: 5
  maxReplicaCount: 10
  triggers:
    - type: rabbitmq
      metadata:
        host: amqp://rabbitmq:5672/
        queueName: batch-jobs
        queueLength: "1"  # One job per message
```

## HTTP-Based Scaling (HTTP Add-on)

```yaml
# Install KEDA HTTP Add-on first
# helm install http-add-on kedacore/keda-add-ons-http

# http-scaler.yaml
apiVersion: http.keda.sh/v1alpha1
kind: HTTPScaledObject
metadata:
  name: api-scaler
spec:
  hosts:
    - api.example.com
  targetPendingRequests: 100  # Scale up at 100 pending requests
  scaleTargetRef:
    deployment: api-server
    service: api-service
    port: 8080
  replicas:
    min: 1
    max: 20
```

## Prometheus Custom Metrics

```yaml
# prometheus-scaler.yaml
apiVersion: keda.sh/v1alpha1
kind: ScaledObject
metadata:
  name: prometheus-scaler
spec:
  scaleTargetRef:
    name: order-processor
  minReplicaCount: 2
  maxReplicaCount: 30
  triggers:
    - type: prometheus
      metadata:
        serverAddress: http://prometheus.monitoring:9090
        metricName: orders_pending
        query: |
          sum(orders_pending{status="pending"})
        threshold: "50"
        activationThreshold: "5"  # Don't scale if below 5
```

## Redis List Length

```yaml
# redis-scaler.yaml
apiVersion: keda.sh/v1alpha1
kind: ScaledObject
metadata:
  name: redis-worker-scaler
spec:
  scaleTargetRef:
    name: redis-worker
  minReplicaCount: 0
  maxReplicaCount: 20
  triggers:
    - type: redis
      metadata:
        address: redis.default:6379
        listName: task-queue
        listLength: "10"
        activationListLength: "1"
```

## Fallback Configuration

```yaml
# fallback-scaler.yaml
apiVersion: keda.sh/v1alpha1
kind: ScaledObject
metadata:
  name: resilient-scaler
spec:
  scaleTargetRef:
    name: worker
  minReplicaCount: 2
  maxReplicaCount: 50
  fallback:
    failureThreshold: 3     # Failures before fallback
    replicas: 5             # Fallback replica count
  triggers:
    - type: prometheus
      metadata:
        serverAddress: http://prometheus:9090
        query: sum(rate(requests[2m]))
        threshold: "100"
```

## Verify KEDA Scaling

```bash
# Check ScaledObject status
kubectl get scaledobject

# Describe for details
kubectl describe scaledobject worker-scaler

# Check HPA created by KEDA
kubectl get hpa

# View KEDA operator logs
kubectl logs -n keda -l app=keda-operator
```

## Summary

KEDA enables powerful event-driven autoscaling beyond traditional CPU/memory metrics. Use it to scale based on message queues, custom metrics, cron schedules, or HTTP traffic. It integrates seamlessly with Kubernetes HPA and supports scale-to-zero for cost optimization.

---

## 📘 Go Further with Kubernetes Recipes

**Love this recipe? There's so much more!** This is just one of **100+ hands-on recipes** in our comprehensive **[Kubernetes Recipes book](https://amzn.to/3DzC8QA)**.

Inside the book, you'll master:
- ✅ Production-ready deployment strategies
- ✅ Advanced networking and security patterns  
- ✅ Observability, monitoring, and troubleshooting
- ✅ Real-world best practices from industry experts

> *"The practical, recipe-based approach made complex Kubernetes concepts finally click for me."*

**👉 [Get Your Copy Now](https://amzn.to/3DzC8QA)** — Start building production-grade Kubernetes skills today!
