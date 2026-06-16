---
title: "H200 NVL 8-GPU Topology Bandwidth Tiers for Kubernetes"
description: "Map the three bandwidth tiers of 8× H200 NVL GPU nodes—NVLink (~337 GB/s), PCIe+UPI (~50 GB/s), RoCE (~35 GB/s)—for NCCL topology-aware NUMA scheduling."
tags:
  - "gpu"
  - "nccl"
  - "performance"
  - "networking"
  - "architecture"
category: "ai"
publishDate: "2026-06-08"
author: "Luca Berton"
difficulty: "advanced"
relatedRecipes:
  - "nccl-gdr-level-tuning-pix-pxb-phb-sys"
  - "nccl-all-reduce-perf-benchmark-multi-node"
  - "nccl-network-validator-production-mpijob"
---

> 💡 **Quick Answer:** An 8× H200 NVL node has three distinct bandwidth tiers: (1) NVLink within each 4-GPU NVL4 bridge domain at ~337 GB/s, (2) PCIe Gen5 x16 + UPI cross-socket between the two 4-GPU halves at ~50 GB/s, and (3) RoCE 400G inter-node at ~35 GB/s. The two NVLink domains are NOT connected — cross-socket traffic uses PCIe/UPI, which is 7× slower than NVLink. NUMA-aware scheduling is critical to avoid the PCIe/UPI bottleneck.

## The Problem

- 8-GPU H200 NVL nodes use NVL4 bridges (4-way NVLink) — NOT NVSwitch
- The two 4-GPU halves are on separate NUMA zones with no NVLink connection
- Cross-socket GPU communication falls from 337 GB/s to 50 GB/s (7× penalty)
- Default Kubernetes schedulers (including Run:ai) are not NUMA-aware for GPU+NIC placement
- Inter-node RoCE bandwidth (~35 GB/s) is actually close to cross-socket bandwidth

## The Solution

### Node Topology: Dual-Socket 8× H200 NVL

```text
┌─────────────────────────────────────────────────────────────────────┐
│                     Dual-Socket GPU Node                             │
│                                                                     │
│  NUMA Zone 0                    UPI              NUMA Zone 1        │
│  ┌──────────────────────┐   ◄──────►   ┌──────────────────────┐    │
│  │       CPU 0          │   (~50 GB/s)  │       CPU 1          │    │
│  │                      │               │                      │    │
│  │  PCIe Switch ×2      │               │  PCIe Switch ×2      │    │
│  │  (Gen5 x16)          │               │  (Gen5 x16)          │    │
│  │                      │               │                      │    │
│  │  ┌────────────────┐  │               │  ┌────────────────┐  │    │
│  │  │ NVL4 Bridge    │  │               │  │ NVL4 Bridge    │  │    │
│  │  │                │  │               │  │                │  │    │
│  │  │ GPU0 GPU1      │  │               │  │ GPU4 GPU5      │  │    │
│  │  │ GPU2 GPU3      │  │               │  │ GPU6 GPU7      │  │    │
│  │  │  (~337 GB/s)   │  │               │  │  (~337 GB/s)   │  │    │
│  │  └────────────────┘  │               │  └────────────────┘  │    │
│  │                      │               │                      │    │
│  │  NIC 400G (mlx5_0)  │               │  NIC 400G (mlx5_1)  │    │
│  └──────────────────────┘               └──────────────────────┘    │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘

Bandwidth Tiers:
  ① NVLink intra-domain (4 GPU):  ~337 GB/s  (full P2P within NVL4)
  ② PCIe Gen5 + UPI cross-domain: ~50 GB/s   (two halves NOT NVLink-connected)
  ③ RoCE 400G inter-node:         ~35 GB/s   (GPU/NIC on cross-NUMA zone)
```

### Bandwidth Tier Comparison

```text
Path                        │ Technology      │ Bandwidth │ Latency │ Notes
────────────────────────────┼─────────────────┼───────────┼─────────┼──────────────
GPU0 ↔ GPU1 (same NVL4)    │ NVLink 4        │ ~337 GB/s │ ~1 μs   │ Full mesh P2P
GPU0 ↔ GPU2 (same NVL4)    │ NVLink 4        │ ~337 GB/s │ ~1 μs   │ Full mesh P2P
GPU0 ↔ GPU4 (cross-socket) │ PCIe Gen5 + UPI │ ~50 GB/s  │ ~5 μs   │ 7× slower than NVL
GPU0 ↔ Remote GPU (RoCE)   │ 400G RoCE       │ ~35 GB/s  │ ~10 μs  │ Inter-node RDMA
────────────────────────────┴─────────────────┴───────────┴─────────┴──────────────

Key insight: Cross-socket (~50 GB/s) is only 1.4× faster than inter-node (~35 GB/s)
→ For communication-heavy workloads, treating cross-socket as "slow" is valid
→ Optimal placement keeps tensor parallelism WITHIN one NVL4 domain
```

