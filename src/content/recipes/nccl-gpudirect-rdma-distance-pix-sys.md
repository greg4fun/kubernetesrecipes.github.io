---
title: "NCCL GPUDirect RDMA Distance Levels and PIX vs SYS"
description: "Understand NCCL GPU Direct RDMA distance-based enablement. When PIX mode disables GDRDMA for distant GPU-HCA pairs (distance 9 > 4) and when SYS mode enables"
tags:
  - "nccl"
  - "gpudirect"
  - "rdma"
  - "topology"
  - "troubleshooting"
category: "ai"
publishDate: "2026-06-04"
author: "Luca Berton"
difficulty: "advanced"
relatedRecipes:
  - "nccl-network-validation-script-openshift"
  - "gpudirect-rdma-setup-verification-kubernetes"
  - "nccl-channel-routing-transport-analysis"
---

> 💡 **Quick Answer:** When `NCCL_NET_GDR_LEVEL=PIX`, NCCL only enables GPUDirect RDMA if the GPU and HCA are within PCIe distance ≤ 4 (same switch). If distance > 4 (e.g., distance 9 = cross-socket), NCCL logs `GPU Direct RDMA Disabled for GPU X / HCA Y (distance 9 > 4)` and falls back to host-staged transfers. Switch to `NCCL_NET_GDR_LEVEL=SYS` to enable GDRDMA regardless of distance — the log then shows `GPU Direct RDMA Enabled for GPU 0 / HCA 0 (distance 4 <= 4), read 0 mode Default`.

## The Problem

- With `NCCL_NET_GDR_LEVEL=PIX`, some GPU-HCA pairs get GDRDMA disabled due to topology distance
- SR-IOV VF assignment is non-deterministic — some ranks get close HCAs, others get far ones
- Need to understand NCCL's distance calculation and when GDRDMA gets disabled vs enabled
- Inconsistent performance across ranks because some use GDRDMA and others fall back

## The Solution

### NCCL Distance Calculation

```text
NCCL measures PCIe topology distance between GPU and HCA:

Distance │ Meaning                          │ Level Name
─────────┼──────────────────────────────────┼───────────
    1    │ Same PCIe switch (PIX)           │ PIX
    2    │ Same PCIe root complex           │ PIX
    3    │ Through PCIe Host Bridge (PHB)   │ PHB
    4    │ Same NUMA node (NODE)            │ NODE
    5    │ Cross-NUMA, same machine         │ SYS
    6-9  │ Further cross-socket paths       │ SYS
─────────┴──────────────────────────────────┴───────────

NCCL_NET_GDR_LEVEL controls the maximum distance threshold:
  PIX  → threshold = 4  (only same NUMA or closer)
  PHB  → threshold = 4  (same as PIX in practice)
  NODE → threshold = 4  (same NUMA node)
  SYS  → threshold = 9+ (always enable, any distance)
```

### Log Output: PIX Mode (Distance Check Fails)

```text
# NCCL_NET_GDR_LEVEL=PIX in mpijob.yaml worker env:
# Line 187-188: NCCL_NET_GDR_LEVEL: "PIX"

# GPU 2 is far from HCA 0 (distance 9 = cross-socket):
NCCL INFO GPU Direct RDMA Disabled for GPU 2 / HCA 0 (distance 9 > 4)

# But GPU 0 is close to HCA 0 (distance 4 = same NUMA):
NCCL INFO GPU Direct RDMA Enabled for GPU 0 / HCA 0 (distance 4 <= 4), read 0 mode Default
NCCL INFO GPU Direct RDMA Enabled for GPU 0 / HCA 0 (distance 4 <= 4), read 1 mode Default

# Result: Mixed — some channels use GDRDMA, others fall back
# Channel 00/0 : 2[0] -> 0[0] [send] via NET/IB/0          ← NO GDRDMA (GPU 2 too far)
# Channel 00/0 : 2[0] -> 0[0] [receive] via NET/IB/0/GDRDMA ← HAS GDRDMA (GPU 0 is close)
```

### Log Output: SYS Mode (Always Enabled)

