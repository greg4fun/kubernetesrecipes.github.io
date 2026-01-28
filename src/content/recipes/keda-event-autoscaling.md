---
title: "How to Implement Pod Autoscaling with KEDA"
description: "Scale workloads based on external events with KEDA. Configure scalers for queues, databases, Prometheus metrics, and custom sources."
category: "autoscaling"
difficulty: "intermediate"
publishDate: "2026-01-22"
tags: ["keda", "autoscaling", "events", "scaling", "serverless"]
---

# How to Implement Pod Autoscaling with KEDA

KEDA (Kubernetes Event-driven Autoscaling) scales workloads based on external metrics and events. Scale to zero and handle event-driven workloads efficiently.

## Install KEDA

```bash
# Install with Helm
helm repo add kedacore https://kedacore.github.io/charts
helm repo update
helm install keda kedacore/keda --namespace keda --create-namespace

# Or with kubectl
kubectl apply --server-side -f https://github.com/kedacore/keda/releases/download/v2.13.0/keda-2.13.0.yaml

# Verify installation
kubectl get pods -n keda
```

## KEDA Components

```yaml
# ScaledObject - For Deployments/StatefulSets
# ScaledJob - For Jobs
# TriggerAuthentication - For secrets/credentials

# KEDA manages HPA automatically
# Can scale to/from zero (unlike standard HPA)
```

## Scale on RabbitMQ Queue

```yaml
# rabbitmq-scaler.yaml
apiVersion: keda.sh/v1alpha1
kind: ScaledObject
metadata:
  name: rabbitmq-scaler
  namespace: production
spec:
  scaleTargetRef:
    name: queue-worker  # Deployment name
  minReplicaCount: 0    # Scale to zero!
  maxReplicaCount: 50
  pollingInterval: 15   # Check every 15 seconds
  cooldownPeriod: 300   # Wait 5 min before scale down
  triggers:
    - type: rabbitmq
      metadata:
        host: amqp://user:pass@rabbitmq.default.svc:5672
        queueName: orders
        mode: QueueLength
        value: "5"  # Scale up at 5 messages per replica
```

## Scale on AWS SQS

```yaml
# sqs-scaler.yaml
apiVersion: keda.sh/v1alpha1
kind: TriggerAuthentication
metadata:
  name: aws-credentials
spec:
  secretTargetRef:
    - parameter: awsAccessKeyID
      name: aws-secrets
      key: AWS_ACCESS_KEY_ID
    - parameter: awsSecretAccessKey
      name: aws-secrets
      key: AWS_SECRET_ACCESS_KEY
---
apiVersion: keda.sh/v1alpha1
kind: ScaledObject
metadata:
  name: sqs-scaler
spec:
  scaleTargetRef:
    name: sqs-worker
  minReplicaCount: 0
  maxReplicaCount: 100
  triggers:
    - type: aws-sqs-queue
      authenticationRef:
        name: aws-credentials
      metadata:
        queueURL: https://sqs.us-east-1.amazonaws.com/123456789/my-queue
        queueLength: "10"
        awsRegion: us-east-1
```

## Scale on Kafka

```yaml
# kafka-scaler.yaml
apiVersion: keda.sh/v1alpha1
kind: ScaledObject
metadata:
  name: kafka-consumer
spec:
  scaleTargetRef:
    name: kafka-consumer
  minReplicaCount: 1
  maxReplicaCount: 50
  triggers:
    - type: kafka
      metadata:
        bootstrapServers: kafka.default.svc:9092
        consumerGroup: my-consumer-group
        topic: events
        lagThreshold: "100"  # Scale when lag > 100
        activationLagThreshold: "10"  # Start from 0 at lag 10
```

## Scale on Prometheus Metrics

```yaml
# prometheus-scaler.yaml
apiVersion: keda.sh/v1alpha1
kind: ScaledObject
metadata:
  name: prometheus-scaler
spec:
  scaleTargetRef:
    name: api-server
  minReplicaCount: 2
  maxReplicaCount: 20
  triggers:
    - type: prometheus
      metadata:
        serverAddress: http://prometheus.monitoring.svc:9090
        metricName: http_requests_per_second
        query: sum(rate(http_requests_total{app="api"}[2m]))
        threshold: "100"  # Scale at 100 RPS
```

## Scale on Redis List

```yaml
# redis-scaler.yaml
apiVersion: keda.sh/v1alpha1
kind: ScaledObject
metadata:
  name: redis-worker
spec:
  scaleTargetRef:
    name: redis-processor
  minReplicaCount: 0
  maxReplicaCount: 30
  triggers:
    - type: redis
      metadata:
        address: redis.default.svc:6379
        listName: job-queue
        listLength: "10"
        databaseIndex: "0"
```

