---
title: "NVLink Bridge Architecture for GPU Kubernetes Nodes"
description: "Understand NVLink Bridge logical architecture in GPU servers for Kubernetes. Dual-socket PCIe Gen5 topology, NVL4 groups, GPU-NIC-NVMe placement, PCIe switch hierarchy, and implications for NCCL collective operations and workload scheduling."
tags:
  - "nvlink"
  - "gpu-architecture"
  - "pcie"
  - "nvidia"
  - "hpc"
category: "ai"
publishDate: "2026-06-04"
author: "Luca Berton"
difficulty: "advanced"
relatedRecipes:
  - "nvidia-gpu-topology-matrix-kubernetes"
  - "nccl-pxn-cross-nic-nvlink-kubernetes"
  - "dual-fabric-mellanox-gpu-ib-storage-ethernet-kubernetes"
---

> 💡 **Quick Answer:** NVLink Bridge connects groups of 4 GPUs (NVL4) with high-bandwidth NVLink for direct GPU-to-GPU communication bypassing PCIe. In a typical 8-GPU dual-socket server: CPU → PCIe Gen5 x16 → PCIe Switch → GPUs + NICs. Each CPU socket owns 4 GPUs + 2 NICs in two NVL4 groups. NVLink provides 900 GB/s (H100) between grouped GPUs vs ~64 GB/s for PCIe Gen5 — making NVLink group sizing critical for distributed training performance.

## The Problem

- Multi-GPU training performance varies wildly depending on which GPUs are assigned
- Cross-socket GPU communication is 10x slower than intra-NVLink-group
- Need to understand the physical topology to properly size GPU requests
- NIC placement relative to GPUs matters for GPUDirect RDMA performance
- PCIe switch hierarchy creates bandwidth bottlenecks if not understood

## The Solution

### NVLink Bridge Logical Architecture

```text
┌──────────────────────────────────────────────────────────────────────────────────────┐
│                          DUAL-SOCKET GPU SERVER (8x GPU)                              │
├──────────────────────────────────────┬───────────────────────────────────────────────┤
│           SOCKET 0 (NUMA 0)          │            SOCKET 1 (NUMA 1)                  │
│                                      │                                               │
│         ┌──────────────────┐         │         ┌──────────────────┐                  │
│         │   System Memory  │         │         │   System Memory  │                  │
│         └────────┬─────────┘         │         └────────┬─────────┘                  │
│                  │                   │                   │                            │
│            ┌─────┴─────┐             │            ┌─────┴─────┐                      │
│            │    CPU 0   │◄──── QPI/UPI ────►      │    CPU 1   │                      │
│            └──┬──────┬──┘             │           └──┬──────┬──┘                      │
│          Gen5 │      │ Gen5           │         Gen5 │      │ Gen5                    │
│          x16  │      │ x16            │         x16  │      │ x16                     │
│    ┌──────────┴──┐ ┌─┴──────────┐    │    ┌─────────┴──┐ ┌─┴──────────┐             │
│    │ PCIe Switch │ │ PCIe Switch │    │    │ PCIe Switch │ │ PCIe Switch │             │
│    └┬──┬──┬──┬──┬┘ └┬──┬──┬──┬──┘    │    └┬──┬──┬──┬──┘ └┬──┬──┬──┬──┬┘            │
│     │  │  │  │  │    │  │  │  │  │    │     │  │  │  │      │  │  │  │  │             │
│   Gen5 Gen5 Gen5     Gen5 Gen5 Gen5   │   Gen5 Gen5 Gen5   Gen5 Gen5 Gen5            │
│   x16  x16  x16     x16  x16  x16    │   x16  x16  x16   x16  x16  x16             │
│     │  │  │  │  │    │  │  │  │  │    │     │  │  │  │      │  │  │  │  │             │
│   ┌─┐┌─┐┌─┐┌─┐┌─┐ ┌─┐┌─┐┌─┐┌─┐     │   ┌─┐┌─┐┌─┐┌─┐   ┌─┐┌─┐┌─┐┌─┐┌─┐          │
│   │N││G││G││G││G││N│                  │   │N││G││G││G││G││N│                          │
│   │I││P││P││P││P││I│                  │   │I││P││P││P││P││I│                          │
│   │C││U││U││U││U││C│                  │   │C││U││U││U││U││C│                          │
│   │0││0││1││2││3││1│                  │   │2││4││5││6││7││3│                          │
│   └─┘└┬┘└┬┘└┬┘└┬┘└─┘                 │   └─┘└┬┘└┬┘└┬┘└┬┘└─┘                         │
│        └──┴──┴──┘                     │        └──┴──┴──┘                             │
│         NVL4 Group 0                  │         NVL4 Group 1                          │
│     (900 GB/s per direction)          │     (900 GB/s per direction)                  │
│                                       │                                               │
│  ┌───┐                                │                                  ┌───┐        │
│  │NVMe│ ← Gen4 x4                    │                      Gen4 x4 → │NVMe│        │
│  └───┘                                │                                  └───┘        │
└──────────────────────────────────────┴───────────────────────────────────────────────┘

Bandwidth comparison:
  NVLink (NVL4, H100): 900 GB/s bidirectional
  PCIe Gen5 x16:       ~64 GB/s bidirectional  
  QPI/UPI (cross-socket): ~40 GB/s
  
  NVLink is 14x faster than PCIe for GPU-to-GPU!
```

