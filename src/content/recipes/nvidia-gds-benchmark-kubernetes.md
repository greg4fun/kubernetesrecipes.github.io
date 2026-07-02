---
title: "NVIDIA GPUDirect Storage Benchmark on K8s"
description: "Benchmark NVIDIA GPUDirect Storage (GDS) on Kubernetes for direct NVMe-to-GPU data transfers. Covers gdsio, gds_stats, performance validation, and comparison"
tags:
  - "benchmarking"
  - "nvidia"
  - "gds"
  - "storage"
  - "performance"
category: "ai"
publishDate: "2026-05-05"
author: "Luca Berton"
difficulty: "advanced"
relatedRecipes:
  - "fio-pscale-nfs-smb-benchmark-kubernetes"
  - "gds-nvme-nfs-rdma"
  - "nvidia-gpu-operator-gitops-openshift"
  - "distributed-multi-gpu-inference-kubernetes"
---

> 💡 **Quick Answer:** GPUDirect Storage (GDS) bypasses the CPU and system memory for storage I/O, transferring data directly from NVMe/NFS to GPU memory. Use `gdsio` to benchmark raw GDS throughput and compare against traditional `cuFile` paths to validate your storage stack delivers full bandwidth.

## The Problem

Traditional storage I/O for GPU workloads:
```
NVMe → PCIe → CPU RAM → PCIe → GPU VRAM (2 copies, CPU involved)
```

GPUDirect Storage:
```
NVMe → PCIe → GPU VRAM (1 copy, zero CPU involvement)
```

Without GDS, the CPU becomes a bottleneck for large dataset loading, and PCIe bandwidth is wasted on double copies.

## The Solution

### Verify GDS is Available

```bash
# Check GDS driver in GPU Operator
kubectl get pods -n gpu-operator -l app=nvidia-driver-daemonset
kubectl exec -n gpu-operator <driver-pod> -- nvidia-smi -q | grep "GPUDirect"

# Check GDS support on node
kubectl debug node/<node-name> -it --image=nvcr.io/nvidia/cuda:12.8.0-devel-ubuntu22.04 -- \
  sh -c '/usr/local/cuda/gds/tools/gds_stats'
```

### Run GDS Benchmark with gdsio

```yaml
apiVersion: batch/v1
kind: Job
metadata:
  name: gds-benchmark
  namespace: ai-bench
spec:
  template:
    spec:
      containers:
        - name: gdsio
          image: nvcr.io/nvidia/cuda:12.8.0-devel-ubuntu22.04
          command:
            - /bin/bash
            - -c
            - |
              echo "=== GDS Benchmark ==="
              nvidia-smi
              
              # Verify GDS is active
              /usr/local/cuda/gds/tools/gds_stats
              
              # Sequential read benchmark (GDS enabled)
              /usr/local/cuda/gds/tools/gdsio \
                -f /mnt/nvme/testfile \
                -d 0 \
                -s 10G \
                -i 1M \
                -x 0 \
                -I 1 \
                -T 120
              
              echo "--- GDS disabled (bounce buffer) ---"
              
              # Same test with GDS disabled (for comparison)
              /usr/local/cuda/gds/tools/gdsio \
                -f /mnt/nvme/testfile \
                -d 0 \
                -s 10G \
                -i 1M \
                -x 1 \
                -I 1 \
                -T 120
          resources:
            limits:
              nvidia.com/gpu: 1
          volumeMounts:
            - name: nvme-storage
              mountPath: /mnt/nvme
            - name: shm
              mountPath: /dev/shm
          securityContext:
            privileged: true    # Required for GDS direct access
      volumes:
        - name: nvme-storage
          hostPath:
            path: /mnt/local-nvme
        - name: shm
          emptyDir:
            medium: Memory
      restartPolicy: Never
      nodeSelector:
        nvidia.com/gds.present: "true"
```

### gdsio Parameters Explained

