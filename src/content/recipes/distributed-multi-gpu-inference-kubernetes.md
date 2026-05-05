---
title: "Distributed Multi-GPU Inference on Kubernetes"
description: "Deploy distributed inference across multiple GPUs and nodes on Kubernetes. Covers tensor parallelism, pipeline parallelism, vLLM, and NIM multi-GPU serving."
tags:
  - "inference"
  - "multi-gpu"
  - "distributed"
  - "vllm"
  - "nvidia"
category: "ai"
publishDate: "2026-05-05"
author: "Luca Berton"
difficulty: "advanced"
relatedRecipes:
  - "multi-node-training-kubernetes"
  - "deploy-mistral-nvidia-nim"
  - "kubernetes-1-36-dra-gpu-management"
  - "kubernetes-1-36-gang-scheduling"
---

> 💡 **Quick Answer:** Large models (70B+ parameters) don't fit on a single GPU. Use **tensor parallelism** (split layers across GPUs on one node) or **pipeline parallelism** (split model stages across nodes) to serve them. vLLM and NIM handle this natively on Kubernetes.

## The Problem

- **Llama 3.1 405B** needs ~810GB VRAM in FP16 — that's 10+ A100 80GB GPUs
- **Mixtral 8x22B** needs ~176GB — 3 A100 80GB GPUs minimum
- Single-GPU serving has latency and throughput limits even for models that fit
- Multi-node inference adds network overhead — needs high-bandwidth interconnects

## The Solution

### Single-Node Multi-GPU: Tensor Parallelism with vLLM

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: llama-70b-tp8
  namespace: inference
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
          image: vllm/vllm-openai:v0.8.0
          args:
            - --model=meta-llama/Llama-3.1-70B-Instruct
            - --tensor-parallel-size=8
            - --gpu-memory-utilization=0.90
            - --max-model-len=32768
            - --port=8000
          ports:
            - containerPort: 8000
          resources:
            limits:
              nvidia.com/gpu: 8
              memory: 512Gi
            requests:
              nvidia.com/gpu: 8
              memory: 256Gi
          env:
            - name: NCCL_DEBUG
              value: "WARN"
            - name: CUDA_VISIBLE_DEVICES
              value: "0,1,2,3,4,5,6,7"
          volumeMounts:
            - name: model-cache
              mountPath: /root/.cache/huggingface
            - name: shm
              mountPath: /dev/shm
      volumes:
        - name: model-cache
          persistentVolumeClaim:
            claimName: model-storage
        - name: shm
          emptyDir:
            medium: Memory
            sizeLimit: 64Gi
      nodeSelector:
        nvidia.com/gpu.count: "8"
```

### Multi-Node Inference: Pipeline Parallelism with vLLM

```yaml
# Head node (rank 0) — coordinates inference
apiVersion: apps/v1
kind: Deployment
metadata:
  name: llama-405b-head
  namespace: inference
spec:
  replicas: 1
  selector:
    matchLabels:
      app: llama-405b
      role: head
  template:
    metadata:
      labels:
        app: llama-405b
        role: head
    spec:
      containers:
        - name: vllm
          image: vllm/vllm-openai:v0.8.0
          args:
            - --model=meta-llama/Llama-3.1-405B-Instruct
            - --tensor-parallel-size=8
            - --pipeline-parallel-size=2
            - --port=8000
          ports:
            - containerPort: 8000
          resources:
            limits:
              nvidia.com/gpu: 8
          env:
            - name: VLLM_HOST_IP
              valueFrom:
                fieldRef:
                  fieldPath: status.podIP
            - name: NCCL_SOCKET_IFNAME
              value: "eth0"
          volumeMounts:
            - name: shm
              mountPath: /dev/shm
            - name: model-cache
              mountPath: /root/.cache/huggingface
      volumes:
        - name: shm
          emptyDir:
            medium: Memory
            sizeLimit: 64Gi
        - name: model-cache
          persistentVolumeClaim:
            claimName: model-storage-405b
---
# Worker node (rank 1)
apiVersion: apps/v1
kind: Deployment
metadata:
  name: llama-405b-worker
  namespace: inference
spec:
  replicas: 1
  selector:
    matchLabels:
      app: llama-405b
      role: worker
  template:
    metadata:
      labels:
        app: llama-405b
        role: worker
    spec:
      containers:
        - name: vllm-worker
          image: vllm/vllm-openai:v0.8.0
          args:
            - --model=meta-llama/Llama-3.1-405B-Instruct
            - --tensor-parallel-size=8
            - --pipeline-parallel-size=2
          resources:
            limits:
              nvidia.com/gpu: 8
          env:
            - name: VLLM_HOST_IP
              valueFrom:
                fieldRef:
                  fieldPath: status.podIP
            - name: NCCL_SOCKET_IFNAME
              value: "eth0"
          volumeMounts:
            - name: shm
              mountPath: /dev/shm
            - name: model-cache
              mountPath: /root/.cache/huggingface
      volumes:
        - name: shm
          emptyDir:
            medium: Memory
            sizeLimit: 64Gi
        - name: model-cache
          persistentVolumeClaim:
            claimName: model-storage-405b
