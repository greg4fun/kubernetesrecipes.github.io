---
title: "How to Monitor Kubernetes with Prometheus"
description: "Set up Prometheus monitoring for Kubernetes clusters. Configure scraping, alerting rules, and visualize metrics with Grafana dashboards."
category: "observability"
difficulty: "intermediate"
publishDate: "2026-01-22"
tags: ["prometheus", "monitoring", "metrics", "grafana", "alerting"]
---

# How to Monitor Kubernetes with Prometheus

Prometheus is the standard for Kubernetes monitoring. Collect metrics from nodes, pods, and applications, set up alerts, and visualize with Grafana.

## Install with Helm

```bash
# Add Prometheus community repo
helm repo add prometheus-community https://prometheus-community.github.io/helm-charts
helm repo update

# Install kube-prometheus-stack (Prometheus + Grafana + Alertmanager)
helm install prometheus prometheus-community/kube-prometheus-stack \
  --namespace monitoring \
  --create-namespace \
  --set grafana.adminPassword=admin123

# Verify installation
kubectl get pods -n monitoring
```

## Access Prometheus UI

```bash
# Port forward Prometheus
kubectl port-forward -n monitoring svc/prometheus-kube-prometheus-prometheus 9090:9090

# Access at http://localhost:9090

# Port forward Grafana
kubectl port-forward -n monitoring svc/prometheus-grafana 3000:80

# Access at http://localhost:3000 (admin/admin123)
```

## ServiceMonitor for Applications

```yaml
# servicemonitor.yaml
apiVersion: monitoring.coreos.com/v1
kind: ServiceMonitor
metadata:
  name: my-app
  namespace: monitoring
  labels:
    release: prometheus  # Must match Prometheus selector
spec:
  selector:
    matchLabels:
      app: my-app
  namespaceSelector:
    matchNames:
      - production
  endpoints:
    - port: metrics
      interval: 30s
      path: /metrics
```

```yaml
# Application service with metrics port
apiVersion: v1
kind: Service
metadata:
  name: my-app
  namespace: production
  labels:
    app: my-app
spec:
  selector:
    app: my-app
  ports:
    - name: http
      port: 80
      targetPort: 8080
    - name: metrics
      port: 9090
      targetPort: 9090
```

## PodMonitor (Direct Pod Scraping)

```yaml
# podmonitor.yaml
apiVersion: monitoring.coreos.com/v1
kind: PodMonitor
metadata:
  name: my-app-pods
  namespace: monitoring
spec:
  selector:
    matchLabels:
      app: my-app
  namespaceSelector:
    matchNames:
      - production
  podMetricsEndpoints:
    - port: metrics
      interval: 15s
      path: /metrics
```

## PrometheusRule for Alerts

```yaml
# alerts.yaml
apiVersion: monitoring.coreos.com/v1
kind: PrometheusRule
metadata:
  name: my-app-alerts
  namespace: monitoring
  labels:
    release: prometheus
spec:
  groups:
    - name: my-app
      rules:
        # High error rate
        - alert: HighErrorRate
          expr: |
            sum(rate(http_requests_total{status=~"5.."}[5m])) 
            / sum(rate(http_requests_total[5m])) > 0.05
          for: 5m
          labels:
            severity: critical
          annotations:
            summary: "High error rate detected"
            description: "Error rate is {{ $value | humanizePercentage }}"
        
        # Pod memory usage
        - alert: PodHighMemory
          expr: |
            container_memory_usage_bytes{container!=""} 
            / container_spec_memory_limit_bytes > 0.9
          for: 5m
          labels:
            severity: warning
          annotations:
            summary: "Pod memory usage high"
            description: "Pod {{ $labels.pod }} memory at {{ $value | humanizePercentage }}"
        
        # Pod restarts
        - alert: PodRestartingTooMuch
          expr: |
            increase(kube_pod_container_status_restarts_total[1h]) > 5
          for: 10m
          labels:
            severity: warning
          annotations:
            summary: "Pod restarting frequently"
            description: "Pod {{ $labels.pod }} restarted {{ $value }} times"
```

## Common PromQL Queries

```promql
# CPU usage by pod
sum(rate(container_cpu_usage_seconds_total{container!=""}[5m])) by (pod)

# Memory usage by pod
sum(container_memory_usage_bytes{container!=""}) by (pod)

# Request rate by service
sum(rate(http_requests_total[5m])) by (service)

# Error rate
sum(rate(http_requests_total{status=~"5.."}[5m])) 
/ sum(rate(http_requests_total[5m]))

# 99th percentile latency
histogram_quantile(0.99, sum(rate(http_request_duration_seconds_bucket[5m])) by (le))

# Node CPU usage
100 - (avg by(instance) (rate(node_cpu_seconds_total{mode="idle"}[5m])) * 100)

# Node memory usage
(1 - node_memory_MemAvailable_bytes / node_memory_MemTotal_bytes) * 100

# Disk usage
(1 - node_filesystem_avail_bytes / node_filesystem_size_bytes) * 100

# Pod count by namespace
count(kube_pod_info) by (namespace)

# Deployment replicas vs desired
kube_deployment_status_replicas_available / kube_deployment_spec_replicas
```

