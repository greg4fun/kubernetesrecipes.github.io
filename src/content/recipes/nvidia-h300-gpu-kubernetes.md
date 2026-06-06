---
title: "NVIDIA H300 GPU Setup on Kubernetes"
description: "Deploy NVIDIA H300 GPUs on Kubernetes. H300 vs H100 vs H200 specs comparison, memory bandwidth, GPU Operator setup, and AI inference optimization."
publishDate: "2026-05-02"
author: "Luca Berton"
category: "ai"
difficulty: "intermediate"
timeToComplete: "15 minutes"
kubernetesVersion: "1.28+"
tags:
  - "nvidia"
  - "gpu"
  - "h300"
  - "h100"
  - "h200"
  - "inference"
relatedRecipes:
  - "nvidia-gpu-operator-troubleshooting"
  - "gpu-feature-discovery-kubernetes"
  - "dgx-h100-nvidia-smi-topo-kubernetes"
---

> 💡 **Quick Answer:** The NVIDIA H300 is a rumored/upcoming GPU in the Hopper family, positioned between H200 and Blackwell B200. Currently, H100 (80GB HBM3, 3.35 TB/s) and H200 (141GB HBM3e, 4.8 TB/s) are the production GPUs for Kubernetes AI workloads. Deploy them with GPU Operator + Node Feature Discovery, request via `nvidia.com/gpu: 1`, and use MIG or time-slicing for multi-tenant sharing.

## The Problem

Choosing the right NVIDIA GPU for Kubernetes AI workloads requires understanding:

- Memory capacity limits (model fits in VRAM?)
- Memory bandwidth (inference tokens/s)
- Interconnect topology (NVLink, NVSwitch for multi-GPU)
- Cost vs performance trade-offs
- Kubernetes scheduling and resource management

## The Solution

### NVIDIA GPU Comparison Matrix

| GPU | Architecture | VRAM | Memory BW | FP16 TFLOPS | NVLink | Use Case |
|-----|-------------|------|-----------|-------------|---------|----------|
| **A100 40GB** | Ampere | 40GB HBM2e | 1.6 TB/s | 312 | 600 GB/s | Training/inference |
| **A100 80GB** | Ampere | 80GB HBM2e | 2.0 TB/s | 312 | 600 GB/s | Large model training |
| **H100 SXM** | Hopper | 80GB HBM3 | 3.35 TB/s | 990 | 900 GB/s | Flagship training |
| **H100 PCIe** | Hopper | 80GB HBM3 | 2.0 TB/s | 756 | 600 GB/s | Inference / edge |
| **H200 SXM** | Hopper | 141GB HBM3e | 4.8 TB/s | 990 | 900 GB/s | Large model inference |
| **B100** | Blackwell | 192GB HBM3e | 8.0 TB/s | 1800 | 1800 GB/s | Next-gen training |
| **B200** | Blackwell | 192GB HBM3e | 8.0 TB/s | 2250 | 1800 GB/s | Flagship next-gen |
| **GB200** | Blackwell | 384GB (2×192) | 16 TB/s | 4500 | NVLink 5 | Superchip |

### Deploy GPUs on Kubernetes

```bash
# 1. Install Node Feature Discovery
helm install nfd nvidia/node-feature-discovery \
  -n gpu-operator --create-namespace

# 2. Install GPU Operator
helm install gpu-operator nvidia/gpu-operator \
  -n gpu-operator \
  --set driver.enabled=true \
  --set toolkit.enabled=true \
  --set devicePlugin.enabled=true \
  --set mig.strategy=single

# 3. Verify GPU nodes
kubectl get nodes -l nvidia.com/gpu.present=true
kubectl describe node gpu-node-1 | grep -A5 "Allocatable:"
#   nvidia.com/gpu: 8
```

### Schedule Pods on Specific GPU Types