### Bandwidth Hierarchy

```text
Connection Path                    │ Bandwidth        │ Use Case
───────────────────────────────────┼──────────────────┼─────────────────────────
GPU↔GPU (NVLink, same NVL4 group) │ 900 GB/s (H100)  │ Tensor parallelism
                                   │ 600 GB/s (A100)  │ All-reduce within node
───────────────────────────────────┼──────────────────┼─────────────────────────
GPU↔GPU (PCIe, cross NVL4 group)  │ ~64 GB/s Gen5    │ Avoid if possible
                                   │ ~32 GB/s Gen4    │ (14x slower than NVLink)
───────────────────────────────────┼──────────────────┼─────────────────────────
GPU↔NIC (GPUDirect RDMA, PIX)     │ ~50 GB/s (400G)  │ Cross-node all-reduce
                                   │ ~25 GB/s (200G)  │ Data parallel gradient sync
───────────────────────────────────┼──────────────────┼─────────────────────────
GPU↔CPU Memory (PCIe)             │ ~64 GB/s Gen5    │ Data loading, preprocessing
───────────────────────────────────┼──────────────────┼─────────────────────────
CPU↔CPU (QPI/UPI)                 │ ~40 GB/s         │ Cross-socket access
───────────────────────────────────┴──────────────────┴─────────────────────────
```

### Kubernetes Scheduling Implications

```yaml
# CORRECT: Request 4 GPUs (fills one NVL4 group)
apiVersion: apps/v1
kind: Deployment
metadata:
  name: tensor-parallel-inference
spec:
  template:
    spec:
      containers:
        - name: vllm
          resources:
            limits:
              nvidia.com/gpu: 4    # One full NVL4 group
          env:
            - name: NCCL_P2P_LEVEL
              value: "NVL"
            # All 4 GPUs communicate at 900 GB/s via NVLink
```

```yaml
# SUBOPTIMAL: Request 5 GPUs (splits across NVL4 groups)
# Result: 4 GPUs at NVLink speed + 1 GPU at PCIe speed (14x slower)
# The 5th GPU becomes a bottleneck for all-reduce operations
spec:
  containers:
    - name: training
      resources:
        limits:
          nvidia.com/gpu: 5    # Avoid — crosses NVL4 boundary
```

### Optimal GPU Request Sizes

```text
NVL4 Architecture (4 GPUs per NVLink group):
  ✅ Request 1 GPU  — single GPU workload
  ✅ Request 2 GPUs — same NVL4 group (if topology-aware scheduler)
  ✅ Request 4 GPUs — full NVL4 group (optimal for TP=4)
  ✅ Request 8 GPUs — full node (both NVL4 groups, cross-socket via PXN)
  ❌ Request 3 GPUs — wastes 1 NVLink slot
  ❌ Request 5 GPUs — one GPU on wrong socket
  ❌ Request 6 GPUs — 4+2 split, 2 GPUs slower

NVL8 Architecture (8 GPUs fully NVLink-connected, e.g., DGX H100):
  ✅ Request 1, 2, 4, or 8 GPUs
  ❌ Request 3, 5, 6, 7 — partial NVLink utilization
```

### NIC Placement and GPUDirect RDMA

