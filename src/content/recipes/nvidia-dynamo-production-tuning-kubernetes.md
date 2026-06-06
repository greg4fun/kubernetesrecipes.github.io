---
title: "NVIDIA Dynamo Production Tuning on Kubernetes"
description: "Tune NVIDIA Dynamo for production LLM inference: prefill/decode pool sizing, KV cache transfer optimization, NCCL backend selection, SLA-driven autoscaling"
tags:
  - "nvidia-dynamo"
  - "inference-optimization"
  - "production"
  - "autoscaling"
  - "kv-cache"
  - "performance"
category: "ai"
publishDate: "2026-05-22"
author: "Luca Berton"
difficulty: "advanced"
relatedRecipes:
  - "nvidia-dynamo-distributed-inference-kubernetes"
  - "runai-dynamo-multinode-scheduling-kubernetes"
  - "nvidia-nsight-operator-gpu-profiling-kubernetes"
  - "nvidia-doca-telemetry-network-monitoring-kubernetes"
---

> 💡 **Quick Answer:** Production Dynamo tuning requires sizing prefill vs decode GPU pools (typically 1:3 ratio), configuring KV cache transfer over RDMA (not TCP), setting TTFT/TPOT SLA targets for the autoscaler, and monitoring disaggregated pipeline health. Key levers: `kv_transfer_backend`, `prefill_batch_size`, `decode_max_batch`, and SLA-driven scaling policies.

## The Problem

- Default Dynamo config works for demos but leaves performance on the table
- Prefill GPUs sit idle while decode GPUs are saturated (or vice versa)
- KV cache transfers over TCP add 5-20ms per request — kills TTFT SLA
- Autoscaler reacts too slowly to traffic bursts — SLA violations before scale-up
- No visibility into disaggregated pipeline bottlenecks (prefill queue depth vs decode throughput)

## The Solution

### Architecture Recap: Disaggregated Serving

```text
┌──────────────────────────────────────────────────────────────┐
│ Dynamo Inference Pipeline                                     │
│                                                               │
│  ┌─────────┐     ┌────────────────┐     ┌────────────────┐  │
│  │ Frontend │────▶│ Prefill Pool   │────▶│ Decode Pool    │  │
│  │ (Router) │     │ (compute KV)   │ KV  │ (generate toks)│  │
│  └─────────┘     │ GPU 0,1,2,3    │────▶│ GPU 4-15       │  │
│       │           └────────────────┘     └────────────────┘  │
│       │                                         │             │
│       │           ┌────────────────┐            │             │
│       └──────────▶│ KV-Aware Router│◀───────────┘             │
│                   │ (hit/miss)     │                          │
│                   └────────────────┘                          │
└──────────────────────────────────────────────────────────────┘

Key insight: Prefill is compute-bound (batch of new prompts)
             Decode is memory-bound (autoregressive token generation)
             Different GPU ratios optimize cost and latency
```

### Prefill/Decode Pool Sizing

```yaml
# DynamoGraphDeploymentRequest — production tuning
apiVersion: dynamo.nvidia.com/v1alpha1
kind: DynamoGraphDeploymentRequest
metadata:
  name: llama-70b-production
  namespace: inference
spec:
  graph: llama-70b-disaggregated
  components:
    frontend:
      replicas: 2
      resources:
        cpu: "4"
        memory: "8Gi"
      config:
        maxConcurrentRequests: 512
        requestTimeoutMs: 30000

    prefill:
      replicas: 4                    # Fewer GPUs — compute-bound
      resources:
        limits:
          nvidia.com/gpu: "1"        # 1 GPU per prefill worker
          memory: "80Gi"
          rdma/rdma_shared_device_a: "1"
      config:
        # Prefill tuning
        maxBatchSize: 32             # Larger batches = better GPU util
        maxInputLength: 8192         # Max prompt tokens
        tensorParallelism: 1         # Single GPU per prefill (fast for short prompts)
        # For very long prompts (>4K tokens), use TP=2:
        # tensorParallelism: 2
        # Then replicas need 2 GPUs each

    decode:
      replicas: 12                   # More GPUs — memory-bandwidth bound
      resources:
        limits:
          nvidia.com/gpu: "1"
          memory: "80Gi"
          rdma/rdma_shared_device_a: "1"
      config:
        # Decode tuning
        maxBatchSize: 256            # High batch = better memory BW utilization
        maxOutputLength: 4096        # Max generation length
        kvCacheMemoryFraction: 0.92  # Reserve 92% of GPU mem for KV cache
        continuousBatching: true
        chunkedPrefill: false        # Disabled — prefill handled by dedicated pool

    kvTransfer:
      config:
        backend: "nccl"              # RDMA-capable ← critical for latency
        # Options: nccl (RDMA), tcp, nixe
        # NCCL uses GPUDirect RDMA if available
        compression: "none"          # lz4 for bandwidth-limited; none for low latency
        maxInFlightTransfers: 64
        transferBufferSizeMB: 256
```

