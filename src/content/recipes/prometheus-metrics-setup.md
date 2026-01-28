---
title: "How to Set Up Prometheus Monitoring for Applications"
description: "Learn to instrument your Kubernetes applications with Prometheus metrics. Complete guide to ServiceMonitors, scraping configuration, and custom metrics."
category: "observability"
difficulty: "intermediate"
timeToComplete: "35 minutes"
kubernetesVersion: "1.28+"
prerequisites:
  - "A running Kubernetes cluster"
  - "Prometheus Operator installed (or kube-prometheus-stack)"
  - "Basic understanding of metrics concepts"
relatedRecipes:
  - "grafana-dashboards"
  - "alertmanager-configuration"
tags:
  - prometheus
  - monitoring
  - metrics
  - observability
  - servicemonitor
publishDate: "2026-01-21"
author: "Luca Berton"
---

## The Problem

You need to collect metrics from your Kubernetes applications to monitor performance, track SLIs, and set up alerting.

## The Solution

Use Prometheus with ServiceMonitors to automatically discover and scrape metrics from your applications.

## Step 1: Install Prometheus Stack

Install the kube-prometheus-stack using Helm:

```bash
helm repo add prometheus-community https://prometheus-community.github.io/helm-charts
helm repo update

helm install prometheus prometheus-community/kube-prometheus-stack \
  --namespace monitoring \
  --create-namespace \
  --set prometheus.prometheusSpec.serviceMonitorSelectorNilUsesHelmValues=false
```

## Step 2: Expose Metrics from Your Application

Your application needs a `/metrics` endpoint. Here's a Go example:

```go
package main

import (
    "net/http"
    "github.com/prometheus/client_golang/prometheus"
    "github.com/prometheus/client_golang/prometheus/promhttp"
)

var (
    requestsTotal = prometheus.NewCounterVec(
        prometheus.CounterOpts{
            Name: "http_requests_total",
            Help: "Total HTTP requests",
        },
        []string{"method", "path", "status"},
    )
)

func init() {
    prometheus.MustRegister(requestsTotal)
}

func main() {
    http.Handle("/metrics", promhttp.Handler())
    http.ListenAndServe(":8080", nil)
}
```

## Step 3: Deploy Application with Metrics Port

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: myapp
  labels:
    app: myapp
spec:
  replicas: 3
  selector:
    matchLabels:
      app: myapp
  template:
    metadata:
      labels:
        app: myapp
      annotations:
        prometheus.io/scrape: "true"
        prometheus.io/port: "8080"
        prometheus.io/path: "/metrics"
    spec:
      containers:
      - name: myapp
        image: myapp:latest
        ports:
        - name: http
          containerPort: 8080
        - name: metrics
          containerPort: 8080
---
apiVersion: v1
kind: Service
metadata:
  name: myapp
  labels:
    app: myapp
spec:
  ports:
  - name: http
    port: 80
    targetPort: 8080
  - name: metrics
    port: 8080
    targetPort: 8080
  selector:
    app: myapp
```

## Step 4: Create a ServiceMonitor

```yaml
apiVersion: monitoring.coreos.com/v1
kind: ServiceMonitor
metadata:
  name: myapp
  namespace: monitoring
  labels:
    release: prometheus  # Match Prometheus selector
spec:
  namespaceSelector:
    matchNames:
    - default
  selector:
    matchLabels:
      app: myapp
  endpoints:
  - port: metrics
    interval: 15s
    path: /metrics
```

## Step 5: Verify Scraping

Port-forward to Prometheus:

```bash
kubectl port-forward -n monitoring svc/prometheus-kube-prometheus-prometheus 9090:9090
```

Check targets at `http://localhost:9090/targets`

## Custom Metrics Examples

### Counter (requests, errors)

```yaml
# HELP http_requests_total Total HTTP requests
# TYPE http_requests_total counter
http_requests_total{method="GET",path="/api/users",status="200"} 1234
http_requests_total{method="POST",path="/api/users",status="201"} 56
```

### Gauge (current value)

```yaml
# HELP active_connections Current active connections
# TYPE active_connections gauge
active_connections 42
```

### Histogram (latency distribution)

```yaml
# HELP http_request_duration_seconds HTTP request latency
# TYPE http_request_duration_seconds histogram
http_request_duration_seconds_bucket{le="0.1"} 1000
http_request_duration_seconds_bucket{le="0.5"} 1200
http_request_duration_seconds_bucket{le="1"} 1250
http_request_duration_seconds_bucket{le="+Inf"} 1260
http_request_duration_seconds_sum 125.5
http_request_duration_seconds_count 1260
```

## Advanced ServiceMonitor Configuration

```yaml
apiVersion: monitoring.coreos.com/v1
kind: ServiceMonitor
metadata:
  name: myapp-detailed
  namespace: monitoring
spec:
  namespaceSelector:
    matchNames:
    - production
  selector:
    matchLabels:
      app: myapp
  endpoints:
  - port: metrics
    interval: 30s
    scrapeTimeout: 10s
    path: /metrics
    scheme: https
    tlsConfig:
      insecureSkipVerify: true
    basicAuth:
      username:
        name: prometheus-auth
        key: username
      password:
        name: prometheus-auth
        key: password
    relabelings:
    - sourceLabels: [__meta_kubernetes_pod_label_version]
      targetLabel: version
    metricRelabelings:
    - sourceLabels: [__name__]
      regex: 'go_.*'
      action: drop
```

## PodMonitor for Direct Pod Scraping

For pods without a Service:

```yaml
apiVersion: monitoring.coreos.com/v1
kind: PodMonitor
metadata:
  name: myapp-pods
  namespace: monitoring
spec:
  namespaceSelector:
    matchNames:
    - default
  selector:
    matchLabels:
      app: myapp
  podMetricsEndpoints:
  - port: metrics
    interval: 15s
```

## Useful PromQL Queries

### Request Rate

```promql
rate(http_requests_total[5m])
```

### Error Rate

```promql
sum(rate(http_requests_total{status=~"5.."}[5m])) 
/ 
sum(rate(http_requests_total[5m])) * 100
```

### 95th Percentile Latency

```promql
histogram_quantile(0.95, 
  rate(http_request_duration_seconds_bucket[5m])
)
```

### Memory Usage

```promql
container_memory_usage_bytes{container="myapp"}
```

## Troubleshooting

### ServiceMonitor Not Working

1. Check labels match:
```bash
kubectl get servicemonitor myapp -n monitoring -o yaml
kubectl get svc myapp -o yaml
```

2. Verify Prometheus config:
```bash
kubectl get prometheus -n monitoring -o yaml | grep serviceMonitorSelector
```

3. Check Prometheus logs:
```bash
kubectl logs -n monitoring prometheus-prometheus-kube-prometheus-prometheus-0
```

### No Metrics Showing

1. Test metrics endpoint directly:
```bash
kubectl port-forward svc/myapp 8080:8080
curl localhost:8080/metrics
```

2. Check scrape errors in Prometheus UI

## Best Practices

- Use meaningful metric names following conventions
- Add labels for dimensionality (method, path, status)
- Keep cardinality under control
- Set appropriate scrape intervals
- Use recording rules for expensive queries

## Key Takeaways

- ServiceMonitors auto-discover scrape targets
- Applications need a `/metrics` endpoint
- Use proper metric types (counter, gauge, histogram)
- Label matching is crucial for discovery
- Monitor scrape targets in Prometheus UI

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