```yaml
apiVersion: v1
kind: Pod
metadata:
  name: llm-inference
spec:
  nodeSelector:
    nvidia.com/gpu.product: NVIDIA-H100-SXM5-80GB
  containers:
  - name: inference
    image: nvcr.io/nvidia/pytorch:24.07-py3
    resources:
      limits:
        nvidia.com/gpu: 1
      requests:
        cpu: "4"
        memory: 32Gi
```

```bash
# List available GPU types in cluster
kubectl get nodes -o jsonpath='{range .items[*]}{.metadata.labels.nvidia\.com/gpu\.product}{"\n"}{end}' | sort -u
# NVIDIA-A100-SXM4-80GB
# NVIDIA-H100-SXM5-80GB
# NVIDIA-H200-SXM-141GB
```

### Model-to-GPU Sizing Guide

| Model | Params | FP16 Size | Min GPU | Recommended |
|-------|--------|-----------|---------|-------------|
| Llama 3.1 8B | 8B | ~16GB | 1× A100 40GB | 1× H100 |
| Llama 3.1 70B | 70B | ~140GB | 2× H100 80GB | 2× H200 141GB |
| Llama 3.1 405B | 405B | ~810GB | 8× H200 (TP=8,PP=2) | 8× B200 |
| Mixtral 8×22B | 141B | ~282GB | 4× H100 80GB | 4× H200 |
| GPT-4 class | ~1.8T | ~3.6TB | 64× H100 | 32× B200 |

### Memory Bandwidth Impact on Inference

```
Inference tokens/s ≈ Memory_BW / (2 × Params_in_bytes)

Llama 70B FP16 on different GPUs:
- A100 80GB:  2000 GB/s / (2 × 140GB) = ~7 tok/s per GPU
- H100 SXM:   3350 GB/s / (2 × 140GB) = ~12 tok/s per GPU  
- H200 SXM:   4800 GB/s / (2 × 140GB) = ~17 tok/s per GPU
- B200:       8000 GB/s / (2 × 140GB) = ~29 tok/s per GPU

For batch inference, compute (TFLOPS) becomes the bottleneck instead.
```

### Multi-GPU Tensor Parallelism

```yaml
# Deploy 70B model across 2× H100 with tensor parallelism
apiVersion: apps/v1
kind: Deployment
metadata:
  name: llm-70b
spec:
  replicas: 1
  template:
    spec:
      containers:
      - name: vllm
        image: vllm/vllm-openai:latest
        args:
        - --model=meta-llama/Llama-3.1-70B-Instruct
        - --tensor-parallel-size=2
        - --gpu-memory-utilization=0.95
        resources:
          limits:
            nvidia.com/gpu: 2        # 2 GPUs with NVLink
        ports:
        - containerPort: 8000
```

## Common Issues

**"CUDA out of memory" on model load**

Model doesn't fit in GPU VRAM. Use quantization (INT4/INT8) or increase tensor parallelism across more GPUs.

**NVLink not detected between GPUs**

GPUs must be on the same NVSwitch fabric (SXM form factor). PCIe GPUs use slower PCIe interconnect. Check: `nvidia-smi topo -m`.

**GPU Operator not detecting GPUs**

Check node labels: `kubectl get node <node> -o yaml | grep nvidia`. Ensure GPU drivers match container CUDA version.

## Best Practices

- **H100 SXM for training** — highest compute with NVLink bandwidth
- **H200 for inference** — 141GB VRAM fits larger models without TP
- **Use MIG on H100** for multi-tenant inference workloads
- **Pin GPU type with nodeSelector** — prevent scheduling on wrong GPU
- **Size VRAM for FP16 model + 20% KV cache overhead**

## Key Takeaways

- H100 (80GB, 3.35TB/s) is the current training standard, H200 (141GB, 4.8TB/s) is best for large model inference
- Memory bandwidth determines inference throughput, TFLOPS determines training speed
- Use `nvidia.com/gpu.product` label selector to target specific GPU types
- Model size in FP16 bytes × 1.2 (KV cache) = minimum VRAM needed
- Tensor parallelism across NVLink-connected GPUs for models exceeding single GPU VRAM
