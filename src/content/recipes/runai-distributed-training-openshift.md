---
title: "Run:ai Distributed PyTorch Training on OpenShift"
description: "Submit multi-node distributed PyTorch training jobs on OpenShift using Run:ai CLI. Covers DDP, FSDP, RDMA networking, and GPU scheduling."
tags:
  - "runai"
  - "openshift"
  - "distributed"
  - "training"
  - "pytorch"
category: "ai"
publishDate: "2026-05-05"
author: "Luca Berton"
difficulty: "advanced"
relatedRecipes:
  - "multi-node-training-kubernetes"
  - "fsdp-lora-finetuning-kubernetes"
  - "kubernetes-1-36-gang-scheduling"
  - "validate-gpu-topology-nccl"
  - "ray-data-pytorch-cpu-thread-oversubscription"
---

> 💡 **Quick Answer:** Run:ai provides a CLI (`runai training pytorch submit`) to launch distributed PyTorch jobs on OpenShift with automatic rank assignment, RDMA networking, and GPU scheduling. It handles `MASTER_ADDR`, `MASTER_PORT`, and `RANK` injection automatically.

## The Problem

Launching distributed training on OpenShift manually requires:

- Creating headless Services for worker discovery
- Managing environment variables (RANK, MASTER_ADDR, MASTER_PORT) per Pod
- Configuring SR-IOV / Mellanox RDMA network attachments
- Handling security contexts (non-root UID/GID for OpenShift SCC)
- Coordinating shared storage mounts across workers

Run:ai abstracts all of this into a single CLI command.

## The Solution

### Submit a Multi-Node DDP Job

```bash
runai training pytorch submit retinanet-ddp \
  --image registry.example.com/training/pytorch:24.12 \
  --annotation "k8s.v1.cni.cncf.io/networks=sriov-rdma" \
  --extended-resource "openshift.io/mellanoxnics=1" \
  --gpu-devices-request 1 \
  --workers 2 \
  --large-shm \
  --cpu-core-request 16 \
  --cpu-memory-request 2560 \
  --cpu-memory-limit 8896 \
  --run-as-uid 2000 \
  --run-as-gid 2000 \
  --environment-variable NCCL_DEBUG="INFO" \
  --environment-variable NCCL_SOCKET_IFNAME="net1" \
  --environment-variable NCCL_IB_QPS_PER_CONNECTION=1 \
  --environment-variable NCCL_IB_SPLIT_DATA_ON_QPS=1 \
  --environment-variable NCCL_SOCKET_NTHREADS=2 \
  --environment-variable NCCL_NSOCKS_PERTHREAD=2 \
  --environment-variable CUDA_VISIBLE_DEVICES=0 \
  --environment-variable RDMAV_FORK_SAFE=1 \
  --environment-variable PYTORCH_CUDA_ALLOC_CONF=expandable_segments:True \
  --existing-pvc claimname=project-data,path=/data \
  --command -- /data/scripts/train/shell/retinanet-ddp.sh
```

### Submit an FSDP Fine-Tuning Job

```bash
runai training pytorch submit mistral-finetune-fsdp \
  --image registry.example.com/training/pytorch:24.12 \
  --annotation "k8s.v1.cni.cncf.io/networks=sriov-rdma" \
  --extended-resource "openshift.io/mellanoxnics=1" \
  --large-shm \
  --workers 2 \
  --gpu-devices-request 1 \
  --cpu-memory-request 3846 \
  --cpu-memory-limit 8996 \
  --run-as-uid 2000 \
  --run-as-gid 2000 \
  --working-dir /data/scripts/llm/finetune-peft \
  --environment-variable PYTORCH_CUDA_ALLOC_CONF=expandable_segments:True \
  --environment-variable NCCL_DEBUG="INFO" \
  --environment-variable NCCL_IB_QPS_PER_CONNECTION=1 \
  --environment-variable NCCL_IB_SPLIT_DATA_ON_QPS=1 \
  --environment-variable NCCL_SOCKET_NTHREADS=2 \
  --environment-variable NCCL_NSOCKS_PERTHREAD=2 \
  --environment-variable NCCL_SOCKET_IFNAME="net1" \
  --environment-variable CUDA_VISIBLE_DEVICES=0 \
  --environment-variable RDMAV_FORK_SAFE=1 \
  --existing-pvc claimname=project-data,path=/data \
  --command -- /data/scripts/llm/shell/accelerate-peft-fsdp.sh
```

### What Run:ai Injects Automatically

Run:ai sets these environment variables in each worker Pod:

```bash
RANK=0          # Worker index (0, 1, 2, ...)
MASTER_ADDR=... # IP/hostname of rank 0
MASTER_PORT=... # Port for rendezvous (default 29500)
```

