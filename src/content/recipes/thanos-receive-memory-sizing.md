---
title: "Thanos Receive Memory Sizing Guide"
description: "Calculate correct memory limits for Thanos Receive based on WAL segments, active series, retention, and ingestion rate. Prevent OOMKill crash loops"
tags:
  - "thanos"
  - "memory"
  - "capacity-planning"
  - "observability"
  - "troubleshooting"
category: "observability"
publishDate: "2026-05-05"
author: "Luca Berton"
difficulty: "advanced"
relatedRecipes:
  - "thanos-receive-oomkilled-runai"
  - "runai-observability-opentelemetry-openshift"
  - "kubernetes-oomkilled-troubleshooting"
  - "openshift-gpu-node-resource-planning"
---

> 💡 **Quick Answer:** Thanos Receive needs memory proportional to WAL size × series cardinality. With 347 WAL segments (each 128MB on disk) and 183-day retention, the WAL replay alone requires 2-4Gi of RAM. Set memory limits to at least 4Gi for production GPU clusters, or reduce retention to 15d.

## The Problem

Thanos Receive keeps crashing with OOMKilled. You set 512Mi, then 1Gi — still crashes. Why does it need 4Gi+ of memory?

## Why Thanos Receive Needs So Much Memory

### 1. WAL (Write-Ahead Log) Replay on Startup

Every time Thanos Receive starts, it replays the entire WAL to reconstruct in-memory state:

```text
WAL on disk:
├── segment-000 (128 MB)
├── segment-001 (128 MB)
├── ...
├── segment-347 (128 MB)
└── Total: ~44 GB on disk

But disk size ≠ memory needed. The WAL contains compressed samples.
During replay, each segment expands into in-memory series data structures.
```

**Memory during replay:**

```text
Per active time series in memory:
├── Labels (metric name, pod, gpu, namespace): ~200 bytes
├── Chunk head (current samples buffer):       ~120 bytes  
├── Memory-mapped chunk references:            ~64 bytes
├── Index postings references:                 ~32 bytes
└── Total per series: ~416 bytes

With 50,000 active series (typical GPU cluster):
  50,000 × 416 bytes = ~20 MB (just the series metadata)

But WAL replay also loads:
├── All samples from non-compacted blocks:     ~1-2 GB
├── Memory-mapped chunks from old blocks:      ~500 MB
├── Go runtime overhead (GC, goroutines):      ~500 MB
├── Incoming remote-write buffer during replay: ~200 MB
└── Total: 2-4 GB
```

### 2. The Head Block

Thanos Receive TSDB keeps a "head block" — all samples from the last 2 hours that haven't been compacted yet:

```text
Head block memory usage:
= active_series × samples_per_series × bytes_per_sample

Example:
= 50,000 series × 120 samples (2h at 60s interval) × 16 bytes
= 96 MB (just samples)

Plus series metadata, label indices, posting lists:
= ~200 MB total for head block
```

### 3. The 183-Day Retention Problem

`--tsdb.retention=183d` means:

```text
TSDB keeps 183 days of blocks before deletion.
Each 2-hour block gets compacted into larger blocks over time.
But the WAL accumulates ALL writes since last successful compaction.

If Thanos Receive keeps OOMKilling before compaction completes:
→ WAL grows unbounded
→ Next replay needs even MORE memory
→ Feedback loop: more WAL = more memory needed = more OOM

This is why it went from "fine" to "347 segments" — it hasn't 
successfully compacted in days/weeks because it can't stay alive.
```

### 4. Memory Breakdown for Your Cluster

```text
Your cluster (estimated):
├── 8 GPU nodes × 8 GPUs = 64 GPUs
├── Run:ai metrics per GPU: ~50 series
├── Node metrics: ~200 per node
├── Pod metrics: ~30 per running Pod × ~100 Pods
├── Total active series: ~8,000 - 50,000
│
├── WAL segments: 347 × variable replay cost
├── Head block: ~200 MB
├── Compaction buffers: ~500 MB
├── Go runtime (GC needs 2× live data): ~1 GB
├── Incoming write buffers: ~200 MB
│
└── TOTAL NEEDED: 3-4 GB minimum
    With safety margin: 4 GB recommended
```

### 5. Go Garbage Collector Impact

```text
Go GC rule of thumb:
  Memory needed = 2× live data (GC needs headroom to collect)

If live data = 1.5 GB:
  Go needs 3 GB to GC efficiently
  With 1 GB limit → GC runs constantly → slows replay → eventually OOM

This is why 1Gi fails even though "live data" seems small:
  Go's GC can't keep up with allocation rate during WAL replay
```

## The Formula