```bash
/usr/local/cuda/gds/tools/gdsio \
  -f /mnt/nvme/testfile \    # File to benchmark
  -d 0 \                     # GPU device index
  -s 10G \                   # File size
  -i 1M \                    # I/O block size
  -x 0 \                     # 0=GDS enabled, 1=GDS disabled (bounce buffer)
  -I 1 \                     # 1=read, 2=write, 3=randread, 4=randwrite
  -T 120 \                   # Runtime in seconds
  -t 4                       # Number of threads
```

### GDS with NFS over RDMA

```yaml
apiVersion: batch/v1
kind: Job
metadata:
  name: gds-nfsrdma-bench
  namespace: ai-bench
spec:
  template:
    spec:
      containers:
        - name: gdsio
          image: nvcr.io/nvidia/cuda:12.8.0-devel-ubuntu22.04
          command:
            - /bin/bash
            - -c
            - |
              # GDS over NFSoRDMA — direct NFS-to-GPU path
              /usr/local/cuda/gds/tools/gdsio \
                -f /mnt/nfs-rdma/dataset/testfile \
                -d 0 \
                -s 10G \
                -i 4M \
                -x 0 \
                -I 1 \
                -T 120 \
                -t 8
          resources:
            limits:
              nvidia.com/gpu: 1
          volumeMounts:
            - name: nfs-rdma
              mountPath: /mnt/nfs-rdma
          securityContext:
            privileged: true
      volumes:
        - name: nfs-rdma
          nfs:
            server: 10.0.1.10
            path: /export/gds-enabled
      restartPolicy: Never
```

### Expected Performance Comparison

```text
I/O Path                      Seq Read 1M    Seq Write 1M
──────────────────────────────────────────────────────────
Local NVMe (no GDS)           3.2 GB/s       2.8 GB/s
Local NVMe (GDS)              6.8 GB/s       5.5 GB/s
NFS over TCP (no GDS)         1.5 GB/s       1.2 GB/s
NFS over RDMA (no GDS)        3.0 GB/s       2.5 GB/s
NFS over RDMA (GDS)           5.5 GB/s       4.5 GB/s

Improvement with GDS: ~2× throughput (CPU bottleneck removed)
```

### Monitor GDS Statistics

```bash
# Real-time GDS stats during benchmark
watch -n 1 '/usr/local/cuda/gds/tools/gds_stats'

# Key metrics:
#   bytes_read_gds       — bytes transferred via GDS path
#   bytes_read_posix     — bytes via fallback (bounce buffer)
#   gds_read_bandwidth   — current GDS throughput
```

## Common Issues

### GDS falls back to bounce buffer silently
- **Cause**: Filesystem not GDS-compatible or alignment wrong
- **Fix**: Check `gds_stats` for `posix` counters increasing; verify ext4/xfs with 4K alignment

### Permission denied for GDS
- **Cause**: Pod not running with sufficient privileges
- **Fix**: `securityContext.privileged: true` or `CAP_SYS_ADMIN` + device access

### GDS not available on node
- **Cause**: GPU Operator not configured for GDS, or kernel module missing
- **Fix**: Enable GDS in GPU Operator Helm values: `driver.gds.enabled=true`

## Best Practices

1. **Always compare GDS vs non-GDS** — use `-x 0` vs `-x 1` to quantify improvement
2. **Use large I/O sizes** — GDS benefits most with 1M+ block sizes
3. **Verify with `gds_stats`** — confirm data flows through GDS path, not bounce buffer
4. **NFS requires RDMA** — GDS over NFS only works with NFSoRDMA (not TCP)
5. **Node selector** — schedule GDS benchmarks only on nodes with GDS support

## Key Takeaways

- GDS provides ~2× throughput improvement by eliminating CPU bounce buffer
- Use `gdsio` for benchmarking, `gds_stats` for verification
- Works with local NVMe and NFS over RDMA
- Requires privileged Pods and GPU Operator GDS driver
- Critical for large-scale training where dataset loading is the bottleneck
