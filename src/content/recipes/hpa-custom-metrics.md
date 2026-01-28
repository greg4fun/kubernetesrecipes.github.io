---
title: "How to Scale Based on Custom Metrics"
description: "Configure Horizontal Pod Autoscaler with custom and external metrics. Learn to scale on application-specific metrics like queue depth and request latency."
category: "autoscaling"
difficulty: "advanced"
publishDate: "2026-01-22"
tags: ["hpa", "autoscaling", "custom-metrics", "prometheus", "scaling"]
---

# How to Scale Based on Custom Metrics

Scale your workloads based on application-specific metrics like queue depth, request latency, or business KPIs using the custom metrics API with Prometheus Adapter.

## Architecture Overview

```
┌─────────────┐     ┌──────────────────┐     ┌────────────┐
│     HPA     │ ──→ │ Prometheus       │ ──→ │ Prometheus │
│             │     │ Adapter          │     │            │
└─────────────┘     └──────────────────┘     └────────────┘
                           │
                    custom.metrics.k8s.io
                    external.metrics.k8s.io
```

## Install Prometheus Adapter

```bash
helm repo add prometheus-community https://prometheus-community.github.io/helm-charts
helm install prometheus-adapter prometheus-community/prometheus-adapter \
  --namespace monitoring \
  --set prometheus.url=http://prometheus.monitoring.svc \
  --set prometheus.port=9090
```

## Configure Custom Metrics Rules

```yaml
# prometheus-adapter-config.yaml
apiVersion: v1
kind: ConfigMap
metadata:
  name: prometheus-adapter
  namespace: monitoring
data:
  config.yaml: |
    rules:
      # HTTP requests per second
      - seriesQuery: 'http_requests_total{namespace!="",pod!=""}'
        resources:
          overrides:
            namespace: {resource: "namespace"}
            pod: {resource: "pod"}
        name:
          matches: "^(.*)_total$"
          as: "${1}_per_second"
        metricsQuery: 'sum(rate(<<.Series>>{<<.LabelMatchers>>}[2m])) by (<<.GroupBy>>)'
      
      # Request latency (p99)
      - seriesQuery: 'http_request_duration_seconds_bucket{namespace!="",pod!=""}'
        resources:
          overrides:
            namespace: {resource: "namespace"}
            pod: {resource: "pod"}
        name:
          matches: "^(.*)_bucket$"
          as: "${1}_p99"
        metricsQuery: 'histogram_quantile(0.99, sum(rate(<<.Series>>{<<.LabelMatchers>>}[2m])) by (le, <<.GroupBy>>))'
      
      # Queue depth
      - seriesQuery: 'rabbitmq_queue_messages{namespace!=""}'
        resources:
          overrides:
            namespace: {resource: "namespace"}
        name:
          matches: "^(.*)$"
          as: "queue_messages"
        metricsQuery: 'sum(<<.Series>>{<<.LabelMatchers>>}) by (<<.GroupBy>>)'
      
      # Active connections
      - seriesQuery: 'app_active_connections{namespace!="",pod!=""}'
        resources:
          overrides:
            namespace: {resource: "namespace"}
            pod: {resource: "pod"}
        name:
          matches: "^(.*)$"
          as: "active_connections"
        metricsQuery: 'sum(<<.Series>>{<<.LabelMatchers>>}) by (<<.GroupBy>>)'
```

## Verify Custom Metrics Available

```bash
# List available custom metrics
kubectl get --raw "/apis/custom.metrics.k8s.io/v1beta1" | jq .

# Query specific metric
kubectl get --raw "/apis/custom.metrics.k8s.io/v1beta1/namespaces/default/pods/*/http_requests_per_second" | jq .

# List external metrics
kubectl get --raw "/apis/external.metrics.k8s.io/v1beta1" | jq .
```

## HPA with Custom Metrics

```yaml
# hpa-custom-metrics.yaml
apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata:
  name: api-hpa
  namespace: default
spec:
  scaleTargetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: api-server
  minReplicas: 2
  maxReplicas: 20
  metrics:
    # Scale on requests per second per pod
    - type: Pods
      pods:
        metric:
          name: http_requests_per_second
        target:
          type: AverageValue
          averageValue: 1000  # 1000 req/s per pod
    
    # Scale on latency
    - type: Pods
      pods:
        metric:
          name: http_request_duration_p99
        target:
          type: AverageValue
          averageValue: 500m  # 500ms p99 latency target
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
        - type: Pods
          value: 4
          periodSeconds: 15
      selectPolicy: Max
```

