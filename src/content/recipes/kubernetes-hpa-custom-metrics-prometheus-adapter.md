---
title: "Kubernetes HPA Custom Metrics Prometheus Adapter"
description: "Configure Kubernetes Horizontal Pod Autoscaler with custom Prometheus metrics via the Prometheus Adapter. Scale on request latency, queue depth, GPU utilization, and business metrics beyond CPU and memory."
tags:
  - "hpa"
  - "autoscaling"
  - "prometheus"
  - "custom-metrics"
  - "prometheus-adapter"
category: "autoscaling"
publishDate: "2026-06-01"
author: "Luca Berton"
difficulty: "advanced"
relatedRecipes:
  - "kubernetes-vertical-pod-autoscaler-vpa"
  - "prometheus-monitoring-kubernetes"
  - "kubernetes-hpa-horizontal-pod-autoscaler"
---

> 💡 **Quick Answer:** The Prometheus Adapter exposes Prometheus metrics as Kubernetes custom metrics API, enabling HPA to scale on any metric. Install the adapter with Helm, configure metric rules to map PromQL queries to the `custom.metrics.k8s.io` API, then reference metrics in your HPA spec with `type: Pods` or `type: Object`.

## The Problem

- Default HPA only scales on CPU and memory — insufficient for many workloads
- Need to scale on: request latency (P99), queue depth, active connections, GPU utilization
- Prometheus has the metrics but HPA can't access them directly
- Custom metrics API bridge is complex to configure
- Business metrics (orders/sec, active users) should drive scaling

## The Solution

### Install Prometheus Adapter

```bash
helm repo add prometheus-community https://prometheus-community.github.io/helm-charts

helm install prometheus-adapter prometheus-community/prometheus-adapter \
  --namespace monitoring \
  --set prometheus.url=http://prometheus-server.monitoring.svc \
  --set prometheus.port=9090 \
  --values adapter-values.yaml
```

### Configure Metric Rules

```yaml
# adapter-values.yaml
rules:
  default: false
  custom:
    # Rule 1: HTTP requests per second per pod
    - seriesQuery: 'http_requests_total{namespace!="",pod!=""}'
      resources:
        overrides:
          namespace: {resource: "namespace"}
          pod: {resource: "pod"}
      name:
        matches: "^(.*)_total$"
        as: "${1}_per_second"
      metricsQuery: 'sum(rate(<<.Series>>{<<.LabelMatchers>>}[2m])) by (<<.GroupBy>>)'

    # Rule 2: Request latency P99
    - seriesQuery: 'http_request_duration_seconds_bucket{namespace!="",pod!=""}'
      resources:
        overrides:
          namespace: {resource: "namespace"}
          pod: {resource: "pod"}
      name:
        matches: ".*"
        as: "http_request_duration_p99"
      metricsQuery: 'histogram_quantile(0.99, sum(rate(<<.Series>>{<<.LabelMatchers>>}[2m])) by (le, <<.GroupBy>>))'

    # Rule 3: Queue depth (external metric)
    - seriesQuery: 'rabbitmq_queue_messages{namespace!=""}'
      resources:
        overrides:
          namespace: {resource: "namespace"}
      name:
        matches: "^(.*)$"
        as: "queue_messages"
      metricsQuery: 'sum(<<.Series>>{<<.LabelMatchers>>}) by (<<.GroupBy>>)'

    # Rule 4: GPU utilization per pod
    - seriesQuery: 'DCGM_FI_DEV_GPU_UTIL{namespace!="",pod!=""}'
      resources:
        overrides:
          namespace: {resource: "namespace"}
          pod: {resource: "pod"}
      name:
        matches: "^(.*)$"
        as: "gpu_utilization"
      metricsQuery: 'avg(<<.Series>>{<<.LabelMatchers>>}) by (<<.GroupBy>>)'

  external:
    # External metrics (not associated with K8s objects)
    - seriesQuery: 'sqs_queue_depth{queue_name!=""}'
      name:
        matches: "^(.*)$"
        as: "sqs_queue_depth"
      metricsQuery: '<<.Series>>{<<.LabelMatchers>>}'
```

### Verify Custom Metrics Available

