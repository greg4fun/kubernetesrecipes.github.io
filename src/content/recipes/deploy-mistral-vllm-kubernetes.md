---
title: "Deploy Mistral 7B with vLLM on Kubernetes"
description: "Step-by-step guide to deploy Mistral-7B-v0.1 using vLLM as an OpenAI-compatible inference server on Kubernetes with GPU fractioning."
category: "ai"
difficulty: "intermediate"
timeToComplete: "30 minutes"
kubernetesVersion: "1.28+"
prerequisites:
  - "Kubernetes or OpenShift cluster with GPU nodes"
  - "NVIDIA GPU Operator installed"
  - "Model weights available on a PVC or S3 storage"
  - "Container image with vLLM (CUDA-enabled)"
relatedRecipes:
  - "deploy-mistral-nvidia-nim"
  - "test-llm-inference-endpoints"
  - "s3-model-storage-permissions"
  - "kai-scheduler-gpu-sharing"
tags:
  - vllm
  - mistral
  - llm
  - inference
  - gpu
  - ai-workloads
  - openai-api
publishDate: "2026-02-16"
author: "Luca Berton"
---

> 💡 **Quick Answer:** Run vLLM with `python -m vllm.entrypoints.openai.api_server --model /data/Mistral-7B-v0.1 --dtype bfloat16 --tensor-parallel-size 1`. Mount model weights via PVC at `/data`. Set `HF_HUB_OFFLINE=1` and `TRANSFORMERS_OFFLINE=1` for air-gapped clusters. The API is OpenAI-compatible on port 8000.
>
> **Important:** The model ID in API calls must match the exact path shown by `/v1/models` (e.g., `/data/Mistral-7B-v0.1`).

# Deploy Mistral 7B with vLLM on Kubernetes

vLLM is a high-throughput inference engine for LLMs that exposes an OpenAI-compatible API. This recipe walks through deploying Mistral-7B-v0.1 on Kubernetes using vLLM with GPU fractioning.

## Architecture Overview

```text
┌─────────────────────────────────────────────┐
│  Kubernetes / OpenShift Cluster              │
│                                              │
│  ┌────────────────────────────────────────┐  │
│  │  Inference Pod (vLLM)                  │  │
│  │  - python -m vllm...openai.api_server  │  │
│  │  - Port 8000 (HTTP)                    │  │
│  │  - GPU: 0.5–1.0 (fractioning)         │  │
│  │  - Volume: /data (PVC)                │  │
│  └────────────────────────────────────────┘  │
│                                              │
│  ┌──────────────┐   ┌─────────────────────┐  │
│  │ PVC / S3     │   │ Ingress / Route     │  │
│  │ Model files  │   │ HTTPS → port 8000   │  │
│  └──────────────┘   └─────────────────────┘  │
└─────────────────────────────────────────────┘
```

## Prerequisites

### 1) Model Weights on a PVC

Your PVC should contain the full Mistral-7B-v0.1 directory:

```text
/data/Mistral-7B-v0.1/
├── config.json
├── tokenizer.json
├── tokenizer_config.json
├── special_tokens_map.json
├── model-00001-of-00002.safetensors
├── model-00002-of-00002.safetensors
└── model.safetensors.index.json
```

### 2) Container Image

Use a vLLM image built with CUDA support. Example:

```text
registry.example.com/org/vllm-cuda:latest
```

## Deployment Manifest

```yaml
# mistral-vllm-deployment.yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: mistral-vllm
  namespace: ai-inference
spec:
  replicas: 1
  selector:
    matchLabels:
      app: mistral-vllm
  template:
    metadata:
      labels:
        app: mistral-vllm
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
            - /data/Mistral-7B-v0.1
            - --download-dir
            - /data
            - --dtype
            - bfloat16
            - --tensor-parallel-size
            - "1"
          ports:
            - containerPort: 8000
              name: http
              protocol: TCP
          env:
            - name: HF_HUB_OFFLINE
              value: "1"
            - name: TRANSFORMERS_OFFLINE
              value: "1"
            - name: VLLM_NO_USAGE_STATS
              value: "1"
          resources:
            limits:
              nvidia.com/gpu: "1"    # or fractional via GPU operator
            requests:
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
  name: mistral-vllm
  namespace: ai-inference
spec:
  selector:
    app: mistral-vllm
  ports:
    - port: 8000
      targetPort: 8000
      protocol: TCP
      name: http
```