```text
# NCCL_NET_GDR_LEVEL=SYS (from validate_network.sh):
# All GPU-HCA pairs get GDRDMA regardless of distance:

NCCL INFO GPU Direct RDMA Enabled for GPU 0 / HCA 0 (distance 4 <= 4), read 0 mode Default
NCCL INFO GPU Direct RDMA Enabled for GPU 0 / HCA 0 (distance 4 <= 4), read 1 mode Default
NCCL INFO GPU Direct RDMA Enabled for GPU 2 / HCA 0 (distance 9 <= 9), read 0 mode Default
NCCL INFO GPU Direct RDMA Enabled for GPU 2 / HCA 0 (distance 9 <= 9), read 1 mode Default

# All channels show /GDRDMA:
# Channel 00/0 : 2[0] -> 0[0] [send] via NET/IB/0/GDRDMA
# Channel 00/0 : 2[0] -> 0[0] [receive] via NET/IB/0/GDRDMA
```

### Read Modes in GDRDMA

```text
From logs: "read 0 mode Default" / "read 1 mode Default"

read 0 = GPU reads from NIC buffer (receive path)
read 1 = NIC reads from GPU buffer (send path)
mode Default = using default DMA-BUF or peermem method

Other modes you might see:
  mode Default  — standard nvidia-peermem / DMA-BUF
  mode DMABUF   — explicitly using DMA-BUF interface (kernel 5.12+)
  mode PEERMEM  — using legacy nvidia-peermem interface
```

### Why PIX Disables Some Pairs

```text
In your Dell XE7745 (2-socket, 8 GPUs):

Socket 0 (PCIe domain 0000):
  GPU 0 [0000:18:00] ─┐
  GPU 1 [0000:67:00] ─┤── PCIe Switch A ── HCA 0 (mlx5_0)
  GPU 2 [0000:b2:00] ─┤                    HCA 1 (mlx5_3)
  GPU 3 [0000:d8:00] ─┘

Socket 1 (PCIe domain 0001):
  GPU 4 [0001:18:00] ─┐
  GPU 5 [0001:69:00] ─┤── PCIe Switch B ── HCA 2 (mlx5_5)
  GPU 6 [0001:8f:00] ─┤                    HCA 3 (mlx5_6)
  GPU 7 [0001:b3:00] ─┘

With SR-IOV shared device plugin:
  Pod gets ONE VF — could be from ANY of the 4 PFs (mlx5_0-6)

If pod's GPU is on Socket 1 but VF is from Socket 0 HCA:
  Distance = 9 (cross-socket) → PIX disables GDRDMA!

With NCCL_NET_GDR_LEVEL=SYS:
  Distance = 9 but threshold = 9+ → GDRDMA still enabled
  Performance: slightly worse than PIX-local, but much better than no GDRDMA
```

### Performance Impact

```text
Scenario                              │ Effective Bandwidth │ Latency
──────────────────────────────────────┼─────────────────────┼────────
GDRDMA enabled, PIX-local (dist ≤ 2) │ 48-50 GB/s          │ ~1 µs
GDRDMA enabled, SYS (dist 9)         │ 38-42 GB/s          │ ~3 µs
GDRDMA disabled (host staging)       │ 25-30 GB/s          │ ~8 µs
──────────────────────────────────────┴─────────────────────┴────────

Cross-socket GDRDMA (SYS): ~20% less than PIX-local
No GDRDMA (host staging):  ~40-50% less than PIX-local

Conclusion: SYS mode with cross-socket GDRDMA is ALWAYS better than no GDRDMA.
Use SYS for SR-IOV (non-deterministic placement).
Use PIX only when VF-to-GPU affinity is guaranteed (dedicated NICs, no SR-IOV).
```

### Proxy Progress and Transport Details

```text
From logs:
  NCCL INFO [Proxy Progress] Device 0 CPU core 127
  └── Network proxy thread for GPU 0 pinned to core 127
  └── Should be on same NUMA as GPU 0 for optimal proxy performance

  NCCL INFO New proxy send connection 4 from local rank 0, transport 2
  NCCL INFO New proxy recv connection 2 from local rank 0, transport 2
  └── transport 2 = NET (network)
  └── transport 0 = P2P (NVLink)
  └── transport 1 = SHM (shared memory)

  NCCL INFO Connected to proxy localRank 0 -> connection 0x7fd020000f00
  └── Connection handle allocated for rank 0's proxy thread
```

### Configuration Comparison in mpijob.yaml

