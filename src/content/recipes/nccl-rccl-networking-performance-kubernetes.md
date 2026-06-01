---
title: "NCCL and RCCL Networking Performance on Kubernetes"
description: "Optimize NCCL (NVIDIA) and RCCL (AMD) collective communication performance on Kubernetes GPU clusters. Network transport selection, bandwidth tuning, latency optimization, InfiniBand vs RoCE configuration, and benchmarking with nccl-tests."
tags:
  - "nccl"
  - "rccl"
  - "gpu"
  - "networking"
  - "rdma"
  - "performance"
  - "distributed-training"
category: "ai"
publishDate: "2026-05-31"
author: "Luca Berton"
difficulty: "advanced"
relatedRecipes:
  - "nccl-topology-dump-tuning-kubernetes"
  - "nccl-pxn-cross-nic-nvlink-kubernetes"
  - "debug-distributed-vllm-nccl-verbose-logging"
  - "dual-fabric-mellanox-gpu-ib-storage-ethernet"
  - "gpudirect-storage-gds-kubernetes"
---

> 💡 **Quick Answer:** NCCL (NVIDIA) and RCCL (AMD) are the collective communication libraries for distributed GPU workloads. Peak networking performance requires: GPUDirect RDMA for zero-copy GPU-to-GPU transfers over InfiniBand/RoCE, correct NIC-to-GPU affinity (same PCIe/NUMA), tuned socket threads for TCP fallback, and rail-optimized topology matching. Benchmark with `all_reduce_perf` — target >90% of theoretical link bandwidth.

## The Problem

- Distributed training/inference spends 30-60% of time in communication (all-reduce, all-gather)
- Default NCCL/RCCL settings leave significant bandwidth on the table
- Mismatched NIC-GPU affinity routes traffic through CPU, halving throughput
- TCP fallback (no RDMA) can be 5-10x slower than InfiniBand/RoCE
- AMD GPU clusters need RCCL-specific tuning different from NVIDIA's NCCL
- Kubernetes pod networking adds latency unless bypassed with host networking or SR-IOV

## The Solution

### NCCL vs RCCL Overview

```text
┌─────────────────────────────────────────────────────────────────────┐
│ NCCL (NVIDIA Collective Communications Library)                      │
│ • For NVIDIA GPUs (CUDA)                                             │
│ • Transports: NVLink, PCIe P2P, InfiniBand (Verbs), RoCE, TCP      │
│ • GPUDirect RDMA: GPU memory ↔ NIC without CPU copy                 │
│ • GPUDirect P2P: GPU ↔ GPU via NVLink/NVSwitch                      │
│ • Version: 2.30.x (latest)                                          │
└─────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────┐
│ RCCL (ROCm Collective Communications Library)                        │
│ • For AMD GPUs (ROCm/HIP)                                            │
│ • Fork of NCCL, similar API and env vars (NCCL_* → RCCL_*)          │
│ • Transports: XGMI (Infinity Fabric), PCIe P2P, RoCE, TCP          │
│ • GPU RDMA via ROCm SMI + Mellanox/Broadcom NICs                    │
│ • Version: 2.20.x (ROCm 6.x)                                        │
└─────────────────────────────────────────────────────────────────────┘

Transport hierarchy (fastest → slowest):
  NVIDIA: NVSwitch > NVLink > PCIe P2P > GPUDirect RDMA > IB Verbs > RoCE > TCP
  AMD:    XGMI > PCIe P2P > GPU RDMA > RoCE > TCP
```

### Network Transport Selection

```text
NCCL automatically selects the best available transport:

Intra-node (same server):
├── NVLink/NVSwitch: 900 GB/s (H100), 600 GB/s (A100)
├── PCIe P2P: ~32 GB/s (Gen4 x16), ~64 GB/s (Gen5 x16)
└── Shared Memory (SHM): ~20 GB/s (CPU-mediated)

Inter-node (across servers):
├── InfiniBand HDR: 200 Gbps (~24 GB/s) per port
├── InfiniBand NDR: 400 Gbps (~48 GB/s) per port
├── RoCE v2: 100-400 Gbps (depends on NIC)
└── TCP/IP: 10-100 Gbps (depends on NIC, high CPU overhead)

Multi-rail (multiple NICs per node):
├── 4x NDR 400G = 1.6 Tbps aggregate (~192 GB/s)
├── 8x HDR 200G = 1.6 Tbps aggregate (~192 GB/s)
└── Rail-optimized: each NIC connects to dedicated switch
```

