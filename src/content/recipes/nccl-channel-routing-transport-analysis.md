---
title: "NCCL Channel Routing and Transport Path Analysis"
description: "Interpret NCCL channel logs to understand GPU communication paths on Kubernetes. Decode P2P/CUMEM, SHM/direct, NET/IB/GDRDMA transport"
tags:
  - "nccl"
  - "debugging"
  - "gpu-communication"
  - "rdma"
  - "distributed-training"
category: "ai"
publishDate: "2026-06-04"
author: "Luca Berton"
difficulty: "advanced"
relatedRecipes:
  - "nccl-all-reduce-perf-benchmark-multi-node"
  - "nvidia-gpu-topology-matrix-kubernetes"
---

> 💡 **Quick Answer:** NCCL INFO channel logs show exactly how each GPU communicates with its peers. `P2P/CUMEM` = NVLink direct (fastest, intra-node), `SHM/direct/direct` = shared host memory (cross-NVLink-group on same node), `NET/IB/X(Y)/GDRDMA` = network RDMA with GPUDirect (inter-node). Each channel maps source rank → destination rank with the transport used. Verify all inter-node channels show `/GDRDMA` suffix for optimal performance.

## The Problem

- Need to verify NCCL is using the optimal transport path for each GPU pair
- Can't tell if GPUDirect RDMA is actually engaged or falling back to host staging
- Distributed training is slow — need to identify which GPU-to-GPU links are bottlenecked
- Unknown which NICs are handling inter-node traffic for each GPU rank
- Proxy threads may be misaligned with GPU NUMA nodes

## The Solution

### Channel Log Format

```text
NCCL INFO Channel <chan_id>/<subchan> : <src_rank>[<local_dev>] -> <dst_rank>[<local_dev>] [<direction>] via <transport>
```

### Intra-Node Transports

```text
# P2P/CUMEM — NVLink peer-to-peer via CUDA Unified Memory
Channel 00/0 : 2[2] -> 1[1] via P2P/CUMEM
Channel 01/0 : 2[2] -> 1[1] via P2P/CUMEM
...
Channel 09/0 : 2[2] -> 1[1] via P2P/CUMEM
  └── Rank 2 (GPU 2) → Rank 1 (GPU 1) on same node
  └── P2P/CUMEM = NVLink direct GPU memory access
  └── 10 channels (00-09) = parallel communication paths
  └── This is the FASTEST intra-node transport

# SHM/direct/direct — Shared host memory (NVLink not available between these GPUs)
Channel 07 : 4[4] -> 2[2] via SHM/direct/direct
Channel 08 : 4[4] -> 2[2] via SHM/direct/direct
  └── GPU 4 → GPU 2 = cross-NVLink-group (different NVL4 domains)
  └── SHM = traffic goes GPU → host memory → GPU (PCIe path)
  └── Slower than P2P/CUMEM but still intra-node
  └── "direct/direct" means both sides use direct GPU memory access to SHM
```

### Inter-Node Transports

```text
# NET/IB/X(Y)/GDRDMA — Network with GPUDirect RDMA
Channel 00/0 : 0[0] -> 8[0] [send] via NET/IB/2(3)/GDRDMA
Channel 01/0 : 0[0] -> 8[0] [send] via NET/IB/2(3)/GDRDMA
Channel 02/0 : 0[0] -> 8[0] [send] via NET/IB/0/GDRDMA
Channel 03/0 : 0[0] -> 8[0] [send] via NET/IB/0/GDRDMA
Channel 04/0 : 0[0] -> 8[0] [send] via NET/IB/0/GDRDMA
Channel 05/0 : 0[0] -> 8[0] [send] via NET/IB/2(3)/GDRDMA
Channel 06/0 : 0[0] -> 8[0] [send] via NET/IB/2(3)/GDRDMA
Channel 07/0 : 0[0] -> 8[0] [send] via NET/IB/0/GDRDMA
Channel 08/0 : 0[0] -> 8[0] [send] via NET/IB/0/GDRDMA
Channel 09/0 : 0[0] -> 8[0] [send] via NET/IB/0/GDRDMA

Breakdown:
  0[0] → 8[0]:  Rank 0 (local GPU 0) → Rank 8 (remote GPU 0 on node 2)
  [send]:       This is the send direction
  NET/IB:       Using InfiniBand/RoCE network transport
  /2(3):        Using NIC index 2, port 3
  /0:           Using NIC index 0 (port default)
  /GDRDMA:      GPUDirect RDMA ACTIVE — GPU memory → NIC → wire directly
                (no CPU staging = optimal)
```

