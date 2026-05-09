---
title: "GPUDirect Storage on Kubernetes"
description: "Configure NVIDIA GPUDirect Storage (GDS) for direct data path between NVMe/NFS storage and GPU memory bypassing CPU. Covers Magnum IO, cuFile API, GDS driver setup on OpenShift and Talos, and benchmarking with gdsio."
tags:
  - "gpudirect"
  - "storage"
  - "nvidia"
  - "nvme"
  - "magnum-io"
category: "ai"
publishDate: "2026-05-09"
author: "Luca Berton"
difficulty: "advanced"
relatedRecipes:
  - "nvidia-peermem-gpu-direct-rdma-module"
  - "iommu-bios-kernel-nccl-gpu-direct"
  - "disable-acs-pcie-gpu-direct-p2p"
  - "sriov-vf-container-mapping-lifecycle"
---

> 💡 **Quick Answer:** GPUDirect Storage (GDS) enables a direct DMA path between storage (NVMe, NFS over RDMA) and GPU memory, bypassing CPU and system RAM entirely. This eliminates the CPU bounce buffer, achieving 2-5x higher I/O throughput for data loading in AI training pipelines. Enable it via GPU Operator with `gds.enabled: true`.

## The Problem

Traditional data loading path for AI training:

- Storage → CPU RAM → GPU VRAM (two copies, CPU bottleneck)
- Large datasets (ImageNet, video, genomics) saturate CPU memory bandwidth
- Data loading becomes the bottleneck, not GPU compute
- GPUs idle waiting for data — expensive idle time on A100/H100/GH200

## The Solution

### Data Path Comparison

```text
Without GDS (traditional):
  NVMe/NFS → PCIe → CPU RAM → PCIe → GPU VRAM
  Throughput: ~6 GB/s (CPU bounce buffer limited)
  CPU usage: High (memcpy)

With GDS:
  NVMe/NFS → PCIe → GPU VRAM (direct DMA)
  Throughput: ~25 GB/s (limited by NVMe/PCIe)
  CPU usage: Near zero

With GDS + RDMA (NFS over RDMA):
  NFS Server → RDMA NIC → PCIe → GPU VRAM
  Throughput: ~24 GB/s per NIC
  CPU usage: Zero (full hardware path)
```

### GPU Operator with GDS

```yaml
apiVersion: nvidia.com/v1
kind: ClusterPolicy
metadata:
  name: gpu-cluster-policy
spec:
  driver:
    enabled: true
    rdma:
      enabled: true
      useHostMofed: true
  gds:
    enabled: true              # ← Enable GPUDirect Storage
    # image: nvcr.io/nvidia/cloud-native/nvidia-fs
    # version: "2.20.5"
  # GDS requires:
  # 1. nvidia_fs kernel module (loaded by GPU Operator)
  # 2. MOFED 5.4+ for NFS-RDMA support
  # 3. Compatible filesystem (ext4, xfs, NFS, Lustre, GPFS)
```

### Verify GDS is Active

```bash
# Check nvidia_fs module
lsmod | grep nvidia_fs
# nvidia_fs  53248  0

# Check GDS status
/usr/local/cuda/gds/tools/gds_stats
# GDS Statistics:
#   Reads:  1234
#   Writes: 567
#   Direct: 1801 (100%)    ← All I/O through GPU-Direct path

# Benchmark with gdsio
/usr/local/cuda/gds/tools/gdsio -f /data/testfile -d 0 -w 4 -s 1G -x 0 -I 1
# -f: test file path
# -d 0: GPU device 0
# -w 4: 4 threads
# -s 1G: 1GB file size
# -x 0: cuFile read mode
# -I 1: direct I/O

# Compare with and without GDS:
# GDS enabled:  ~24 GB/s read throughput
# GDS disabled: ~6 GB/s (CPU bounce buffer)
```

### Pod with GDS Access

