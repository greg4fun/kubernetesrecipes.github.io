---
title: "DGX H100 nvidia-smi topo -m Guide"
description: "Read nvidia-smi topo -m output on DGX H100 systems. Understand NVLink, NVSwitch, PCIe topology, GPU-to-GPU bandwidth, and NUMA affinity for Kubernetes."
publishDate: "2026-05-02"
author: "Luca Berton"
category: "ai"
difficulty: "advanced"
timeToComplete: "15 minutes"
kubernetesVersion: "1.28+"
tags:
  - "nvidia"
  - "dgx"
  - "h100"
  - "topology"
  - "nvlink"
  - "gpu"
relatedRecipes:
  - "nvidia-smi-kubernetes-monitoring"
  - "nvidia-h300-gpu-kubernetes"
  - "nccl-environment-variables-guide"
---

> 💡 **Quick Answer:** Run `nvidia-smi topo -m` on a DGX H100 to see the GPU interconnect topology matrix. NVLink connections show `NV18` (18 NVLinks = full NVSwitch bandwidth ~900 GB/s bidirectional), PCIe shows `PIX`/`PXB`/`PHB`, and `SYS` means cross-NUMA. For Kubernetes, this topology determines GPU scheduling — always co-locate tensor-parallel GPUs on the same NVSwitch domain.

## The Problem

Multi-GPU workloads perform differently depending on GPU placement:

- 2 GPUs connected via NVLink: ~900 GB/s bandwidth
- 2 GPUs on same PCIe switch: ~64 GB/s
- 2 GPUs across NUMA nodes: ~32 GB/s + latency penalty

Understanding `nvidia-smi topo -m` output is essential for optimal GPU scheduling.

## The Solution

### Read the Topology Matrix

```bash
# Run on any GPU node
nvidia-smi topo -m
```

**DGX H100 (8× H100 SXM) output:**

```
        GPU0  GPU1  GPU2  GPU3  GPU4  GPU5  GPU6  GPU7  CPU Affinity  NUMA
GPU0     X    NV18  NV18  NV18  NV18  NV18  NV18  NV18  0-51         0
GPU1    NV18   X    NV18  NV18  NV18  NV18  NV18  NV18  0-51         0
GPU2    NV18  NV18   X    NV18  NV18  NV18  NV18  NV18  0-51         0
GPU3    NV18  NV18  NV18   X    NV18  NV18  NV18  NV18  0-51         0
GPU4    NV18  NV18  NV18  NV18   X    NV18  NV18  NV18  52-103       1
GPU5    NV18  NV18  NV18  NV18  NV18   X    NV18  NV18  52-103       1
GPU6    NV18  NV18  NV18  NV18  NV18  NV18   X    NV18  52-103       1
GPU7    NV18  NV18  NV18  NV18  NV18  NV18  NV18   X    52-103       1

Legend:
  NV#  = Connected via # NVLinks
  PIX  = Same PCIe switch
  PXB  = PCIe switches connected via same host bridge
  PHB  = Across host bridges (same NUMA)
  SYS  = Cross-NUMA socket (QPI/UPI)
  NODE = Same NUMA node
```

In a DGX H100, all 8 GPUs are fully connected via NVSwitch (NV18 = 18 NVLinks each), giving ~900 GB/s bidirectional bandwidth between any GPU pair.

### Topology Connection Types

| Code | Meaning | Bandwidth | Latency |
|------|---------|-----------|---------|
| **NV18** | 18 NVLinks (NVSwitch) | ~900 GB/s | ~1 μs |
| **NV12** | 12 NVLinks | ~600 GB/s | ~1 μs |
| **NV4** | 4 NVLinks (A100 peer) | ~200 GB/s | ~2 μs |
| **PIX** | Same PCIe switch | ~64 GB/s (Gen5) | ~5 μs |
| **PXB** | Same host bridge | ~32 GB/s | ~10 μs |
| **PHB** | Same NUMA, different bridge | ~32 GB/s | ~15 μs |
| **SYS** | Cross-NUMA (QPI/UPI) | ~25 GB/s | ~20 μs |

### DGX H100 vs A100 Topology

