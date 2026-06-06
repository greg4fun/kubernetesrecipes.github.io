---
title: "NCCL DMABUF Enable for GPUDirect RDMA on Kubernetes"
description: "Enable NCCL DMA-BUF support for GPUDirect RDMA in Kubernetes GPU clusters. Covers NCCL_DMABUF_ENABLE=1, kernel requirements, nvidia-peermem vs dmabuf, GPU"
tags:
  - "nccl"
  - "rdma"
  - "gpu"
  - "performance"
  - "kernel"
category: "ai"
publishDate: "2026-06-04"
author: "Luca Berton"
difficulty: "advanced"
relatedRecipes:
  - "nccl-gdr-level-tuning-pix-pxb-phb-sys"
  - "nccl-network-validator-production-mpijob"
  - "nvidia-network-operator-rdma-kubernetes"
---

> 💡 **Quick Answer:** Set `NCCL_DMABUF_ENABLE=1` to enable DMA-BUF based GPUDirect RDMA in NCCL 2.17+. This is the modern replacement for nvidia-peermem kernel module registration. Requires Linux kernel ≥ 5.12, CUDA ≥ 12.0, and MOFED ≥ 5.5. Verify with `NCCL_DEBUG=INFO` — look for "GPU Direct RDMA Enabled" and "DMA-BUF" in logs.

## The Problem

- Legacy GPUDirect RDMA relied on `nvidia-peermem` kernel module for GPU↔NIC DMA
- nvidia-peermem has kernel version compatibility issues and requires module loading
- DMA-BUF is the upstream Linux kernel standard for cross-device DMA (no out-of-tree modules)
- Need to enable DMA-BUF in NCCL without breaking fallback to peermem
- Must verify the correct path is active in production

## The Solution

### Enabling DMA-BUF in NCCL

```yaml
# In MPIJob worker and launcher env:
env:
  - name: NCCL_DMABUF_ENABLE
    value: "1"         # Enable DMA-BUF for GPUDirect RDMA
  - name: NCCL_NET_GDR_LEVEL
    value: "PHB"       # Control which GPU-NIC pairs use RDMA
  - name: NCCL_DEBUG
    value: "INFO"      # Verify DMA-BUF is active
```

### DMA-BUF vs nvidia-peermem

```text
Feature              │ nvidia-peermem          │ DMA-BUF (dmabuf)
─────────────────────┼─────────────────────────┼─────────────────────────
Kernel module        │ nvidia-peermem.ko       │ None (in-kernel)
Min kernel version   │ Any (out-of-tree)       │ 5.12+
Registration         │ Module load + ib_register│ Automatic via fd
NCCL support         │ NCCL 2.x (default)     │ NCCL 2.17+ (opt-in)
GPU Operator         │ driver.rdma.enabled     │ No config needed
Stability            │ Can break on upgrades   │ Upstream-stable
CUDA requirement     │ CUDA 11.x+             │ CUDA 12.0+
─────────────────────┴─────────────────────────┴─────────────────────────

DMA-BUF is preferred when kernel and CUDA versions support it.
nvidia-peermem remains as fallback for older kernels.
```

### Verifying DMA-BUF in NCCL Logs

```text
# With NCCL_DMABUF_ENABLE=1 and NCCL_DEBUG=INFO:

# Success — DMA-BUF active:
NCCL INFO GPU Direct RDMA Enabled for GPU 0 / HCA 0 (distance 9 <= 9), read 1 mode Default
NCCL INFO Using DMA-BUF for GPU Direct RDMA

# Fallback to peermem (DMA-BUF not available):
NCCL INFO GPU Direct RDMA Enabled for GPU 0 / HCA 0, using nvidia-peermem

# No RDMA at all (distance too far or disabled):
NCCL INFO Channel 0/0 : 0[0] -> 2[0] [send] via NET/IB/0  # No GDRDMA suffix
```

### Kernel Requirements Check

```bash
# Verify kernel version (need >= 5.12)
uname -r
# Expected: 5.14.0-xxx or higher (RHEL 9 / OpenShift 4.12+)

# Check DMA-BUF support in kernel config
grep CONFIG_DMA_SHARED_BUFFER /boot/config-$(uname -r)
# Expected: CONFIG_DMA_SHARED_BUFFER=y

# Verify nvidia-peermem is loaded (backup path)
lsmod | grep nvidia_peermem
# nvidia_peermem    16384  0

# Check if MOFED supports DMA-BUF
ofed_info -s
# Expected: MLNX_OFED_LINUX-5.5-x.x.x or higher
```

