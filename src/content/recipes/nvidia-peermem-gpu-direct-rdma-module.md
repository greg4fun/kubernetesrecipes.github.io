---
title: "NVIDIA PeerMem for GPU-Direct RDMA"
description: "Install and configure nvidia_peermem kernel module to enable GPU-Direct RDMA between NVIDIA GPUs and Mellanox RDMA NICs. Covers module loading, verification, OpenShift and Talos setup, and troubleshooting peermem registration failures."
tags:
  - "nvidia-peermem"
  - "gpu-direct"
  - "rdma"
  - "kernel-module"
  - "nccl"
category: "ai"
publishDate: "2026-05-09"
author: "Luca Berton"
difficulty: "advanced"
relatedRecipes:
  - "iommu-bios-kernel-nccl-gpu-direct"
  - "disable-acs-pcie-gpu-direct-p2p"
  - "openshift-sriov-rdma-infiniband-device-plugin"
  - "roce-pfc-ecn-lossless-ethernet-gpu"
---

> 💡 **Quick Answer:** `nvidia_peermem` is the kernel module that bridges NVIDIA GPU memory to the Linux RDMA subsystem, enabling GPU-Direct RDMA — NIC reads/writes directly to GPU VRAM without CPU copies. Without it, NCCL falls back to CPU-staged transfers (2-5x slower for inter-node communication).

## The Problem

GPU-Direct RDMA requires a bridge between two kernel subsystems:

- NVIDIA GPU driver manages GPU memory (VRAM)
- RDMA/InfiniBand subsystem manages NIC DMA operations
- Neither knows about the other's memory regions
- `nvidia_peermem` registers GPU memory with the RDMA stack
- Without it: NIC → CPU RAM → GPU (two copies, high latency)
- With it: NIC → GPU VRAM (one DMA, zero CPU involvement)

## The Solution

### Data Path Comparison

```text
Without nvidia_peermem (CPU-staged):
  Remote GPU → RDMA NIC → Host RAM → PCIe → Local GPU
  Bandwidth: ~12 GB/s (limited by CPU memory copy)
  Latency: ~15μs

With nvidia_peermem (GPU-Direct RDMA):
  Remote GPU → RDMA NIC → PCIe → Local GPU
  Bandwidth: ~24-48 GB/s (limited by PCIe/NIC speed)
  Latency: ~3μs
```

### Load nvidia_peermem

```bash
# Check if already loaded
lsmod | grep nvidia_peermem
# nvidia_peermem         16384  0

# If not loaded:
modprobe nvidia_peermem

# Verify registration
dmesg | grep -i peermem
# Expected: "nvidia peermem loaded successfully"
# Or: "nvidia peermem registered"

# Make persistent across reboots
echo "nvidia_peermem" >> /etc/modules-load.d/gpu-rdma.conf
```

### Prerequisites (Load Order)

```bash
# nvidia_peermem depends on both:
# 1. NVIDIA driver (nvidia, nvidia_uvm)
# 2. RDMA core (ib_core, mlx5_ib)

# Correct load order:
modprobe ib_core
modprobe mlx5_core
modprobe mlx5_ib
modprobe nvidia
modprobe nvidia_uvm
modprobe nvidia_peermem    # Must be LAST

# Check dependencies
modinfo nvidia_peermem
# depends: ib_core, nvidia
```

### OpenShift GPU Operator (Automatic)

```yaml
# GPU Operator handles nvidia_peermem automatically when:
apiVersion: nvidia.com/v1
kind: ClusterPolicy
metadata:
  name: gpu-cluster-policy
spec:
  driver:
    enabled: true
    # nvidia_peermem loaded as part of driver stack
    rdma:
      enabled: true          # ← This enables nvidia_peermem
      useHostMofed: true     # Use host-installed MLNX_OFED
  
  # Or with containerized MOFED:
  driver:
    rdma:
      enabled: true
      useHostMofed: false    # GPU Operator manages MOFED too
```

### OpenShift MachineConfig

```yaml
# If not using GPU Operator for driver management:
apiVersion: machineconfiguration.openshift.io/v1
kind: MachineConfig
metadata:
  name: 99-gpu-worker-peermem
  labels:
    machineconfiguration.openshift.io/role: gpu-worker
spec:
  config:
    ignition:
      version: 3.2.0
    storage:
      files:
        - path: /etc/modules-load.d/gpu-rdma.conf
          mode: 0644
          contents:
            inline: |
              ib_core
              mlx5_core
              mlx5_ib
              nvidia
              nvidia_uvm
              nvidia_peermem
```

### Talos Linux

