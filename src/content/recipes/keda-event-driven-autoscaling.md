---
title: "KEDA: Event-Driven Autoscaling for Kubernetes"
description: "Scale Kubernetes workloads with KEDA based on external events: queue depth, cron schedules, Prometheus metrics, HTTP traffic, and 60+ event sources."
category: "autoscaling"
difficulty: "intermediate"
publishDate: "2026-04-05"
tags: ["keda", "event-driven", "autoscaling", "queue", "serverless"]
author: "Luca Berton"
relatedRecipes:
  - "kubernetes-cost-optimization-strategies"
  - "openclaw-resource-limits-tuning"
  - "hpa-custom-metrics"
  - "horizontal-pod-autoscaler"
---

> 💡 **Quick Answer:** Scale Kubernetes workloads with KEDA based on external events: queue depth, cron schedules, Prometheus metrics, HTTP traffic, and 60+ event sources.

## The Problem

Engineers frequently search for this topic but find scattered, incomplete guides. This recipe provides a comprehensive, production-ready reference.

## The Solution

### Install KEDA

```bash
helm repo add kedacore https://kedacore.github.io/charts
helm install keda kedacore/keda --namespace keda --create-namespace
```

### Scale on Queue Depth (RabbitMQ)

```yaml
apiVersion: keda.sh/v1alpha1
kind: ScaledObject
metadata:
  name: rabbitmq-consumer
spec:
  scaleTargetRef:
    name: consumer-deployment
  minReplicaCount: 0      # Scale to zero when idle!
  maxReplicaCount: 30
  triggers:
    - type: rabbitmq
      metadata:
        host: amqp://user:pass@rabbitmq.default:5672/
        queueName: tasks
        queueLength: "5"   # 1 pod per 5 messages
```

### Scale on Prometheus Metric

```yaml
apiVersion: keda.sh/v1alpha1
kind: ScaledObject
metadata:
  name: api-scaler
spec:
  scaleTargetRef:
    name: api-deployment
  minReplicaCount: 2
  maxReplicaCount: 50
  triggers:
    - type: prometheus
      metadata:
        serverAddress: http://prometheus.monitoring:9090
        metricName: http_requests_per_second
        query: sum(rate(http_requests_total{service="api"}[2m]))
        threshold: "100"   # Scale at 100 req/s per pod
```

### Scale on Cron Schedule

```yaml
triggers:
  - type: cron
    metadata:
      timezone: Europe/Paris
      start: 0 8 * * 1-5     # 8 AM weekdays
      end: 0 18 * * 1-5      # 6 PM weekdays
      desiredReplicas: "10"   # Business hours
```

### KEDA vs HPA

| Feature | HPA | KEDA |
|---------|-----|------|
| Scale to zero | ❌ (min=1) | ✅ |
| External metrics | Complex (adapter needed) | ✅ Built-in (60+ sources) |
| Cron-based | ❌ | ✅ |
| Queue-based | ❌ | ✅ |
| CPU/memory | ✅ | ✅ (uses HPA internally) |

```mermaid
graph TD
    A[KEDA] --> B{Event source}
    B -->|RabbitMQ queue depth| C[Scale consumers]
    B -->|Prometheus metric| D[Scale API pods]
    B -->|Cron schedule| E[Scale for business hours]
    B -->|Kafka lag| F[Scale stream processors]
    C -->|Queue empty| G[Scale to zero]
```

## Frequently Asked Questions

### Can KEDA scale CronJobs?

Yes! Use `ScaledJob` instead of `ScaledObject` to create Jobs on events — perfect for batch processing from queues.

### Does KEDA replace HPA?

KEDA creates and manages HPA objects internally. You don't need to create separate HPAs when using KEDA.

## Best Practices

- Start with the simplest approach that solves your problem
- Test thoroughly in staging before production
- Monitor and iterate based on real metrics
- Document decisions for your team

## Key Takeaways

- This is essential Kubernetes operational knowledge
- Production-readiness requires proper configuration and monitoring
- Use `kubectl describe` and logs for troubleshooting
- Automate where possible to reduce human error
