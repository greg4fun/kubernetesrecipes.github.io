---
title: "Kubernetes 1.36 Native Histogram Metrics"
description: "Enable Prometheus native histograms in Kubernetes 1.36 for higher-resolution metrics with lower storage cost. Covers all control plane components."
tags:
  - "kubernetes-1.36"
  - "prometheus"
  - "metrics"
  - "observability"
  - "monitoring"
category: "observability"
publishDate: "2026-05-03"
author: "Luca Berton"
difficulty: "intermediate"
relatedRecipes:
  - "kubernetes-prometheus-monitoring-guide"
  - "kubernetes-opentelemetry-guide"
  - "kubernetes-alerting-best-practices"
  - "kubernetes-1-36-selinux-mount-labeling"
---

> 💡 **Quick Answer:** Kubernetes 1.36 adds **Prometheus Native Histogram** support (Alpha) across all control plane components. Native histograms provide higher resolution than classic histograms with 10x less storage and no bucket configuration needed.

## The Problem

Classic Prometheus histograms have significant drawbacks:

- **Fixed buckets** — you choose bucket boundaries at instrumentation time, before knowing the actual distribution
- **Wrong boundaries** — miss important percentile boundaries (p95, p99) if buckets don't align
- **High cardinality** — each bucket is a separate time series (10 buckets = 10 series per metric)
- **Storage cost** — histogram metrics consume 10-20x more storage than gauges
- **Aggregation errors** — merging histograms across instances introduces quantile errors

## The Solution

Native histograms use exponential bucketing with automatic boundary selection. No configuration needed, higher accuracy, lower storage.

### Enable Native Histograms (Alpha Feature Gate)

```bash
# API Server
kube-apiserver --feature-gates=NativeHistograms=true

# Scheduler
kube-scheduler --feature-gates=NativeHistograms=true

# Kubelet
kubelet --feature-gates=NativeHistograms=true

# Controller Manager
kube-controller-manager --feature-gates=NativeHistograms=true

# Kube-Proxy
kube-proxy --feature-gates=NativeHistograms=true
```

### kubeadm Cluster Configuration

```yaml
apiVersion: kubeadm.k8s.io/v1beta4
kind: ClusterConfiguration
apiServer:
  extraArgs:
    - name: feature-gates
      value: "NativeHistograms=true"
scheduler:
  extraArgs:
    - name: feature-gates
      value: "NativeHistograms=true"
controllerManager:
  extraArgs:
    - name: feature-gates
      value: "NativeHistograms=true"
---
apiVersion: kubeadm.k8s.io/v1beta4
kind: InitConfiguration
nodeRegistration:
  kubeletExtraArgs:
    - name: feature-gates
      value: "NativeHistograms=true"
```

### Configure Prometheus to Scrape Native Histograms

```yaml
# prometheus.yml
global:
  scrape_interval: 15s

scrape_configs:
  - job_name: 'kubernetes-apiservers'
    kubernetes_sd_configs:
      - role: endpoints
    scheme: https
    tls_config:
      ca_file: /var/run/secrets/kubernetes.io/serviceaccount/ca.crt
    bearer_token_file: /var/run/secrets/kubernetes.io/serviceaccount/token
    scrape_protocols:
      - PrometheusProto          # Required for native histograms
      - OpenMetricsText1.0.0
      - OpenMetricsText0.0.1
      - PrometheusText0.0.4
    relabel_configs:
      - source_labels: [__meta_kubernetes_namespace, __meta_kubernetes_service_name, __meta_kubernetes_endpoint_port_name]
        action: keep
        regex: default;kubernetes;https
```

### Prometheus Operator Configuration

```yaml
apiVersion: monitoring.coreos.com/v1
kind: Prometheus
metadata:
  name: k8s
  namespace: monitoring
spec:
  version: v3.2.0
  scrapeProtocols:
    - PrometheusProto    # Enable protobuf scraping for native histograms
    - OpenMetricsText1.0.0
    - PrometheusText0.0.4
  enableFeatures:
    - native-histograms
  serviceMonitorSelector:
    matchLabels:
      team: platform
```

### Query Native Histograms in PromQL

```promql
# Classic histogram quantile (old way):
histogram_quantile(0.99, rate(apiserver_request_duration_seconds_bucket[5m]))

# Native histogram quantile (new way — same function, automatic):
histogram_quantile(0.99, rate(apiserver_request_duration_seconds[5m]))
# No _bucket suffix needed!

# Native histogram average:
histogram_avg(rate(apiserver_request_duration_seconds[5m]))

# Native histogram count and sum still work:
histogram_count(rate(apiserver_request_duration_seconds[5m]))
histogram_sum(rate(apiserver_request_duration_seconds[5m]))

# Fraction of requests under 500ms:
histogram_fraction(0, 0.5, rate(apiserver_request_duration_seconds[5m]))
```

### Key Metrics Now Supporting Native Histograms

```promql
# API Server request latency (most important for SLOs)
apiserver_request_duration_seconds

# Scheduler binding latency
scheduler_binding_duration_seconds

# Kubelet Pod start duration
kubelet_pod_start_duration_seconds

# Controller Manager work queue latency
workqueue_queue_duration_seconds
```

### Storage Comparison

```bash
# Classic histogram: apiserver_request_duration_seconds
# 15 buckets × ~200 label combinations = 3,000 time series
# Storage: ~150 KB/scrape

# Native histogram: apiserver_request_duration_seconds
# 1 native histogram × ~200 label combinations = 200 time series
# Storage: ~15 KB/scrape

# 10x reduction in storage for the same (or better) accuracy
```

### Grafana Dashboard Updates

```json
{
  "targets": [
    {
      "expr": "histogram_quantile(0.99, rate(apiserver_request_duration_seconds{job=\"apiserver\"}[5m]))",
      "legendFormat": "p99 latency",
      "format": "native"
    }
  ],
  "type": "timeseries",
  "title": "API Server Request Latency (Native Histogram)"
}
```

Grafana 10.3+ supports native histogram visualization with heatmap panels.

## Common Issues

### Prometheus not scraping native histograms
- **Cause**: Missing `PrometheusProto` in `scrape_protocols`
- **Fix**: Add `PrometheusProto` as the first entry in scrape protocols

### Old dashboards show no data
- **Cause**: Queries use `_bucket` suffix which doesn't exist for native histograms
- **Fix**: Remove `_bucket` suffix; `histogram_quantile` works on both formats

### Storage not decreasing
- **Cause**: Classic histograms still emitted alongside native (dual emission)
- **Fix**: In alpha, both formats may be emitted. Storage savings fully realized in beta.

## Best Practices

1. **Enable `PrometheusProto` scraping** — required for native histogram ingestion
2. **Update Prometheus to 2.50+** — native histogram support needed
3. **Update Grafana to 10.3+** — for native histogram visualization
4. **Test in non-production first** — alpha feature, verify metric compatibility
5. **Update alerting rules** — remove `_bucket` references from histogram queries
6. **Keep classic histograms during migration** — dual emission ensures no data gaps

## Key Takeaways

- Native histograms are **Alpha in Kubernetes 1.36** across all control plane components
- 10x less storage with higher accuracy — no bucket configuration needed
- Requires Prometheus protobuf scraping (`PrometheusProto` protocol)
- Same `histogram_quantile()` PromQL function works for both formats
- New functions: `histogram_avg()`, `histogram_fraction()` for richer analysis