```bash
# DGX A100 (8× A100 SXM) — NVSwitch v2
#   GPU0-GPU3: NV12 (within baseboard)
#   GPU0-GPU4: NV12 (across baseboards via NVSwitch)
#   All-to-all: NV12

# DGX H100 (8× H100 SXM) — NVSwitch v3
#   All-to-all: NV18 (full NVSwitch bandwidth)
#   Each GPU: 18 NVLinks × 50 GB/s = 900 GB/s per GPU

# HGX B200 (8× B200) — NVSwitch v4
#   All-to-all: NV72 (NVLink 5)
#   Each GPU: 1.8 TB/s per GPU
```

### Check GPU-NIC Affinity (RDMA)

```bash
# Critical for multi-node training — GPU and NIC should be on same NUMA
nvidia-smi topo -m | grep -E "GPU|mlx"

# Check NIC NUMA affinity
cat /sys/class/infiniband/mlx5_0/device/numa_node
# 0  → NIC is on NUMA 0

# GPUs on NUMA 0: GPU0-GPU3
# GPUs on NUMA 1: GPU4-GPU7
# Best: GPU0 → mlx5_0, GPU4 → mlx5_1 (same NUMA as NIC)
```

### Kubernetes Topology-Aware Scheduling

```yaml
# GPU Operator with topology-aware scheduling
apiVersion: v1
kind: Pod
metadata:
  name: multi-gpu-training
spec:
  containers:
  - name: trainer
    image: nvcr.io/nvidia/pytorch:24.07-py3
    resources:
      limits:
        nvidia.com/gpu: 4    # Request 4 GPUs
    env:
    - name: CUDA_VISIBLE_DEVICES
      value: "0,1,2,3"       # Same NUMA group
    - name: NCCL_SOCKET_IFNAME
      value: "eth0"
    - name: NCCL_DEBUG
      value: "INFO"          # Shows which transport NCCL picks
```

```bash
# NCCL will log the transport used:
# NCCL INFO Channel 00/02 : 0[0] -> 1[1] via NVLink/NVSwitch
# If you see "via NET" instead, GPUs aren't on NVSwitch — check topo!
```

### Verify NVLink Bandwidth

```bash
# Run NCCL allreduce benchmark on DGX H100
kubectl exec -it gpu-pod -- \
  /usr/bin/all_reduce_perf -b 8 -e 1G -f 2 -g 8

# Expected DGX H100 (8× H100, NVSwitch):
# size(B)   busbw(GB/s)
# 1048576   280
# 67108864  430
# 1073741824  450   ← Peak ~450 GB/s bus bandwidth

# If busbw < 200 GB/s, NVLink is not being used — check topology
```

## Common Issues

**NCCL falling back to PCIe/NET despite NVLink**

`NCCL_P2P_DISABLE=1` or `NCCL_P2P_LEVEL` set too restrictively. Remove these env vars to let NCCL auto-detect NVLink.

**Cross-NUMA GPU scheduling hurts performance**

Request GPUs in multiples matching NUMA groups (4 GPUs per NUMA on DGX). Or use topology-aware scheduler (GPU Operator + NUMA-aware scheduling).

**"topo -m" shows SYS between GPU and NIC**

GPU and NIC on different NUMA nodes. Set `NCCL_NET_GDR_LEVEL=SYS` to allow GPUDirect RDMA across NUMA, or pin workloads to correct NUMA.

## Best Practices

- **Always check `nvidia-smi topo -m`** before running multi-GPU workloads
- **Co-locate tensor-parallel GPUs** on same NVSwitch domain
- **Match GPU-NIC NUMA affinity** for GPUDirect RDMA
- **Use NCCL_DEBUG=INFO** to verify NVLink is actually being used
- **Request GPUs in NUMA-aligned groups** (4 per NUMA on DGX H100)

## Key Takeaways

- `nvidia-smi topo -m` shows GPU interconnect topology: NVLink, PCIe, NUMA
- DGX H100: NV18 = 18 NVLinks per GPU pair via NVSwitch (~900 GB/s)
- GPU-NIC NUMA affinity is critical for multi-node training performance
- NCCL auto-detects topology but verify with NCCL_DEBUG=INFO logs
- Always schedule multi-GPU workloads within the same NUMA domain
