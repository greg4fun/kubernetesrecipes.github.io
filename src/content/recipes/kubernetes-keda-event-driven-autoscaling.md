---
title: "KEDA: Event-Driven Autoscaling for Kubernetes"
description: "Install KEDA with Helm and scale on Kafka lag, RabbitMQ, Prometheus, cron or HTTP. ScaledObject, ScaledJob, TriggerAuthentication, scale-to-zero."
publishDate: "2026-04-24"
author: "Luca Berton"
category: "autoscaling"
difficulty: "intermediate"
timeToComplete: "20 minutes"
kubernetesVersion: "1.28+"
tags:
  - "keda"
  - "autoscaling"
  - "event-driven"
  - "kafka"
  - "rabbitmq"
  - "scale-to-zero"
  - "serverless"
relatedRecipes:
  - "keda-vs-hpa-autoscaling-comparison"
  - "openclaw-autoscaling-keda"
  - "kubernetes-keda-scalers-guide"
  - "kubernetes-hpa-custom-metrics-prometheus-adapter"
  - "kubernetes-vpa-resource-rightsizing"
  - "strimzi-kafka-operator-kubernetes"
---

> 💡 **Quick Answer:** KEDA (Kubernetes Event-Driven Autoscaling) feeds external metrics — Kafka consumer lag, queue depth, Prometheus queries, cron windows, HTTP traffic — into an HPA it creates and manages for you, and handles the 0 ↔ 1 transition itself so workloads can **scale to zero**. Install with Helm, then create a `ScaledObject` (for Deployments/StatefulSets) or `ScaledJob` (one Job per batch of events).
>
> **Gotcha:** Don't create your own HPA for a workload that has a `ScaledObject` — KEDA already owns one (`keda-hpa-<name>`) and they will fight.

## The Problem

- HPA scales on CPU/memory; a Kafka consumer at 5% CPU with 10,000 messages waiting shouldn't scale down
- Plain HPA can't go below 1 replica (scale-to-zero needs the alpha `HPAScaleToZero` gate)
- Wiring a Prometheus Adapter rule for every new metric is tedious
- Idle event workers waste capacity when no events arrive

## Install KEDA

```bash
helm repo add kedacore https://kedacore.github.io/charts
helm repo update
helm install keda kedacore/keda \
  --namespace keda --create-namespace \
  --version 2.16.0

kubectl get pods -n keda
kubectl get apiservice v1beta1.external.metrics.k8s.io   # KEDA's metrics server
```

KEDA registers as the cluster's `external.metrics.k8s.io` provider — only one such provider can exist, so it conflicts with a Prometheus Adapter serving external metrics.

## Scale on Kafka Consumer Lag

```yaml
apiVersion: keda.sh/v1alpha1
kind: ScaledObject
metadata:
  name: kafka-consumer
  namespace: production
spec:
  scaleTargetRef:
    name: order-processor        # Deployment name
  pollingInterval: 15            # Seconds between trigger checks
  cooldownPeriod: 300            # Wait after last activity before scaling to 0
  minReplicaCount: 0
  maxReplicaCount: 20
  triggers:
    - type: kafka
      metadata:
        bootstrapServers: kafka.messaging:9092
        consumerGroup: order-group
        topic: orders
        lagThreshold: "100"          # Target lag per replica
        activationLagThreshold: "5"  # Wake from 0 only above 5 messages
```

Replicas ≈ total lag / `lagThreshold`, but by default KEDA won't exceed the topic's **partition count** — extra consumers in a group would sit idle.

## Scale on RabbitMQ Queue Depth

```yaml
apiVersion: keda.sh/v1alpha1
kind: ScaledObject
metadata:
  name: order-processor
  namespace: production
spec:
  scaleTargetRef:
    name: order-processor
  minReplicaCount: 0
  maxReplicaCount: 30
  triggers:
    - type: rabbitmq
      authenticationRef:
        name: rabbitmq-auth          # See TriggerAuthentication below
      metadata:
        queueName: orders
        mode: QueueLength
        value: "10"                  # 1 replica per 10 messages
```

## Scale on a Prometheus Metric

```yaml
apiVersion: keda.sh/v1alpha1
kind: ScaledObject
metadata:
  name: api-scaler
  namespace: production
spec:
  scaleTargetRef:
    name: api-server
  minReplicaCount: 2
  maxReplicaCount: 50
  triggers:
    - type: prometheus
      metadata:
        serverAddress: http://prometheus.monitoring:9090
        query: sum(rate(http_requests_total{namespace="production",service="api"}[2m]))
        threshold: "100"             # Target value per replica (AverageValue)
        activationThreshold: "5"
```

## Scale on AWS SQS Queue Depth

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
        queueURL: https://sqs.us-east-1.amazonaws.com/123456789012/orders
        queueLength: "10"          # target messages per replica
        awsRegion: us-east-1
      authenticationRef:
        name: aws-pod-identity
---
apiVersion: keda.sh/v1alpha1
kind: TriggerAuthentication
metadata:
  name: aws-pod-identity
spec:
  podIdentity:
    provider: aws               # IRSA / EKS Pod Identity — no static keys
    identityOwner: keda         # KEDA operator's role; "workload" assumes the target's SA role
```

The IAM role needs `sqs:GetQueueAttributes` on the queue.

## Cron-Based Scaling

```yaml
triggers:
  - type: cron
    metadata:
      timezone: Europe/Amsterdam
      start: "0 8 * * 1-5"       # 08:00 weekdays
      end: "0 18 * * 1-5"        # 18:00 weekdays
      desiredReplicas: "10"
