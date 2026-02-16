---
title: "Quantize LLMs for Efficient GPU Inference on Kubernetes"
description: "Run quantized LLM models (GPTQ, AWQ, GGUF) on Kubernetes to reduce GPU memory requirements and serve models on smaller GPUs."
category: "ai"
difficulty: "intermediate"
timeToComplete: "20 minutes"
kubernetesVersion: "1.28+"
prerequisites:
  - "Kubernetes cluster with GPU nodes"
  - "vLLM or compatible inference server"
  - "Quantized model weights (GPTQ, AWQ, or GGUF format)"
relatedRecipes:
  - "deploy-mistral-vllm-kubernetes"
  - "deploy-mistral-nvidia-nim"
  - "nvidia-gpu-operator-install"
  - "s3-model-storage-permissions"
tags:
  - quantization
  - gptq
  - awq
  - gguf
  - llm
  - gpu
  - optimization
  - ai-workloads
publishDate: "2026-02-16"
author: "Luca Berton"
---

> 💡 **Quick Answer:** Use quantized models (AWQ or GPTQ) to cut GPU memory by 50–75%. Mistral-7B goes from ~14 GB (bf16) → ~4 GB (4-bit). In vLLM, set `--quantization awq` or `--quantization gptq`. Download pre-quantized models from Hugging Face (e.g., `TheBloke/Mistral-7B-v0.1-AWQ`). No code changes needed — same OpenAI-compatible API.

# Quantize LLMs for Efficient GPU Inference on Kubernetes

Quantization reduces model precision (e.g., 16-bit → 4-bit) to shrink GPU memory requirements and increase throughput. This lets you serve production LLMs on smaller or shared GPUs.

## Memory Savings Overview

| Model | bf16 (full) | 8-bit | 4-bit (AWQ/GPTQ) |
|---|---|---|---|
| Mistral-7B | ~14 GB | ~8 GB | ~4 GB |
| Llama-2-13B | ~26 GB | ~14 GB | ~7 GB |
| Llama-2-70B | ~140 GB | ~70 GB | ~35 GB |
| Mixtral-8x7B | ~90 GB | ~48 GB | ~24 GB |

## Quantization Formats

| Format | Quality | Speed | vLLM Support | Notes |
|---|---|---|---|---|
| **AWQ** | Excellent | Fast | Yes | Recommended for vLLM |
| **GPTQ** | Excellent | Good | Yes | Widely adopted |
| **GGUF** | Good | Varies | No (use llama.cpp) | Best for CPU inference |
| **bitsandbytes** | Good | Moderate | Limited | Easiest to apply |
| **FP8** | Near-lossless | Fastest | NIM only | Requires H100/Ada |

## Deploy AWQ Model with vLLM

### Step 1: Get Pre-Quantized Weights

Download a pre-quantized model. Example with Mistral-7B AWQ:

```bash
# From Hugging Face (on a machine with internet access)
huggingface-cli download TheBloke/Mistral-7B-v0.1-AWQ \
  --local-dir ./Mistral-7B-v0.1-AWQ

# Upload to your PVC or S3 storage
# Model directory structure is identical to full-precision models
```

### Step 2: Deployment Manifest

```yaml
# mistral-awq-deployment.yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: mistral-awq
  namespace: ai-inference
spec:
  replicas: 1
  selector:
    matchLabels:
      app: mistral-awq
  template:
    metadata:
      labels:
        app: mistral-awq
    spec:
      containers:
        - name: vllm
          image: registry.example.com/org/vllm-cuda:latest
          command:
            - python
            - -m
            - vllm.entrypoints.openai.api_server
          args:
            - --model
            - /data/Mistral-7B-v0.1-AWQ
            - --quantization
            - awq
            - --dtype
            - float16
            - --tensor-parallel-size
            - "1"
            - --max-model-len
            - "8192"
          ports:
            - containerPort: 8000
          env:
            - name: HF_HUB_OFFLINE
              value: "1"
            - name: TRANSFORMERS_OFFLINE
              value: "1"
          resources:
            limits:
              nvidia.com/gpu: "1"
          volumeMounts:
            - name: model-data
              mountPath: /data
              readOnly: true
      volumes:
        - name: model-data
          persistentVolumeClaim:
            claimName: model-storage-pvc
---
apiVersion: v1
kind: Service
metadata:
  name: mistral-awq
  namespace: ai-inference
spec:
  selector:
    app: mistral-awq
  ports:
    - port: 8000
      targetPort: 8000
```

### Key Difference from Full-Precision

The only changes are:

```text
--model /data/Mistral-7B-v0.1-AWQ    # quantized weights path
--quantization awq                    # tell vLLM the format
--dtype float16                       # AWQ works with fp16, not bf16
```

## Deploy GPTQ Model with vLLM

```yaml
args:
  - --model
  - /data/Mistral-7B-v0.1-GPTQ
  - --quantization
  - gptq
  - --dtype
  - float16
  - --tensor-parallel-size
  - "1"
```

## GPU Selection Guide for Quantized Models

| GPU | VRAM | Mistral-7B (4-bit) | Llama-2-13B (4-bit) | Llama-2-70B (4-bit) |
|---|---|---|---|---|
| T4 | 16 GB | ✅ | ✅ (tight) | ❌ |
| A10 | 24 GB | ✅ | ✅ | ❌ |
| A30 | 24 GB | ✅ | ✅ | ❌ |
| A100-40GB | 40 GB | ✅ | ✅ | ✅ (tight) |
| A100-80GB | 80 GB | ✅ | ✅ | ✅ |
| H100 | 80 GB | ✅ | ✅ | ✅ |

With 4-bit quantization, Mistral-7B fits comfortably on a T4 — enabling inference on much cheaper hardware.

## Quality Comparison

Quantization introduces small accuracy trade-offs:

```text
Benchmark (Mistral-7B):
  bf16 (baseline):  MMLU 62.5%  |  Perplexity 5.21
  AWQ 4-bit:        MMLU 62.1%  |  Perplexity 5.28
  GPTQ 4-bit:       MMLU 61.8%  |  Perplexity 5.32

Practical impact: Negligible for most applications.
```

## Run:ai Configuration for Quantized Models

| Field | Full Precision | AWQ 4-bit |
|---|---|---|
| Image | vLLM container | Same |
| Arguments | `--model /data/Mistral-7B-v0.1 --dtype bfloat16` | `--model /data/Mistral-7B-v0.1-AWQ --quantization awq --dtype float16` |
| GPU fraction | 50% (of A100) | 25% or smaller GPU |
| GPU memory needed | ~14 GB | ~4 GB |

## Verify Quantized Deployment

```bash
# Check model is loaded
curl -k https://<endpoint>/v1/models

# Run inference (same API as full-precision)
curl -k -X POST https://<endpoint>/v1/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "/data/Mistral-7B-v0.1-AWQ",
    "prompt": "Explain quantization in one sentence:",
    "max_tokens": 32
  }'
```

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `ValueError: quantization method not supported` | Wrong vLLM version | Use vLLM ≥ 0.4.0 |
| Slow inference | CPU fallback for some ops | Ensure GPU is allocated |
| Quality degradation | Over-aggressive quantization | Try AWQ instead of GPTQ, or use 8-bit |
| `CUDA out of memory` | Batch size too large for quantized model | Reduce `--max-num-seqs` |

## Related Recipes

- [Deploy Mistral with vLLM](./deploy-mistral-vllm-kubernetes)
- [Deploy Mistral with NVIDIA NIM](./deploy-mistral-nvidia-nim)
- [Install NVIDIA GPU Operator](./nvidia-gpu-operator-install)
