---
title: "Prometheus: K8s Monitoring and Alerting"
description: "Deploy Prometheus monitoring in Kubernetes with kube-prometheus-stack. ServiceMonitor, PrometheusRule, Grafana dashboards, and alerting for production clusters."
publishDate: "2026-05-02"
author: "Luca Berton"
category: "observability"
difficulty: "intermediate"
timeToComplete: "15 minutes"
kubernetesVersion: "1.28+"
tags:
  - "prometheus"
  - "monitoring"
  - "alerting"
  - "observability"
  - "grafana"
relatedRecipes:
  - "kubernetes-metrics-server-top"
  - "kubernetes-probes-liveness-readiness"
---

> 💡 **Quick Answer:** Deploy the full monitoring stack: `helm install prometheus prometheus-community/kube-prometheus-stack -n monitoring --create-namespace`. Includes Prometheus, Grafana, Alertmanager, node-exporter, and kube-state-metrics. Create `ServiceMonitor` to scrape your apps. Create `PrometheusRule` for alerts. Access Grafana: `kubectl port-forward svc/prometheus-grafana 3000:80 -n monitoring` (admin/prom-operator).

## The Problem

You need visibility into your Kubernetes cluster:

- Are nodes healthy? CPU/memory/disk usage?
- Are pods running? Restart counts?
- Application-specific metrics (request rate, error rate, latency)
- Alerting when things go wrong
- Historical data for capacity planning

## The Solution

### Install kube-prometheus-stack

```bash
helm repo add prometheus-community https://prometheus-community.github.io/helm-charts
helm install prometheus prometheus-community/kube-prometheus-stack \
  -n monitoring --create-namespace \
  --set grafana.adminPassword=admin \
  --set prometheus.prometheusSpec.retention=30d \
  --set prometheus.prometheusSpec.storageSpec.volumeClaimTemplate.spec.resources.requests.storage=50Gi

# What you get:
# - Prometheus (metrics collection)
# - Grafana (dashboards)
# - Alertmanager (alert routing)
# - node-exporter (node metrics)
# - kube-state-metrics (K8s object metrics)
# - Pre-built dashboards and alerting rules

# Access Grafana
kubectl port-forward svc/prometheus-grafana 3000:80 -n monitoring
# http://localhost:3000 → admin / admin
```

### ServiceMonitor (Scrape Your Apps)

```yaml
# Your app exposes /metrics on port 8080
apiVersion: monitoring.coreos.com/v1
kind: ServiceMonitor
metadata:
  name: my-app
  namespace: monitoring
  labels:
    release: prometheus          # Must match Prometheus selector
spec:
  namespaceSelector:
    matchNames:
    - production
  selector:
    matchLabels:
      app: my-app
  endpoints:
  - port: http-metrics           # Service port name
    path: /metrics
    interval: 30s
    scrapeTimeout: 10s
```

```yaml
# App Service (must have named port)
apiVersion: v1
kind: Service
metadata:
  name: my-app
  namespace: production
  labels:
    app: my-app
spec:
  ports:
  - name: http-metrics           # Referenced by ServiceMonitor
    port: 8080
  selector:
    app: my-app
```

### PodMonitor (For Pods Without Service)

```yaml
apiVersion: monitoring.coreos.com/v1
kind: PodMonitor
metadata:
  name: batch-jobs
  namespace: monitoring
spec:
  namespaceSelector:
    matchNames:
    - batch
  selector:
    matchLabels:
      app: batch-processor
  podMetricsEndpoints:
  - port: metrics
    interval: 60s
```

### PrometheusRule (Alerting)

```yaml
apiVersion: monitoring.coreos.com/v1
kind: PrometheusRule
metadata:
  name: app-alerts
  namespace: monitoring
  labels:
    release: prometheus
spec:
  groups:
  - name: app.rules
    rules:
    # High error rate
    - alert: HighErrorRate
      expr: |
        sum(rate(http_requests_total{status=~"5.."}[5m]))
        /
        sum(rate(http_requests_total[5m]))
        > 0.05
      for: 5m
      labels:
        severity: critical
      annotations:
        summary: "High error rate ({{ $value | humanizePercentage }})"
        description: "Error rate above 5% for 5 minutes"
    
    # Pod restarts
    - alert: PodCrashLooping
      expr: rate(kube_pod_container_status_restarts_total[15m]) * 60 * 15 > 0
      for: 15m
      labels:
        severity: warning
      annotations:
        summary: "Pod {{ $labels.namespace }}/{{ $labels.pod }} restarting"
    
    # High memory usage
    - alert: HighMemoryUsage
      expr: |
        container_memory_working_set_bytes{container!=""}
        /
        container_spec_memory_limit_bytes{container!=""}
        > 0.9
      for: 10m
      labels:
        severity: warning
      annotations:
        summary: "Container {{ $labels.container }} using >90% memory"
    
    # Node disk pressure
    - alert: NodeDiskPressure
      expr: |
        (node_filesystem_avail_bytes{mountpoint="/"} / node_filesystem_size_bytes{mountpoint="/"}) < 0.1
      for: 5m
      labels:
        severity: critical
      annotations:
        summary: "Node {{ $labels.instance }} disk <10% free"
```