### NCCL Performance Tuning for Kubernetes

```yaml
apiVersion: batch/v1
kind: Job
metadata:
  name: nccl-benchmark
  namespace: gpu-workloads
spec:
  parallelism: 2
  completions: 2
  template:
    spec:
      hostNetwork: true       # Bypass pod network overhead
      dnsPolicy: ClusterFirstWithHostNet
      containers:
        - name: nccl-test
          image: nvcr.io/nvidia/pytorch:24.05-py3
          command:
            - bash
            - -c
            - |
              # Run all_reduce benchmark
              /usr/local/bin/all_reduce_perf \
                -b 8 -e 4G -f 2 -g 8 \
                -n 100 -w 50
          env:
            # === Transport Selection ===
            - name: NCCL_NET
              value: "IB"              # Force InfiniBand (IB|Socket)

            # === InfiniBand / RDMA ===
            - name: NCCL_IB_HCA
              value: "=mlx5_0,mlx5_1,mlx5_2,mlx5_3"  # Select specific HCAs
            - name: NCCL_IB_GID_INDEX
              value: "3"               # RoCE v2 GID index
            - name: NCCL_IB_TIMEOUT
              value: "23"              # IB timeout (2^23 * 4.096µs ≈ 34s)
            - name: NCCL_IB_RETRY_CNT
              value: "7"               # Max IB retries

            # === GPUDirect RDMA ===
            - name: NCCL_NET_GDR_LEVEL
              value: "5"               # 5 = allow GDR across any PCIe distance
            - name: NCCL_NET_GDR_READ
              value: "1"               # Enable GDR for read operations

            # === Multi-NIC / Rail ===
            - name: NCCL_CROSS_NIC
              value: "0"               # 0 = same rail only (rail-optimized)
            - name: NCCL_IB_QPS_PER_CONNECTION
              value: "4"               # QPs per IB connection

            # === TCP Fallback (if no RDMA) ===
            - name: NCCL_SOCKET_IFNAME
              value: "=eth0"
            - name: NCCL_SOCKET_NTHREADS
              value: "4"               # CPU threads per socket connection
            - name: NCCL_NSOCKS_PERTHREAD
              value: "4"               # Sockets per thread (max 64 total)
            - name: NCCL_BUFFSIZE
              value: "8388608"         # 8MB send/recv buffer

            # === Algorithm / Protocol ===
            # DO NOT set in production — let NCCL auto-select
            # - name: NCCL_ALGO
            #   value: "Ring"          # Ring|Tree|CollnetDirect|CollnetChain
            # - name: NCCL_PROTO
            #   value: "Simple"        # LL|LL128|Simple

            # === Debugging (remove in production) ===
            - name: NCCL_DEBUG
              value: "INFO"
            - name: NCCL_DEBUG_SUBSYS
              value: "INIT,NET,GRAPH"

          resources:
            limits:
              nvidia.com/gpu: "8"
              rdma/rdma_shared_device_a: "1"
          volumeMounts:
            - name: shm
              mountPath: /dev/shm
      volumes:
        - name: shm
          emptyDir:
            medium: Memory
            sizeLimit: 64Gi
      restartPolicy: Never
```

### RCCL Performance Tuning for AMD GPUs

