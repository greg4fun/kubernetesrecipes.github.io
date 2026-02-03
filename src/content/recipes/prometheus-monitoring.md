---
title: "How to Set Up Prometheus Monitoring"
description: "Deploy Prometheus for Kubernetes monitoring. Collect metrics from nodes, pods, and applications with ServiceMonitors and alerting rules."
category: "observability"
difficulty: "intermediate"
publishDate: "2026-01-22"
tags: ["prometheus", "monitoring", "metrics", "alerting", "observability"]
author: "Luca Berton"
---

> 💡 **Quick Answer:** Install Prometheus Operator via Helm (`helm install prometheus prometheus-community/kube-prometheus-stack`), then create `ServiceMonitor` CRDs to scrape your apps. Access Prometheus UI via port-forward: `kubectl port-forward svc/prometheus-operated 9090`.
>
> **Key resource:** `ServiceMonitor` tells Prometheus which Services to scrape and on which port/path.
>
> **Gotcha:** ServiceMonitor must be in a namespace that Prometheus watches, and labels must match Prometheus's `serviceMonitorSelector`.

# How to Set Up Prometheus Monitoring

Prometheus is the standard for Kubernetes monitoring. It scrapes metrics from targets, stores time-series data, and enables powerful queries with PromQL.

## Install with Helm

```bash
# Add Prometheus community Helm repo
helm repo add prometheus-community https://prometheus-community.github.io/helm-charts
helm repo update

# Install kube-prometheus-stack (includes Prometheus, Grafana, Alertmanager)
helm install prometheus prometheus-community/kube-prometheus-stack \
  --namespace monitoring \
  --create-namespace
```

## Access Prometheus UI

```bash
# Port-forward to Prometheus
kubectl port-forward -n monitoring svc/prometheus-kube-prometheus-prometheus 9090

# Port-forward to Grafana (default: admin/prom-operator)
kubectl port-forward -n monitoring svc/prometheus-grafana 3000:80
```

## ServiceMonitor for Your App

```yaml
# servicemonitor.yaml
apiVersion: monitoring.coreos.com/v1
kind: ServiceMonitor
metadata:
  name: my-app
  namespace: monitoring
  labels:
    release: prometheus  # Must match Prometheus's serviceMonitorSelector
spec:
  selector:
    matchLabels:
      app: my-app
  namespaceSelector:
    matchNames:
      - default
      - production
  endpoints:
    - port: metrics
      interval: 30s
      path: /metrics
```

## Expose Metrics from Your App

```yaml
# deployment-with-metrics.yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: my-app
spec:
  replicas: 3
  selector:
    matchLabels:
      app: my-app
  template:
    metadata:
      labels:
        app: my-app
    spec:
      containers:
        - name: app
          image: my-app:latest
          ports:
            - name: http
              containerPort: 8080
            - name: metrics
              containerPort: 9090
---
apiVersion: v1
kind: Service
metadata:
  name: my-app
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
        
        - alert: PodNotReady
          expr: kube_pod_status_ready{condition="false"} == 1
          for: 5m
          labels:
            severity: warning
          annotations:
            summary: "Pod not ready"
            description: "Pod {{ $labels.pod }} not ready for 5 minutes"
```

## Useful PromQL Queries

```promql
# CPU usage by pod
sum(rate(container_cpu_usage_seconds_total[5m])) by (pod)

# Memory usage by namespace
sum(container_memory_usage_bytes) by (namespace)

# HTTP request rate
sum(rate(http_requests_total[5m])) by (service)

# 95th percentile latency
histogram_quantile(0.95, rate(http_request_duration_seconds_bucket[5m]))

# Pod restart count
sum(kube_pod_container_status_restarts_total) by (pod)
```

## PodMonitor (for pods without Service)

```yaml
# podmonitor.yaml
apiVersion: monitoring.coreos.com/v1
kind: PodMonitor
metadata:
  name: my-job
  namespace: monitoring
spec:
  selector:
    matchLabels:
      app: my-job
  podMetricsEndpoints:
    - port: metrics
      interval: 30s
```

## Verify Targets

```bash
# Check if Prometheus discovers your targets
kubectl port-forward -n monitoring svc/prometheus-kube-prometheus-prometheus 9090

# Visit http://localhost:9090/targets
# Your ServiceMonitor should appear with "UP" status
```

## Troubleshooting

```bash
# Check ServiceMonitor is picked up
kubectl get servicemonitor -n monitoring

# Check Prometheus configuration
kubectl get secret -n monitoring prometheus-kube-prometheus-prometheus -o jsonpath='{.data.prometheus\.yaml\.gz}' | base64 -d | gunzip

# Check Prometheus logs
kubectl logs -n monitoring prometheus-kube-prometheus-prometheus-0 -c prometheus
```
