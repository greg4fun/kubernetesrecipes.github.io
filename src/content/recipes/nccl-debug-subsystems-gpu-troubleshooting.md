---
title: "NCCL Debug Subsystems for GPU Network Troubleshooting"
description: "Configure NCCL_DEBUG and NCCL_DEBUG_SUBSYS for targeted logging during multi-node GPU training. Covers INIT, NET, GRAPH subsystems, log"
tags:
  - "nccl"
  - "troubleshooting"
  - "observability"
  - "gpu"
  - "debugging"
category: "troubleshooting"
publishDate: "2026-06-04"
author: "Luca Berton"
difficulty: "intermediate"
relatedRecipes:
  - "nccl-network-validation-troubleshooting-checklist"
  - "nccl-network-validator-production-mpijob"
---

> 💡 **Quick Answer:** Set `NCCL_DEBUG=INFO` with `NCCL_DEBUG_SUBSYS=INIT,NET,GRAPH` for targeted debugging without flooding logs. INIT shows device discovery and topology, NET shows network transport selection and RDMA setup, GRAPH shows channel/ring topology decisions. For production, use `NCCL_DEBUG=WARN` to minimize log volume.

## The Problem

- NCCL full debug (`NCCL_DEBUG=TRACE`) produces gigabytes of logs
- Need targeted subsystem logging to diagnose specific issues
- Must understand what each subsystem reveals for efficient troubleshooting
- Production workloads need minimal logging overhead
- Multi-rank jobs produce interleaved logs that are hard to parse

## The Solution

### Debug Levels

```bash
# NCCL_DEBUG controls overall verbosity:
export NCCL_DEBUG=WARN      # Production: only warnings and errors
export NCCL_DEBUG=INFO      # Debugging: initialization and key events
export NCCL_DEBUG=TRACE     # Deep debug: every operation (very verbose)
```

### Debug Subsystems

```bash
# NCCL_DEBUG_SUBSYS filters which components log at the selected level:
export NCCL_DEBUG_SUBSYS="INIT,NET,GRAPH"

# Available subsystems:
# INIT   — Device discovery, topology detection, version info
# NET    — Network transport selection (IB, socket, RDMA)
# GRAPH  — Channel topology, ring/tree algorithm decisions
# COLL   — Collective operation scheduling
# P2P    — Peer-to-peer GPU communication
# SHM    — Shared memory transport
# NVLS   — NVLink SHARP (NVSwitch multicast)
# REG    — Memory registration (DMA-BUF, peermem)
# PROXY  — Network proxy thread operations
# ALL    — Everything (same as TRACE without subsys filter)
```

### Recommended Configurations

```yaml
# === Validation/Benchmarking ===
# See device selection, network setup, and topology
env:
  - name: NCCL_DEBUG
    value: "INFO"
  - name: NCCL_DEBUG_SUBSYS
    value: "INIT,NET,GRAPH"

# === Network Debugging ===
# Focus on RDMA connections and transport
env:
  - name: NCCL_DEBUG
    value: "INFO"
  - name: NCCL_DEBUG_SUBSYS
    value: "NET,PROXY"

# === Topology Issues ===
# Channel algorithm and ring formation
env:
  - name: NCCL_DEBUG
    value: "INFO"
  - name: NCCL_DEBUG_SUBSYS
    value: "GRAPH,INIT"

# === Production ===
# Minimal logging, only errors
env:
  - name: NCCL_DEBUG
    value: "WARN"
  # No NCCL_DEBUG_SUBSYS needed at WARN level

# === Full Trace (last resort) ===
# WARNING: Produces GB of logs, slows execution
env:
  - name: NCCL_DEBUG
    value: "TRACE"
  - name: NCCL_DEBUG_SUBSYS
    value: "ALL"
```

### Interpreting Key Log Lines