```yaml
apiVersion: batch/v1
kind: Job
metadata:
  name: rccl-benchmark
  namespace: gpu-workloads
spec:
  parallelism: 2
  completions: 2
  template:
    spec:
      hostNetwork: true
      containers:
        - name: rccl-test
          image: rocm/pytorch:rocm6.2-ubuntu22.04-py3.10
          command:
            - bash
            - -c
            - |
              /opt/rocm/bin/all_reduce_perf \
                -b 8 -e 4G -f 2 -g 8 \
                -n 100 -w 50
          env:
            # RCCL uses same env var names as NCCL (mostly)
            # Some are prefixed RCCL_ instead of NCCL_

            # === Network Selection ===
            - name: NCCL_SOCKET_IFNAME
              value: "=eth0"
            - name: NCCL_IB_HCA
              value: "=mlx5_0,mlx5_1,mlx5_2,mlx5_3"

            # === RCCL-Specific ===
            - name: RCCL_MSCCL_ENABLE
              value: "1"               # Enable MSCCL algorithms
            - name: HSA_FORCE_FINE_GRAIN_PCIE
              value: "1"               # Fine-grain PCIe for P2P
            - name: NCCL_MIN_NCHANNELS
              value: "32"              # Min channels (MI300X: 32)
            - name: NCCL_MAX_NCHANNELS
              value: "32"              # Max channels

            # === AMD Infinity Fabric (XGMI) ===
            # Automatic for MI250X/MI300X intra-node
            # No env var needed — detected via topology

            # === RoCE v2 (inter-node) ===
            - name: NCCL_IB_GID_INDEX
              value: "3"
            - name: NCCL_NET_GDR_LEVEL
              value: "3"               # AMD GDR level (check ROCm docs)

            # === Debugging ===
            - name: NCCL_DEBUG
              value: "INFO"
            - name: RCCL_KERNEL_DEBUG
              value: "0"

          resources:
            limits:
              amd.com/gpu: "8"
          volumeMounts:
            - name: shm
              mountPath: /dev/shm
      volumes:
        - name: shm
          emptyDir:
            medium: Memory
            sizeLimit: 64Gi
      restartPolicy: Never
```

### Benchmarking with nccl-tests

```bash
# Build nccl-tests (if not in container image)
git clone https://github.com/NVIDIA/nccl-tests.git
cd nccl-tests
make MPI=1 CUDA_HOME=/usr/local/cuda NCCL_HOME=/usr/lib/x86_64-linux-gnu

# Single-node: 8 GPUs, message sizes 8B to 4GB
./build/all_reduce_perf -b 8 -e 4G -f 2 -g 8

# Multi-node via MPI (2 nodes × 8 GPUs)
mpirun -np 16 --hostfile hosts \
  -x NCCL_IB_HCA=mlx5_0,mlx5_1,mlx5_2,mlx5_3 \
  -x NCCL_DEBUG=INFO \
  ./build/all_reduce_perf -b 8 -e 4G -f 2 -g 8
```

```text
# Expected output interpretation:
#
#       size    count   type   redop   root  time    algbw    busbw
#       (B)    (elements)                    (us)   (GB/s)   (GB/s)
#
#         8         2  float    sum      -   25.3    0.00     0.00
#       256        64  float    sum      -   26.1    0.01     0.02
#      4096      1024  float    sum      -   28.4    0.14     0.27
#     65536     16384  float    sum      -   32.1    2.04     3.83
#   1048576    262144  float    sum      -   48.2   21.76    40.80
#  16777216   4194304  float    sum      -  215.3   77.93   146.12
# 268435456  67108864  float    sum      -  2891    92.84   174.08
#4294967296 1073741824 float    sum      -  44521   96.47   180.88
#
# Key metrics:
# algbw  = algorithm bandwidth (data_size / time)
# busbw  = bus bandwidth (accounts for collective factor)
#         = algbw × 2(n-1)/n for all_reduce with n GPUs
#
# Targets (inter-node, 4x NDR 400G):
#   busbw ≈ 170-190 GB/s (>90% of 4×48 GB/s theoretical)
#
# Targets (intra-node, NVSwitch H100):
#   busbw ≈ 800-850 GB/s (>90% of 900 GB/s theoretical)
```

### Performance Comparison: Transport Impact

