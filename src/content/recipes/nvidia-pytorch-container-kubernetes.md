---
title: "NVIDIA PyTorch Container on Kubernetes"
description: "Deploy nvcr.io/nvidia/pytorch containers on Kubernetes for GPU training. Version selection, CUDA compatibility, multi-node DDP, and NCCL configuration."
publishDate: "2026-05-02"
author: "Luca Berton"
category: "ai"
difficulty: "intermediate"
timeToComplete: "15 minutes"
kubernetesVersion: "1.28+"
tags:
  - "nvidia"
  - "pytorch"
  - "gpu"
  - "training"
  - "nccl"
  - "containers"
relatedRecipes:
  - "multi-gpu-pytorch-ddp-kubernetes"
  - "deepspeed-kubernetes-distributed"
  - "nccl-environment-variables-guide"
  - "dgx-h100-nvidia-smi-topo-kubernetes"
---

> 💡 **Quick Answer:** Use `nvcr.io/nvidia/pytorch:24.07-py3` (or latest monthly tag) for GPU training on Kubernetes. The NVIDIA PyTorch containers include pre-built CUDA, cuDNN, NCCL, and PyTorch — everything needed for single and multi-node GPU training. Request GPU resources (`nvidia.com/gpu: 1`), mount shared storage for datasets, and set NCCL environment variables for multi-node communication.

## The Problem

Building PyTorch containers for GPU training is complex:

- CUDA, cuDNN, NCCL version compatibility matrix
- GPU driver compatibility with container CUDA version
- Multi-node training requires specific NCCL and network config
- Building from source takes hours and often fails

## The Solution

### NVIDIA PyTorch Container Versions

```bash
# Container naming: nvcr.io/nvidia/pytorch:YY.MM-py3
# YY.MM = year.month release cycle

# Popular versions:
# 24.07-py3  → CUDA 12.5, PyTorch 2.4, NCCL 2.22
# 24.10-py3  → CUDA 12.6, PyTorch 2.5, NCCL 2.23
# 25.01-py3  → CUDA 12.7, PyTorch 2.6, NCCL 2.25
# 25.04-py3  → CUDA 12.8, PyTorch 2.7, NCCL 2.26
# 25.11-py3  → CUDA 13.0, PyTorch 2.8, NCCL 2.28 (latest reference)

# Check available tags
curl -s "https://nvcr.io/v2/nvidia/pytorch/tags/list" | jq '.tags[-10:]'
```

### Single GPU Training Job

```yaml
apiVersion: batch/v1
kind: Job
metadata:
  name: pytorch-training
spec:
  template:
    spec:
      containers:
      - name: trainer
        image: nvcr.io/nvidia/pytorch:24.07-py3
        command:
        - python
        - /workspace/train.py
        - --epochs=10
        - --batch-size=64
        resources:
          limits:
            nvidia.com/gpu: 1
          requests:
            cpu: "4"
            memory: 16Gi
        volumeMounts:
        - name: dataset
          mountPath: /data
        - name: scripts
          mountPath: /workspace
      volumes:
      - name: dataset
        persistentVolumeClaim:
          claimName: training-data
      - name: scripts
        configMap:
          name: training-scripts
      restartPolicy: Never
  backoffLimit: 2
```

### Multi-GPU Single Node (DataParallel)

```yaml
apiVersion: batch/v1
kind: Job
metadata:
  name: multi-gpu-training
spec:
  template:
    spec:
      containers:
      - name: trainer
        image: nvcr.io/nvidia/pytorch:24.07-py3
        command:
        - torchrun
        - --nproc_per_node=4
        - /workspace/train_ddp.py
        resources:
          limits:
            nvidia.com/gpu: 4       # All 4 GPUs on one node
          requests:
            cpu: "16"
            memory: 64Gi
        env:
        - name: NCCL_DEBUG
          value: "INFO"
        volumeMounts:
        - name: dataset
          mountPath: /data
        - name: shm
          mountPath: /dev/shm
      volumes:
      - name: dataset
        persistentVolumeClaim:
          claimName: training-data
      - name: shm
        emptyDir:
          medium: Memory
          sizeLimit: 16Gi          # Shared memory for NCCL
      restartPolicy: Never
```