```text
# === INIT subsystem ===

# Version and library info:
NCCL INFO nccl-tests version 2.18.3 nccl-headers=22808 nccl-library=22808
# Confirms nccl-tests and NCCL library versions match

# Device discovery:
NCCL INFO Using devices: Rank 0 Group 0 Pid 95 on worker-0 device 0 [0000:42:00] NVIDIA H200 NVL
# Shows: rank assignment, node, PCIe bus ID, GPU model

# CUDA driver:
NCCL INFO cudaDriverVersion 13000
# CUDA driver version (13000 = CUDA 13.0)

# === NET subsystem ===

# Transport selection:
NCCL INFO Channel 0/0 : 0[0] -> 2[0] [send] via NET/IB/0/GDRDMA
# Channel/subchannel : src_rank[gpu] -> dst_rank[gpu] direction transport
# NET/IB/0/GDRDMA = InfiniBand device 0 with GPUDirect RDMA ✓
# NET/IB/0         = InfiniBand device 0 without GDRDMA (CPU bounce)
# NET/Socket/0     = TCP socket fallback (bad performance)

# GPUDirect RDMA enabled:
NCCL INFO GPU Direct RDMA Enabled for GPU 0 / HCA 0 (distance 9 <= 9), read 1 mode Default
# distance 9 <= 9 means SYS level allows this pair

# IB device setup:
NCCL INFO NET/IB: Dev 0 IBDev 0 Port 1 qpn 364 mtu 5 GID 3
# Dev=network device, IBDev=IB device, qpn=queue pair, mtu 5=4096B, GID 3=RoCEv2 IPv4

# Socket interface:
NCCL INFO NCCL_SOCKET_IFNAME set to net1
# Confirms NCCL is using the correct SR-IOV interface

# Plugin search:
NCCL INFO ENV/Plugin: Could not find: libnccl-env.so
# Informational only — no env plugin loaded (normal)

# === GRAPH subsystem ===

# Topology search:
NCCL INFO Trees [0] 1/-1/-1->0->-1 [1] -1/-1/-1->0->1
# Shows tree algorithm channels and connections

# Ring formation:
NCCL INFO Ring 0: 0->1->2->3->0
# Shows rank ordering in the allreduce ring

# Channel count:
NCCL INFO Connected all trees
NCCL INFO Connected all rings
# Confirms all channels established successfully
```

### Per-Rank Log Filtering

```bash
# NCCL logs are prefixed with worker and rank:
# nccl-roce-validation-worker-0:95:95 [0] NCCL INFO ...
#                              ^node  ^pid  ^rank

# Filter logs for specific rank:
kubectl logs nccl-validation-launcher | grep "\[0\] NCCL" > rank0.log
kubectl logs nccl-validation-launcher | grep "\[1\] NCCL" > rank1.log

# Filter for specific subsystem in logs:
grep "NET/IB" rank0.log          # Network device setup
grep "GPU Direct" rank0.log      # GDRDMA status
grep "Channel" rank0.log         # Transport selection per channel
grep "Connected" rank0.log       # Ring/tree establishment
```

### Log Volume Estimates

```text
Configuration                    │ Log Size (4 ranks, 1G-16G test)
─────────────────────────────────┼──────────────────────────────────
NCCL_DEBUG=WARN                  │ ~1 KB (errors only)
NCCL_DEBUG=INFO, SUBSYS=INIT     │ ~50 KB
NCCL_DEBUG=INFO, SUBSYS=NET      │ ~200 KB
NCCL_DEBUG=INFO, SUBSYS=INIT,NET,GRAPH │ ~500 KB
NCCL_DEBUG=INFO (no subsys filter)     │ ~2 MB
NCCL_DEBUG=TRACE, SUBSYS=ALL    │ ~500 MB - 2 GB
─────────────────────────────────┴──────────────────────────────────
```

## Common Issues

### Logs show "via NET/Socket" instead of "via NET/IB"
- **Cause**: IB disabled or plugin not loaded
- **Fix**: Check `NCCL_IB_DISABLE=0`, remove `NCCL_NET_PLUGIN=none`

### No "GPU Direct RDMA Enabled" message
- **Cause**: GDR level too restrictive or DMABUF not enabled
- **Fix**: Set `NCCL_NET_GDR_LEVEL=SYS` and `NCCL_DMABUF_ENABLE=1`

### "Connected all trees/rings" never appears
- **Cause**: NCCL hanging on connection setup — likely DNS or network issue
- **Fix**: Check MPI hostfile DNS resolution and inter-pod connectivity

### Logs truncated (pod OOM)
- **Cause**: TRACE logging consuming too much memory for log buffers
- **Fix**: Use targeted SUBSYS instead of ALL; increase pod memory

## Best Practices

1. **Use `INFO` + subsystem filter** for targeted debugging — never blind TRACE
2. **`INIT,NET,GRAPH`** covers 90% of debugging scenarios
3. **Save logs before pod cleanup** — `cleanPodPolicy: None` helps
4. **Filter by rank** for multi-node debugging — each rank's perspective differs
5. **Switch to `WARN` in production** — INFO adds latency at scale
6. **Redirect to file** for large tests: `NCCL_DEBUG_FILE=/tmp/nccl_%h_%p.log`

## Key Takeaways

- `NCCL_DEBUG_SUBSYS=INIT,NET,GRAPH` is the optimal validation configuration
- INIT: device discovery + topology | NET: transport + RDMA | GRAPH: channels + rings
- Look for "via NET/IB/0/GDRDMA" (good) vs "via NET/Socket" (bad)
- "Could not find: libnccl-env.so" is informational — not an error
- Per-rank log filtering essential for multi-node debugging
- Production: `NCCL_DEBUG=WARN` only; debugging: `INFO` with subsystem filter
