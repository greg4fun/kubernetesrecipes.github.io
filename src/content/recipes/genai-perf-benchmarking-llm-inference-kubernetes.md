---
title: "GenAI-Perf Benchmarking LLM Inference on Kubernetes"
description: "Benchmark LLM inference performance with NVIDIA GenAI-Perf on Kubernetes. Profile vLLM, TensorRT-LLM, and Triton endpoints with concurrency sweeps, token throughput metrics, and latency percentiles."
tags:
  - "genai-perf"
  - "benchmarking"
  - "vllm"
  - "tensorrt-llm"
  - "triton"
  - "performance"
category: "ai"
publishDate: "2026-06-01"
author: "Luca Berton"
difficulty: "intermediate"
relatedRecipes:
  - "vllm-distributed-inference-kubernetes"
  - "tensorrt-llm-kubernetes-deployment"
  - "nvidia-nim-kubernetes-deployment"
---

> 💡 **Quick Answer:** GenAI-Perf is NVIDIA's benchmarking tool for LLM inference endpoints. Run `genai-perf profile -m <model> --service-kind openai --endpoint-type chat` against vLLM/NIM/Triton services. It measures time-to-first-token (TTFT), inter-token latency (ITL), output token throughput, and request latency at configurable concurrency levels.

## The Problem

- No standardized way to benchmark LLM inference throughput and latency
- Manual `curl` tests don't represent real concurrent workload patterns
- Need to compare vLLM vs TensorRT-LLM vs Triton performance objectively
- Latency percentiles (P50/P90/P99) are critical but hard to measure manually
- Token throughput varies by prompt length, output length, batch size, and concurrency

## The Solution

### Install GenAI-Perf

```bash
# GenAI-Perf comes with the Triton SDK container
# Or install standalone:
pip install genai-perf

# Verify
genai-perf --version
```

### Profile vLLM with OpenAI-Compatible API

```bash
# Basic profiling against vLLM endpoint
genai-perf profile \
  -m "llama-70b" \
  --service-kind openai \
  --endpoint-type chat \
  --url http://vllm-service.llm.svc:8000 \
  --concurrency 10 \
  --num-prompts 100 \
  --random-seed 42 \
  --input-tokens-mean 128 \
  --input-tokens-stddev 16 \
  --output-tokens-mean 256

# Concurrency sweep (find saturation point)
for c in 1 2 4 8 16 32 64; do
  echo "=== Concurrency: $c ==="
  genai-perf profile \
    -m "llama-70b" \
    --service-kind openai \
    --endpoint-type chat \
    --url http://vllm-service.llm.svc:8000 \
    --concurrency $c \
    --num-prompts 50 \
    --input-tokens-mean 128 \
    --output-tokens-mean 256
done
```

### Profile as Kubernetes Job

```yaml
apiVersion: batch/v1
kind: Job
metadata:
  name: genai-perf-benchmark
  namespace: llm
spec:
  template:
    spec:
      containers:
        - name: genai-perf
          image: nvcr.io/nvidia/tritonserver:24.05-py3-sdk
          command:
            - bash
            - -c
            - |
              genai-perf profile \
                -m "llama-70b" \
                --service-kind openai \
                --endpoint-type chat \
                --url http://vllm-service:8000 \
                --concurrency 1,2,4,8,16,32 \
                --num-prompts 200 \
                --input-tokens-mean 128 \
                --input-tokens-stddev 32 \
                --output-tokens-mean 512 \
                --output-tokens-stddev 64 \
                --streaming \
                --profile-export-file /results/benchmark.json

              # Copy results
              cp -r artifacts/ /results/
          volumeMounts:
            - name: results
              mountPath: /results
      volumes:
        - name: results
          persistentVolumeClaim:
            claimName: benchmark-results
      restartPolicy: Never
  backoffLimit: 0
```

### Key Metrics Explained