Your training script uses them directly:

```bash
#!/bin/bash
set -euo pipefail

echo "rank = $RANK"
echo "master addr = $MASTER_ADDR"
echo "master port = $MASTER_PORT"

export RDMAV_FORK_SAFE=1

torchrun --nnodes=2 --nproc_per_node=1 --node_rank=${RANK} \
         --master_addr=${MASTER_ADDR} --master_port=${MASTER_PORT} \
         train.py \
         --batch-size 16 \
         --accum-steps 1 \
         --image-size 800 \
         --max-train 200 \
         --backend cpu \
         --num-workers 8 \
         --epochs 2
```

### NCCL Environment Explained

| Variable | Value | Purpose |
|----------|-------|---------|
| `NCCL_SOCKET_IFNAME` | `net1` | Use SR-IOV RDMA interface (not default eth0) |
| `NCCL_IB_QPS_PER_CONNECTION` | `1` | QP count per IB connection |
| `NCCL_IB_SPLIT_DATA_ON_QPS` | `1` | Distribute data across QPs |
| `NCCL_SOCKET_NTHREADS` | `2` | Socket threads for fallback |
| `NCCL_NSOCKS_PERTHREAD` | `2` | Sockets per thread |
| `RDMAV_FORK_SAFE` | `1` | Safe RDMA after fork() |
| `CUDA_VISIBLE_DEVICES` | `0` | Restrict to single GPU per worker |
| `PYTORCH_CUDA_ALLOC_CONF` | `expandable_segments:True` | Reduce memory fragmentation |

### Check Job Status

```bash
# View job status
runai training standard describe ${JOB_NAME}

# Get logs
runai training standard logs ${JOB_NAME} -f

# Shell into a running worker
runai training standard exec ${JOB_NAME} --pod ${JOB_NAME}-worker-0 -- /bin/bash

# Delete job
runai training standard delete ${JOB_NAME}
```

### SR-IOV / Mellanox RDMA on OpenShift

The `--annotation` and `--extended-resource` flags configure RDMA:

```bash
# Network attachment: SR-IOV interface for RDMA
--annotation "k8s.v1.cni.cncf.io/networks=sriov-rdma"

# Request one Mellanox NIC VF (Virtual Function)
--extended-resource "openshift.io/mellanoxnics=1"
```

This gives each Pod a dedicated RDMA-capable network interface (`net1`) for NCCL communication at full InfiniBand/RoCE bandwidth.

### Security: Non-Root Execution

OpenShift requires non-root by default. Run:ai supports this:

```bash
--run-as-uid 2000
--run-as-gid 2000
```

Ensures Pods comply with OpenShift Security Context Constraints (SCC) without needing `privileged` or `anyuid`.

## Common Issues

### NCCL can't find RDMA interface
- **Cause**: `NCCL_SOCKET_IFNAME` doesn't match the SR-IOV interface name
- **Fix**: Check interface name inside Pod: `ip addr | grep net` — it's usually `net1`

### Job stuck in Pending
- **Cause**: Not enough GPUs or SR-IOV VFs available
- **Fix**: Check Run:ai dashboard for resource availability; reduce `--workers`

### Authentication failed for git pull
- **Cause**: Token expired for internal Git repos
- **Fix**: Refresh Git credentials in the mounted secret or config

### OOM on large model loading
- **Cause**: All ranks trying to load full model weights simultaneously
- **Fix**: Use `fsdp_cpu_ram_efficient_loading` (only rank 0 loads, broadcasts to others)

## Best Practices

1. **Use `--large-shm`** — enables large `/dev/shm` for NCCL shared memory
2. **Set `RDMAV_FORK_SAFE=1`** — prevents RDMA issues after Python multiprocessing fork
3. **Use `PYTORCH_CUDA_ALLOC_CONF=expandable_segments:True`** — reduces OOM from fragmentation
4. **Pin to `net1` interface** — SR-IOV interface for RDMA, not default Pod network
5. **Non-root UIDs** — always set `--run-as-uid/gid` for OpenShift SCC compliance
6. **Mount persistent storage** — use `--existing-pvc` for datasets, checkpoints, and scripts

## Key Takeaways

- Run:ai CLI automates distributed PyTorch job submission on OpenShift
- Automatically injects `RANK`, `MASTER_ADDR`, `MASTER_PORT` per worker
- SR-IOV RDMA networking via annotations + extended resources
- `--large-shm` + NCCL tuning essential for multi-node GPU training
- Non-root execution with `--run-as-uid/gid` for OpenShift SCC compliance