```text
Required memory = (active_series × 416 bytes)
                + (WAL_replay_peak × 1.5)
                + (head_block × 2)    # GC overhead
                + 500 MB              # compaction buffer
                + 200 MB              # incoming writes buffer

Conservative estimate for GPU clusters:
  Small  (1-4 nodes,  <10K series):  2 Gi
  Medium (4-16 nodes, 10-50K series): 4 Gi
  Large  (16+ nodes,  50K+ series):   8 Gi
```

## The Solution

### Immediate Fix (Stop the Crash Loop)

```bash
# 1. Scale down
oc scale sts runai-backend-thanos-receive -n runai-backend --replicas=0

# 2. Wipe the bloated WAL (object storage data is safe)
oc run wal-cleanup -n runai-backend --rm -it \
  --image=busybox \
  --overrides='{
    "spec": {
      "containers": [{
        "name": "cleanup",
        "image": "busybox",
        "command": ["sh", "-c", "rm -rf /data/wal/* /data/chunks_head/*"],
        "volumeMounts": [{"name": "data", "mountPath": "/data"}]
      }],
      "volumes": [{
        "name": "data",
        "persistentVolumeClaim": {"claimName": "data-runai-backend-thanos-receive-0"}
      }]
    }
  }'

# 3. Bump memory to 4Gi
oc patch sts runai-backend-thanos-receive -n runai-backend --type=json \
  -p='[{"op":"add","path":"/spec/template/spec/containers/0/resources","value":{"limits":{"cpu":"1","memory":"4Gi"},"requests":{"cpu":"500m","memory":"2Gi"}}}]'

# 4. Reduce retention (prevents WAL from growing this large again)
# Edit StatefulSet args: change --tsdb.retention=183d to --tsdb.retention=15d

# 5. Scale back up
oc scale sts runai-backend-thanos-receive -n runai-backend --replicas=1
```

### Permanent Fix (GitOps)

```yaml
# Helm values for Run:ai Thanos subchart
thanos:
  receive:
    resources:
      limits:
        cpu: "1"
        memory: 4Gi
      requests:
        cpu: 500m
        memory: 2Gi
    extraArgs:
      - --tsdb.retention=15d
```

### Monitoring to Prevent Recurrence

```yaml
# PrometheusRule to alert before OOM
apiVersion: monitoring.coreos.com/v1
kind: PrometheusRule
metadata:
  name: thanos-receive-memory
  namespace: runai-backend
spec:
  groups:
    - name: thanos-receive
      rules:
        - alert: ThanosReceiveHighMemory
          expr: |
            container_memory_working_set_bytes{
              namespace="runai-backend",
              container="receive"
            } / container_spec_memory_limit_bytes > 0.8
          for: 5m
          labels:
            severity: warning
          annotations:
            summary: "Thanos Receive using >80% memory"
            description: "Consider increasing memory limit before OOM"
```

## Prevention Checklist

| Setting | Bad | Good | Why |
|---------|-----|------|-----|
| Memory limit | 512Mi-1Gi | 4Gi | WAL replay + GC overhead |
| `--tsdb.retention` | 183d | 15d | Limits WAL growth; obj store handles long-term |
| Compaction | Failing silently | Monitored | Blocked compaction = WAL growth |
| Alerts | None | >80% memory | Catch before OOM |
| Object storage | Missing | Configured | Offloads historical data from local TSDB |

## Common Issues

### WAL grows indefinitely
- **Cause**: Thanos Receive OOMKills before compaction → WAL never gets truncated → grows → needs more memory → OOM
- **Fix**: Break the cycle by wiping WAL + increasing memory + reducing retention

### Memory usage spikes during compaction
- **Cause**: Compaction loads block data into memory for merging
- **Fix**: Ensure memory limit has 50% headroom above steady-state usage

### Thanos Receive fine for months then suddenly OOMs
- **Cause**: Series cardinality increased (new workloads, new nodes), or compaction fell behind
- **Fix**: Monitor `thanos_receive_tsdb_head_active_appenders` for cardinality growth

## Key Takeaways

- **1Gi is never enough** for production Thanos Receive — minimum 2Gi, recommended 4Gi
- WAL replay loads ALL uncompacted data into memory on every restart
- 347 WAL segments means compaction hasn't succeeded in days/weeks
- Go GC needs ~2× live data as headroom — halve your "theoretical" memory and that's what crashes
- `--tsdb.retention=183d` is fine for object storage tier, dangerous for local TSDB
- Break the OOM→WAL-growth→OOM cycle: wipe WAL + increase memory + reduce retention
- Object storage (S3/GCS/Minio) handles long-term retention — local TSDB should be short-lived