## Environment Variables Explained

| Variable | Value | Purpose |
|---|---|---|
| `HF_HUB_OFFLINE` | `1` | Prevents downloads from Hugging Face Hub |
| `TRANSFORMERS_OFFLINE` | `1` | Forces transformers to use local files only |
| `VLLM_NO_USAGE_STATS` | `1` | Disables telemetry |

These are critical for air-gapped or disconnected environments.

## GPU Fractioning

If your cluster supports GPU fractioning (e.g., Run:ai, MIG, or time-slicing):

```yaml
resources:
  limits:
    nvidia.com/gpu: "1"
  requests:
    nvidia.com/gpu: "1"
```

With Run:ai or similar schedulers, configure fractional GPU (e.g., 50%) through the platform UI rather than the manifest.

**Mistral-7B requirements:**
- Minimum: ~14 GB VRAM (bfloat16)
- Recommended: 24+ GB VRAM for production batch sizes
- Works on: A10, A30, A100, H100

## Verify Deployment

```bash
# Check pod is running
kubectl get pods -n ai-inference -l app=mistral-vllm

# Check logs for successful startup
kubectl logs -n ai-inference deployment/mistral-vllm | tail -20

# List available models
curl -k https://<inference-endpoint>/v1/models
```

Expected `/v1/models` response:

```json
{
  "object": "list",
  "data": [{
    "id": "/data/Mistral-7B-v0.1",
    "object": "model",
    "owned_by": "vllm",
    "max_model_len": 32768
  }]
}
```

## Important: Model ID in API Calls

vLLM uses the **exact model path** as the model ID. You must use it as-is:

```bash
# Correct — uses the exact ID from /v1/models
curl -k -X POST https://<endpoint>/v1/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "/data/Mistral-7B-v0.1",
    "prompt": "Write a one-line greeting:",
    "max_tokens": 32
  }'

# Wrong — this returns 404
curl -k -X POST https://<endpoint>/v1/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "Mistral-7B-v0.1",
    "prompt": "Write a one-line greeting:",
    "max_tokens": 32
  }'
```

The second call fails with:

```json
{"error": {"message": "The model `Mistral-7B-v0.1` does not exist.", "type": "NotFoundError", "code": 404}}
```

## Chat vs Completions

Mistral-7B-v0.1 (base model) does **not** include a chat template:

| Endpoint | Works? | Notes |
|---|---|---|
| `/v1/completions` | Yes | Use this for base Mistral |
| `/v1/chat/completions` | No | Requires a model with chat template (e.g., Mistral-7B-Instruct) |

If you need `/v1/chat/completions`, deploy `Mistral-7B-Instruct-v0.2` or newer instruct-tuned variants instead.

## Run:ai Deployment (UI)

If using Run:ai, configure:

| Field | Value |
|---|---|
| Inference type | Custom |
| Image URL | `registry.example.com/org/vllm-cuda:latest` |
| Image pull | Only if not present (recommended) |
| Container port | 8000 (HTTP) |
| Command | `python -m vllm.entrypoints.openai.api_server` |
| Arguments | `--model /data/Mistral-7B-v0.1 --download-dir /data --dtype bfloat16 --tensor-parallel-size 1` |
| Env: HF_HUB_OFFLINE | 1 |
| Env: TRANSFORMERS_OFFLINE | 1 |
| Env: VLLM_NO_USAGE_STATS | 1 |
| GPU devices | 1 |
| GPU fraction | 50% |
| Data origin (PVC) | your-model-storage-pvc |
| Container path | /data |
| Priority | high or very-high |

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| 404 on `/v1/completions` | Wrong model name | Use exact ID from `/v1/models` |
| Chat template error | Base model has no template | Use `/v1/completions` or switch to Instruct variant |
| Pod OOMKilled | Insufficient GPU memory | Increase GPU fraction or use quantized model |
| Slow first request | Model loading / warmup | Wait 30–60s after pod starts |

## Related Recipes

- [Deploy Mistral with NVIDIA NIM](./deploy-mistral-nvidia-nim)
- [Test LLM Inference Endpoints](./test-llm-inference-endpoints)
- [Configure S3 Storage Permissions for ML Models](./s3-model-storage-permissions)
