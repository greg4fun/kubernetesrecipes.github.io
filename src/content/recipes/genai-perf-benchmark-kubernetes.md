---
title: "GenAI-Perf Benchmark LLM Kubernetes"
description: "Benchmark LLM inference on Kubernetes with GenAI-Perf. Configure --service-kind openai for vLLM, NIM, and TGI endpoints. Measure throughput, latency, time-to-first-token, and inter-token latency."
publishDate: "2026-04-30"
author: "Luca Berton"
category: "ai"
difficulty: "intermediate"
timeToComplete: "20 minutes"
kubernetesVersion: "1.28+"
tags:
  - "genai-perf"
  - "benchmarking"
  - "llm"
  - "nvidia"
  - "vllm"
  - "inference"
relatedRecipes:
  - "deploy-vllm-inference-kubernetes"
  - "nim-model-profiles-selection-kubernetes"
  - "continuous-batching-llm-inference-kubernetes"
  - "speculative-decoding-llm-kubernetes"
---

> 💡 **Quick Answer:** GenAI-Perf is NVIDIA's tool for benchmarking LLM inference endpoints. Use `--service-kind openai` to test any OpenAI-compatible API (vLLM, NIM, TGI, Ollama). Run: `genai-perf profile --model llama3 --service-kind openai --endpoint-type chat --url http://llm-service:8000 --concurrency 10`. It measures throughput (tokens/s), request latency, time-to-first-token (TTFT), inter-token latency (ITL), and output token throughput.

## The Problem

Deploying LLMs on Kubernetes requires performance validation:

- What's the max throughput at acceptable latency?
- How does concurrency affect time-to-first-token?
- Is the model GPU-bound or network-bound?
- How does batching perform under load?
- Does the endpoint handle sustained traffic without degradation?

GenAI-Perf provides standardized benchmarking for all OpenAI-compatible inference servers.

## The Solution

### Install GenAI-Perf

```bash
# Option 1: pip install
pip install genai-perf

# Option 2: NVIDIA Triton SDK container (includes genai-perf)
kubectl run genai-perf \
  --image=nvcr.io/nvidia/tritonserver:24.07-py3-sdk \
  --restart=Never \
  -- sleep infinity

kubectl exec -it genai-perf -- bash
```

### Basic Benchmark with --service-kind openai

```bash
# Benchmark a vLLM endpoint
genai-perf profile \
  --model meta-llama/Llama-3.1-8B-Instruct \
  --service-kind openai \
  --endpoint-type chat \
  --url http://vllm-service:8000 \
  --num-prompts 100 \
  --concurrency 10 \
  --streaming

# Output:
#                          LLM Metrics
# ┌──────────────────────┬──────────┬──────────┬──────────┐
# │ Metric               │ avg      │ p50      │ p99      │
# ├──────────────────────┼──────────┼──────────┼──────────┤
# │ Request latency (ms) │ 1,245    │ 1,180    │ 2,890    │
# │ TTFT (ms)            │ 45       │ 38       │ 142      │
# │ ITL (ms)             │ 12       │ 11       │ 28       │
# │ Output tokens/req    │ 156      │ 148      │ 312      │
# │ Throughput (tok/s)   │ 1,250    │          │          │
# │ Request throughput   │ 8.0/s    │          │          │
# └──────────────────────┴──────────┴──────────┴──────────┘
```

### Endpoint Types

```bash
# Chat completions (OpenAI chat format)
genai-perf profile \
  --service-kind openai \
  --endpoint-type chat \
  --model llama3 \
  --url http://llm-service:8000

# Text completions (legacy /v1/completions)
genai-perf profile \
  --service-kind openai \
  --endpoint-type completions \
  --model llama3 \
  --url http://llm-service:8000

# Embeddings
genai-perf profile \
  --service-kind openai \
  --endpoint-type embeddings \
  --model text-embedding-ada-002 \
  --url http://embedding-service:8000
```

### Concurrency Sweep

```bash
# Test increasing concurrency to find saturation point
for c in 1 2 4 8 16 32 64; do
  echo "=== Concurrency: $c ==="
  genai-perf profile \
    --model llama3 \
    --service-kind openai \
    --endpoint-type chat \
    --url http://vllm-service:8000 \
    --concurrency $c \
    --num-prompts 50 \
    --streaming \
    2>&1 | grep -E "Throughput|TTFT|ITL|Request latency"
done
```