```text
Pool Sizing Guidelines:
──────────────────────────────────────────────────────────────────
Workload Pattern              Prefill:Decode Ratio    Why
──────────────────────────────────────────────────────────────────
Chatbot (short prompts)       1:4                    Fast prefill, long decode
RAG (long context)            1:2                    Heavy prefill computation
Code generation               1:3                    Medium prompts, long output
Summarization                 2:3                    Long input, short output
Batch processing              1:1                    Prefill-dominated
──────────────────────────────────────────────────────────────────

Formula: prefill_gpus = total_gpus × (avg_input_tokens / (avg_input + avg_output))
         (adjusted for compute vs memory intensity)
```

### KV Cache Transfer Optimization

```yaml
# NCCL backend config for KV transfers (fastest)
apiVersion: v1
kind: ConfigMap
metadata:
  name: dynamo-kv-transfer-config
  namespace: inference
data:
  kv_transfer.yaml: |
    backend: nccl
    
    nccl:
      # Use RDMA for inter-node KV transfers
      net_plugin: "ib"              # InfiniBand / RoCE
      # Or for RoCE specifically:
      # net_plugin: "socket"        # Falls back to TCP if no RDMA
      
      # Buffer sizes for KV blocks
      buffSize: 8388608             # 8MB NCCL buffer
      nChannels: 8                  # Parallel transfer channels
      
      # GDR (GPUDirect RDMA) — zero-copy GPU-to-GPU
      gdrEnable: true
      gdrCopy: true
      
    transfer:
      # Async pipeline: overlap transfer with compute
      asyncTransfer: true
      maxConcurrent: 64             # Parallel KV block transfers
      blockSizeKB: 512              # KV cache block granularity
      prefetchBlocks: 4             # Prefetch next blocks during decode
      
    compression:
      enabled: false                # Disable for latency-sensitive
      # enabled: true               # Enable for bandwidth-limited links
      # algorithm: "lz4"
      # level: 1                    # Fastest compression
```

```bash
# Verify KV transfers use RDMA (not TCP)
kubectl logs -n inference deploy/dynamo-prefill | grep -i "transfer\|nccl\|rdma"
# Expected: "KV transfer backend: NCCL (IB/RDMA)"
# Bad:      "KV transfer backend: TCP"

# Monitor KV transfer latency
kubectl exec -n inference deploy/dynamo-frontend -- \
  curl -s localhost:8080/metrics | grep kv_transfer
# dynamo_kv_transfer_latency_ms{quantile="0.5"} 1.2
# dynamo_kv_transfer_latency_ms{quantile="0.99"} 3.8
# dynamo_kv_transfer_bytes_total 8.2e12
# dynamo_kv_transfer_cache_hit_ratio 0.73
```

### SLA-Driven Autoscaling

