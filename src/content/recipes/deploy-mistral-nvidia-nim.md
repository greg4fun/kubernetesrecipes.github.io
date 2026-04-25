---
title: "Deploy Mistral 7B with NVIDIA NIM"
description: "Step-by-step guide to deploy Mistral-7B using NVIDIA NIM with TensorRT-LLM backend on Kubernetes for optimized GPU inference."
category: "ai"
difficulty: "advanced"
timeToComplete: "30 minutes"
kubernetesVersion: "1.28+"
prerequisites:
  - "Kubernetes or OpenShift cluster with GPU nodes"
  - "NVIDIA GPU Operator installed"
  - "NVIDIA NIM LLM container image available in local registry"
  - "Model weights on a PVC or S3-backed volume"
relatedRecipes:
  - "deploy-mistral-vllm-kubernetes"
  - "troubleshoot-nim-tensorrt-llm"
  - "test-llm-inference-endpoints"
  - "s3-model-storage-permissions"
  - "llm-autoscaling-kubernetes"
  - "llm-serving-frameworks-compared"
tags:
  - nvidia-nim
  - tensorrt-llm
  - mistral
  - llm
  - inference
  - gpu
  - ai-workloads
publishDate: "2026-02-16"
author: "Luca Berton"
---

> 💡 **Quick Answer:** Deploy the NVIDIA NIM LLM container with environment variables `NIM_MODEL_NAME=/data/Mistral-7B-v0.1/` and `NIM_SERVED_MODEL_NAME=Mistral-7B-v0.1`. Mount model weights to `/data`. NIM auto-starts TensorRT-LLM on port 8000. No custom command needed — the container entrypoint handles everything.
>
> **Key difference from vLLM:** NIM uses TensorRT-LLM for optimized inference with CUDA graphs, chunked prefill, and automatic engine building. Higher throughput, but stricter version requirements.


NVIDIA NIM (NVIDIA Inference Microservice) wraps TensorRT-LLM to serve LLMs with high throughput and low latency. This recipe covers deploying Mistral-7B-v0.1 using NIM on Kubernetes.

## NIM vs vLLM Comparison

| Feature | NIM (TensorRT-LLM) | vLLM |
|---|---|---|
| Backend | TensorRT-LLM C++ engine | PyTorch-based |
| Throughput | Higher (optimized kernels) | Good |
| Startup time | Slower (engine build) | Faster |
| Compatibility | Strict version coupling | More forgiving |
| CUDA graphs | Built-in | Optional |
| Chat template | Required for `/chat/completions` | Same |
| Custom command | Not needed | Required |

## Architecture

```text
┌──────────────────────────────────────────────┐
│  Kubernetes / OpenShift                       │
│                                               │
│  ┌─────────────────────────────────────────┐  │
│  │  NIM Pod                                │  │
│  │  ┌─────────────────────────────────┐    │  │
│  │  │ TensorRT-LLM Engine             │    │  │
│  │  │ - JIT engine build on first run  │    │  │
│  │  │ - CUDA graphs for batching       │    │  │
│  │  │ - Chunked prefill enabled        │    │  │
│  │  └─────────────────────────────────┘    │  │
│  │  Port 8000 (OpenAI-compatible API)      │  │
│  │  Volume: /data (PVC with model files)   │  │
│  └─────────────────────────────────────────┘  │
└──────────────────────────────────────────────┘
```

## Deployment Manifest

```yaml
# mistral-nim-deployment.yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: mistral-nim
  namespace: ai-inference
spec:
  replicas: 1
  selector:
    matchLabels:
      app: mistral-nim
  template:
    metadata:
      labels:
        app: mistral-nim
    spec:
      containers:
        - name: nim
          image: registry.example.com/org/nvidia/llm-nim:latest
          # No command/args — NIM entrypoint handles startup
          ports:
            - containerPort: 8000
              name: http
              protocol: TCP
          env:
            - name: NIM_MODEL_NAME
              value: "/data/Mistral-7B-v0.1/"
            - name: NIM_SERVED_MODEL_NAME
              value: "Mistral-7B-v0.1"
          resources:
            limits:
              nvidia.com/gpu: "1"
            requests:
              nvidia.com/gpu: "1"
          volumeMounts:
            - name: model-data
              mountPath: /data
              readOnly: true
          readinessProbe:
            httpGet:
              path: /v1/models
              port: 8000
            initialDelaySeconds: 120
            periodSeconds: 10
            timeoutSeconds: 5
          livenessProbe:
            httpGet:
              path: /v1/models
              port: 8000
            initialDelaySeconds: 180
            periodSeconds: 30
            timeoutSeconds: 5
      volumes:
        - name: model-data
          persistentVolumeClaim:
            claimName: model-storage-pvc
---
apiVersion: v1
kind: Service
metadata:
  name: mistral-nim
  namespace: ai-inference
spec:
  selector:
    app: mistral-nim
  ports:
    - port: 8000
      targetPort: 8000
      protocol: TCP
      name: http
```

