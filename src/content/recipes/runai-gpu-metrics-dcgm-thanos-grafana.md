---
title: "Run:ai GPU Metrics Pipeline with DCGM and Thanos"
description: "End-to-end GPU metrics pipeline on Run:ai: DCGM exporter collects GPU utilization, Prometheus scrapes, remote-writes to Thanos Receive, and Grafana dashboards display per-workload GPU usage."
tags:
  - "runai"
  - "dcgm"
  - "thanos"
  - "grafana"
  - "gpu-monitoring"
category: "ai"
publishDate: "2026-05-05"
author: "Luca Berton"
difficulty: "intermediate"
relatedRecipes:
  - "runai-platform-components-architecture"
  - "thanos-receive-oom-crashloop-statefulset"
  - "runai-fsdp-training-mistral-gpu"
  - "nvidia-dcgm-exporter-monitoring"
---

> 💡 **Quick Answer:** Run:ai uses DCGM Exporter → Prometheus → Thanos Receive → Thanos Query → Grafana to provide per-workload GPU utilization, memory usage, NVLink bandwidth, and GPU compute allocation metrics with long-term retention.

## The Problem

You need to:

- Track GPU utilization per training job (not just per node)
- Retain GPU metrics beyond Prometheus's local retention (15d default)
- Visualize GPU compute, memory, and NVLink usage in dashboards
- Correlate GPU metrics with workload lifecycle events
- Alert on underutilized GPUs (wasted expensive resources)

## The Solution

### Metrics Pipeline Architecture

```text
GPU Node                        Infra Node
┌─────────────────────┐        ┌─────────────────────────────────┐
│ NVIDIA GPU          │        │ Thanos Receive (StatefulSet)    │
│   ↓                 │        │   ↑ remote-write                │
│ DCGM Exporter :9400 │        │   │                             │
│   ↓ scrape          │        │ Prometheus (cluster-monitoring) │
│ Prometheus Agent    ─┼───────┼─→ │                             │
└─────────────────────┘        │   ↓ query                       │
                               │ Thanos Query                    │
                               │   ↓                             │
                               │ Grafana (Run:ai dashboards)     │
                               └─────────────────────────────────┘
```

### Key Metrics Collected

```text
GPU Metrics (from DCGM Exporter):
├── GPU_UTILIZATION          → % compute cores active (0-100)
├── GPU_MEMORY_USAGE_BYTES   → VRAM used (bytes)
├── GPU_MEMORY_TOTAL_BYTES   → Total VRAM available
├── CPU_USAGE_CORES          → Container CPU usage
├── CPU_MEMORY_USAGE_BYTES   → Container RAM usage
├── NVLINK_BANDWIDTH_TOTAL   → Inter-GPU bandwidth (bytes/sec)
└── GPU_TEMPERATURE          → Die temperature (°C)

Run:ai enrichment labels:
├── clusterId                → Cluster UUID
├── workload                 → Job name (e.g., mistral4small-fsdp)
├── project                  → Run:ai project/department
├── user                     → Submitting user
└── gpu_index                → GPU device index (0,1,2...)
```

### DCGM Exporter DaemonSet

```yaml
apiVersion: apps/v1
kind: DaemonSet
metadata:
  name: dcgm-exporter
  namespace: gpu-operator
spec:
  selector:
    matchLabels:
      app: dcgm-exporter
  template:
    spec:
      nodeSelector:
        nvidia.com/gpu.present: "true"
      containers:
        - name: dcgm-exporter
          image: nvcr.io/nvidia/k8s/dcgm-exporter:3.3.8-3.6.0-ubuntu22.04
          ports:
            - containerPort: 9400
              name: metrics
          env:
            - name: DCGM_EXPORTER_LISTEN
              value: ":9400"
            - name: DCGM_EXPORTER_KUBERNETES
              value: "true"
            - name: DCGM_EXPORTER_COLLECTORS
              value: "/etc/dcgm-exporter/dcp-metrics-included.csv"
          volumeMounts:
            - name: dcgm-metrics
              mountPath: /etc/dcgm-exporter
      volumes:
        - name: dcgm-metrics
          configMap:
            name: dcgm-metrics-config
```

### Prometheus Remote Write to Thanos

```yaml
# Prometheus config for remote-write to Thanos Receive
remoteWrite:
  - url: "http://runai-backend-thanos-receive.runai-backend.svc:19291/api/v1/receive"
    writeRelabelConfigs:
      - sourceLabels: [__name__]
        regex: "DCGM_.*|runai_.*|nvidia_.*"
        action: keep
    queueConfig:
      maxSamplesPerSend: 5000
      batchSendDeadline: 10s
      maxRetries: 3
```

### Grafana Dashboard Queries (PromQL)