```yaml
# Test with PIX (restrictive — disables far GPU-HCA pairs):
env:
  - name: NCCL_IB_DISABLE
    value: "0"
  - name: NCCL_COLLNET_ENABLE
    value: "0"
  - name: NCCL_NET_GDR_LEVEL
    value: "PIX"              # ← Only same-switch GDRDMA
  - name: NCCL_DMABUF_ENABLE
    value: "1"
  - name: NCCL_SHM_DISABLE
    value: "0"

# Test with SYS (permissive — GDRDMA for all pairs):
env:
  - name: NCCL_IB_DISABLE
    value: "0"
  - name: NCCL_COLLNET_ENABLE
    value: "0"
  - name: NCCL_NET_GDR_LEVEL
    value: "SYS"              # ← GDRDMA regardless of distance
  - name: NCCL_DMABUF_ENABLE
    value: "1"
  - name: NCCL_SHM_DISABLE
    value: "0"
```

### Interpreting Mixed GDRDMA Logs

```text
When some pairs are enabled and others disabled (PIX mode):

GPU Direct RDMA Disabled for GPU 2 / HCA 0 (distance 9 > 4)
  └── GPU 2 on socket 1, HCA 0 on socket 0 → too far for PIX

GPU Direct RDMA Enabled for GPU 0 / HCA 0 (distance 4 <= 4), read 0 mode Default
  └── GPU 0 on socket 0, HCA 0 on socket 0 → close enough

This means:
  - Channels FROM GPU 0 → remote: GDRDMA send (fast)
  - Channels TO GPU 0 ← remote: GDRDMA receive (fast)
  - Channels FROM GPU 2 → remote: HOST-STAGED send (slow)
  - Channels TO GPU 2 ← remote: depends on remote GPU's proximity

Result: Bottleneck on the slowest path (GPU 2's host-staged transfers)
Fix: Use NCCL_NET_GDR_LEVEL=SYS
```

## Common Issues

### "GPU Direct RDMA Disabled for GPU X / HCA Y (distance 9 > 4)"
- **Cause**: `NCCL_NET_GDR_LEVEL=PIX` and GPU is on different socket than HCA
- **Fix**: Set `NCCL_NET_GDR_LEVEL=SYS` — enables GDRDMA at any distance

### GDRDMA enabled for some GPUs but not others (inconsistent perf)
- **Cause**: SR-IOV VF from far PF assigned to pod; some GPUs close, others far
- **Fix**: Use SYS level; or implement topology-aware SR-IOV (pin VFs to local GPUs)

### "read 0 mode Default" but bandwidth still low
- **Cause**: Cross-socket GDRDMA is slower than PIX-local (~20% less)
- **Fix**: This is expected. For optimal: ensure VF is from PF on same socket as GPU

### Distance always shows 9 (even for seemingly local pairs)
- **Cause**: SR-IOV VF may report different PCIe topology than parent PF
- **Fix**: Verify with `nvidia-smi topo -m` and `ibdev2netdev` on host (not in pod)

## Best Practices

1. **Use `NCCL_NET_GDR_LEVEL=SYS` for SR-IOV** — consistent GDRDMA for all ranks
2. **Use `NCCL_NET_GDR_LEVEL=PIX` only with dedicated NICs** — when GPU-HCA locality is guaranteed
3. **Check logs for "Disabled" messages** — any disabled pair becomes the bottleneck
4. **Compare PIX vs SYS benchmark results** — quantify topology impact for your hardware
5. **Pin proxy threads to GPU-local NUMA** — reduces proxy latency for network operations
6. **Monitor per-rank bandwidth** — identify if specific ranks underperform due to distance

## Key Takeaways

- `NCCL_NET_GDR_LEVEL=PIX`: threshold 4 — disables GDRDMA when GPU-HCA distance > 4
- `NCCL_NET_GDR_LEVEL=SYS`: threshold 9+ — always enables GDRDMA regardless of distance
- Log message: `distance 9 > 4` = cross-socket GPU-HCA pair, GDRDMA disabled
- Log message: `distance 4 <= 4` = same-NUMA GPU-HCA pair, GDRDMA enabled
- Cross-socket GDRDMA (SYS): ~20% less than PIX-local, but 40-50% better than no GDRDMA
- SR-IOV makes VF placement non-deterministic → always use SYS
- Mixed enabled/disabled creates bottleneck on slowest rank — avoid with SYS
- "read 0/1 mode Default" = DMA-BUF or peermem method for receive/send paths