### NVL4 Bridge vs NVSwitch

```text
Architecture        │ GPU Connectivity        │ Intra-node BW │ Typical Systems
────────────────────┼─────────────────────────┼───────────────┼────────────────
NVL4 Bridge (this)  │ 4 GPUs fully connected  │ 337 GB/s ×2   │ Dell XE7740, etc.
                    │ Two separate 4-GPU groups│ (within each) │ 
NVSwitch (DGX)      │ All 8 GPUs fully meshed │ 900 GB/s      │ DGX H100/H200
                    │ via NVSwitch fabric     │ (all-to-all)  │
────────────────────┴─────────────────────────┴───────────────┴────────────────

NVL4 tradeoff: cheaper, fewer components, but creates the cross-socket bottleneck.
DGX NVSwitch: all 8 GPUs at full NVLink speed, no NUMA penalty for GPU-GPU traffic.
```

### NCCL Topology Impact

```text
# nvidia-smi topo -m on 8× H200 NVL (NVL4 bridge):

        GPU0  GPU1  GPU2  GPU3  GPU4  GPU5  GPU6  GPU7
GPU0     X    NV4   NV4   NV4   SYS   SYS   SYS   SYS
GPU1    NV4    X    NV4   NV4   SYS   SYS   SYS   SYS
GPU2    NV4   NV4    X    NV4   SYS   SYS   SYS   SYS
GPU3    NV4   NV4   NV4    X    SYS   SYS   SYS   SYS
GPU4    SYS   SYS   SYS   SYS    X    NV4   NV4   NV4
GPU5    SYS   SYS   SYS   SYS   NV4    X    NV4   NV4
GPU6    SYS   SYS   SYS   SYS   NV4   NV4    X    NV4
GPU7    SYS   SYS   SYS   SYS   NV4   NV4   NV4    X

NV4 = NVLink 4 (intra-domain, ~337 GB/s)
SYS = Cross-socket via UPI (~50 GB/s, NO NVLink path)

# NCCL builds rings that cross the SYS boundary — this is the bottleneck
```

### Scheduling Strategies

```yaml
# Strategy 1: Keep tensor parallelism within 4 GPUs (NVL4 domain)
# Best for: inference, small models that fit in 4 GPUs
env:
  - name: CUDA_VISIBLE_DEVICES
    value: "0,1,2,3"        # Stay within NUMA Zone 0 NVL4

# Strategy 2: Use all 8 GPUs but accept cross-socket penalty
# Best for: large models requiring >4 GPUs per node
# NCCL will use NVLink for intra-domain, PCIe/UPI for cross-domain
env:
  - name: NCCL_NVLS_ENABLE
    value: "0"              # Disable NVLink SHARP (no NVSwitch)

# Strategy 3: Prefer inter-node over cross-socket
# For 2-node jobs needing 8 GPUs total: use 4+4 (one NVL4 per node)
# Instead of 8 GPUs on one node with cross-socket penalty
resources:
  limits:
    nvidia.com/gpu: 4       # Half the node, all within one NVL4
```

### NUMA-Aware NIC Placement

```text
Critical: Each 400G NIC is attached to ONE NUMA zone.

  NIC (mlx5_0) → NUMA Zone 0 → PCIe Switch → GPU 0,1,2,3
  NIC (mlx5_1) → NUMA Zone 1 → PCIe Switch → GPU 4,5,6,7

For inter-node RDMA (RoCE):
  GPU 0 → mlx5_0: PIX/PXB distance → GPUDirect RDMA ✓ (~35 GB/s)
  GPU 0 → mlx5_1: SYS distance    → Cross-socket DMA (extra UPI hop)
  GPU 4 → mlx5_1: PIX/PXB distance → GPUDirect RDMA ✓ (~35 GB/s)
  GPU 4 → mlx5_0: SYS distance    → Cross-socket DMA (extra UPI hop)

Problem: OpenShift/Run:ai cannot guarantee GPU-NIC NUMA affinity.
The SR-IOV VF allocated to a pod may be from the "wrong" NIC.

Mitigation: NCCL_NET_GDR_LEVEL=SYS allows all pairs, but cross-socket
GPUDirect adds latency. Topology-aware VF allocation is the real fix.
```

### NCCL Ring Algorithm on NVL4 Topology

