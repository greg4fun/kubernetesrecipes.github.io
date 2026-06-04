---
title: "GPUDirect RDMA Setup and Verification on Kubernetes"
description: "Enable and verify GPUDirect RDMA for GPU-to-NIC direct data transfer on Kubernetes. Install nvidia-peermem, configure DMA-BUF, verify RDMA paths, troubleshoot GDRDMA failures, and optimize for NCCL multi-node training."
tags:
  - "gpudirect"
  - "rdma"
  - "nvidia"
  - "nccl"
  - "networking"
category: "ai"
publishDate: "2026-06-04"
author: "Luca Berton"
difficulty: "advanced"
relatedRecipes:
  - "nccl-all-reduce-perf-benchmark-multi-node"
  - "nccl-channel-routing-transport-analysis"
  - "nvidia-gpu-topology-matrix-kubernetes"
---

> 💡 **Quick Answer:** GPUDirect RDMA allows the NIC to read/write GPU memory directly without CPU involvement, reducing latency by ~50% and increasing bandwidth by 30-50% for inter-node GPU communication. Enable with: `modprobe nvidia-peermem`, verify with `cat /sys/module/nvidia_peermem/version`, and confirm in NCCL logs by checking for `/GDRDMA` suffix on NET/IB channels.

## The Problem

- Inter-node GPU communication routes data GPU → CPU memory → NIC (two extra copies)
- Without GDRDMA, NCCL falls back to host staging — wastes PCIe bandwidth and adds latency
- Need to verify GPUDirect RDMA is actually active (not just configured)
- nvidia-peermem module may not load automatically after driver install
- DMA-BUF kernel support required but may be missing on older kernels

## The Solution

### Enable nvidia-peermem

```bash
# Load the nvidia-peermem kernel module
modprobe nvidia-peermem

# Verify loaded
lsmod | grep nvidia_peermem
# nvidia_peermem    16384  0

# Check version
cat /sys/module/nvidia_peermem/version
# 2.0

# Make persistent across reboots
echo "nvidia-peermem" >> /etc/modules-load.d/nvidia-peermem.conf
```

### Verify DMA-BUF Support

```bash
# DMA-BUF is required for modern GPUDirect RDMA (kernel 5.12+)
# Check kernel support
grep CONFIG_DMA_SHARED_BUFFER /boot/config-$(uname -r)
# CONFIG_DMA_SHARED_BUFFER=y

# Verify NVIDIA driver exposes DMA-BUF per GPU
ls /sys/bus/pci/devices/0000:*/dma_buf_supported 2>/dev/null
# If exists, DMA-BUF is available

# In NCCL logs, look for:
# NCCL INFO DMA-BUF is available on GPU device 0
# NCCL INFO DMA-BUF is available on GPU device 1
# ... (must appear for EACH GPU)
```

### GPU Operator Configuration for GDRDMA

```yaml
# ClusterPolicy with GPUDirect RDMA enabled
apiVersion: nvidia.com/v1
kind: ClusterPolicy
metadata:
  name: cluster-policy
spec:
  operator:
    defaultRuntime: containerd
  driver:
    enabled: true
    rdma:
      enabled: true        # Loads nvidia-peermem automatically
      useHostMofed: true   # Use host-installed MLNX_OFED
  devicePlugin:
    enabled: true
  gfd:
    enabled: true
```

### OpenShift MachineConfig for nvidia-peermem

```yaml
apiVersion: machineconfiguration.openshift.io/v1
kind: MachineConfig
metadata:
  name: 99-nvidia-peermem
  labels:
    machineconfiguration.openshift.io/role: gpu-worker
spec:
  config:
    ignition:
      version: 3.4.0
    storage:
      files:
        - path: /etc/modules-load.d/nvidia-peermem.conf
          mode: 0644
          contents:
            source: data:,nvidia-peermem
```

### Verify GDRDMA in NCCL

```bash
# Run with NCCL_DEBUG=INFO
export NCCL_DEBUG=INFO
export NCCL_NET_GDR_LEVEL=5    # Use GDRDMA at all topology distances

# In output, look for:
# ✅ GOOD — GDRDMA active:
# NCCL INFO Channel 00/0 : 0[0] -> 8[0] [send] via NET/IB/0/GDRDMA

# ❌ BAD — GDRDMA not active:
# NCCL INFO Channel 00/0 : 0[0] -> 8[0] [send] via NET/IB/0
# (no /GDRDMA suffix = data stages through CPU memory)
```

### NCCL_NET_GDR_LEVEL Explained

```text
Level │ Meaning                                      │ GDRDMA Used When
──────┼──────────────────────────────────────────────┼─────────────────────────
  0   │ Disabled                                      │ Never
  1   │ Only when GPU and NIC on same PCIe switch     │ PIX only
  2   │ Same PCIe tree (through Host Bridge)          │ PIX + PHB
  3   │ Same NUMA node                                │ PIX + PHB + NODE
  4   │ Same machine (may cross sockets)              │ PIX + PHB + NODE + SYS
  5   │ Always use GDRDMA regardless of distance      │ All (recommended)
──────┴──────────────────────────────────────────────┴─────────────────────────

Recommendation: NCCL_NET_GDR_LEVEL=5
  Even cross-socket GDRDMA is faster than CPU staging for large messages.
  NCCL automatically selects the nearest NIC anyway via topology detection.
```

