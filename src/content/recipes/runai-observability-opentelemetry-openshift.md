---
title: "Run:ai Observability with OpenTelemetry"
description: "Configure Run:ai observability on OpenShift with OpenTelemetry Collector, Prometheus receivers, metrics enrichment, OAuth2 export, and GPU metric collection"
tags:
  - "runai"
  - "opentelemetry"
  - "observability"
  - "openshift"
  - "gpu-monitoring"
category: "observability"
publishDate: "2026-05-05"
author: "Luca Berton"
difficulty: "advanced"
relatedRecipes:
  - "runai-distributed-training-openshift"
  - "kubernetes-opentelemetry-collector"
  - "nvidia-gpu-operator-setup"
  - "kubernetes-prometheus-monitoring-guide"
  - "thanos-receive-memory-sizing"
---

> 💡 **Quick Answer:** Run:ai deploys an OpenTelemetry Collector (via Helm chart `otelcollector-0.142.1`) that scrapes Prometheus metrics from diagnostics endpoints, enriches them with customer/cluster labels, filters to `runai_*` metrics, and exports via OTLP/HTTP with OAuth2 authentication to a central telemetry backend.

## The Problem

Running AI workloads at scale on OpenShift requires visibility into:

- **GPU utilization** per Pod, node, and cluster
- **Memory pressure** — OOM kills, swap usage, page faults
- **Job scheduling** — queue times, workload distribution
- **Cluster capacity** — total vs allocated GPUs, CPU, memory
- **Export to central platform** — with authentication and filtering

## The Solution

### Run:ai OTel Collector ConfigMap

```yaml
kind: ConfigMap
apiVersion: v1
metadata:
  name: runai-backend-otelcollector
  namespace: runai-backend
  labels:
    app.kubernetes.io/component: standalone-collector
    app.kubernetes.io/instance: runai-backend
    app.kubernetes.io/managed-by: Helm
    app.kubernetes.io/name: otelcollector
    app.kubernetes.io/part-of: opentelemetry-collector
    app.kubernetes.io/version: 0.142.0
    helm.sh/chart: otelcollector-0.142.1
  annotations:
    argocd.argoproj.io/tracking-id: "runai-backend:/ConfigMap;runai-backend/runai-backend-otelcollector"
data:
  relay: |
    extensions:
      health_check:
        endpoint: 0.0.0.0:13133
      oauth2client:
        client_id: client-id
        client_secret: client-secret
        token_url: https://auth.example.com/oauth/token
        endpoint_params:
          grant_type: client_credentials

    receivers:
      prometheus:
        config:
          scrape_configs:
            - job_name: runai-diagnostics
              metrics_path: /internal/diagnostics/scrapeable-metrics
              scheme: http
              scrape_interval: 60s
              static_configs:
                - targets:
                    - runai-backend-diagnostics-service:8080

    processors:
      metricstransform/enrich:
        transforms:
          - include: '.*'
            match_type: regexp
            action: update
            operations:
              - action: add_label
                new_label: customer_id
                new_value: your-customer-id-here
      filter/central:
        metrics:
          include:
            match_type: regexp
            metric_names:
              - "^runai_cluster_info$"
              - "^runai_control_plane_info$"

    exporters:
      debug:
        verbosity: detailed
      otlphttp:
        endpoint: https://telemetry.example.com
        tls:
          insecure: true
        auth:
          authenticator: oauth2client
        sending_queue:
          enabled: true
        retry_on_failure:
          enabled: true

    service:
      extensions:
        - health_check
        - oauth2client
      pipelines:
        metrics:
          receivers:
            - prometheus
          processors:
            - metricstransform/enrich
            - filter/central
          exporters:
            - otlphttp
```

### Run:ai Node Exporter — GPU Metrics

The `runai-node-exporter` DaemonSet collects GPU-level metrics:

```yaml
# Metrics registered by runai-node-exporter
# Source: Run:AI Node Exporter initialization logs

# GPU compute utilization (0-100%)
- runai_pod_gpu_utilization
  labels: [pod, uuid, gpu]
  source: utilization_sm (nvidia-smi)

# GPU memory usage in bytes
- runai_pod_gpu_memory_used_bytes
  labels: [pod, uuid, gpu]
  source: memory.allocated

# GPU swap/RAM usage
- runai_pod_gpu_swap_ram_used_bytes
  labels: [pod, uuid, gpu]
  source: memory.swap

# OOM-kill tracking
- runai_gpu_oomkill_burst_count
  labels: [gpu]
  source: com.burst

- runai_gpu_oomkill_idle_count
  labels: [gpu]
  source: com.idle

- runai_gpu_oomkill_priority_count
  labels: [gpu]
  source: com.priority

- runai_gpu_oomkill_swap_out_of_ram_count
  labels: [gpu]
  source: com.swap_out_of_ram
```

### Run:ai Telemetry API Endpoints

Run:ai exposes telemetry via API for capacity planning:

```text
# Cluster-level GPU metrics
/telemetry/clusters/{cluster-id}/telemetryType=READY_GPUS
/telemetry/clusters/{cluster-id}/telemetryType=TOTAL_GPUS
/telemetry/clusters/{cluster-id}/telemetryType=FREE_GPUS
/telemetry/clusters/{cluster-id}/telemetryType=ALLOCATED_GPUS
/telemetry/clusters/{cluster-id}/telemetryType=TOTAL_GPU_MEMORY_BYTES

# CPU metrics
/telemetry/clusters/{cluster-id}/telemetryType=TOTAL_CPU_CORES
/telemetry/clusters/{cluster-id}/telemetryType=ALLOCATED_CPU_CORES
/telemetry/clusters/{cluster-id}/telemetryType=TOTAL_CPU_MEMORY_BYTES

# Workload metrics
/telemetry/clusters/{cluster-id}/telemetryType=WORKLOADS_COUNT
/telemetry/clusters/{cluster-id}/telemetryType=PENDING_TIME_DISTRIBUTION

# Node-level breakdown
/telemetry/clusters/{cluster-id}&groupBy=Node&telemetryType=TOTAL_GPUS
/telemetry/clusters/{cluster-id}&groupBy=Node&telemetryType=READY_GPUS

# Category breakdown
/telemetry/clusters/{cluster-id}&groupBy=Category&telemetryType=WORKLOADS_COUNT
```