## Environment Variables

| Variable | Value | Purpose |
|---|---|---|
| `NIM_MODEL_NAME` | `/data/Mistral-7B-v0.1/` | Path to model weights inside the container |
| `NIM_SERVED_MODEL_NAME` | `Mistral-7B-v0.1` | Model name exposed via the API |

**Important:** Do NOT set a custom command or entrypoint. NIM handles startup internally, including TensorRT-LLM engine building and API server initialization.

## GPU Requirements

Mistral-7B with NIM TensorRT-LLM:

| Metric | Value |
|---|---|
| Engine size | ~29.5 GB |
| Minimum VRAM | 40 GB (A100 recommended) |
| Supported GPUs | A100, H100, A30 (limited) |
| dtype | bfloat16 (default) |
| Tensor parallelism | 1 (single GPU for 7B) |

## Run:ai Deployment (UI)

| Field | Value |
|---|---|
| Inference type | Custom |
| Image URL | `registry.example.com/org/nvidia/llm-nim:latest` |
| Image pull | Only if not present (recommended) |
| Container port | 8000 (HTTP) |
| Command | *(leave empty)* |
| Arguments | *(leave empty)* |
| Env: NIM_MODEL_NAME | `/data/Mistral-7B-v0.1/` |
| Env: NIM_SERVED_MODEL_NAME | `Mistral-7B-v0.1` |
| GPU devices | 1 |
| GPU fraction | 50% (if fractioning available) |
| Data origin (PVC) | your-model-storage-pvc |
| Container path | `/data` |
| Priority | high or very-high |

## Startup Process

NIM goes through these stages on first start:

1. **Detect GPU** — identifies available CUDA devices
2. **Load model config** — reads HuggingFace config from `/data/Mistral-7B-v0.1/`
3. **Build TensorRT-LLM engine** — JIT compilation (can take 60–120 seconds)
4. **Load weights** — loads safetensors into GPU memory (~4 seconds)
5. **Initialize KV cache** — allocates GPU memory for inference batching
6. **Start API server** — listens on port 8000

Watch for this in logs:

```text
Loading weights concurrently: 100%|██████████| 617/617
Model init total -- 4.40s
```

## Verify Deployment

```bash
# Check pod status
kubectl get pods -n ai-inference -l app=mistral-nim

# Watch startup logs
kubectl logs -n ai-inference deployment/mistral-nim -f

# List models
curl -k https://<inference-endpoint>/v1/models

# Run a completion
curl -k -X POST https://<inference-endpoint>/v1/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "Mistral-7B-v0.1",
    "prompt": "Hello from NIM!",
    "max_tokens": 32
  }'
```

## Chat vs Completions (Mistral Base Model)

Mistral-7B-v0.1 is a **base** model — it has no chat template:

| Endpoint | Works? | Notes |
|---|---|---|
| `/v1/completions` | Yes | Use this |
| `/v1/chat/completions` | No | Returns error: "does not have a default chat template" |

If you need chat, use `Mistral-7B-Instruct-v0.2` or define a custom chat template.

## TensorRT-LLM Runtime Configuration

NIM auto-configures these parameters. Key defaults for Mistral-7B:

```yaml
dtype: bfloat16
tensor_parallel_size: 1
max_batch_size: 512
max_seq_len: 32768
max_num_tokens: 8192
enable_chunked_context: true
cuda_graph_mode: true
kvcache_free_memory_fraction: 0.9
scheduler_policy: guarantee_no_evict
sliding_window: 4096  # per layer
```

Override with caution. See [Troubleshoot NIM TensorRT-LLM](/recipes/troubleshooting/troubleshoot-nim-tensorrt-llm/) for known issues.

## Related Recipes

- [Deploy Mistral with vLLM](/recipes/ai/deploy-mistral-vllm-kubernetes/)
- [Troubleshoot NIM TensorRT-LLM Failures](/recipes/troubleshooting/troubleshoot-nim-tensorrt-llm/)
- [Test LLM Inference Endpoints](/recipes/ai/test-llm-inference-endpoints/)
- [Configure S3 Storage Permissions for ML Models](/recipes/storage/s3-model-storage-permissions/)