### Multi-Node DDP Training

```yaml
apiVersion: kubeflow.org/v1
kind: PyTorchJob
metadata:
  name: distributed-training
spec:
  pytorchReplicaSpecs:
    Master:
      replicas: 1
      template:
        spec:
          containers:
          - name: pytorch
            image: nvcr.io/nvidia/pytorch:24.07-py3
            command:
            - torchrun
            - --nnodes=4
            - --nproc_per_node=8
            - --rdzv_backend=c10d
            - --rdzv_endpoint=$(MASTER_ADDR):29500
            - /workspace/train_ddp.py
            resources:
              limits:
                nvidia.com/gpu: 8
            env:
            - name: NCCL_IB_DISABLE
              value: "0"           # Enable InfiniBand
            - name: NCCL_SOCKET_IFNAME
              value: "eth0"
            - name: NCCL_DEBUG
              value: "WARN"
            volumeMounts:
            - name: shm
              mountPath: /dev/shm
          volumes:
          - name: shm
            emptyDir:
              medium: Memory
              sizeLimit: 32Gi
    Worker:
      replicas: 3
      template:
        spec:
          containers:
          - name: pytorch
            image: nvcr.io/nvidia/pytorch:24.07-py3
            # Same config as Master
```

### Container Contents Reference

| Component | 24.07-py3 | 25.01-py3 | 25.11-py3 |
|-----------|-----------|-----------|-----------|
| CUDA | 12.5 | 12.7 | 13.0 |
| cuDNN | 9.2 | 9.5 | 9.8 |
| NCCL | 2.22.3 | 2.25.1 | 2.28.8 |
| PyTorch | 2.4.0 | 2.6.0 | 2.8.0 |
| Python | 3.10 | 3.10 | 3.12 |
| MOFED | 5.4 | 5.4 | 5.4 |
| GDRCopy | 2.4 | 2.4.1 | 2.5.1 |
| OS | Ubuntu 22.04 | Ubuntu 22.04 | Ubuntu 24.04 |

### GPU Driver Compatibility

```bash
# Check minimum driver version for container CUDA version
# CUDA 12.5 → Driver ≥ 555.42
# CUDA 12.6 → Driver ≥ 560.28
# CUDA 12.7 → Driver ≥ 565.57
# CUDA 13.0 → Driver ≥ 570.86

# Check node driver version
kubectl get nodes -o jsonpath='{range .items[*]}{.metadata.name}: {.status.nodeInfo.containerRuntimeVersion}{"\n"}{end}'

# Inside pod
nvidia-smi --query-gpu=driver_version --format=csv,noheader
```

## Common Issues

**"CUDA error: no kernel image is available for execution on the device"**

GPU architecture mismatch. The container's PyTorch was compiled for specific GPU architectures. H100 needs recent containers (24.01+), older GPUs like V100 are widely supported.

**Shared memory errors (`RuntimeError: DataLoader worker... killed`)**

Default `/dev/shm` is 64MB. Mount an emptyDir with `medium: Memory` and `sizeLimit: 16Gi+`.

**NCCL timeout in multi-node**

Network interface selection wrong. Set `NCCL_SOCKET_IFNAME` to your pod network interface (usually `eth0`) and check firewall rules for NCCL ports.

## Best Practices

- **Pin container version** — use `24.07-py3` not `latest`
- **Always mount `/dev/shm`** — PyTorch DataLoader needs large shared memory
- **Match driver version** — check CUDA→driver compatibility matrix
- **Set `NCCL_DEBUG=INFO`** for initial setup, `WARN` for production
- **Use Kubeflow PyTorchJob** for multi-node — handles `MASTER_ADDR` and coordination

## Key Takeaways

- `nvcr.io/nvidia/pytorch:YY.MM-py3` containers include CUDA, cuDNN, NCCL, and PyTorch pre-built
- Pin versions (e.g., `24.07-py3`) for reproducible training
- Always mount `/dev/shm` as emptyDir Memory for DataLoader workers
- Multi-node requires NCCL env vars (NCCL_SOCKET_IFNAME, NCCL_IB_DISABLE)
- Check GPU driver version compatibility before deploying