## HPA with External Metrics

```yaml
# hpa-external-metrics.yaml
apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata:
  name: queue-worker-hpa
spec:
  scaleTargetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: queue-worker
  minReplicas: 1
  maxReplicas: 50
  metrics:
    # Scale based on queue depth (external metric)
    - type: External
      external:
        metric:
          name: rabbitmq_queue_messages
          selector:
            matchLabels:
              queue: tasks
        target:
          type: AverageValue
          averageValue: 10  # 10 messages per pod
```

## Application Exposing Custom Metrics

```yaml
# app-with-metrics.yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: api-server
  annotations:
    prometheus.io/scrape: "true"
    prometheus.io/port: "9090"
    prometheus.io/path: "/metrics"
spec:
  template:
    spec:
      containers:
        - name: api
          image: api-server:v1
          ports:
            - containerPort: 8080
              name: http
            - containerPort: 9090
              name: metrics
```

Sample metrics endpoint output:

```prometheus
# HELP http_requests_total Total HTTP requests
# TYPE http_requests_total counter
http_requests_total{method="GET",path="/api/users",status="200"} 15234
http_requests_total{method="POST",path="/api/orders",status="201"} 3421

# HELP http_request_duration_seconds HTTP request latency
# TYPE http_request_duration_seconds histogram
http_request_duration_seconds_bucket{le="0.1"} 14532
http_request_duration_seconds_bucket{le="0.5"} 15100
http_request_duration_seconds_bucket{le="1.0"} 15200
http_request_duration_seconds_bucket{le="+Inf"} 15234

# HELP app_active_connections Current active connections
# TYPE app_active_connections gauge
app_active_connections 42
```

## Multiple Metrics Combined

```yaml
# hpa-multiple-metrics.yaml
apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata:
  name: web-app-hpa
spec:
  scaleTargetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: web-app
  minReplicas: 3
  maxReplicas: 100
  metrics:
    # CPU as baseline
    - type: Resource
      resource:
        name: cpu
        target:
          type: Utilization
          averageUtilization: 70
    
    # Custom requests metric
    - type: Pods
      pods:
        metric:
          name: http_requests_per_second
        target:
          type: AverageValue
          averageValue: 500
    
    # Memory as safety
    - type: Resource
      resource:
        name: memory
        target:
          type: Utilization
          averageUtilization: 80
```

## Object Metrics (Ingress-based)

```yaml
# hpa-object-metrics.yaml
apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata:
  name: ingress-based-hpa
spec:
  scaleTargetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: web-app
  minReplicas: 2
  maxReplicas: 50
  metrics:
    - type: Object
      object:
        metric:
          name: requests_per_second
        describedObject:
          apiVersion: networking.k8s.io/v1
          kind: Ingress
          name: web-ingress
        target:
          type: Value
          value: 10000  # Total 10k req/s across all pods
```

## Debug HPA Scaling

```bash
# Check HPA status
kubectl describe hpa api-hpa

# View HPA events
kubectl get events --field-selector involvedObject.name=api-hpa

# Check current metric values
kubectl get hpa api-hpa -o yaml | grep -A 20 "status:"

# Verify adapter is serving metrics
kubectl logs -n monitoring -l app=prometheus-adapter
```

## Custom Metric ServiceMonitor

```yaml
# servicemonitor.yaml
apiVersion: monitoring.coreos.com/v1
kind: ServiceMonitor
metadata:
  name: api-server
  namespace: monitoring
spec:
  selector:
    matchLabels:
      app: api-server
  namespaceSelector:
    matchNames:
      - default
  endpoints:
    - port: metrics
      interval: 15s
      path: /metrics
```

## Summary

Custom metrics HPA enables scaling based on business-relevant metrics. Deploy Prometheus Adapter to bridge Prometheus metrics to the Kubernetes metrics API. Configure rules to expose application metrics like request rate, latency, and queue depth for intelligent autoscaling.

---

## 📘 Go Further with Kubernetes Recipes

**Love this recipe? There's so much more!** This is just one of **100+ hands-on recipes** in our comprehensive **[Kubernetes Recipes book](/book)**.

Inside the book, you'll master:
- ✅ Production-ready deployment strategies
- ✅ Advanced networking and security patterns  
- ✅ Observability, monitoring, and troubleshooting
- ✅ Real-world best practices from industry experts

> *"The practical, recipe-based approach made complex Kubernetes concepts finally click for me."*

**👉 [Get Your Copy Now](/book)** — Start building production-grade Kubernetes skills today!