```text
Transport              | Latency (µs) | Bandwidth (GB/s) | CPU Overhead
───────────────────────┼──────────────┼──────────────────┼─────────────
NVLink/NVSwitch (H100) |      1-3     |    800-900       |    None
XGMI (MI300X)          |      2-5     |    400-500       |    None
GPUDirect RDMA (IB)    |      3-8     |     45-48        |    Minimal
IB Verbs (host copy)   |     10-20    |     20-24        |    Moderate
RoCE v2 + GDR          |      5-12    |     40-45        |    Minimal
RoCE v2 (host copy)    |     15-30    |     15-20        |    Moderate
TCP (tuned)            |     50-200   |      8-12        |    High
TCP (default)          |    100-500   |      2-5         |    Very High
───────────────────────┴──────────────┴──────────────────┴─────────────

GPUDirect RDMA eliminates CPU from the data path:
  Without GDR: GPU → CPU memory → NIC → wire → NIC → CPU memory → GPU
  With GDR:    GPU → NIC → wire → NIC → GPU  (zero CPU copies)
```

### GPUDirect RDMA Verification

```bash
# Verify GDR is enabled (inside GPU pod)
# Check for nvidia_peermem module
lsmod | grep nvidia_peermem
# nvidia_peermem    16384  0

# Or check NCCL debug output for "GPU Direct RDMA"
export NCCL_DEBUG=INFO
python3 -c "
import torch.distributed as dist
import os
os.environ.update({'MASTER_ADDR':'localhost','MASTER_PORT':'29500','RANK':'0','WORLD_SIZE':'1'})
dist.init_process_group('nccl')
t = torch.zeros(1024*1024).cuda()
dist.all_reduce(t)
" 2>&1 | grep -i "gdr\|gpu direct\|NET/"

# Expected: "NET/IB : Using [0]mlx5_0:1/GDR ; ..."
# If no GDR: "NET/IB : Using [0]mlx5_0:1/ ; ..."  (missing /GDR)

# Verify peer memory registered
cat /sys/kernel/mm/memory_peers/nv_mem/version
# 2.0

# Check IB device GDR capability
ibv_devinfo -d mlx5_0 | grep -i "fw_ver\|phys_port"
```

### NIC-GPU Affinity (Critical for Performance)

```text
Optimal: NIC and GPU on same PCIe root complex / NUMA node
  GPU0 ←PCIe→ NIC0 (same NUMA 0) → 48 GB/s with GDR ✓
  GPU4 ←PCIe→ NIC2 (same NUMA 1) → 48 GB/s with GDR ✓

Suboptimal: NIC and GPU on different NUMA nodes
  GPU0 (NUMA 0) → QPI/UPI → NIC2 (NUMA 1) → ~30 GB/s (30-40% loss)
```

```bash
# Check GPU-NIC affinity
nvidia-smi topo -m
#         GPU0  GPU1  GPU2  GPU3  mlx5_0  mlx5_1  CPU Affinity  NUMA
# GPU0     X    NV18  NV18  NV18  PXB     SYS     0-63          0
# GPU1    NV18   X    NV18  NV18  SYS     PXB     0-63          0
# mlx5_0  PXB   SYS   SYS   SYS   X       SYS     0-63          0
# mlx5_1  SYS   PXB   SYS   SYS  SYS      X       0-63          0
#
# PXB = same PCIe bridge (best for GDR)
# SYS = cross-socket (suboptimal)
# NV = NVLink

# For AMD GPUs
rocm-smi --showtopo
```

### Kubernetes Network Configurations