```yaml
# Dynamo autoscaler configuration
apiVersion: dynamo.nvidia.com/v1alpha1
kind: DynamoAutoscaler
metadata:
  name: llama-70b-autoscaler
  namespace: inference
spec:
  target:
    name: llama-70b-production
  
  sla:
    # Time To First Token — user perceives as responsiveness
    ttftP99Ms: 500                   # P99 TTFT < 500ms
    # Time Per Output Token — streaming speed
    tpotP99Ms: 30                    # P99 TPOT < 30ms (≈33 tok/s)
    # End-to-end request timeout
    requestTimeoutMs: 30000

  scaling:
    prefill:
      minReplicas: 2
      maxReplicas: 16
      scaleUpThreshold:
        queueDepth: 64               # Scale up when prefill queue > 64
        ttftP99Ms: 400               # Scale up at 80% of SLA
      scaleDownThreshold:
        gpuUtilization: 30           # Scale down when util < 30%
        cooldownSeconds: 300         # Wait 5 min before scale-down

    decode:
      minReplicas: 4
      maxReplicas: 48
      scaleUpThreshold:
        batchUtilization: 0.85       # Scale when batch is 85% full
        tpotP99Ms: 25                # Scale at 83% of SLA
      scaleDownThreshold:
        batchUtilization: 0.3
        cooldownSeconds: 300

    kvTransfer:
      # Scale KV transfer bandwidth with prefill count
      autoMatchPrefill: true         # 1 transfer worker per prefill GPU

  metrics:
    source: prometheus
    address: "http://prometheus.monitoring:9090"
    scrapeInterval: 10s
```

### Monitoring Disaggregated Pipeline

```yaml
apiVersion: monitoring.coreos.com/v1
kind: PrometheusRule
metadata:
  name: dynamo-production-alerts
  namespace: inference
spec:
  groups:
    - name: dynamo-sla
      rules:
        - alert: DynamoTTFTSLABreach
          expr: |
            histogram_quantile(0.99,
              rate(dynamo_ttft_seconds_bucket[5m])
            ) > 0.5
          for: 2m
          labels:
            severity: critical
          annotations:
            summary: "TTFT P99 exceeding 500ms SLA"
            description: "Current P99 TTFT: {{ $value }}s — scale prefill pool."

        - alert: DynamoTPOTSLABreach
          expr: |
            histogram_quantile(0.99,
              rate(dynamo_tpot_seconds_bucket[5m])
            ) > 0.03
          for: 2m
          labels:
            severity: critical
          annotations:
            summary: "TPOT P99 exceeding 30ms SLA"
            description: "Current P99 TPOT: {{ $value }}s — scale decode pool."

        - alert: DynamoKVTransferSlow
          expr: |
            histogram_quantile(0.99,
              rate(dynamo_kv_transfer_latency_seconds_bucket[5m])
            ) > 0.01
          for: 5m
          labels:
            severity: warning
          annotations:
            summary: "KV cache transfer P99 > 10ms"
            description: "Check RDMA connectivity — may have fallen back to TCP."

        - alert: DynamoPrefillQueueBacklog
          expr: dynamo_prefill_queue_depth > 128
          for: 1m
          labels:
            severity: warning
          annotations:
            summary: "Prefill queue backlog ({{ $value }} requests)"
            description: "Prefill pool saturated — scale up or increase batch size."

        - alert: DynamoKVCacheHitRateLow
          expr: dynamo_kv_cache_hit_ratio < 0.5
          for: 10m
          labels:
            severity: info
          annotations:
            summary: "KV cache hit ratio low ({{ $value }})"
            description: "Many unique prompts — consider larger KV cache or prefix caching."
```

### Grafana Dashboard Queries

```promql
# Request throughput (tokens/second across all decode workers)
sum(rate(dynamo_output_tokens_total[1m]))

# TTFT latency distribution
histogram_quantile(0.5, rate(dynamo_ttft_seconds_bucket[5m]))   # P50
histogram_quantile(0.99, rate(dynamo_ttft_seconds_bucket[5m]))  # P99

# TPOT (inter-token latency)
histogram_quantile(0.99, rate(dynamo_tpot_seconds_bucket[5m]))

# Prefill vs Decode GPU utilization
avg(dynamo_gpu_utilization{pool="prefill"})
avg(dynamo_gpu_utilization{pool="decode"})

# KV cache memory usage per decode worker
dynamo_kv_cache_usage_bytes / dynamo_kv_cache_capacity_bytes

# KV transfer bandwidth (GB/s)
rate(dynamo_kv_transfer_bytes_total[1m]) / 1e9

# Cache hit ratio (higher = less redundant prefill)
dynamo_kv_cache_hit_ratio

# Queue depths (early warning)
dynamo_prefill_queue_depth
dynamo_decode_batch_size / dynamo_decode_max_batch_size
```

### Performance Comparison: Tuned vs Default

