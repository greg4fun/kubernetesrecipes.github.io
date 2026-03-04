---
title: "Multi-GPU and Tensor Parallel LLM Inference on Kubernetes"
description: "Deploy large language models across multiple GPUs using tensor parallelism with vLLM and NVIDIA NIM on Kubernetes."
category: "ai"
difficulty: "advanced"
timeToComplete: "30 minutes"
kubernetesVersion: "1.28+"
prerequisites:
  - "Kubernetes cluster with multi-GPU nodes"
  - "NVIDIA GPU Operator installed"
  - "Model that requires more than one GPU (e.g., 70B+ parameters)"
  - "NVLink or high-bandwidth GPU interconnect recommended"
relatedRecipes:
  - "deploy-mistral-vllm-kubernetes"
  - "deploy-mistral-nvidia-nim"
  - "nvidia-gpu-operator-install"
  - "kai-scheduler-topology-aware"
tags:
  - multi-gpu
  - tensor-parallelism
  - pipeline-parallelism
  - llm
  - inference
  - gpu
  - ai-workloads
  - scaling
publishDate: "2026-02-16"
author: "Luca Berton"
---

> 💡 **Quick Answer:** Set `--tensor-parallel-size N` in vLLM (or `NIM_TP_SIZE=N` for NIM) where N matches the GPU count. Request `nvidia.com/gpu: N` in the pod spec. vLLM automatically shards model layers across GPUs. A 70B model at bf16 needs 4× A100-40GB or 2× A100-80GB. Ensure GPUs are on the same node with NVLink for best performance.

# Multi-GPU and Tensor Parallel LLM Inference on Kubernetes

Models larger than ~15B parameters typically exceed single-GPU memory. Tensor parallelism splits the model across multiple GPUs so they work together on each request.

## When You Need Multi-GPU

| Model | Parameters | bf16 Memory | GPUs Needed (A100-80GB) |
|---|---|---|---|
| Mistral-7B | 7B | ~14 GB | 1 |
| Llama-2-13B | 13B | ~26 GB | 1 |
| Llama-2-70B | 70B | ~140 GB | 2 |
| Mixtral-8x7B | 46.7B | ~90 GB | 2 |
| Llama-3-405B | 405B | ~810 GB | 8+ |

## Parallelism Strategies

### Tensor Parallelism (TP)

Splits each layer across GPUs. All GPUs process every request together.

```text
GPU 0: Layer 1 (half) + Layer 2 (half) + ... + Layer N (half)
GPU 1: Layer 1 (half) + Layer 2 (half) + ... + Layer N (half)
```

- Best for: low-latency single-request inference
- Requires: GPUs on same node with NVLink
- Set with: `--tensor-parallel-size`

### Pipeline Parallelism (PP)

Assigns different layers to different GPUs. Requests flow through GPUs sequentially.

```text
GPU 0: Layers 1-16
GPU 1: Layers 17-32
```

- Best for: spreading across nodes or non-NVLink setups
- Higher latency per request but more flexible
- Set with: `--pipeline-parallel-size`

## vLLM Multi-GPU Deployment

```yaml
# llama-70b-multi-gpu.yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: llama-70b
  namespace: ai-inference
spec:
  replicas: 1
  selector:
    matchLabels:
      app: llama-70b
  template:
    metadata:
      labels:
        app: llama-70b
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
            - /data/Llama-2-70B-hf
            - --dtype
            - bfloat16
            - --tensor-parallel-size
            - "2"                    # Split across 2 GPUs
            - --max-model-len
            - "4096"
          ports:
            - containerPort: 8000
          env:
            - name: HF_HUB_OFFLINE
              value: "1"
            - name: TRANSFORMERS_OFFLINE
              value: "1"
            - name: NCCL_DEBUG
              value: "WARN"          # Set to INFO for debugging
          resources:
            limits:
              nvidia.com/gpu: "2"    # Must match tensor-parallel-size
            requests:
              nvidia.com/gpu: "2"
          volumeMounts:
            - name: model-data
              mountPath: /data
              readOnly: true
            - name: shm
              mountPath: /dev/shm
      volumes:
        - name: model-data
          persistentVolumeClaim:
            claimName: model-storage-pvc
        - name: shm
          emptyDir:
            medium: Memory
            sizeLimit: 16Gi        # Shared memory for NCCL
---
apiVersion: v1
kind: Service
metadata:
  name: llama-70b
  namespace: ai-inference
spec:
  selector:
    app: llama-70b
  ports:
    - port: 8000
      targetPort: 8000
```