### GPU Operator ClusterPolicy Configuration

```yaml
apiVersion: nvidia.com/v1
kind: ClusterPolicy
metadata:
  name: gpu-cluster-policy
spec:
  driver:
    enabled: true
    rdma:
      enabled: true          # Loads nvidia-peermem (backup for DMA-BUF)
      useHostMOFED: true     # Use host MOFED instead of container MOFED
  gds:
    enabled: true            # GPUDirect Storage (nvidia-fs)
  # DMA-BUF doesn't need GPU Operator configuration —
  # it's enabled at the NCCL level via environment variable
```

### Pod Spec with DMA-BUF

```yaml
containers:
  - name: worker
    image: registry.example.com/nccl-validator:v6
    env:
      - name: NCCL_DMABUF_ENABLE
        value: "1"
      - name: NCCL_NET_GDR_LEVEL
        value: "SYS"
      - name: NCCL_IB_DISABLE
        value: "0"
    resources:
      limits:
        nvidia.com/gpu: 2
        openshift.io/mellanoxnics: 1    # Provides RDMA VF
    securityContext:
      capabilities:
        add:
          - NET_RAW          # For RDMA verbs
    volumeMounts:
      - name: dshm
        mountPath: /dev/shm
```

### Relationship to Other NCCL Settings

```text
NCCL_DMABUF_ENABLE=1     │ Enables DMA-BUF path for GPU memory registration
NCCL_NET_GDR_LEVEL=PHB   │ Controls which GPU-NIC pairs can use GPUDirect
NCCL_IB_DISABLE=0        │ Enables InfiniBand/RoCE transport (required)
NCCL_NET_PLUGIN=none     │ Disables IB plugin (falls back to socket)
                          │ Remove this to enable RDMA!
NCCL_NET_GDR_READ=0/1    │ Allow remote-side GDR reads (advanced)

Flow:
  NCCL_IB_DISABLE=0 → IB transport enabled
  → NCCL_NET_GDR_LEVEL=PHB → check PCIe distance
  → distance OK → NCCL_DMABUF_ENABLE=1 → register GPU memory via DMA-BUF
  → GPUDirect RDMA active (GPU → NIC → wire → NIC → GPU, zero CPU copies)
```

## Common Issues

### DMA-BUF not activating despite NCCL_DMABUF_ENABLE=1
- **Cause**: Kernel too old (< 5.12) or CUDA < 12.0
- **Fix**: Upgrade to RHEL 9 / OpenShift 4.12+ and CUDA 12.x container

### nvidia-peermem and DMA-BUF both loaded
- **Cause**: Normal. NCCL prefers DMA-BUF when available, falls back to peermem
- **Fix**: No action needed. Both can coexist.

### NCCL_NET_PLUGIN=none disables RDMA entirely
- **Cause**: "none" means no network plugin — socket transport only
- **Fix**: Remove `NCCL_NET_PLUGIN` env var to let NCCL auto-detect IB plugin

### Performance same with and without DMABUF_ENABLE
- **Cause**: nvidia-peermem already providing GPUDirect path
- **Fix**: Both paths achieve similar performance. DMA-BUF advantage is stability, not speed.

## Best Practices

1. **Always set `NCCL_DMABUF_ENABLE=1`** on CUDA 12+ with kernel 5.12+
2. **Keep nvidia-peermem loaded** as fallback — it doesn't conflict
3. **Don't set `NCCL_NET_PLUGIN=none`** in production — that disables RDMA
4. **Use `NCCL_DEBUG=INFO`** to verify which path is active
5. **Test with and without** to confirm RDMA is actually improving bandwidth
6. **Check `NCCL_IB_DISABLE=0`** — DMA-BUF is useless if IB transport is off

## Key Takeaways

- `NCCL_DMABUF_ENABLE=1` is the modern GPUDirect RDMA registration method
- Requires kernel ≥ 5.12, CUDA ≥ 12.0, MOFED ≥ 5.5
- Coexists with nvidia-peermem (NCCL prefers DMA-BUF when both available)
- No GPU Operator configuration needed — purely NCCL environment variable
- `NCCL_NET_PLUGIN=none` **disables** RDMA — remove it for production
- Verify via NCCL_DEBUG=INFO: "GPU Direct RDMA Enabled" + "DMA-BUF"
- Combined with `NCCL_NET_GDR_LEVEL` to control which pairs use GPUDirect