```text
NVIDIA Dynamo — Llama 3.1 70B on 16x H100 (default vs tuned):
──────────────────────────────────────────────────────────────────
Metric                    Default         Tuned           Gain
──────────────────────────────────────────────────────────────────
TTFT P99                  820 ms          380 ms          2.2x ⬇️
TPOT P99                  45 ms           22 ms           2.0x ⬇️
Throughput (tok/s)        4,200           8,900           2.1x ⬆️
KV transfer latency       12 ms (TCP)     1.5 ms (RDMA)  8x ⬇️
GPU utilization (avg)     52%             78%             +26%
Cost per 1M tokens        $4.20           $1.95           2.2x ⬇️
──────────────────────────────────────────────────────────────────

Key changes:
1. KV backend: TCP → NCCL/RDMA (8x transfer speedup)
2. Prefill batch: 8 → 32 (better GPU saturation)
3. Decode batch: 64 → 256 (better memory BW utilization)
4. Pool ratio: 1:1 → 1:3 (matched to workload)
5. kvCacheMemoryFraction: 0.8 → 0.92 (more concurrent requests)
```

### Troubleshooting Performance

```bash
# Check if RDMA is actually being used
kubectl exec -n inference deploy/dynamo-prefill -- env | grep NCCL
# NCCL_NET=IB          ← Good (InfiniBand/RoCE)
# NCCL_NET=Socket      ← Bad (TCP fallback)

# Check prefill/decode balance
kubectl exec -n inference deploy/dynamo-frontend -- \
  curl -s localhost:8080/stats | jq '.pool_stats'
# {
#   "prefill": {"active": 28, "queued": 2, "avg_ms": 45},
#   "decode":  {"active": 180, "queued": 0, "avg_tpot_ms": 18}
# }
# Ideal: queued near 0 for both pools

# If prefill is bottleneck (high queue):
# → Increase prefill replicas OR increase prefill batch size

# If decode is bottleneck (high TPOT):
# → Increase decode replicas OR increase kvCacheMemoryFraction

# Profile KV transfer overhead
kubectl exec -n inference deploy/dynamo-prefill -- \
  curl -s localhost:8080/metrics | grep kv_transfer_latency
# If P99 > 5ms, check:
# 1. RDMA connectivity (ibstat)
# 2. Network congestion (DOCA telemetry)
# 3. GPU memory pressure (OOM causes transfer stalls)
```

## Common Issues

### TTFT spikes despite low prefill queue
- **Cause**: KV transfer latency dominating (TCP fallback)
- **Fix**: Verify NCCL backend with RDMA; check `ibstat` on prefill/decode nodes

### Decode throughput drops with more requests
- **Cause**: KV cache full — evicting and re-prefilling (thrashing)
- **Fix**: Increase `kvCacheMemoryFraction` or add decode replicas

### Uneven GPU utilization across decode pool
- **Cause**: KV-aware router sending repeat prompts to same GPU (cache affinity)
- **Fix**: Normal behavior — cache hits avoid redundant prefill; monitor overall throughput not per-GPU util

### Autoscaler too slow to react
- **Cause**: Default scrape interval too long; cooldown too aggressive
- **Fix**: Set `scrapeInterval: 10s`; reduce cooldown; use predictive scaling based on queue growth rate

## Best Practices

1. **Always use NCCL/RDMA for KV transfer** — TCP adds 10x latency
2. **Size decode pool 3-4x prefill** for chatbot workloads
3. **Set kvCacheMemoryFraction to 0.90-0.95** — leave minimal headroom
4. **Monitor KV cache hit ratio** — high hits = less prefill needed = lower cost
5. **Scale on queue depth, not just utilization** — queue is a leading indicator
6. **Profile weekly with Nsight** — detect regression in kernel performance

## Key Takeaways

- Production Dynamo tuning: pool ratio, KV transfer backend, batch sizes, cache fraction
- KV transfer over RDMA (not TCP) is the single biggest performance lever (~8x)
- Prefill = compute-bound (batch size matters), Decode = memory-bound (batch + cache matters)
- SLA-driven autoscaling on TTFT (prefill) and TPOT (decode) separately
- Monitor: queue depths, cache hit ratio, transfer latency, GPU util per pool
- Typical tuned gains: 2x throughput, 2x latency reduction, 2x cost savings