### Transport WITHOUT GDRDMA (Degraded)

```text
# If you see this — GDRDMA is NOT working:
Channel 00/0 : 0[0] -> 8[0] [send] via NET/IB/0
  └── No /GDRDMA suffix = data goes GPU → CPU memory → NIC (extra copy!)
  └── Expect 30-50% bandwidth loss vs GDRDMA

Causes:
  - nvidia-peermem module not loaded
  - DMA-BUF not available for this GPU
  - NCCL_NET_GDR_LEVEL=0 or unset
  - NIC not PIX-local to GPU (falls back if topology too distant)
```

### NIC Distribution Across Channels

```text
From the logs, NCCL distributes channels across available NICs:

Channels 00,01,05,06 → NET/IB/2(3) (NIC index 2, port 3)
Channels 02,03,04,07,08,09 → NET/IB/0 (NIC index 0)

Ideal: even distribution across all NICs for maximum aggregate bandwidth.
If one NIC handles too many channels → bottleneck on that NIC.

Fix: ensure NCCL_IB_HCA lists all available NICs:
  NCCL_IB_HCA=mlx5_0,mlx5_3,mlx5_5,mlx5_6
```

### Proxy Progress Thread

```text
NCCL INFO [Proxy Progress] Device 3 CPU core 289
  └── Network proxy thread for GPU 3 is pinned to CPU core 289
  └── Should be on the same NUMA node as GPU 3
  └── If on wrong NUMA: increased latency for network operations

Verify NUMA alignment:
  GPU 3 on NUMA 0 → core 289 should be on NUMA 0
  Check: cat /sys/devices/system/cpu/cpu289/topology/physical_package_id
```

### Network Plugin Assignment

```text
NCCL INFO Assigned NET plugin IB to comm
  └── IB (InfiniBand) network plugin handles data transfer

NCCL INFO Assigned GIN plugin GIN_IB_GDAKT to comm
  └── GIN = GPU-Initiated Networking
  └── GIN_IB_GDAKT = GPU initiates DMA transfer directly via IB

NCCL INFO Assigned RMA plugin GIN_IB_PROXY to comm
  └── RMA = Remote Memory Access
  └── GIN_IB_PROXY = GPU-initiated with proxy assistance for complex operations

NCCL INFO Using network IB
  └── Confirms IB/RoCE is the active network stack
```

### Full Channel Map Visualization

```text
2-Node, 8 GPUs/node, 16 total ranks:

Node 1 (Ranks 0-7):          Node 2 (Ranks 8-15):
┌─────────────────────┐      ┌─────────────────────┐
│ GPU0(R0) ──NVL── GPU1(R1)│      │ GPU0(R8) ──NVL── GPU1(R9) │
│ GPU2(R2) ──NVL── GPU3(R3)│      │ GPU2(R10)──NVL── GPU3(R11)│
│   │ NVL4 Group 0    │      │   │ NVL4 Group 0    │
│ GPU4(R4) ──NVL── GPU5(R5)│      │ GPU4(R12)──NVL── GPU5(R13)│
│ GPU6(R6) ──NVL── GPU7(R7)│      │ GPU6(R14)──NVL── GPU7(R15)│
│   │ NVL4 Group 1    │      │   │ NVL4 Group 1    │
└─────────┬───────────┘      └─────────┬───────────┘
          │                             │
     NIC0,NIC1,NIC2,NIC3          NIC0,NIC1,NIC2,NIC3
          │         RoCE/IB RDMA        │
          └─────────────────────────────┘

Intra-node paths (P2P/CUMEM):
  R0↔R1, R0↔R2, R0↔R3 (same NVL4)
  R4↔R5, R4↔R6, R4↔R7 (same NVL4)

Cross-NVL4 paths (SHM/direct):
  R0↔R4, R1↔R5, R2↔R6, R3↔R7 (different NVL4 groups, same node)

Inter-node paths (NET/IB/GDRDMA):
  R0↔R8, R1↔R9, ... (all cross-node pairs)
```

