---
title: "NVIDIA GenAI-Perf Inference Benchmarking"
description: "Benchmark LLM inference throughput and latency on Kubernetes using NVIDIA GenAI-Perf. Covers vLLM, Run:ai, concurrency testing, and multi-location client runs."
tags:
  - "benchmarking"
  - "inference"
  - "nvidia"
  - "vllm"
  - "performance"
category: "ai"
publishDate: "2026-05-05"
author: "Luca Berton"
difficulty: "advanced"
relatedRecipes:
  - "distributed-multi-gpu-inference-kubernetes"
  - "runai-distributed-training-openshift"
  - "nvidia-gpu-operator-setup"
  - "deploy-mistral-vllm-kubernetes"
---

> 💡 **Quick Answer:** NVIDIA GenAI-Perf (formerly AI-Perf) benchmarks LLM inference endpoints by measuring tokens/second, latency percentiles, and time-to-first-token. Run it from multiple locations (cluster, admin node, laptop) to measure real network impact on inference performance.

## The Problem

Deploying an LLM on Kubernetes is only half the battle. You need to know:

- **Throughput**: How many tokens/second can it generate?
- **Latency**: What's the P50/P95/P99 time-to-first-token (TTFT)?
- **Concurrency**: How does performance degrade under load?
- **Network impact**: Does HA Proxy / Ingress routing add latency?
- **Scaling**: When do you need more replicas or GPUs?

## The Solution

### Deploy vLLM with Run:ai

```bash
# Deploy model for inference benchmarking
runai training pytorch submit inference-bench \
  --image registry.example.com/inference/vllm:0.8.0 \
  --gpu-devices-request 1 \
  --cpu-memory-request 3846 \
  --large-shm \
  --run-as-uid 2000 \
  --run-as-gid 2000 \
  --environment-variable MODEL_NAME="mistralai/Mistral-Small-4-11B" \
  --environment-variable TENSOR_PARALLEL_SIZE="1" \
  --existing-pvc claimname=model-cache,path=/models \
  --command -- vllm serve $MODEL_NAME --port 8000
```

### Run GenAI-Perf from Inside the Cluster

```bash
# Install GenAI-Perf
pip install genai-perf

# Basic benchmark: single concurrency
genai-perf \
  --endpoint-type chat \
  --backend vllm \
  --url http://inference-bench:8000/v1 \
  --model mistralai/Mistral-Small-4-11B \
  --concurrency 1 \
  --input-tokens-mean 200 \
  --output-tokens-mean 200 \
  --num-requests 100 \
  --output-format csv

# High concurrency test
genai-perf \
  --endpoint-type chat \
  --backend vllm \
  --url http://inference-bench:8000/v1 \
  --model mistralai/Mistral-Small-4-11B \
  --concurrency 2 \
  --input-tokens-mean 200 \
  --output-tokens-mean 100 \
  --num-requests 200 \
  --output-format csv
```

### Benchmark from Multiple Locations

Testing from 3 locations reveals network bottlenecks:

```bash
# Location 1: From within the cluster (Pod-to-Pod, lowest latency)
kubectl run genai-perf-client --image=nvcr.io/nvidia/tritonserver:24.12-py3 \
  --rm -it -- genai-perf \
  --url http://inference-svc.default:8000/v1 \
  --concurrency 1 \
  --input-tokens-mean 200

# Location 2: From admin node (behind HA Proxy)
genai-perf \
  --url https://inference.apps.cluster.example.com/v1 \
  --concurrency 1 \
  --input-tokens-mean 200

# Location 3: From developer laptop (full network path)
genai-perf \
  --url https://inference.apps.cluster.example.com/v1 \
  --concurrency 1 \
  --input-tokens-mean 200
```

### Key Metrics to Capture

```text
Metric                    Target (Single H200)
─────────────────────────────────────────────
Tokens/sec (output)       > 50 tok/s per request
Time to First Token P50   < 200ms (cluster), < 500ms (external)
Time to First Token P99   < 1000ms
Inter-token latency P50   < 30ms
Requests/sec @ conc=8     > 5 req/s
GPU utilization           > 70% during benchmark
```

### Benchmark Script (Automated Multi-Concurrency)