```yaml
# Option 1: Host Network (best performance, least isolation)
apiVersion: v1
kind: Pod
spec:
  hostNetwork: true
  dnsPolicy: ClusterFirstWithHostNet
  containers:
    - name: trainer
      env:
        - name: NCCL_SOCKET_IFNAME
          value: "=ib0"    # Use host IB interface directly

---
# Option 2: SR-IOV VF (near-host performance + isolation)
apiVersion: v1
kind: Pod
spec:
  containers:
    - name: trainer
      resources:
        limits:
          nvidia.com/gpu: "8"
          openshift.io/mlx5-rdma: "1"   # SR-IOV VF with RDMA
      env:
        - name: NCCL_IB_HCA
          value: "=mlx5_2"              # VF device name in pod

---
# Option 3: Macvlan/IPVLAN (decent performance, simpler setup)
apiVersion: v1
kind: Pod
metadata:
  annotations:
    k8s.v1.cni.cncf.io/networks: rdma-net
spec:
  containers:
    - name: trainer
      env:
        - name: NCCL_SOCKET_IFNAME
          value: "=net1"               # Secondary network interface

---
# Option 4: Pod network only (worst for NCCL, fine for small scale)
apiVersion: v1
kind: Pod
spec:
  containers:
    - name: trainer
      env:
        - name: NCCL_SOCKET_IFNAME
          value: "=eth0"
        - name: NCCL_SOCKET_NTHREADS
          value: "8"                   # More threads to compensate
        - name: NCCL_NSOCKS_PERTHREAD
          value: "4"
```

### RoCE v2 Tuning (Ethernet-Based RDMA)

```yaml
# RoCE requires careful network configuration
env:
  # RoCE GID index (typically 3 for RoCEv2)
  - name: NCCL_IB_GID_INDEX
    value: "3"

  # Disable adaptive routing if causing issues
  - name: NCCL_IB_ADAPTIVE_ROUTING
    value: "0"

  # Traffic class for DSCP marking
  - name: NCCL_IB_TC
    value: "106"    # Maps to DSCP 26 (AF31) for PFC

  # Increase timeout for lossy networks
  - name: NCCL_IB_TIMEOUT
    value: "22"     # Higher = more tolerant of drops

  # Service level (priority)
  - name: NCCL_IB_SL
    value: "0"
```

```text
RoCE v2 switch requirements:
├── PFC (Priority Flow Control) enabled on GPU traffic class
├── ECN (Explicit Congestion Notification) enabled
├── Large buffers for bursty all-reduce traffic
├── Jumbo frames (MTU 9000) recommended
└── DCQCN or DCTCP congestion control
```

### Performance Optimization Checklist

```text
Category          │ Check                                    │ Impact
──────────────────┼──────────────────────────────────────────┼────────
Transport         │ GPUDirect RDMA enabled (nvidia_peermem)  │ 2-3x
                  │ NVLink/NVSwitch for intra-node           │ 10-30x
                  │ InfiniBand > RoCE > TCP                  │ 5-10x
──────────────────┼──────────────────────────────────────────┼────────
Topology          │ NIC-GPU same NUMA/PCIe root              │ 30-40%
                  │ NCCL_CROSS_NIC=0 (rail-optimized)        │ 10-20%
                  │ Correct NCCL_IB_HCA selection            │ 20-50%
──────────────────┼──────────────────────────────────────────┼────────
Kubernetes        │ hostNetwork or SR-IOV (bypass CNI)       │ 2-5x
                  │ /dev/shm large enough (≥ model size)     │ avoid OOM
                  │ NUMA-aware scheduling                    │ 10-20%
──────────────────┼──────────────────────────────────────────┼────────
TCP fallback      │ SOCKET_NTHREADS × NSOCKS_PERTHREAD ≤ 64 │ 2-4x
                  │ BUFFSIZE=8388608 (8MB)                   │ 10-30%
                  │ Jumbo frames (MTU 9000)                  │ 10-15%
──────────────────┼──────────────────────────────────────────┼────────
Protocol          │ Let NCCL auto-select (don't force)       │ varies
                  │ LL128 for small messages (<256KB)         │ latency
                  │ Simple for large messages (>1MB)          │ bandwidth
──────────────────┴──────────────────────────────────────────┴────────
```

### Monitoring NCCL/RCCL Performance in Production

```yaml
# DCGM metrics for NCCL monitoring
apiVersion: v1
kind: ConfigMap
metadata:
  name: dcgm-metrics
  namespace: gpu-operator
data:
  custom-metrics.csv: |
    # NVLink bandwidth
    DCGM_FI_PROF_NVLINK_TX_BYTES, gauge, NVLink TX bytes
    DCGM_FI_PROF_NVLINK_RX_BYTES, gauge, NVLink RX bytes
    # PCIe bandwidth (for non-NVLink transfers)
    DCGM_FI_PROF_PCIE_TX_BYTES, gauge, PCIe TX bytes
    DCGM_FI_PROF_PCIE_RX_BYTES, gauge, PCIe RX bytes
```