```bash
# Check custom metrics API
kubectl get --raw "/apis/custom.metrics.k8s.io/v1beta1" | jq .

# List available metrics
kubectl get --raw "/apis/custom.metrics.k8s.io/v1beta1/namespaces/production/pods/*/http_requests_per_second" | jq .

# Check external metrics
kubectl get --raw "/apis/external.metrics.k8s.io/v1beta1" | jq .
```

### HPA with Custom Metrics

```yaml
# Scale on requests per second
apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata:
  name: api-server-hpa
  namespace: production
spec:
  scaleTargetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: api-server
  minReplicas: 2
  maxReplicas: 20
  metrics:
    # Scale on RPS per pod (target 100 req/s per pod)
    - type: Pods
      pods:
        metric:
          name: http_requests_per_second
        target:
          type: AverageValue
          averageValue: "100"

    # Also consider CPU (but not as primary)
    - type: Resource
      resource:
        name: cpu
        target:
          type: Utilization
          averageUtilization: 70
  behavior:
    scaleDown:
      stabilizationWindowSeconds: 300
      policies:
        - type: Percent
          value: 10
          periodSeconds: 60
    scaleUp:
      stabilizationWindowSeconds: 30
      policies:
        - type: Percent
          value: 50
          periodSeconds: 30
```

### HPA with External Metrics (Queue-Based)

```yaml
# Scale workers based on queue depth
apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata:
  name: queue-worker-hpa
  namespace: production
spec:
  scaleTargetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: queue-worker
  minReplicas: 1
  maxReplicas: 50
  metrics:
    - type: External
      external:
        metric:
          name: sqs_queue_depth
          selector:
            matchLabels:
              queue_name: "orders-queue"
        target:
          type: Value
          value: "30"    # Scale up when >30 messages per replica
```

### HPA with Object Metrics (Ingress RPS)

```yaml
# Scale based on Ingress requests per second
apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata:
  name: frontend-hpa
  namespace: production
spec:
  scaleTargetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: frontend
  minReplicas: 3
  maxReplicas: 30
  metrics:
    - type: Object
      object:
        describedObject:
          apiVersion: networking.k8s.io/v1
          kind: Ingress
          name: frontend-ingress
        metric:
          name: requests_per_second
        target:
          type: Value
          value: "1000"    # Scale when total ingress RPS > 1000
```

## Common Issues

### "unable to fetch metrics from custom metrics API"
- **Cause**: Prometheus Adapter not running, or rules misconfigured
- **Fix**: Check adapter pod logs; test with `kubectl get --raw /apis/custom.metrics.k8s.io/v1beta1`

### Metrics return 0 or missing
- **Cause**: PromQL query returns no data; label matchers don't match
- **Fix**: Test the query directly in Prometheus; verify pod/namespace labels exist

### HPA not scaling despite high metric value
- **Cause**: `stabilizationWindowSeconds` preventing rapid changes; or metric below target
- **Fix**: Check `kubectl describe hpa`; reduce stabilization window; verify target value

### "no matches for kind HorizontalPodAutoscaler in version autoscaling/v2"
- **Cause**: Kubernetes version too old (v2 stable since 1.23)
- **Fix**: Use `autoscaling/v2beta2` for K8s <1.23

## Best Practices

1. **Test PromQL before configuring adapter** — verify query returns expected data
2. **Use rate() for counter metrics** — raw counters aren't useful for scaling
3. **Set stabilization windows** — prevent flapping (5min down, 30s up is common)
4. **Combine multiple metrics** — HPA uses the highest recommendation
5. **Scale on leading indicators** — queue depth > CPU (scales before overload)
6. **Set appropriate `averageValue`** — represents per-pod target, not total
7. **Monitor HPA decisions** — `kubectl describe hpa` shows scaling rationale

## Key Takeaways

- Prometheus Adapter bridges Prometheus metrics → Kubernetes custom metrics API
- HPA can scale on any Prometheus metric: RPS, latency, queue depth, GPU util
- Three metric types: `Pods` (per-pod average), `Object` (single resource), `External` (non-K8s)
- Rules map PromQL queries to API-compatible metric names
- `behavior` field controls scale-up/down speed and stabilization
- Leading indicators (queue depth, latency) are better scaling signals than CPU
- Always verify metrics with `kubectl get --raw` before creating HPA