## Scale on PostgreSQL Query

```yaml
# postgres-scaler.yaml
apiVersion: keda.sh/v1alpha1
kind: TriggerAuthentication
metadata:
  name: postgres-auth
spec:
  secretTargetRef:
    - parameter: connection
      name: postgres-secrets
      key: connection-string
---
apiVersion: keda.sh/v1alpha1
kind: ScaledObject
metadata:
  name: postgres-scaler
spec:
  scaleTargetRef:
    name: db-processor
  minReplicaCount: 0
  maxReplicaCount: 20
  triggers:
    - type: postgresql
      authenticationRef:
        name: postgres-auth
      metadata:
        query: "SELECT COUNT(*) FROM jobs WHERE status='pending'"
        targetQueryValue: "5"
```

## Scale on HTTP Traffic

```yaml
# http-scaler.yaml
apiVersion: keda.sh/v1alpha1
kind: ScaledObject
metadata:
  name: http-scaler
spec:
  scaleTargetRef:
    name: web-app
  minReplicaCount: 1
  maxReplicaCount: 50
  triggers:
    - type: prometheus
      metadata:
        serverAddress: http://prometheus.monitoring.svc:9090
        query: |
          sum(rate(nginx_ingress_controller_requests{
            namespace="production",
            service="web-app"
          }[2m]))
        threshold: "100"
```

## Multiple Triggers

```yaml
# multi-trigger.yaml
apiVersion: keda.sh/v1alpha1
kind: ScaledObject
metadata:
  name: multi-scaler
spec:
  scaleTargetRef:
    name: worker
  minReplicaCount: 1
  maxReplicaCount: 100
  triggers:
    # Scale on either condition
    - type: rabbitmq
      metadata:
        host: amqp://rabbitmq.svc:5672
        queueName: high-priority
        queueLength: "1"
    - type: rabbitmq
      metadata:
        host: amqp://rabbitmq.svc:5672
        queueName: normal
        queueLength: "10"
```

## ScaledJob (For Jobs)

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
    template:
      spec:
        containers:
          - name: processor
            image: batch-processor:v1
            env:
              - name: QUEUE_URL
                value: "amqp://rabbitmq.svc:5672"
        restartPolicy: Never
  pollingInterval: 30
  successfulJobsHistoryLimit: 5
  failedJobsHistoryLimit: 5
  maxReplicaCount: 50
  triggers:
    - type: rabbitmq
      metadata:
        host: amqp://rabbitmq.svc:5672
        queueName: batch-jobs
        mode: QueueLength
        value: "1"  # One job per message
```

## Scaling Behavior

```yaml
# advanced-scaling.yaml
apiVersion: keda.sh/v1alpha1
kind: ScaledObject
metadata:
  name: advanced-scaler
spec:
  scaleTargetRef:
    name: my-app
  minReplicaCount: 2
  maxReplicaCount: 100
  pollingInterval: 15
  cooldownPeriod: 300
  advanced:
    horizontalPodAutoscalerConfig:
      behavior:
        scaleDown:
          stabilizationWindowSeconds: 300
          policies:
            - type: Percent
              value: 10
              periodSeconds: 60
        scaleUp:
          stabilizationWindowSeconds: 0
          policies:
            - type: Percent
              value: 100
              periodSeconds: 15
  triggers:
    - type: prometheus
      metadata:
        serverAddress: http://prometheus.svc:9090
        query: sum(rate(requests_total[1m]))
        threshold: "50"
```

## Monitor KEDA

```bash
# Check ScaledObjects
kubectl get scaledobject -A
kubectl describe scaledobject my-scaler

# Check created HPA
kubectl get hpa

# KEDA operator logs
kubectl logs -n keda -l app=keda-operator

# Metrics server logs
kubectl logs -n keda -l app=keda-metrics-apiserver

# Debug scaling
kubectl get scaledobject my-scaler -o yaml | grep -A20 status
```

## Summary

KEDA extends Kubernetes autoscaling with 50+ event sources. Create ScaledObjects for Deployments that can scale to zero. Use TriggerAuthentication for secure credential management. Configure triggers for queues (RabbitMQ, SQS, Kafka), databases (PostgreSQL, Redis), metrics (Prometheus), and more. ScaledJobs spawn Jobs based on events. Use multiple triggers to scale on any condition. Monitor with `kubectl get scaledobject` and check operator logs for debugging.

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
