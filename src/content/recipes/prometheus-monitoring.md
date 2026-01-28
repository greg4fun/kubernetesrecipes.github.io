---
title: "How to Monitor Kubernetes with Prometheus"
description: "Deploy Prometheus for comprehensive Kubernetes monitoring. Set up metrics collection, create dashboards, and configure alerting for cluster health."
category: "observability"
difficulty: "intermediate"
publishDate: "2026-01-22"
tags: ["prometheus", "monitoring", "metrics", "grafana", "observability"]
---

# How to Monitor Kubernetes with Prometheus

Prometheus provides powerful metrics collection and alerting for Kubernetes clusters. Deploy the kube-prometheus-stack for comprehensive monitoring with Grafana dashboards.

## Install kube-prometheus-stack

```bash
# Add Helm repository
helm repo add prometheus-community https://prometheus-community.github.io/helm-charts
helm repo update

# Install with default configuration
helm install prometheus prometheus-community/kube-prometheus-stack \
  --namespace monitoring \
  --create-namespace

# Verify installation
kubectl get pods -n monitoring
```

## Custom Values Installation

```yaml
# prometheus-values.yaml
prometheus:
  prometheusSpec:
    retention: 30d
    retentionSize: 50GB
    resources:
      requests:
        cpu: 500m
        memory: 2Gi
      limits:
        cpu: 2000m
        memory: 8Gi
    storageSpec:
      volumeClaimTemplate:
        spec:
          storageClassName: gp3
          accessModes: ["ReadWriteOnce"]
          resources:
            requests:
              storage: 100Gi
    serviceMonitorSelectorNilUsesHelmValues: false
    podMonitorSelectorNilUsesHelmValues: false

grafana:
  adminPassword: "your-secure-password"
  persistence:
    enabled: true
    size: 10Gi
  ingress:
    enabled: true
    hosts:
      - grafana.example.com

alertmanager:
  alertmanagerSpec:
    storage:
      volumeClaimTemplate:
        spec:
          storageClassName: gp3
          accessModes: ["ReadWriteOnce"]
          resources:
            requests:
              storage: 10Gi
```

```bash
helm install prometheus prometheus-community/kube-prometheus-stack \
  --namespace monitoring \
  --create-namespace \
  -f prometheus-values.yaml
```

## Access Prometheus UI

```bash
# Port forward Prometheus
kubectl port-forward svc/prometheus-kube-prometheus-prometheus -n monitoring 9090:9090

# Port forward Grafana
kubectl port-forward svc/prometheus-grafana -n monitoring 3000:80

# Get Grafana admin password
kubectl get secret prometheus-grafana -n monitoring \
  -o jsonpath="{.data.admin-password}" | base64 -d
```

## ServiceMonitor for Applications

```yaml
# servicemonitor.yaml
apiVersion: monitoring.coreos.com/v1
kind: ServiceMonitor
metadata:
  name: myapp-monitor
  namespace: monitoring
  labels:
    release: prometheus  # Must match Prometheus selector
spec:
  selector:
    matchLabels:
      app: myapp
  namespaceSelector:
    matchNames:
      - default
      - production
  endpoints:
    - port: metrics
      interval: 30s
      path: /metrics
      scrapeTimeout: 10s
---
# Application service with metrics port
apiVersion: v1
kind: Service
metadata:
  name: myapp
  labels:
    app: myapp
spec:
  selector:
    app: myapp
  ports:
    - name: http
      port: 80
      targetPort: 8080
    - name: metrics
      port: 9090
      targetPort: 9090
```

## PodMonitor for Pods Without Services

```yaml
# podmonitor.yaml
apiVersion: monitoring.coreos.com/v1
kind: PodMonitor
metadata:
  name: batch-jobs-monitor
  namespace: monitoring
spec:
  selector:
    matchLabels:
      app: batch-job
  namespaceSelector:
    matchNames:
      - batch
  podMetricsEndpoints:
    - port: metrics
      interval: 60s
      path: /metrics
```

## Custom Prometheus Rules