```text
Each PCIe switch hosts:
  - 4 GPUs (NVL4 group)
  - 1-2 NICs (ConnectX-7 / BlueField-3)
  - Each NIC is "PIX" to its co-located GPUs

For GPUDirect RDMA:
  GPU0 ←PIX→ NIC0: Data flows GPU → PCIe switch → NIC (single hop)
  GPU0 ←SYS→ NIC3: Data flows GPU → PCIe switch → CPU0 → QPI → CPU1 → PCIe switch → NIC
                    (4 hops, 2x latency, reduced throughput)

NCCL automatically selects the nearest NIC when NCCL_TOPO_DUMP_FILE is set.
Force with: NCCL_IB_HCA=mlx5_0:1,mlx5_1:1  (only local NICs)
```

### NVMe Placement

```text
NVMe drives connect via Gen4 x4 to the outermost PCIe switch port:
  - One NVMe per socket (or shared)
  - Used for checkpoint storage, dataset caching
  - Gen4 x4 = ~8 GB/s (sufficient for checkpoint writes)
  - Ensure checkpoint writes go to NUMA-local NVMe
```

### Cross-Node Communication (NCCL PXN)

```text
For 2+ node training with NVL4 architecture:

Without PXN:
  GPU0 (Node A) → NIC0 (Node A) → Network → NIC0 (Node B) → GPU0 (Node B)
  Only 1 NIC per direction (bottleneck: 50 GB/s)

With NCCL PXN (Proxy via NVLink):
  GPU0 (Node A) → NVLink → GPU1 (Node A) → NIC1 (Node A) → Network
  GPU0 (Node A) → NVLink → GPU2 (Node A) → NIC2 (Node A) → Network
  Multiple NICs saturated simultaneously via NVLink proxying!
  Effective: 4x NIC bandwidth = 200 GB/s cross-node

Enable: NCCL_PXN_DISABLE=0 (enabled by default on modern NCCL)
```

## Common Issues

### Training slower with 8 GPUs than expected vs 4 GPUs
- **Cause**: 8 GPUs span two NVL4 groups; cross-group communication via PCIe/SYS
- **Fix**: Use PXN for inter-group; or accept ~80% scaling for 8 GPU vs 4 GPU jobs

### GPUDirect RDMA throughput lower than expected
- **Cause**: NIC on wrong socket (SYS path to GPU instead of PIX)
- **Fix**: Pin NCCL to PIX-local NICs: `NCCL_IB_HCA` with only socket-local interfaces

### NCCL reporting "Using PCIe" instead of "NVLink"
- **Cause**: GPUs from different NVL4 groups assigned; or NVLink disabled
- **Fix**: Request GPUs in NVL4-aligned quantities; check `nvidia-smi nvlink --status`

### vLLM tensor parallelism slow at TP=8
- **Cause**: TP=8 spans both sockets — half the all-reduce traffic goes over PCIe
- **Fix**: Use TP=4 (one NVL4 group) + PP=2; or accept cross-socket penalty on NVL4 systems

## Best Practices

1. **Align GPU requests to NVL group size** — 4 for NVL4, 8 for DGX/NVL8
2. **Use topology-aware scheduling** — Run:ai, Volcano, or NVIDIA DRA plugin
3. **Pin NICs to GPU groups** — ensures GPUDirect RDMA uses shortest PCIe path
4. **Set `NCCL_TOPO_DUMP_FILE`** — lets NCCL auto-optimize ring/tree algorithms
5. **Enable PXN for cross-node** — multiplies effective network bandwidth via NVLink proxy
6. **TP within NVLink group, DP across nodes** — minimize cross-socket traffic
7. **Benchmark before production** — `all_reduce_perf` from nccl-tests validates topology

## Key Takeaways

- NVLink Bridge connects 4 GPUs (NVL4) at 900 GB/s — 14x faster than PCIe Gen5
- Dual-socket = two independent NVL4 groups; cross-group = PCIe/QPI bottleneck
- Architecture: CPU → Gen5 x16 → PCIe Switch → (GPUs + NICs); NVLink between GPUs
- Request GPUs in NVL4-aligned quantities (1, 2, 4, or 8 — never 3, 5, 6)
- NIC-GPU PIX locality critical for GPUDirect RDMA — same PCIe switch = best
- PXN proxies traffic through NVLink to saturate multiple NICs simultaneously
- NVMe on Gen4 x4 for checkpoint/data — sufficient throughput for storage operations