```

### NIM Multi-GPU Deployment

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: nim-llama-70b
  namespace: inference
spec:
  replicas: 1
  selector:
    matchLabels:
      app: nim-llama-70b
  template:
    metadata:
      labels:
        app: nim-llama-70b
    spec:
      containers:
        - name: nim
          image: nvcr.io/nim/meta/llama-3.1-70b-instruct:1.8.0
          ports:
            - containerPort: 8000
          resources:
            limits:
              nvidia.com/gpu: 8
          env:
            - name: NIM_TENSOR_PARALLEL_SIZE
              value: "8"
            - name: NIM_MAX_MODEL_LEN
              value: "32768"
            - name: NIM_GPU_MEMORY_UTILIZATION
              value: "0.90"
          volumeMounts:
            - name: nim-cache
              mountPath: /opt/nim/.cache
            - name: shm
              mountPath: /dev/shm
      volumes:
        - name: nim-cache
          persistentVolumeClaim:
            claimName: nim-model-cache
        - name: shm
          emptyDir:
            medium: Memory
            sizeLimit: 64Gi
```

### Service and Autoscaling

```yaml
apiVersion: v1
kind: Service
metadata:
  name: inference-api
  namespace: inference
spec:
  selector:
    app: llama-70b
  ports:
    - port: 8000
      targetPort: 8000
  type: ClusterIP
---
apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata:
  name: inference-hpa
  namespace: inference
spec:
  scaleTargetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: llama-70b-tp8
  minReplicas: 1
  maxReplicas: 4
  metrics:
    - type: Pods
      pods:
        metric:
          name: vllm_num_requests_waiting
        target:
          type: AverageValue
          averageValue: "10"
```

### Parallelism Strategy Decision

```text
Model fits on 1 GPU?
  → Single GPU, no parallelism needed

Model fits on 1 node (multiple GPUs)?
  → Tensor Parallelism (TP)
  → tp_size = number of GPUs needed
  → Best performance (NVLink bandwidth)

Model needs multiple nodes?
  → Pipeline Parallelism (PP) across nodes + TP within each node
  → pp_size = number of nodes
  → tp_size = GPUs per node
  → Network becomes bottleneck (use RDMA/InfiniBand)
```

### GPU Memory Calculator

```text
Model VRAM (FP16) ≈ parameters × 2 bytes
Model VRAM (INT8) ≈ parameters × 1 byte
Model VRAM (INT4/GPTQ) ≈ parameters × 0.5 bytes

KV Cache VRAM = batch_size × seq_len × hidden_dim × num_layers × 2 × 2 bytes

Examples:
  7B FP16:  ~14 GB → 1× A100 ✓
  70B FP16: ~140 GB → 2× A100-80GB (TP=2) or 4× A100-40GB (TP=4)
  405B FP16: ~810 GB → 2 nodes × 8× A100-80GB (TP=8, PP=2)
```

## Common Issues

### NCCL timeout during multi-node inference
- **Cause**: Network latency too high or firewall blocking NCCL ports
- **Fix**: Use RDMA/InfiniBand; open ports 29400-29500; set `NCCL_SOCKET_IFNAME`

### OOM with tensor parallelism
- **Cause**: KV cache too large for remaining memory after model sharding
- **Fix**: Reduce `--max-model-len` or increase `--tensor-parallel-size`

### Uneven GPU utilization
- **Cause**: Pipeline parallelism creates bubbles between stages
- **Fix**: Use tensor parallelism when possible; PP is last resort for models too large for one node

## Best Practices

1. **Prefer tensor parallelism** — lower latency than pipeline parallelism
2. **Use NVLink/NVSwitch nodes** — 900 GB/s vs 32 GB/s PCIe for inter-GPU communication
3. **Size `/dev/shm` generously** — NCCL uses shared memory for GPU communication
4. **Pin to topology** — use topology-aware scheduling to keep TP GPUs on same NVLink domain
5. **Quantize first** — INT8/INT4 reduces GPU count needed before resorting to multi-node

## Key Takeaways

- **Tensor parallelism** splits across GPUs on one node (fast, uses NVLink)
- **Pipeline parallelism** splits across nodes (slower, needs network)
- vLLM and NIM handle parallelism natively via `--tensor-parallel-size` and `--pipeline-parallel-size`
- Always try quantization before adding more GPUs
- `/dev/shm` must be large enough for NCCL shared memory buffers