```

Combine a cron trigger with a queue trigger to pre-scale before a known peak; with multiple triggers KEDA uses the **highest** computed replica count.

## Scale on HTTP Traffic (HTTP Add-On)

```bash
helm install http-add-on kedacore/keda-add-ons-http --namespace keda
```

```yaml
apiVersion: http.keda.sh/v1alpha1
kind: HTTPScaledObject
metadata:
  name: my-app
  namespace: production
spec:
  hosts:
    - myapp.example.com
  scaleTargetRef:
    name: my-app
    kind: Deployment
    apiVersion: apps/v1
    service: my-app
    port: 8080
  replicas:
    min: 0
    max: 20
  scalingMetric:
    concurrency:
      targetValue: 10            # In-flight requests per replica
```

Traffic must flow through the add-on's interceptor service, which buffers requests while a scaled-to-zero app starts.

## ScaledJob: One Job per Event Batch

```yaml
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
      authenticationRef:
        name: rabbitmq-auth
      metadata:
        queueName: images
        mode: QueueLength
        value: "1"                 # 1 Job per message
```

Use `ScaledJob` for long-running, run-to-completion work: a Deployment scaled down mid-task kills in-flight work, a Job doesn't.

## TriggerAuthentication

```yaml
apiVersion: v1
kind: Secret
metadata:
  name: rabbitmq-creds
  namespace: production
stringData:
  host: amqp://user:password@rabbitmq.production:5672/
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
```

Use `ClusterTriggerAuthentication` to share credentials across namespaces, or `podIdentity` (AWS/Azure/GCP workload identity) to avoid static secrets.

## Tuning Scale-Down

`cooldownPeriod` only governs the last step to **zero**. Scaling between 1 and N is done by the HPA, so tune it via `advanced`:

```yaml
spec:
  advanced:
    horizontalPodAutoscalerConfig:
      behavior:
        scaleDown:
          stabilizationWindowSeconds: 300
          policies:
            - type: Percent
              value: 50
              periodSeconds: 60
```

```mermaid
graph TD
    KAFKA[Kafka lag] --> KEDA[KEDA operator + metrics server]
    PROM[Prometheus query] --> KEDA
    CRON[Cron window] --> KEDA
    KEDA -->|0 to 1 activation| DEPLOY[Deployment]
    KEDA -->|external metrics| HPA[keda-hpa-name]
    HPA -->|1 to N| DEPLOY
    KEDA -->|idle past cooldownPeriod| ZERO[0 replicas]
```

## Check Status

```bash
kubectl get scaledobjects -A
# NAME             SCALETARGETNAME  MIN  MAX  TRIGGERS  READY  ACTIVE
# kafka-consumer   kafka-consumer   0    50   kafka     True   True

kubectl get hpa -A | grep keda-hpa-          # the HPA KEDA generated
kubectl describe scaledobject kafka-consumer  # conditions + events
kubectl logs -n keda deploy/keda-operator --tail=50
```

`READY=False` usually means the scaler can't reach or authenticate to the event source; `ACTIVE=False` means the trigger is below its activation threshold (KEDA will scale to `minReplicaCount`).

## Common Issues

| Issue | Cause | Fix |
|-------|-------|-----|
| Not scaling from zero | Activation threshold not met, or trigger can't reach the source | `kubectl describe scaledobject`, KEDA operator logs |
| Not scaling to zero | `minReplicaCount > 0`, cooldown not elapsed, or trigger never reports 0 | Set `minReplicaCount: 0`, check trigger value |
| Flapping between 1 and N | Noisy metric | `advanced.horizontalPodAutoscalerConfig.behavior` stabilization |
| KEDA vs your HPA | Two HPAs on one Deployment | Delete the manual HPA |
| Kafka stops at N replicas | Capped at partition count | Add partitions |
| External metrics API errors | Another adapter owns `external.metrics.k8s.io` | Keep one external metrics provider |

## Best Practices

1. **Use activation thresholds** to avoid cold starts on a single stray event
2. **Keep `cooldownPeriod` ≥ 300s** for scale-to-zero workloads
3. **Keep credentials in TriggerAuthentication** or pod identity, never in the ScaledObject
4. **Prefer ScaledJob** for long-running per-message work
5. **Start with `minReplicaCount: 1`**, then enable scale-to-zero once behavior is validated
6. **Monitor KEDA** — `keda_scaler_metrics_value`, `keda_scaler_errors_total`, `keda_scaled_object_errors_total`

## Frequently Asked Questions

### What is KEDA?

KEDA is a CNCF graduated project that adds event-driven autoscaling to Kubernetes. It provides 60+ scalers (Kafka, RabbitMQ, SQS, Redis, Prometheus, cron, databases and more), exposes their values through the external metrics API, drives a standard HPA, and scales workloads to and from zero.

### KEDA vs HPA — which should I use?

KEDA doesn't replace HPA; it configures one. Use plain HPA for CPU/memory scaling; use KEDA when you need to scale on external event sources or scale to zero. See the [KEDA vs HPA comparison](/recipes/autoscaling/keda-vs-hpa-autoscaling-comparison/).

### How do I install KEDA with the Helm chart?

`helm repo add kedacore https://kedacore.github.io/charts`, then `helm install keda kedacore/keda -n keda --create-namespace`. The chart installs the operator, the metrics API server, the admission webhooks, and the CRDs (`ScaledObject`, `ScaledJob`, `TriggerAuthentication`, `ClusterTriggerAuthentication`).

### How does KEDA handle multiple triggers?

Each trigger becomes a metric in the generated HPA, and the HPA picks the highest desired replica count across them. Scale-to-zero happens only when all triggers are inactive.

### Where do I set stabilizationWindowSeconds in KEDA?

Under `spec.advanced.horizontalPodAutoscalerConfig.behavior.scaleDown` (or `scaleUp`) in the ScaledObject — it's passed through to the generated HPA.