```yaml
apiVersion: v1
kind: Pod
metadata:
  name: gds-training
  namespace: ai-training
spec:
  containers:
    - name: training
      image: nvcr.io/nvidia/pytorch:24.07-py3
      env:
        - name: CUFILE_ENV_PATH_JSON
          value: "/etc/cufile.json"
      resources:
        requests:
          nvidia.com/gpu: "8"
      volumeMounts:
        - name: training-data
          mountPath: /data
        - name: cufile-config
          mountPath: /etc/cufile.json
          subPath: cufile.json
  volumes:
    - name: training-data
      persistentVolumeClaim:
        claimName: nvme-dataset        # NVMe-backed PVC
    - name: cufile-config
      configMap:
        name: cufile-config
---
apiVersion: v1
kind: ConfigMap
metadata:
  name: cufile-config
  namespace: ai-training
data:
  cufile.json: |
    {
      "logging": {
        "type": "stderr",
        "level": "INFO"
      },
      "properties": {
        "max_direct_io_size": "16777216",
        "max_device_cache_size": "131072",
        "max_device_pinned_mem_size": "33554432",
        "posix_pool_slab_size": "4194304",
        "posix_pool_slab_count": "128",
        "rdma_peer_affinity_policy": "GPU_FLOW",
        "allow_compat_mode": true
      },
      "fs": {
        "generic": {
          "posix_unaligned_writes": false,
          "rdma_write_support": false
        },
        "lustre": {
          "posix_gds_min_kb": 0
        },
        "nfs": {
          "rdma_write_support": true
        }
      }
    }
```

### Supported Storage Backends

```text
Backend       GDS Support    Notes
──────────────────────────────────────────────────────────────────
Local NVMe    Full           Best performance, direct PCIe path
NFS (TCP)     Compat mode    Falls back to CPU bounce buffer
NFS (RDMA)    Full           Requires NFSoRDMA + MOFED 5.4+
Lustre        Full           Native cuFile integration
GPFS/Spectrum Full           IBM Spectrum Scale 5.1+
WekaFS        Full           Native GDS support
VAST Data     Full           NFS-RDMA path
ext4/xfs      Full           Local filesystem on NVMe
tmpfs         No             In-memory, no block I/O
```

## Common Issues

### "cuFile driver not initialized"
- **Cause**: nvidia_fs module not loaded
- **Fix**: Check GPU Operator `gds.enabled: true`; verify `lsmod | grep nvidia_fs`

### GDS falls back to compat mode
- **Cause**: Filesystem not GDS-compatible (e.g., NFS over TCP)
- **Fix**: Use NFS over RDMA, or local NVMe; check `cufile.json` allows compat mode

### Low throughput despite GDS enabled
- **Cause**: File not opened with O_DIRECT; or small I/O sizes
- **Fix**: Use cuFile API with aligned buffers; minimum 4KB I/O for GDS benefit

## Best Practices

1. **NVMe for maximum GDS throughput** — direct PCIe path to GPU
2. **NFS over RDMA for shared datasets** — requires MOFED + NFSoRDMA server
3. **Tune cufile.json** — increase `max_direct_io_size` for large sequential reads
4. **Benchmark before and after** with `gdsio` — quantify actual improvement
5. **Use GPU Operator** to manage nvidia_fs lifecycle automatically
6. **O_DIRECT flag required** — buffered I/O bypasses GDS entirely

## Key Takeaways

- GPUDirect Storage eliminates CPU bounce buffer for storage → GPU data path
- 2-5x I/O throughput improvement for AI training data loading
- GPU Operator: set `gds.enabled: true` in ClusterPolicy
- Requires `nvidia_fs` kernel module + compatible storage (NVMe, NFS-RDMA, Lustre)
- Benchmark with `gdsio` to verify direct path is active
- Best with local NVMe; also works with NFS over RDMA for shared datasets
- cuFile API in application code (PyTorch DataLoader, DALI) for automatic GDS