```text
# NCCL builds channels (rings/trees) that account for topology:

# Optimal ring for 8 GPUs across 2 NVL4 domains:
Ring: 0→1→2→3→[UPI]→4→5→6→7→[RoCE]→(next node)→[RoCE]→0

# The UPI crossing happens once per ring traversal
# Minimizing cross-domain hops is NCCL's graph search goal

# NCCL tuning for NVL4 topology:
env:
  - name: NCCL_MIN_NCHANNELS
    value: "4"
  - name: NCCL_MAX_NCHANNELS
    value: "16"
  # More channels = more parallelism, amortizes UPI latency
```

### Benchmark Expected Results

```text
Test Configuration           │ Expected busbw │ Bottleneck
─────────────────────────────┼────────────────┼─────────────────────
4 GPU intra-NVL4 (same node) │ ~300-337 GB/s  │ NVLink bandwidth
8 GPU single node (all GPUs)  │ ~50 GB/s       │ UPI cross-socket
4+4 GPU (2 nodes, NVL4 each) │ ~35 GB/s       │ RoCE 400G
8+8 GPU (2 nodes, all GPUs)  │ ~35 GB/s       │ RoCE (UPI hidden in pipeline)
─────────────────────────────┴────────────────┴─────────────────────

Key takeaway: For 8-GPU all_reduce on NVL4 nodes, the UPI bottleneck
dominates. Single-node 8-GPU is only ~50 GB/s, while cross-node is ~35 GB/s.
The incremental penalty of going multi-node is small (~30% less than cross-socket).
```

### Implications for Model Parallelism

```text
Parallelism Strategy          │ Optimal Placement on NVL4 Nodes
──────────────────────────────┼─────────────────────────────────────────
Tensor Parallelism (TP=4)     │ Within ONE NVL4 domain (GPU 0-3 or 4-7)
Tensor Parallelism (TP=8)     │ Full node — accepts UPI penalty
Pipeline Parallelism (PP)     │ Across nodes — uses RoCE, less BW-sensitive
Data Parallelism (DP)         │ Across nodes — gradient allreduce over RoCE
TP=4 + PP=2                   │ TP within NVL4, PP across nodes ← OPTIMAL
TP=4 + DP=N                   │ TP within NVL4, DP across all nodes
──────────────────────────────┴─────────────────────────────────────────

Rule: Keep TP within NVLink domain. Use PP/DP for cross-socket and inter-node.
```

## Common Issues

### All_reduce busbw only ~50 GB/s with 8 GPUs on one node
- **Cause**: UPI cross-socket bottleneck between NVL4 domains (expected)
- **Fix**: Not fixable on NVL4 hardware. Use TP=4 within domain, or accept penalty.

### Inter-node worse than expected (~20 GB/s instead of ~35 GB/s)
- **Cause**: GPU and NIC on different NUMA zones (cross-socket GPUDirect)
- **Fix**: Ensure `NCCL_NET_GDR_LEVEL=SYS` and check GPU-NIC affinity

### NCCL hangs during 8-GPU ring formation
- **Cause**: SYS-level P2P disabled by kernel (IOMMU restriction)
- **Fix**: Verify `iommu=pt` in kernel args; check `nvidia-smi topo -p2p`

### Scheduler places 4 GPUs from each NUMA zone
- **Cause**: GPU device plugin doesn't respect NUMA topology by default
- **Fix**: Enable topology manager in kubelet: `topologyManagerPolicy: best-effort`

## Best Practices

1. **Keep tensor parallelism ≤ 4** on NVL4 nodes — stay within one NVLink domain
2. **Use pipeline parallelism** for cross-socket and cross-node — less BW-sensitive
3. **Size NIC per NUMA zone** — one 400G NIC per CPU socket for locality
4. **Measure all three tiers** — validate NVLink, UPI, and RoCE independently
5. **Consider 2-node 4+4** over single-node 8 GPU — only 30% less BW, double memory
6. **Set `NCCL_NET_GDR_LEVEL=SYS`** — even cross-socket RDMA is better than CPU bounce
7. **Enable topology manager** in kubelet for NUMA-aware GPU+NIC placement

## Key Takeaways

- NVL4 bridge creates TWO separate 4-GPU NVLink domains — not one 8-GPU mesh
- Cross-socket (UPI) is 7× slower than intra-NVLink: 50 vs 337 GB/s
- Inter-node RoCE (~35 GB/s) is surprisingly close to cross-socket (~50 GB/s)
- Optimal strategy: TP=4 within NVL4, PP/DP for anything beyond
- NUMA-aware scheduling is critical but NOT default in OpenShift/Run:ai
- For models needing >4 GPUs: compare 8-GPU-single-node vs 2×4-GPU-multi-node
- NVSwitch systems (DGX) eliminate this problem — all 8 GPUs at ~900 GB/s