### Alertmanager Configuration

```yaml
# In Helm values or AlertmanagerConfig CRD
apiVersion: monitoring.coreos.com/v1alpha1
kind: AlertmanagerConfig
metadata:
  name: slack-alerts
  namespace: monitoring
spec:
  route:
    groupBy: ['alertname', 'namespace']
    groupWait: 30s
    groupInterval: 5m
    repeatInterval: 4h
    receiver: slack-critical
    routes:
    - matchers:
      - name: severity
        value: critical
      receiver: slack-critical
    - matchers:
      - name: severity
        value: warning
      receiver: slack-warning
  
  receivers:
  - name: slack-critical
    slackConfigs:
    - apiURL:
        name: slack-webhook
        key: url
      channel: '#alerts-critical'
      title: '🔴 {{ .GroupLabels.alertname }}'
      text: '{{ range .Alerts }}{{ .Annotations.summary }}{{ end }}'
  
  - name: slack-warning
    slackConfigs:
    - apiURL:
        name: slack-webhook
        key: url
      channel: '#alerts-warning'
```

### Essential PromQL Queries

```promql
# CPU usage by pod
sum(rate(container_cpu_usage_seconds_total{container!=""}[5m])) by (pod)

# Memory usage by namespace
sum(container_memory_working_set_bytes{container!=""}) by (namespace)

# Request rate by service
sum(rate(http_requests_total[5m])) by (service)

# P99 latency
histogram_quantile(0.99, sum(rate(http_request_duration_seconds_bucket[5m])) by (le))

# Error rate
sum(rate(http_requests_total{status=~"5.."}[5m])) / sum(rate(http_requests_total[5m]))

# Pod restart count (last hour)
increase(kube_pod_container_status_restarts_total[1h])

# Node CPU utilization
100 - (avg by(instance) (rate(node_cpu_seconds_total{mode="idle"}[5m])) * 100)

# Disk usage percentage
(1 - node_filesystem_avail_bytes/node_filesystem_size_bytes) * 100

# Top 10 pods by CPU
topk(10, sum(rate(container_cpu_usage_seconds_total{container!=""}[5m])) by (pod))
```

### Instrument Your App

```python
# Python with prometheus_client
from prometheus_client import Counter, Histogram, start_http_server

REQUEST_COUNT = Counter('http_requests_total', 'Total requests', ['method', 'endpoint', 'status'])
REQUEST_LATENCY = Histogram('http_request_duration_seconds', 'Request latency', ['endpoint'])

@app.route('/api/data')
@REQUEST_LATENCY.labels(endpoint='/api/data').time()
def get_data():
    result = process()
    REQUEST_COUNT.labels(method='GET', endpoint='/api/data', status=200).inc()
    return result

# Expose /metrics on port 8080
start_http_server(8080)
```

## Common Issues

**ServiceMonitor not discovered**

Missing `release: prometheus` label. Prometheus operator only watches ServiceMonitors matching its selector.

**"0 active targets" for custom metrics**

Service port name doesn't match ServiceMonitor `endpoints.port`. Must use port name, not number.

**Prometheus OOM killed**

Retention too long or too many series. Reduce retention, add storage, or use Thanos/Cortex for long-term.

## Best Practices

- **kube-prometheus-stack** for one-command full monitoring
- **ServiceMonitor per app** — not global scrape configs
- **Alert on symptoms** (error rate, latency) not causes (CPU, memory)
- **Use recording rules** for expensive queries
- **Grafana dashboards per team** — don't overload a single dashboard

## Key Takeaways

- kube-prometheus-stack = Prometheus + Grafana + Alertmanager + exporters
- ServiceMonitor CRD tells Prometheus what to scrape
- PrometheusRule CRD defines alerting rules
- PromQL for querying — learn the key patterns (rate, sum, histogram_quantile)
- Instrument your apps with /metrics endpoint for custom metrics
