---
title: "Monitor NCCL Benchmark Runs Prometheus & Gr..."
description: "Track NCCL benchmark outcomes and GPU telemetry over time with Prometheus and Grafana dashboards to detect communication regressions early."
category: "observability"
difficulty: "intermediate"
timeToComplete: "30 minutes"
kubernetesVersion: "1.28+"
prerequisites:
  - "Prometheus and Grafana available"
  - "NVIDIA DCGM exporter installed"
  - "NCCL test workload logs accessible"
relatedRecipes:
  - "run-nccl-tests-mpijob-kubernetes"
  - "run-nccl-tests-kubernetes"
  - "automate-nccl-preflight-ci"
  - "nccl-allreduce-benchmark-profile"
tags:
  - nccl
  - prometheus
  - grafana
  - observability
  - gpu
publishDate: "2026-02-17"
author: "Luca Berton"
---

> 💡 **Quick Answer:** Combine NCCL benchmark logs with GPU metrics (utilization, memory, interconnect indicators) in Grafana dashboards to detect performance drift across cluster changes.


Benchmark snapshots are useful, but trend-based monitoring catches regressions sooner.

## Data Sources

- NCCL benchmark output logs
- DCGM exporter metrics
- Node and pod metadata labels

## Dashboard Suggestions

- Benchmark run duration by node pair
- Effective bandwidth trend by test profile
- GPU utilization and memory during tests
- Failure count per benchmark type

## Operational Practice

Schedule recurring benchmark jobs and alert when bandwidth drops below baseline thresholds.

## Prometheus Metrics for NCCL

Export NCCL communication metrics to Prometheus for GPU cluster monitoring.

### DCGM Integration

DCGM Exporter exposes GPU metrics that correlate with NCCL performance:

```yaml
apiVersion: apps/v1
kind: DaemonSet
metadata:
  name: dcgm-exporter
spec:
  selector:
    matchLabels:
      app: dcgm-exporter
  template:
    metadata:
      labels:
        app: dcgm-exporter
    spec:
      containers:
      - name: dcgm-exporter
        image: nvcr.io/nvidia/k8s/dcgm-exporter:3.3.5-3.4.1-ubuntu22.04
        ports:
        - containerPort: 9400
        env:
        - name: DCGM_EXPORTER_COLLECTORS
          value: "/etc/dcgm-exporter/dcp-metrics-included.csv"
```

### Key Metrics to Monitor

| Metric | Description | Alert Threshold |
|--------|-------------|----------------|
| `DCGM_FI_PROF_NVLINK_TX_BYTES` | NVLink transmit bandwidth | <50% of peak |
| `DCGM_FI_PROF_NVLINK_RX_BYTES` | NVLink receive bandwidth | <50% of peak |
| `DCGM_FI_DEV_GPU_UTIL` | GPU utilization during NCCL ops | <70% |
| `DCGM_FI_DEV_MEM_COPY_UTIL` | Memory copy utilization | <40% |

### Grafana Dashboard

```bash
# Import NCCL monitoring dashboard
kubectl apply -f - <<EOF
apiVersion: v1
kind: ConfigMap
metadata:
  name: nccl-dashboard
  labels:
    grafana_dashboard: "1"
data:
  nccl-performance.json: |
    {
      "title": "NCCL Performance",
      "panels": [
        {"title": "NVLink Bandwidth", "targets": [{"expr": "rate(DCGM_FI_PROF_NVLINK_TX_BYTES[5m])"}]},
        {"title": "AllReduce Latency", "targets": [{"expr": "histogram_quantile(0.99, nccl_allreduce_duration_bucket)"}]}
      ]
    }
EOF
```