### Troubleshooting Channel Output

```bash
# Enable verbose channel info
export NCCL_DEBUG=INFO
export NCCL_DEBUG_SUBSYS=INIT,NET,GRAPH

# In logs, look for:
# 1. All inter-node channels should show /GDRDMA
grep "via NET" nccl.log | grep -v GDRDMA
# If any results → those channels lack GPUDirect RDMA

# 2. NIC distribution should be balanced
grep "via NET" nccl.log | grep -oP 'NET/IB/\d+' | sort | uniq -c
#   5 NET/IB/0
#   5 NET/IB/2
# Balanced = good. All on one NIC = bottleneck.

# 3. Verify all GPUs use P2P for intra-node
grep "via P2P" nccl.log | wc -l
# Should be (ranks_per_node - 1) × channels × 2 (send+recv)
```

## Common Issues

### Some channels show NET/IB without /GDRDMA
- **Cause**: nvidia-peermem not loaded; or NIC too far from GPU (SYS topology)
- **Fix**: `modprobe nvidia-peermem`; verify `cat /sys/module/nvidia_peermem/version`; use PIX-local NICs

### All channels use same NIC (unbalanced)
- **Cause**: `NCCL_IB_HCA` not set or lists only one NIC
- **Fix**: Set `NCCL_IB_HCA=mlx5_0,mlx5_3,mlx5_5,mlx5_6` (all fabric NICs)

### SHM/direct paths where P2P/CUMEM expected
- **Cause**: GPUs not in same NVLink group; or CUDA P2P access not enabled
- **Fix**: Check `nvidia-smi topo -m` — SHM is correct for cross-NVL4 GPUs. P2P/CUMEM only between NVLink-connected GPUs

### Proxy thread on wrong NUMA node
- **Cause**: Default proxy thread placement doesn't consider GPU locality
- **Fix**: Set `NCCL_PROXY_AFFINITY=1` (NCCL 2.21+); or pin manually with taskset

## Best Practices

1. **Every inter-node channel should show `/GDRDMA`** — if not, fix nvidia-peermem
2. **Balance NIC usage across channels** — set `NCCL_IB_HCA` with all fabric NICs
3. **P2P/CUMEM within NVL group, SHM across groups** — this is correct behavior
4. **Pin proxy threads to GPU-local NUMA** — reduces network operation latency
5. **Use `NCCL_DEBUG=INFO`** to capture channel map at initialization
6. **More channels = more parallelism** — increase `NCCL_MAX_NCHANNELS` if NICs underutilized
7. **Monitor per-NIC bandwidth** — ensure no single NIC is saturated

## Key Takeaways

- NCCL channel logs reveal exact transport path between every GPU pair
- **P2P/CUMEM**: NVLink direct — fastest intra-node (same NVL group)
- **SHM/direct/direct**: host memory relay — cross-NVL4 groups on same node
- **NET/IB/X(Y)/GDRDMA**: network RDMA with GPUDirect — optimal inter-node
- Missing `/GDRDMA` suffix = degraded path (30-50% bandwidth loss)
- NIC index in `NET/IB/2(3)` maps to physical mlx5 devices — verify balance
- Proxy Progress shows CPU core for network proxy — should be NUMA-aligned with GPU
- GIN (GPU-Initiated Networking) + RMA plugins = latest NCCL optimization stack