### Input/Output Token Control

```bash
# Control prompt and output length
genai-perf profile \
  --model llama3 \
  --service-kind openai \
  --endpoint-type chat \
  --url http://vllm-service:8000 \
  --concurrency 10 \
  --num-prompts 100 \
  --streaming \
  --input-tokens-mean 512 \
  --input-tokens-stddev 50 \
  --output-tokens-mean 256 \
  --output-tokens-stddev 25 \
  --extra-inputs max_tokens:256
```

### Custom Prompts Dataset

```bash
# Use your own prompts
cat > prompts.jsonl << 'EOF'
{"text_input": "Explain Kubernetes pod scheduling in detail"}
{"text_input": "Write a Python function to parse YAML"}
{"text_input": "What are the best practices for container security?"}
EOF

genai-perf profile \
  --model llama3 \
  --service-kind openai \
  --endpoint-type chat \
  --url http://vllm-service:8000 \
  --input-file prompts.jsonl \
  --concurrency 10 \
  --streaming
```

### Kubernetes Job for Benchmarking

```yaml
apiVersion: batch/v1
kind: Job
metadata:
  name: llm-benchmark
  namespace: ai-workloads
spec:
  template:
    spec:
      containers:
      - name: genai-perf
        image: nvcr.io/nvidia/tritonserver:24.07-py3-sdk
        command:
        - genai-perf
        - profile
        - --model=meta-llama/Llama-3.1-8B-Instruct
        - --service-kind=openai
        - --endpoint-type=chat
        - --url=http://vllm-service:8000
        - --concurrency=10
        - --num-prompts=200
        - --streaming
        resources:
          requests:
            cpu: "2"
            memory: 4Gi
      restartPolicy: Never
  backoffLimit: 0
```

### Key Metrics Explained

| Metric | What It Measures | Good Value (8B model, A100) |
|--------|-----------------|----------------------------|
| **TTFT** | Time to first token | < 100ms |
| **ITL** | Inter-token latency | < 20ms |
| **Throughput** | Output tokens/second | > 1000 tok/s |
| **Request latency** | End-to-end per request | Depends on output length |
| **Request throughput** | Requests/second | > 5/s at concurrency 10 |

### Compare Inference Servers

```bash
# Same benchmark against different backends
MODELS="llama3"
BACKENDS=(
  "http://vllm-service:8000"
  "http://nim-service:8000"
  "http://tgi-service:8080"
)

for backend in "${BACKENDS[@]}"; do
  echo "=== $backend ==="
  genai-perf profile \
    --model $MODELS \
    --service-kind openai \
    --endpoint-type chat \
    --url "$backend" \
    --concurrency 10 \
    --num-prompts 100 \
    --streaming
done
```

## Common Issues

**"Connection refused" to inference endpoint**

Service not reachable from the benchmark pod. Check: `kubectl get svc vllm-service`, port forwarding, NetworkPolicy.

**TTFT is high but ITL is normal**

Prompt processing (prefill) is the bottleneck. Check if the model is compute-bound during prefill — may need more GPU memory or prefix caching.

**Throughput plateaus at low concurrency**

Continuous batching may not be enabled. For vLLM, it's enabled by default. For NIM, check model profile settings.

**"--service-kind openai" not recognized**

Old genai-perf version. Update: `pip install --upgrade genai-perf`.

## Best Practices

- **Always benchmark with `--streaming`** — matches real-world LLM usage
- **Run concurrency sweep** — find the saturation point before production deployment
- **Control input/output tokens** — standardize for reproducible benchmarks
- **Benchmark from within the cluster** — avoid network latency skewing results
- **Compare TTFT across configs** — most important metric for user experience
- **Run multiple iterations** — use `--num-prompts 200+` for statistical significance

## Key Takeaways

- `--service-kind openai` works with any OpenAI-compatible API (vLLM, NIM, TGI, Ollama)
- TTFT and ITL are the key metrics for LLM serving quality
- Concurrency sweeps reveal the throughput saturation point
- Run benchmarks from inside the cluster to avoid external network noise
- GenAI-Perf is the standard NVIDIA tool for LLM inference benchmarking