### Critical: Shared Memory

Multi-GPU inference uses NCCL for GPU-to-GPU communication. NCCL requires shared memory (`/dev/shm`):

```yaml
volumes:
  - name: shm
    emptyDir:
      medium: Memory
      sizeLimit: 16Gi    # At least 1 GB, 16 GB recommended for large models
```

Without this, you get:

```text
NCCL WARN: Failed to open shared memory
```

## NIM Multi-GPU Deployment

For NVIDIA NIM, set tensor parallelism via environment variable:

```yaml
env:
  - name: NIM_MODEL_NAME
    value: "/data/Llama-2-70B-hf/"
  - name: NIM_SERVED_MODEL_NAME
    value: "Llama-2-70B"
  - name: NIM_TP_SIZE
    value: "2"
resources:
  limits:
    nvidia.com/gpu: "2"
```

## Topology-Aware Scheduling

For best multi-GPU performance, schedule pods on nodes where GPUs are connected via NVLink:

```yaml
# Node affinity for NVLink nodes
spec:
  affinity:
    nodeAffinity:
      requiredDuringSchedulingIgnoredDuringExecution:
        nodeSelectorTerms:
          - matchExpressions:
              - key: nvidia.com/gpu.count
                operator: Gte
                values: ["2"]
              - key: nvidia.com/gpu.product
                operator: In
                values:
                  - NVIDIA-A100-SXM4-80GB
                  - NVIDIA-H100-SXM5-80GB
```

If using KAI Scheduler, it can automatically detect and prefer NVLink topologies. See [KAI Scheduler Topology-Aware Placement](/recipes/ai/kai-scheduler-topology-aware/).

## Verify Multi-GPU Setup

```bash
# Check pod has multiple GPUs
kubectl exec -it <pod> -n ai-inference -- nvidia-smi

# Should show 2+ GPUs listed

# Verify NCCL connectivity
kubectl logs <pod> -n ai-inference | grep -i "nccl\|parallel"

# Look for successful initialization:
# "Initializing tensor parallel group with size 2"
# "NCCL version: ..."

# Test inference
curl -k -X POST https://<endpoint>/v1/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "/data/Llama-2-70B-hf",
    "prompt": "Hello from multi-GPU inference:",
    "max_tokens": 32
  }'
```

## TP Size Selection Guide

| Model Size | A100-40GB | A100-80GB | H100-80GB |
|---|---|---|---|
| 7B (bf16) | TP=1 | TP=1 | TP=1 |
| 13B (bf16) | TP=1 | TP=1 | TP=1 |
| 34B (bf16) | TP=2 | TP=1 | TP=1 |
| 70B (bf16) | TP=4 | TP=2 | TP=2 |
| 70B (AWQ 4-bit) | TP=2 | TP=1 | TP=1 |
| 405B (bf16) | TP=8+ | TP=8 | TP=8 |

**Rule of thumb:** `TP = ceil(model_bf16_GB / single_GPU_VRAM × 1.2)`

The 1.2× factor accounts for KV cache and activation memory.

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `NCCL error: unhandled system error` | Missing `/dev/shm` mount | Add emptyDir with `medium: Memory` |
| Slow multi-GPU inference | PCIe instead of NVLink | Use SXM GPUs or NVSwitch topology |
| `CUDA error: out of memory` | TP size too small | Increase `--tensor-parallel-size` |
| Pod pending | Not enough GPUs on one node | Check node GPU count; use PP for cross-node |
| Hangs on startup | NCCL port blocked | Ensure pod-to-pod communication is allowed |

## Related Recipes

- [Deploy Mistral with vLLM](/recipes/ai/deploy-mistral-vllm-kubernetes/)
- [Deploy Mistral with NVIDIA NIM](/recipes/ai/deploy-mistral-nvidia-nim/)
- [Install NVIDIA GPU Operator](/recipes/ai/nvidia-gpu-operator-install/)
- [KAI Scheduler Topology-Aware Placement](/recipes/ai/kai-scheduler-topology-aware/)