```yaml
machine:
  kernel:
    modules:
      - name: ib_core
      - name: mlx5_core
      - name: mlx5_ib
      - name: nvidia
      - name: nvidia_uvm
      - name: nvidia_peermem
```

### Verify GPU-Direct RDMA is Active

```bash
# Check peermem is registered with RDMA subsystem
cat /sys/module/nvidia_peermem/refcnt
# > 0 means actively in use

# Check NVIDIA driver sees peermem
nvidia-smi -q | grep -i "peer"
# Or check nvidia-persistenced log

# Test with NCCL
export NCCL_DEBUG=INFO
export NCCL_NET_GDR_LEVEL=5

# In NCCL output, look for:
# "GPU Direct RDMA Enabled for ..."
# "NET/IB : GPU Direct RDMA enabled"

# If you see:
# "GPU Direct RDMA Disabled"
# → nvidia_peermem not loaded or not registered

# Test with perftest
# Server:
ib_write_bw --use_cuda=0 -d mlx5_0 -a

# Client:
ib_write_bw --use_cuda=0 -d mlx5_0 -a <server-ip>
# --use_cuda=0 tests GPU 0 RDMA directly
# Should show ~24 GB/s for 200Gb/s NIC
```

### NCCL_NET_GDR_LEVEL Values

```text
GDR Level   Path                        When to Use
──────────────────────────────────────────────────────────────────
0 (LOC)     Disabled                    Debugging only
1 (PIX)     Same PCIe switch            Conservative
2 (PXB)     Same PCIe bus               Safe default
3 (PHB)     Same NUMA node              Recommended minimum
4 (SYS)     Cross-NUMA (via QPI/UPI)    Large systems
5 (ALL)     Any path including remote   Maximum performance ✅

Recommendation: Use 5 (ALL) for GPU clusters with proper IOMMU/ACS config
```

### Troubleshooting: peermem Won't Load

```bash
# Error: modprobe: FATAL: Module nvidia_peermem not found
# Cause: nvidia driver version doesn't include peermem
# Fix: Update to NVIDIA driver 470+ (peermem included since 470)

# Error: "nvidia_peermem: Unknown symbol ib_register_peer_memory_client"
# Cause: ib_core not loaded or MOFED version mismatch
# Fix: Load ib_core first; ensure MOFED matches kernel version

# Error: nvidia_peermem loads but refcnt stays 0
# Cause: No RDMA traffic using GPU memory yet (normal if idle)
# Fix: Run an NCCL test — refcnt will increase during GPU-Direct transfers

# Error: "GPU Direct RDMA Disabled" in NCCL
# Cause: NCCL_NET_GDR_LEVEL=0 or peermem not registered
# Fix: Set NCCL_NET_GDR_LEVEL=5; check dmesg for peermem registration
```

## Common Issues

### peermem loaded but NCCL doesn't use GPU-Direct
- **Cause**: `NCCL_NET_GDR_LEVEL` not set or set too low
- **Fix**: Set `NCCL_NET_GDR_LEVEL=5`

### peermem registration fails after driver update
- **Cause**: NVIDIA driver and MOFED version incompatibility
- **Fix**: Rebuild peermem against current kernel; or update both together

### Performance same with and without peermem
- **Cause**: GPU and NIC on different NUMA nodes; data crosses QPI anyway
- **Fix**: Check `nvidia-smi topo -m`; schedule on nodes with GPU-NIC NUMA locality

## Best Practices

1. **Use GPU Operator `rdma.enabled: true`** — manages peermem automatically
2. **Set `NCCL_NET_GDR_LEVEL=5`** — enables GPU-Direct on all paths
3. **Verify with `dmesg | grep peermem`** after every node boot
4. **Load order matters** — ib_core → mlx5 → nvidia → peermem
5. **Test with `ib_write_bw --use_cuda`** — validates GPU memory RDMA path
6. **Match MOFED + NVIDIA driver versions** — incompatibility = silent failure

## Key Takeaways

- `nvidia_peermem` bridges NVIDIA GPU memory to RDMA subsystem
- Without it: NIC → CPU → GPU (2 copies). With it: NIC → GPU (zero-copy)
- 2-4x bandwidth improvement for inter-node GPU communication
- GPU Operator loads it automatically with `rdma.enabled: true`
- Must load AFTER both ib_core and nvidia modules
- `NCCL_NET_GDR_LEVEL=5` tells NCCL to use GPU-Direct RDMA on all paths
- Verify: `dmesg | grep peermem` + `NCCL_DEBUG=INFO` shows "GPU Direct RDMA Enabled"
- Included in NVIDIA driver 470+; no separate package needed