```yaml
# prometheus-rules.yaml
apiVersion: monitoring.coreos.com/v1
kind: PrometheusRule
metadata:
  name: kubernetes-alerts
  namespace: monitoring
  labels:
    release: prometheus
spec:
  groups:
    - name: kubernetes.rules
      rules:
        # Pod not ready
        - alert: PodNotReady
          expr: |
            kube_pod_status_ready{condition="false"} == 1
          for: 15m
          labels:
            severity: warning
          annotations:
            summary: "Pod {{ $labels.namespace }}/{{ $labels.pod }} not ready"
            description: "Pod has been not ready for more than 15 minutes"

        # High CPU usage
        - alert: HighCPUUsage
          expr: |
            (
              sum(rate(container_cpu_usage_seconds_total{container!=""}[5m])) by (namespace, pod)
              /
              sum(kube_pod_container_resource_limits{resource="cpu"}) by (namespace, pod)
            ) > 0.9
          for: 5m
          labels:
            severity: warning
          annotations:
            summary: "High CPU usage in {{ $labels.namespace }}/{{ $labels.pod }}"
            description: "CPU usage is above 90% for 5 minutes"

        # High memory usage
        - alert: HighMemoryUsage
          expr: |
            (
              sum(container_memory_working_set_bytes{container!=""}) by (namespace, pod)
              /
              sum(kube_pod_container_resource_limits{resource="memory"}) by (namespace, pod)
            ) > 0.9
          for: 5m
          labels:
            severity: warning
          annotations:
            summary: "High memory usage in {{ $labels.namespace }}/{{ $labels.pod }}"

        # Node disk pressure
        - alert: NodeDiskPressure
          expr: kube_node_status_condition{condition="DiskPressure",status="true"} == 1
          for: 5m
          labels:
            severity: critical
          annotations:
            summary: "Node {{ $labels.node }} has disk pressure"
```

## Recording Rules for Performance

```yaml
# recording-rules.yaml
apiVersion: monitoring.coreos.com/v1
kind: PrometheusRule
metadata:
  name: recording-rules
  namespace: monitoring
spec:
  groups:
    - name: cpu.rules
      interval: 30s
      rules:
        - record: namespace:container_cpu_usage_seconds_total:sum_rate
          expr: |
            sum(rate(container_cpu_usage_seconds_total{container!=""}[5m])) by (namespace)
        
        - record: namespace:container_memory_usage_bytes:sum
          expr: |
            sum(container_memory_working_set_bytes{container!=""}) by (namespace)

    - name: request.rules
      interval: 30s
      rules:
        - record: job:http_requests_total:rate5m
          expr: sum(rate(http_requests_total[5m])) by (job)
        
        - record: job:http_request_duration_seconds:p99
          expr: histogram_quantile(0.99, sum(rate(http_request_duration_seconds_bucket[5m])) by (job, le))
```

## Useful PromQL Queries

```promql
# CPU usage by namespace
sum(rate(container_cpu_usage_seconds_total{container!=""}[5m])) by (namespace)

# Memory usage by pod
sum(container_memory_working_set_bytes{container!=""}) by (namespace, pod)

# Request rate by service
sum(rate(http_requests_total[5m])) by (service)

# Error rate percentage
sum(rate(http_requests_total{status=~"5.."}[5m])) 
/ 
sum(rate(http_requests_total[5m])) * 100

# P99 latency
histogram_quantile(0.99, sum(rate(http_request_duration_seconds_bucket[5m])) by (le))

# Pod restart rate
sum(increase(kube_pod_container_status_restarts_total[1h])) by (namespace, pod)

# Node CPU utilization
100 - (avg by(instance)(rate(node_cpu_seconds_total{mode="idle"}[5m])) * 100)

# Persistent volume usage
kubelet_volume_stats_used_bytes / kubelet_volume_stats_capacity_bytes * 100
```

## Grafana Dashboard ConfigMap

```yaml
# grafana-dashboard.yaml
apiVersion: v1
kind: ConfigMap
metadata:
  name: myapp-dashboard
  namespace: monitoring
  labels:
    grafana_dashboard: "1"
data:
  myapp-dashboard.json: |
    {
      "dashboard": {
        "title": "MyApp Dashboard",
        "panels": [
          {
            "title": "Request Rate",
            "type": "graph",
            "targets": [
              {
                "expr": "sum(rate(http_requests_total{job=\"myapp\"}[5m]))",
                "legendFormat": "Requests/s"
              }
            ]
          }
        ]
      }
    }
```

## Federation for Multi-Cluster

```yaml
# prometheus-federation.yaml
prometheus:
  prometheusSpec:
    additionalScrapeConfigs:
      - job_name: 'federate'
        scrape_interval: 30s
        honor_labels: true
        metrics_path: '/federate'
        params:
          'match[]':
            - '{job=~".+"}'
        static_configs:
          - targets:
              - 'prometheus-cluster-a.example.com:9090'
              - 'prometheus-cluster-b.example.com:9090'
```

## Verify Metrics Collection

```bash
# Check targets
kubectl port-forward svc/prometheus-kube-prometheus-prometheus -n monitoring 9090:9090
# Visit http://localhost:9090/targets

# Check service monitors
kubectl get servicemonitors -A

# Check prometheus rules
kubectl get prometheusrules -A

# Query metrics via API
curl -s 'http://localhost:9090/api/v1/query?query=up'
```

## Summary

kube-prometheus-stack provides complete Kubernetes monitoring with Prometheus, Grafana, and Alertmanager. Use ServiceMonitors to scrape application metrics, create PrometheusRules for alerts, and build Grafana dashboards for visualization. Configure retention and storage based on your needs.

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