### Performance Comparison

```text
Transfer Type               │ Latency    │ Bandwidth   │ CPU Load
────────────────────────────┼────────────┼─────────────┼──────────
GPU → NIC (GDRDMA)          │ ~1-2 µs    │ 48-50 GB/s  │ ~0%
GPU → CPU → NIC (staged)   │ ~5-10 µs   │ 25-35 GB/s  │ High
────────────────────────────┴────────────┴─────────────┴──────────

For 8-GPU all-reduce across 2 nodes:
  With GDRDMA:    ~35 GB/s bus bandwidth
  Without GDRDMA: ~20-25 GB/s bus bandwidth
  Difference:     30-50% throughput gain
```

### Test GDRDMA Directly (without NCCL)

```bash
# Use perftest tools with GPU memory flag
# Server (node 1):
ib_write_bw -d mlx5_0 --use_cuda=0 --report_gbits -s 1048576

# Client (node 2):
ib_write_bw -d mlx5_0 --use_cuda=0 --report_gbits -s 1048576 10.10.0.1

# Expected output with GDRDMA:
#  #bytes  #iterations  BW peak[Gb/sec]  BW average[Gb/sec]
#  1048576  5000         395.2            393.8

# Without --use_cuda (CPU memory):
#  1048576  5000         380.1            378.5

# If --use_cuda shows significantly LESS than without → GDRDMA broken
```

### Kubernetes Pod with GDRDMA

```yaml
apiVersion: v1
kind: Pod
metadata:
  name: gdrdma-test
spec:
  containers:
    - name: nccl-test
      image: nvcr.io/nvidia/pytorch:24.04-py3
      env:
        - name: NCCL_NET_GDR_LEVEL
          value: "5"
        - name: NCCL_IB_HCA
          value: "mlx5_0,mlx5_3,mlx5_5,mlx5_6"
        - name: NCCL_DEBUG
          value: "INFO"
      resources:
        limits:
          nvidia.com/gpu: "8"
          rdma/rdma_shared_device_a: "1"
      securityContext:
        capabilities:
          add: ["IPC_LOCK"]     # Required for RDMA memory registration
      volumeMounts:
        - name: shm
          mountPath: /dev/shm
  volumes:
    - name: shm
      emptyDir:
        medium: Memory
        sizeLimit: "32Gi"
```

## Common Issues

### "nvidia_peermem: module not found"
- **Cause**: NVIDIA driver version too old; or module not built
- **Fix**: Upgrade to NVIDIA driver ≥ 520; or install `nvidia-peermem` package from CUDA repo

### GDRDMA active but bandwidth lower than expected
- **Cause**: NIC on different NUMA node (SYS path); or PCIe Gen4 vs Gen5 limitation
- **Fix**: Use PIX-local NICs (`NCCL_IB_HCA`); verify PCIe link speed with `lspci -vvv`

### "DMA-BUF is NOT available" in NCCL logs
- **Cause**: Kernel < 5.12; or nvidia driver built without DMA-BUF support
- **Fix**: Upgrade kernel to ≥ 5.12; rebuild NVIDIA driver with DMA-BUF; or fall back to nvidia-peermem legacy mode

### GDRDMA works for some GPUs but not others
- **Cause**: nvidia-peermem not registered for all GPUs; or some GPUs on unsupported PCIe topology
- **Fix**: Check `/sys/module/nvidia_peermem/`; restart driver; verify each GPU shows DMA-BUF available

## Best Practices

1. **Always set `NCCL_NET_GDR_LEVEL=5`** — let NCCL use GDRDMA regardless of topology distance
2. **Verify `/GDRDMA` suffix in channel logs** — confirms GPU-direct path is active
3. **Load nvidia-peermem at boot** — don't rely on manual modprobe
4. **Test with `ib_write_bw --use_cuda`** — validates GDRDMA independently of NCCL
5. **Use PIX-local NICs** — best GDRDMA throughput when NIC shares PCIe switch with GPU
6. **IPC_LOCK capability required** — for RDMA memory registration in containers
7. **Large /dev/shm** — NCCL needs shared memory for internal buffers

## Key Takeaways

- GPUDirect RDMA: NIC reads/writes GPU memory directly (no CPU copies)
- Enable: `modprobe nvidia-peermem` + `NCCL_NET_GDR_LEVEL=5`
- Verify: NCCL channel logs must show `/GDRDMA` suffix on all NET/IB channels
- DMA-BUF (kernel ≥ 5.12) is the modern interface; nvidia-peermem provides it
- Performance gain: 30-50% more bandwidth, 50% less latency vs CPU staging
- GPU Operator: set `driver.rdma.enabled=true` for automatic nvidia-peermem
- Container needs: `IPC_LOCK` capability + RDMA device access + large shared memory
