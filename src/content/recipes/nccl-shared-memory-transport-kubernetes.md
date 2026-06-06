---
title: "Shared Memory Transport for NCCL Intra-Node GPU"
description: "Configure NCCL shared memory (SHM) transport for intra-node GPU communication on Kubernetes. Covers /dev/shm sizing with emptyDir and NVLink/PCIe P2P paths."
tags:
  - "nccl"
  - "gpu"
  - "performance"
  - "configuration"
  - "storage"
category: "ai"
publishDate: "2026-06-04"
author: "Luca Berton"
difficulty: "intermediate"
relatedRecipes:
  - "nccl-network-validator-production-mpijob"
  - "nccl-gdr-level-tuning-pix-pxb-phb-sys"
  - "kubernetes-emptydir-volume"
---

> 💡 **Quick Answer:** Mount a 16Gi Memory-backed `emptyDir` at `/dev/shm` for NCCL shared memory transport. Keep `NCCL_SHM_DISABLE=0` (enabled) for intra-node GPU communication when NVLink is unavailable. NCCL uses SHM as a CPU-mediated fallback between GPUs on the same node that lack direct P2P paths.

## The Problem

- Default `/dev/shm` in containers is 64MB — too small for NCCL buffers
- NCCL shared memory transport needs large tmpfs for inter-GPU staging
- Kubernetes default `emptyDir` uses disk, not memory — too slow for NCCL
- Need to size SHM correctly for GPU count and message sizes
- Must understand when SHM is used vs NVLink vs PCIe P2P

## The Solution

### Pod Volume Configuration

```yaml
volumes:
  - name: dshm
    emptyDir:
      medium: Memory      # tmpfs (RAM-backed, not disk)
      sizeLimit: 16Gi     # Size for NCCL buffers

containers:
  - name: worker
    volumeMounts:
      - name: dshm
        mountPath: /dev/shm
```

### When NCCL Uses Each Transport

```text
Transport Path        │ When Used                         │ Bandwidth
──────────────────────┼───────────────────────────────────┼───────────
NVLink (P2P/CUMEM)    │ GPUs connected via NVLink/NVSwitch│ 600-900 GB/s
PCIe P2P              │ GPUs on same PCIe switch, no NVL  │ 20-30 GB/s
SHM (shared memory)   │ Same node, no direct P2P path    │ 10-20 GB/s
NET/IB/GDRDMA         │ Cross-node with GPUDirect RDMA   │ 35-45 GB/s
NET/IB (no GDR)       │ Cross-node, CPU bounce buffer    │ 12-15 GB/s
NET/Socket            │ Cross-node, TCP fallback          │ 2-5 GB/s
──────────────────────┴───────────────────────────────────┴───────────

SHM is used for intra-node communication when:
- NVLink is not available between the GPU pair
- PCIe peer-to-peer is disabled or unsupported
- Both ranks are on the same physical node
```

### NCCL SHM Environment Variables

```yaml
env:
  # Keep SHM enabled (default)
  - name: NCCL_SHM_DISABLE
    value: "0"            # 0=enabled, 1=disabled

  # Disable collective network (SHARP) — not available on most clusters
  - name: NCCL_COLLNET_ENABLE
    value: "0"            # 0=disabled (no SHARP hardware)
```

### Sizing Guide

```text
GPUs per Node │ Recommended /dev/shm │ Rationale
──────────────┼──────────────────────┼──────────────────────────────
2             │ 8Gi                  │ Single SHM buffer pair
4             │ 16Gi                 │ Multiple concurrent transfers
8             │ 32Gi                 │ Ring/tree allreduce staging
16 (multi-NIC)│ 64Gi                 │ Full NVSwitch + fallback paths
──────────────┴──────────────────────┴──────────────────────────────

Formula: ~2-4 GB per GPU for staging buffers
Safety margin: 2× formula for concurrent collectives
```

### Verifying SHM Usage

```bash
# Inside the pod, check /dev/shm size:
df -h /dev/shm
# Expected: tmpfs  16G  0  16G  0% /dev/shm

# During NCCL test, monitor SHM usage:
watch -n1 'du -sh /dev/shm/'
# Active test: may show 1-4 GB used

# In NCCL debug logs, SHM transport appears as:
# NCCL INFO Channel 0/0 : 0[0] -> 1[1] [send] via SHM/direct
# "SHM/direct" = shared memory transport between co-located GPUs
```

### When to Disable SHM

```bash
# Disable SHM if you see shared-memory errors:
export NCCL_SHM_DISABLE=1

# Scenarios for disabling:
# - Pod crashed with "Bus error" (SHM too small)
# - "mmap failed" errors in NCCL logs
# - All GPUs have NVLink (SHM unnecessary, NVLink is faster)
# - Debugging to isolate network vs. local issues

# Note: Disabling SHM forces NCCL to use network transport
# even for intra-node communication (wasteful but sometimes needed for debug)
```

## Common Issues

### "Bus error" or SIGBUS during NCCL test
- **Cause**: /dev/shm too small — NCCL exceeded tmpfs limit
- **Fix**: Increase `sizeLimit` in emptyDir volume (16Gi → 32Gi)

### /dev/shm shows only 64MB
- **Cause**: Default Docker/containerd SHM size; volume not mounted
- **Fix**: Add explicit emptyDir volume mount at `/dev/shm` with `medium: Memory`

### SHM not used despite same-node GPUs
- **Cause**: NVLink available (preferred) or P2P active
- **Fix**: Not an issue — NVLink/P2P is faster. SHM is the fallback.

### Pod evicted for memory pressure
- **Cause**: Memory-backed emptyDir counts against pod memory limit
- **Fix**: Ensure pod memory limit includes SHM size (e.g., 32Gi limit if 16Gi SHM + 16Gi app)

## Best Practices

1. **Always mount `/dev/shm` with Memory medium** — default 64MB is never enough
2. **Size at 2-4 GB per GPU** minimum — 16Gi covers most 2-4 GPU configurations
3. **Keep `NCCL_SHM_DISABLE=0`** unless debugging specific SHM errors
4. **Account for SHM in memory limits** — tmpfs counts against cgroup memory
5. **Set `NCCL_COLLNET_ENABLE=0`** unless you have Mellanox SHARP hardware
6. **Monitor with `du -sh /dev/shm`** during tests to right-size allocation

## Key Takeaways

- `/dev/shm` must be explicitly mounted as Memory-backed emptyDir in Kubernetes
- Default 64MB container SHM is insufficient — use 16Gi+ for GPU workloads
- NCCL uses SHM for intra-node when NVLink/P2P unavailable — it's the CPU fallback
- Memory-backed emptyDir counts against pod memory limit (plan accordingly)
- `NCCL_SHM_DISABLE=0` keeps SHM enabled; disable only for debugging
- `NCCL_COLLNET_ENABLE=0` disables SHARP (not available on most clusters)