Example API response:
```json
{
  "type": "ALLOCATED_CPU_CORES",
  "timestamp": "2026-05-05T12:42:36.768000457Z",
  "values": []
}
```

### Troubleshooting: OTel Collector OOM

```yaml
# Common alert: RunaiContainerMemoryUsageCritical
# "otelcollector is using more than 90% of its memory limit"

# Root cause: Exporter retries accumulate in sending_queue
# when backend is unreachable (invalid key / endpoint down)

# Fix 1: Increase memory limits
resources:
  limits:
    memory: 2Gi      # Default may be too low (512Mi)
  requests:
    memory: 1Gi

# Fix 2: Limit sending queue size
exporters:
  otlphttp:
    sending_queue:
      enabled: true
      queue_size: 1000    # Limit queue (default 5000)
    retry_on_failure:
      enabled: true
      max_elapsed_time: 300s   # Stop retrying after 5 min
```

### Troubleshooting: OAuth2 Key Errors

```text
# Error pattern in OTel collector logs:
# "invalid key: Key must be a PEM encoded PKCS1 or PKCS8 key"
# "Exporting failed. Will retry the request after interval."
# "failed to make an HTTP request: Post https://telemetry.example.com/v1/metrics"

# Root cause: OAuth2 token URL returns key in wrong format
# or client_secret contains non-PEM data

# Fix: Verify OAuth2 credentials
curl -X POST https://auth.example.com/oauth/token \
  -d "grant_type=client_credentials" \
  -d "client_id=your-client-id" \
  -d "client_secret=your-client-secret"

# Should return: {"access_token": "...", "token_type": "Bearer", ...}
# If it returns HTML or error → credentials are wrong
```

### Troubleshooting: NodeMemoryMajorPageFaults

```text
# Alert: "Memory major pages are occurring at very high rate at <node>,
#         2,500 major page faults per second for the last 15 minutes"

# Cause: Pod memory usage exceeds available RAM, causing swap thrashing
# Often triggered by OTel collector retry queue growth

# Investigation:
oc adm top nodes
oc adm top pods -n runai-backend --sort-by=memory

# Fix: Increase node memory or reduce collector memory usage
# Set memory limits on the OTel collector to prevent node-level impact
```

### Monitoring Run:ai Components

```bash
# Check all Run:ai Pods
oc get pods -n runai-backend
oc get pods -n runai

# Key components to monitor:
# - runai-backend-otelcollector    → Telemetry export
# - runai-node-exporter            → GPU metrics (DaemonSet)
# - runai-backend-diagnostics      → Internal metrics source
# - alertmanager                   → Alert routing
# - admission-controller           → Job validation

# Check OTel collector health
oc exec -n runai-backend deploy/runai-backend-otelcollector -- \
  wget -qO- http://localhost:13133/health/status

# Check node exporter logs
oc logs -n runai daemonset/runai-node-exporter --tail=50
```

### ArgoCD-Managed Deployment

```yaml
# Run:ai backend is deployed via ArgoCD
# Tracking annotation ensures GitOps reconciliation:
annotations:
  argocd.argoproj.io/tracking-id: "runai-backend:/ConfigMap;runai-backend/runai-backend-otelcollector"

# To update OTel config:
# 1. Modify in Git repo (values.yaml or overlay)
# 2. ArgoCD syncs automatically
# 3. OTel collector Pod restarts with new config
```

## Common Issues

### OTel collector drops data after retries exhausted
- **Cause**: Backend endpoint unreachable or auth failing continuously
- **Fix**: Fix OAuth2 credentials; check `sending_queue` and `retry_on_failure` settings

### Node exporter reports 0 GPU utilization
- **Cause**: NVIDIA driver not exposing metrics or Pod not using GPU
- **Fix**: Verify `nvidia-smi` works on node; check Pod actually requests GPU resources

### Metrics not appearing in central dashboard
- **Cause**: `filter/central` processor too restrictive
- **Fix**: Temporarily add `debug` exporter to see what metrics pass through

## Best Practices

1. **Filter metrics aggressively** — only export `runai_*` metrics to reduce cost
2. **Set memory limits on OTel collector** — prevent node-level OOM from retry queues
3. **Use OAuth2 client_credentials** — standard flow for machine-to-machine auth
4. **Monitor the monitor** — set alerts on OTel collector memory usage
5. **Use `sending_queue` with limits** — prevent unbounded memory growth on export failure
6. **Scrape interval 60s** — balance between freshness and collector load

## Key Takeaways

- Run:ai uses OTel Collector (Helm chart v0.142.1) for telemetry export
- Prometheus receiver scrapes internal diagnostics endpoint
- `metricstransform/enrich` adds customer_id label for multi-tenant backends
- `filter/central` restricts export to `runai_cluster_info` and `runai_control_plane_info`
- Node exporter collects per-Pod GPU utilization, memory, and OOM-kill counts
- Telemetry API provides cluster capacity data (total/allocated/free GPUs)
- OOM in collector usually means export backend is down → retry queue grows unbounded