```text
GenAI-Perf output metrics:

Time To First Token (TTFT):
  • Time from request sent to first token received
  • Measures prefill/prompt processing latency
  • Target: <500ms for interactive, <2s for batch

Inter-Token Latency (ITL):
  • Time between consecutive output tokens
  • Measures decode step latency
  • Target: <50ms for smooth streaming

Output Token Throughput:
  • Total output tokens / total time (across all requests)
  • Measures system-wide generation capacity
  • Higher = better utilization

Request Throughput:
  • Completed requests per second
  • Depends on output length — shorter = more req/s

End-to-End Latency:
  • Total time from request to last token
  • = TTFT + (output_tokens × ITL)

Example output:
┌─────────────────────────────────────────────────────┐
│ LLM Metrics (concurrency=16)                         │
├─────────────────────┬───────┬───────┬───────┬───────┤
│ Metric              │  P50  │  P90  │  P99  │  Avg  │
├─────────────────────┼───────┼───────┼───────┼───────┤
│ TTFT (ms)           │   85  │  142  │  310  │   98  │
│ ITL (ms)            │   32  │   45  │   67  │   35  │
│ Request latency (s) │  8.4  │ 11.2  │ 15.8  │  9.1  │
├─────────────────────┼───────┼───────┼───────┼───────┤
│ Output throughput   │       │       │       │ 2847  │
│ (tokens/sec)        │       │       │       │       │
│ Request throughput  │       │       │       │  11.1 │
│ (req/sec)           │       │       │       │       │
└─────────────────────┴───────┴───────┴───────┴───────┘
```

### Compare vLLM vs TensorRT-LLM

```bash
# Profile vLLM
genai-perf profile \
  -m "llama-70b" \
  --service-kind openai \
  --endpoint-type chat \
  --url http://vllm-svc:8000 \
  --concurrency 16 \
  --num-prompts 200 \
  --streaming \
  --profile-export-file vllm-results.json

# Profile TensorRT-LLM (via Triton)
genai-perf profile \
  -m "llama-70b" \
  --service-kind triton \
  --backend tensorrtllm \
  --url triton-svc:8001 \
  --concurrency 16 \
  --num-prompts 200 \
  --streaming \
  --profile-export-file trtllm-results.json

# Compare results
genai-perf compare \
  --files vllm-results.json trtllm-results.json
```

### Advanced Options

```bash
# Custom prompts from file
genai-perf profile \
  -m "llama-70b" \
  --service-kind openai \
  --endpoint-type chat \
  --url http://vllm-svc:8000 \
  --input-file prompts.jsonl \
  --concurrency 8

# Completions endpoint (not chat)
genai-perf profile \
  -m "llama-70b" \
  --service-kind openai \
  --endpoint-type completions \
  --url http://vllm-svc:8000 \
  --concurrency 16

# Warmup requests before measurement
genai-perf profile \
  -m "llama-70b" \
  --service-kind openai \
  --endpoint-type chat \
  --url http://vllm-svc:8000 \
  --warmup-prompts 20 \
  --num-prompts 100 \
  --concurrency 16

# Export to CSV for graphing
genai-perf profile \
  -m "llama-70b" \
  --service-kind openai \
  --endpoint-type chat \
  --url http://vllm-svc:8000 \
  --profile-export-file results.csv
```

## Common Issues

### "Connection refused" to vLLM service
- **Cause**: Service not ready, or wrong port (vLLM default: 8000)
- **Fix**: Verify service with `kubectl port-forward svc/vllm-svc 8000:8000` first

### TTFT very high at low concurrency
- **Cause**: Model not warmed up; first requests trigger CUDA compilation
- **Fix**: Use `--warmup-prompts 10` to exclude cold-start from measurements

### Throughput doesn't scale with concurrency
- **Cause**: GPU saturated; or KV-cache full causing request queuing
- **Fix**: Check GPU utilization; increase `--max-num-seqs` in vLLM; add more GPU replicas

### "Model not found" error
- **Cause**: Model name doesn't match vLLM's `--served-model-name`
- **Fix**: Check `curl http://vllm-svc:8000/v1/models` for exact model name

## Best Practices

1. **Sweep concurrency** — find the saturation point (throughput plateaus, latency spikes)
2. **Use realistic input/output lengths** — match your actual workload distribution
3. **Warmup before measuring** — exclude cold-start from results
4. **Test with streaming** — matches real chat/completion use cases
5. **Run multiple iterations** — single runs have high variance; average 3-5 runs
6. **Profile after changes** — quantify impact of model optimization, scaling, config changes
7. **Export results** — track performance over time as code/infra changes
8. **Test at target SLA** — find max concurrency that meets your P99 latency target

## Key Takeaways

- GenAI-Perf profiles LLM endpoints with realistic concurrent workloads
- Works with vLLM (`--service-kind openai`), TensorRT-LLM, Triton, and NIM
- Key metrics: TTFT (prefill speed), ITL (decode speed), output token throughput
- Concurrency sweep reveals saturation point — where latency degrades
- Use `--streaming` for chat workloads; `--endpoint-type completions` for batch
- Run as Kubernetes Job for reproducible, in-cluster benchmarking
- Compare backends objectively with `genai-perf compare`