```bash
#!/bin/bash
set -euo pipefail

URL="${1:-http://inference-svc:8000/v1}"
MODEL="${2:-mistralai/Mistral-Small-4-11B}"
OUTPUT_DIR="${3:-/data/output/benchmarks}"

mkdir -p "$OUTPUT_DIR"

echo "=== GenAI-Perf Benchmark Suite ==="
echo "URL: $URL"
echo "Model: $MODEL"
echo "Date: $(date -Iseconds)"

for CONCURRENCY in 1 2 4 8 16; do
  for INPUT_TOKENS in 100 200 500; do
    echo "--- concurrency=$CONCURRENCY, input_tokens=$INPUT_TOKENS ---"
    
    genai-perf \
      --endpoint-type chat \
      --backend vllm \
      --url "$URL" \
      --model "$MODEL" \
      --concurrency $CONCURRENCY \
      --input-tokens-mean $INPUT_TOKENS \
      --output-tokens-mean 200 \
      --num-requests 50 \
      --output-format csv \
      --output-file "$OUTPUT_DIR/bench_c${CONCURRENCY}_i${INPUT_TOKENS}.csv" \
      2>&1 | tee -a "$OUTPUT_DIR/benchmark.log"
  done
done

echo "=== Benchmark complete ==="
```

### Compare Results Across Locations

```python
import pandas as pd
import glob

# Load all benchmark CSVs
results = []
for f in glob.glob("benchmarks/*.csv"):
    df = pd.read_csv(f)
    df["source"] = f.split("/")[-1]
    results.append(df)

combined = pd.concat(results)

# Summary table
summary = combined.groupby(["concurrency", "location"]).agg({
    "output_tokens_per_sec": "mean",
    "time_to_first_token_ms": ["p50", "p95", "p99"],
    "inter_token_latency_ms": "mean",
}).round(2)

print(summary)
```

### Run:ai Multi-Node Distributed Inference Benchmark

```bash
# Deploy distributed inference (tensor parallel across 2 GPUs)
runai training pytorch submit inference-distributed \
  --image registry.example.com/inference/vllm:0.8.0 \
  --workers 2 \
  --gpu-devices-request 1 \
  --large-shm \
  --environment-variable NCCL_SOCKET_IFNAME="net1" \
  --annotation "k8s.v1.cni.cncf.io/networks=sriov-rdma" \
  --extended-resource "openshift.io/mellanoxnics=1" \
  --existing-pvc claimname=model-cache,path=/models \
  --command -- vllm serve meta-llama/Llama-3.1-70B-Instruct \
    --tensor-parallel-size 2 --port 8000

# Then benchmark the distributed endpoint
genai-perf \
  --url http://inference-distributed:8000/v1 \
  --model meta-llama/Llama-3.1-70B-Instruct \
  --concurrency 2 \
  --input-tokens-mean 200 \
  --num-requests 100
```

## Common Issues

### GenAI-Perf timeout on first request
- **Cause**: Model still loading into GPU memory
- **Fix**: Wait for `/health` endpoint to return 200, then run benchmark

### Different results from different locations
- **Expected**: Cluster (best) > Admin node > Laptop (worst)
- **Investigation**: HA Proxy adds ~10-50ms; TLS termination adds ~5-10ms

### Low throughput despite high GPU utilization
- **Cause**: Batch size too small or KV cache undersized
- **Fix**: Increase concurrent requests to fill GPU batching pipeline

## Best Practices

1. **Warm up before benchmarking** — send 10 requests before measuring
2. **Test from multiple locations** — reveals network vs compute bottlenecks
3. **Vary concurrency** — find the saturation point for capacity planning
4. **Use fixed input/output token counts** — reproducible comparisons
5. **Capture GPU metrics simultaneously** — correlate throughput with utilization
6. **Base image**: Use NVIDIA NGC PyTorch (`nvidia/pytorch:26.02-py3`, PyTorch 2.11)

## Key Takeaways

- GenAI-Perf measures tokens/sec, TTFT, inter-token latency at various concurrency levels
- Run from 3 locations (cluster, admin, laptop) to isolate network overhead
- Use `--input-tokens-mean` and `--concurrency` to simulate realistic workloads
- Compare single-GPU vs tensor-parallel to validate scaling efficiency
- Results drive capacity planning: when to add replicas vs GPUs