```promql
# GPU Compute Utilization per workload
avg(DCGM_FI_DEV_GPU_UTIL{workload="mistral4small-fsdp"}) by (gpu_index)

# GPU Memory Usage per workload (GiB)
sum(DCGM_FI_DEV_FB_USED{workload="mistral4small-fsdp"}) by (gpu_index) / 1024

# Total GPU allocation across cluster
count(DCGM_FI_DEV_GPU_UTIL > 0) / count(DCGM_FI_DEV_GPU_UTIL)

# NVLink bandwidth (GB/s)
rate(DCGM_FI_DEV_NVLINK_BANDWIDTH_TOTAL[5m]) / 1e9

# Idle GPU detection (< 5% utilization for 30 min)
DCGM_FI_DEV_GPU_UTIL < 5 and ON() (time() - runai_job_start_time > 1800)
```

### Run:ai API Metrics Endpoints

```text
Run:ai UI fetches metrics via REST API:

GET /api/v1/metrics?metricType=GPU_UTILIZATION
    &start=2026-05-05&d=2026-05-05T14%3A...
    &clusterId=d94fdaa3-e91e-4368-b5b9-a71751bf3985

GET /api/v1/metrics?metricType=GPU_MEMORY_USAGE_BYTES
    &start=20&d=2026-05-05T14%3A...

GET /api/v1/metrics?metricType=CPU_USAGE_CORES
    &start=20&d=2026-05-05T14%3A...

GET /api/v1/metrics?metricType=NVLINK_BANDWIDTH_TOTAL
    &start=20&d=2026-05-05T14%3A...

Response format:
{
  "value": "12582912",
  "timestamp": "2026-05-05T14:07:12.3452"
}
```

### Typical GPU Training Metrics Pattern

```text
Phase           GPU Util    GPU Mem    CPU Cores    CPU Mem
────────────────────────────────────────────────────────────
Initializing    0%          0 GB       0.5          2 GB
Model Loading   5-10%       +20 GB     2-3          +40 GB
FSDP Setup      10-20%      +5 GB      3-4          +10 GB
Training Loop   85-98%      stable     2-4          stable
Checkpointing   20-30%      stable     1-2          +5 GB
Evaluation      60-80%      stable     1-2          stable
Completion      0%          drops      0            drops
```

### Alert Rules for GPU Waste

```yaml
apiVersion: monitoring.coreos.com/v1
kind: PrometheusRule
metadata:
  name: gpu-waste-alerts
  namespace: runai-backend
spec:
  groups:
    - name: gpu-utilization
      rules:
        - alert: GPUIdleWorkload
          expr: |
            avg_over_time(DCGM_FI_DEV_GPU_UTIL[30m]) < 5
            and on(pod) kube_pod_status_phase{phase="Running"} == 1
          for: 30m
          labels:
            severity: warning
          annotations:
            summary: "GPU idle for 30+ minutes"
            description: "Workload {{ $labels.workload }} using < 5% GPU"

        - alert: GPUMemoryUnderutilized
          expr: |
            DCGM_FI_DEV_FB_USED / DCGM_FI_DEV_FB_FREE < 0.2
          for: 1h
          labels:
            severity: info
          annotations:
            summary: "GPU memory < 20% utilized"
```

## Common Issues

### GPU metrics missing in Grafana
- **Cause**: Thanos Receive crashed (OOMKilled) → metrics gap
- **Fix**: Fix Thanos Receive memory; historical gaps are permanent

### DCGM Exporter CrashLoopBackOff
- **Cause**: GPU driver mismatch or DCGM version incompatibility
- **Fix**: Match DCGM exporter version to GPU driver version

### NVLink metrics all zeros
- **Cause**: Single-GPU workload or NVLink not configured
- **Fix**: NVLink metrics only appear for multi-GPU workloads using NCCL

### Metrics delayed by 5+ minutes
- **Cause**: Prometheus remote-write queue backlog
- **Fix**: Increase `maxSamplesPerSend`; check Thanos Receive health

## Best Practices

1. **Size Thanos Receive for retention** — 4Gi+ memory for 15d of GPU metrics
2. **Filter remote-write** — only send DCGM/Run:ai metrics, not all cluster metrics
3. **Alert on idle GPUs** — $10+/hour per GPU wasted is expensive
4. **Use per-workload labels** — enables chargeback by team/project
5. **Monitor NVLink** — bandwidth drops indicate NCCL communication issues
6. **Set dashboard time ranges** — training jobs are short; use 1h-4h windows

## Key Takeaways

- DCGM Exporter runs as DaemonSet on all GPU nodes, exposes :9400
- Prometheus scrapes and remote-writes to Thanos Receive in runai-backend
- Run:ai UI queries metrics via REST API (wraps Thanos Query PromQL)
- Key metrics: GPU_UTILIZATION, GPU_MEMORY_USAGE_BYTES, NVLINK_BANDWIDTH
- Typical FSDP training: 85-98% GPU util, ~32% GPU memory, spiky CPU
- Thanos Receive OOM causes permanent metrics gaps — size it properly
- Alert on idle GPUs to avoid wasting $10+/hour per unused device
