---
title: "How to Use KEDA for Event-Driven Autoscaling"
description: "Scale Kubernetes workloads based on external events with KEDA. Configure scalers for queues, databases, and custom metrics beyond CPU/memory."
category: "autoscaling"
difficulty: "intermediate"
publishDate: "2026-01-22"
tags: ["keda", "autoscaling", "event-driven", "queues", "serverless"]
author: "Luca Berton"
---

> 💡 **Quick Answer:** Install KEDA (`helm install keda kedacore/keda`), create `ScaledObject` pointing to your Deployment with a trigger (e.g., `type: rabbitmq`, `queueLength: 5`). KEDA scales from 0 to N based on event source metrics—not just CPU/memory.
>
> **Key concept:** KEDA extends HPA with 50+ scalers (Kafka, RabbitMQ, AWS SQS, Azure Queue, Prometheus, Cron, etc.).
>
> **Gotcha:** KEDA can scale to zero, but first pod startup adds latency. Set `minReplicaCount: 1` for latency-sensitive workloads.

# How to Use KEDA for Event-Driven Autoscaling

KEDA (Kubernetes Event-Driven Autoscaling) scales workloads based on external events like message queues, databases, or custom metrics. It can scale to zero when there's no work.

## Install KEDA

```bash
# Add Helm repo
helm repo add kedacore https://kedacore.github.io/charts
helm repo update

# Install KEDA
helm install keda kedacore/keda --namespace keda --create-namespace

# Verify installation
kubectl get pods -n keda
```

## Basic ScaledObject

```yaml
# scaledobject.yaml
apiVersion: keda.sh/v1alpha1
kind: ScaledObject
metadata:
  name: my-app-scaler
  namespace: default
spec:
  scaleTargetRef:
    name: my-app  # Deployment name
  pollingInterval: 15
  cooldownPeriod: 300
  minReplicaCount: 0
  maxReplicaCount: 100
  triggers:
    - type: rabbitmq
      metadata:
        queueName: tasks
        queueLength: "5"  # Scale when >5 messages per replica
      authenticationRef:
        name: rabbitmq-auth
```

## RabbitMQ Scaler

```yaml
# rabbitmq-scaledobject.yaml
apiVersion: keda.sh/v1alpha1
kind: ScaledObject
metadata:
  name: rabbitmq-consumer
spec:
  scaleTargetRef:
    name: queue-processor
  minReplicaCount: 0
  maxReplicaCount: 30
  triggers:
    - type: rabbitmq
      metadata:
        host: amqp://guest:guest@rabbitmq.default.svc.cluster.local:5672/
        queueName: orders
        mode: QueueLength
        value: "10"
```

## Kafka Scaler

```yaml
# kafka-scaledobject.yaml
apiVersion: keda.sh/v1alpha1
kind: ScaledObject
metadata:
  name: kafka-consumer
spec:
  scaleTargetRef:
    name: kafka-processor
  minReplicaCount: 1
  maxReplicaCount: 50
  triggers:
    - type: kafka
      metadata:
        bootstrapServers: kafka.default.svc.cluster.local:9092
        consumerGroup: my-group
        topic: events
        lagThreshold: "100"
```

## AWS SQS Scaler

```yaml
# sqs-scaledobject.yaml
apiVersion: keda.sh/v1alpha1
kind: ScaledObject
metadata:
  name: sqs-consumer
spec:
  scaleTargetRef:
    name: sqs-processor
  minReplicaCount: 0
  maxReplicaCount: 20
  triggers:
    - type: aws-sqs-queue
      metadata:
        queueURL: https://sqs.us-east-1.amazonaws.com/123456789/my-queue
        queueLength: "5"
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
      name: aws-secrets
      key: AWS_ACCESS_KEY_ID
    - parameter: awsSecretAccessKey
      name: aws-secrets
      key: AWS_SECRET_ACCESS_KEY
```

## Prometheus Scaler

```yaml
# prometheus-scaledobject.yaml
apiVersion: keda.sh/v1alpha1
kind: ScaledObject
metadata:
  name: prometheus-scaler
spec:
  scaleTargetRef:
    name: my-app
  minReplicaCount: 2
  maxReplicaCount: 10
  triggers:
    - type: prometheus
      metadata:
        serverAddress: http://prometheus.monitoring.svc.cluster.local:9090
        metricName: http_requests_per_second
        threshold: "100"
        query: sum(rate(http_requests_total{app="my-app"}[2m]))
```

## Cron Scaler (Scheduled Scaling)

```yaml
# cron-scaledobject.yaml
apiVersion: keda.sh/v1alpha1
kind: ScaledObject
metadata:
  name: business-hours-scaler
spec:
  scaleTargetRef:
    name: web-app
  minReplicaCount: 1
  maxReplicaCount: 20
  triggers:
    - type: cron
      metadata:
        timezone: America/New_York
        start: 0 8 * * 1-5    # 8 AM weekdays
        end: 0 18 * * 1-5     # 6 PM weekdays
        desiredReplicas: "10"
    - type: cron
      metadata:
        timezone: America/New_York
        start: 0 18 * * 1-5   # After hours
        end: 0 8 * * 1-5
        desiredReplicas: "2"
```

## Multiple Triggers

```yaml
# multi-trigger-scaledobject.yaml
apiVersion: keda.sh/v1alpha1
kind: ScaledObject
metadata:
  name: multi-trigger
spec:
  scaleTargetRef:
    name: my-app
  minReplicaCount: 1
  maxReplicaCount: 50
  triggers:
    - type: rabbitmq
      metadata:
        queueName: high-priority
        queueLength: "1"
    - type: cpu
      metricType: Utilization
      metadata:
        value: "70"
    - type: memory
      metricType: Utilization
      metadata:
        value: "80"
```

## ScaledJob (for Job-based scaling)

```yaml
# scaledjob.yaml
apiVersion: keda.sh/v1alpha1
kind: ScaledJob
metadata:
  name: queue-job
spec:
  jobTargetRef:
    template:
      spec:
        containers:
          - name: processor
            image: my-processor:latest
        restartPolicy: Never
  pollingInterval: 10
  maxReplicaCount: 100
  triggers:
    - type: rabbitmq
      metadata:
        queueName: batch-jobs
        queueLength: "1"
```

## Monitor KEDA

```bash
# Check ScaledObjects
kubectl get scaledobject

# Check HPA created by KEDA
kubectl get hpa

# View KEDA operator logs
kubectl logs -n keda -l app=keda-operator

# Describe ScaledObject for status
kubectl describe scaledobject my-app-scaler
```

## Available Scalers

KEDA supports 50+ scalers including:
- Message Queues: RabbitMQ, Kafka, AWS SQS, Azure Queue, GCP Pub/Sub
- Databases: PostgreSQL, MySQL, MongoDB, Redis
- Metrics: Prometheus, Datadog, New Relic
- Cloud: AWS CloudWatch, Azure Monitor, GCP Stackdriver
- Other: Cron, External, CPU, Memory