```bash
# Real-time NVLink utilization
nvidia-smi nvlink -gt d -i 0
# GPU 0: NVLink throughput: TX: 45 GB/s, RX: 45 GB/s

# IB port counters
perfquery -x mlx5_0 1
# PortXmitData:..............1234567890
# PortRcvData:...............1234567890

# Check for RDMA errors / retransmits
rdma stat show link mlx5_0/1
```

## Common Issues

### busbw much lower than expected (50% or less of theoretical)
- **Cause**: NIC-GPU affinity mismatch (cross-NUMA traffic)
- **Fix**: Verify with `nvidia-smi topo -m`; select NICs on same PCIe root as GPUs

### "NET/IB : No device found" in NCCL debug
- **Cause**: RDMA device not exposed to container
- **Fix**: Add `rdma/rdma_shared_device_a: "1"` to resource limits; verify device plugin

### High latency for small messages (>100µs)
- **Cause**: Using TCP instead of RDMA; or NCCL falling back to shared memory
- **Fix**: Verify IB/RoCE is active in `NCCL_DEBUG=INFO` output; check `NCCL_NET=IB`

### RCCL hangs on multi-node all_reduce
- **Cause**: XGMI detected but no inter-node RDMA configured
- **Fix**: Set `NCCL_IB_HCA` explicitly; verify RoCE GID index with `ibv_devinfo`

### Performance degrades at scale (>32 GPUs)
- **Cause**: Tree algorithm hitting network bottlenecks; or congestion without PFC/ECN
- **Fix**: Verify switch PFC configuration; check for packet drops with `ethtool -S`

### "Connection refused" between nodes
- **Cause**: Firewall blocking NCCL ports (random high ports) or IB subnet manager down
- **Fix**: Use `hostNetwork: true`; or open port range 40000-50000; verify SM with `ibstat`

## Best Practices

1. **Always use GPUDirect RDMA** — eliminates 2 CPU memory copies per transfer
2. **Match NIC-GPU NUMA affinity** — verify with `nvidia-smi topo -m` before deploying
3. **Use hostNetwork or SR-IOV** — pod CNI adds 10-50µs latency per transfer
4. **Benchmark before production** — run `all_reduce_perf` on every new cluster
5. **Don't force NCCL_ALGO/NCCL_PROTO** — auto-selection is optimal 95% of the time
6. **Size /dev/shm adequately** — at least 1GB per GPU for NCCL shared memory
7. **Enable PFC/ECN for RoCE** — without flow control, RoCE drops packets under load
8. **Use NCCL_TOPO_DUMP_FILE** — cache topology to avoid 10-30s detection per container start
9. **Monitor NVLink/PCIe counters** — DCGM exposes per-GPU link utilization
10. **RCCL on AMD: set NCCL_MIN/MAX_NCHANNELS** — MI300X benefits from 32 channels

## Key Takeaways

- NCCL (NVIDIA) and RCCL (AMD) handle all GPU collective communication — optimizing them is critical for distributed workloads
- GPUDirect RDMA gives 2-3x bandwidth improvement over CPU-mediated transfers
- NIC-GPU PCIe/NUMA affinity is the #1 source of unexpected performance loss
- InfiniBand > RoCE v2 > TCP — each step down is 2-5x slower
- Kubernetes networking (CNI) adds overhead — use hostNetwork or SR-IOV for GPU traffic
- RCCL is API-compatible with NCCL but needs AMD-specific tuning (MSCCL, channel count, XGMI)
- Benchmark target: >90% of theoretical link bandwidth on large messages (≥256MB)
- Auto-selection beats manual algorithm/protocol forcing in almost all cases
- Production monitoring: DCGM NVLink/PCIe counters + IB port perfquery + error rates