## Configure Alertmanager

```yaml
# alertmanager-config.yaml
apiVersion: v1
kind: Secret
metadata:
  name: alertmanager-prometheus-kube-prometheus-alertmanager
  namespace: monitoring
stringData:
  alertmanager.yaml: |
    global:
      resolve_timeout: 5m
      slack_api_url: 'https://hooks.slack.com/services/xxx'
    
    route:
      group_by: ['alertname', 'namespace']
      group_wait: 30s
      group_interval: 5m
      repeat_interval: 4h
      receiver: 'slack'
      routes:
        - match:
            severity: critical
          receiver: 'pagerduty'
        - match:
            severity: warning
          receiver: 'slack'
    
    receivers:
      - name: 'slack'
        slack_configs:
          - channel: '#alerts'
            send_resolved: true
            title: '{{ .Status | toUpper }}: {{ .CommonAnnotations.summary }}'
            text: '{{ .CommonAnnotations.description }}'
      
      - name: 'pagerduty'
        pagerduty_configs:
          - service_key: '<pagerduty-key>'
            send_resolved: true
```

## Grafana Dashboards

```yaml
# Import dashboards via ConfigMap
apiVersion: v1
kind: ConfigMap
metadata:
  name: grafana-dashboard-my-app
  namespace: monitoring
  labels:
    grafana_dashboard: "1"
data:
  my-app-dashboard.json: |
    {
      "title": "My App Dashboard",
      "panels": [
        {
          "title": "Request Rate",
          "targets": [
            {
              "expr": "sum(rate(http_requests_total[5m]))"
            }
          ]
        }
      ]
    }
```

```bash
# Popular dashboard IDs to import in Grafana:
# 315  - Kubernetes cluster monitoring
# 6417 - Kubernetes pods
# 7249 - Kubernetes cluster
# 11074 - Node Exporter Full
# 13502 - Kubernetes / API server
```

## Application Instrumentation

```python
# Python Flask with prometheus_client
from prometheus_client import Counter, Histogram, generate_latest
from flask import Flask, Response

app = Flask(__name__)

REQUEST_COUNT = Counter(
    'http_requests_total',
    'Total HTTP requests',
    ['method', 'endpoint', 'status']
)

REQUEST_LATENCY = Histogram(
    'http_request_duration_seconds',
    'HTTP request latency',
    ['method', 'endpoint']
)

@app.route('/api/data')
def get_data():
    with REQUEST_LATENCY.labels('GET', '/api/data').time():
        result = process_data()
    REQUEST_COUNT.labels('GET', '/api/data', '200').inc()
    return result

@app.route('/metrics')
def metrics():
    return Response(generate_latest(), mimetype='text/plain')
```

## Recording Rules

```yaml
# recording-rules.yaml
apiVersion: monitoring.coreos.com/v1
kind: PrometheusRule
metadata:
  name: recording-rules
  namespace: monitoring
spec:
  groups:
    - name: aggregations
      interval: 30s
      rules:
        # Pre-compute expensive queries
        - record: job:http_requests_total:rate5m
          expr: sum(rate(http_requests_total[5m])) by (job)
        
        - record: job:http_request_duration_seconds:p99
          expr: histogram_quantile(0.99, sum(rate(http_request_duration_seconds_bucket[5m])) by (job, le))
        
        - record: namespace:container_cpu_usage:sum
          expr: sum(rate(container_cpu_usage_seconds_total[5m])) by (namespace)
```

## Verify Monitoring

```bash
# Check Prometheus targets
kubectl port-forward -n monitoring svc/prometheus-kube-prometheus-prometheus 9090:9090
# Visit http://localhost:9090/targets

# Check ServiceMonitor discovered
kubectl get servicemonitor -A

# Check PrometheusRule loaded
kubectl get prometheusrule -A

# View Prometheus config
kubectl get secret -n monitoring prometheus-prometheus-kube-prometheus-prometheus -o jsonpath='{.data.prometheus\.yaml\.gz}' | base64 -d | gunzip
```

## Summary

Prometheus with kube-prometheus-stack provides comprehensive Kubernetes monitoring. Create ServiceMonitors to scrape application metrics and PodMonitors for direct pod scraping. Define alerts with PrometheusRule resources and configure Alertmanager for notifications via Slack, PagerDuty, or email. Use PromQL for querying metrics and create Grafana dashboards for visualization. Instrument applications with Prometheus client libraries to expose custom metrics. Use recording rules to pre-compute expensive queries for dashboard performance.

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
