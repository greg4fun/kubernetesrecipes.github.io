---
title: "NCCL All-Reduce Benchmarking on Multi-Node GPUs"
description: "Run and interpret NCCL all_reduce_perf benchmarks on multi-node Kubernetes GPU clusters. Understand bus bandwidth results, expected throughput for H200 NVL"
tags:
  - "nccl"
  - "benchmarking"
  - "all-reduce"
  - "gpu"
  - "rdma"
category: "ai"
publishDate: "2026-06-04"
author: "Luca Berton"
difficulty: "advanced"
relatedRecipes:
  - "nccl-topology-dump-tuning-kubernetes"
  - "nvlink-bridge-architecture-gpu-kubernetes"
---

> 💡 **Quick Answer:** Run `all_reduce_perf` from nccl-tests across nodes to measure collective communication bandwidth. On 2-node H200 NVL (8 GPUs/node, 4x ConnectX-7 RoCE), expect ~35 GB/s peak bus bandwidth for large messages (≥1GB) and ~13-18 GB/s average across all sizes. Results below 30 GB/s at large sizes indicate network misconfiguration, missing GDRDMA, or NIC-GPU topology mismatch.

## The Problem

- Need to validate GPU cluster interconnect performance before running production training
- Don't know if NCCL is achieving theoretical bandwidth on your fabric
- Can't tell if GPUDirect RDMA is actually working vs falling back to host memory staging
- Need baseline numbers to compare against after config changes
- Multi-node all-reduce is the critical path for data-parallel training throughput

## The Solution

### Run all_reduce_perf on Kubernetes

```yaml
apiVersion: batch/v1
kind: Job
metadata:
  name: nccl-allreduce-bench
  namespace: gpu-workloads
spec:
  parallelism: 2       # 2 nodes
  completions: 2
  template:
    spec:
      hostNetwork: true
      containers:
        - name: nccl-test
          image: nvcr.io/nvidia/pytorch:24.04-py3
          command:
            - bash
            - -c
            - |
              /build/all_reduce_perf \
                -b 8 \
                -e 8G \
                -f 2 \
                -g 8 \
                -n 20 \
                -w 5
          env:
            - name: NCCL_DEBUG
              value: "INFO"
            - name: NCCL_IB_HCA
              value: "mlx5_0,mlx5_3,mlx5_5,mlx5_6"
            - name: NCCL_NET_GDR_LEVEL
              value: "5"
            - name: MASTER_ADDR
              value: "10.10.13.10"
            - name: MASTER_PORT
              value: "29500"
            - name: NCCL_NVLS_ENABLE
              value: "1"
          resources:
            limits:
              nvidia.com/gpu: "8"
              rdma/rdma_shared_device_a: "1"
```

### Using MPI Launcher

```bash
# From a launcher pod with SSH access to both nodes
mpirun --np 16 --npernode 8 \
  --host node1:8,node2:8 \
  --mca btl_tcp_if_include eth0 \
  -x NCCL_DEBUG=INFO \
  -x NCCL_IB_HCA=mlx5_0,mlx5_3,mlx5_5,mlx5_6 \
  -x NCCL_NET_GDR_LEVEL=5 \
  -x LD_LIBRARY_PATH=/usr/lib/x86_64-linux-gnu \
  /build/all_reduce_perf -b 8 -e 8G -f 2 -g 1 -n 20 -w 5
```

### Interpreting Results

```text
# all_reduce_perf output format:
#                                              out-of-place          in-place
#       size    count   type  redop  root    time   algbw  busbw  #wrong   time   algbw  busbw  #wrong
#        (B) (elements)                       (us)  (GB/s) (GB/s)          (us)  (GB/s) (GB/s)
           8        2  float    sum    -1    27.80   0.00   0.00      0    27.83   0.00   0.00       0
         128       32  float    sum    -1    28.24   0.00   0.01      0    27.96   0.00   0.01       0
        1024      256  float    sum    -1    30.31   0.03   0.06      0    29.97   0.03   0.06       0
        8192     2048  float    sum    -1    38.24   0.21   0.40      0    37.78   0.22   0.41       0
       65536    16384  float    sum    -1    63.41   1.03   1.94      0    62.52   1.05   1.97       0
      524288   131072  float    sum    -1   256.85   2.04   3.83      0   249.74   2.10   3.94       0
     4194304  1048576  float    sum    -1   437.59   9.59  17.97      0   436.09   9.62  18.03       0
    33554432  8388608  float    sum    -1   531.96  15.77  29.57      0   530.99  15.80  29.62       0
   268435456 67108864  float    sum    -1 14314.7   18.75  35.16      0 14972.1   17.93  33.62       0
  1073741824  2.68e+8  float    sum    -1 59530.2   18.04  33.82      0 57634.7   18.63  34.93       0
  8589934592  2.15e+9  float    sum    -1  458955  18.72  35.09      0  459021   18.71  35.09       0
# Avg bus bandwidth: 13.49 GB/s

Key columns:
  size     = message size in bytes
  algbw    = algorithm bandwidth (size/time)
  busbw    = bus bandwidth (corrected for algorithm — the meaningful metric)
  #wrong   = data verification errors (should be 0)
```

### Bus Bandwidth Expectations

```text
Configuration                          │ Expected Peak busbw │ Notes
───────────────────────────────────────┼─────────────────────┼──────────────────
2-node, 4x ConnectX-7 400G RoCE       │ 35-50 GB/s          │ 4 NICs × ~12.5 GB/s
2-node, 4x ConnectX-7 400G IB         │ 40-55 GB/s          │ IB slightly better
2-node, 8x ConnectX-7 400G IB (DGX)   │ 80-100 GB/s         │ Full NIC count
1-node only (NVLink H200)             │ 400-450 GB/s        │ NVLink-only
───────────────────────────────────────┴─────────────────────┴──────────────────

Formula for expected bus bandwidth (all-reduce ring):
  busbw_max = N_NICs × link_rate × 2(N-1)/N × efficiency
  = 4 × 50 GB/s × (2×15/16) × 0.90
  ≈ 4 × 50 × 1.875 × 0.9 ≈ 337.5 (theoretical, single-node)

Cross-node limited by:
  = 4 NICs × 50 GB/s (400Gbps each) × efficiency(0.85)
  ≈ 170 GB/s link bandwidth, but all-reduce correction: busbw = algbw × 2(N-1)/N
```

### Understanding NCCL Transport Selection

```text
From NCCL INFO logs:

Intra-node (GPU-to-GPU on same server):
  Channel X : 2[2] -> 1[1] via P2P/CUMEM
  └── P2P/CUMEM = NVLink direct memory access (fastest)

  Channel X : 4[4] -> 2[2] via SHM/direct/direct  
  └── SHM = shared memory (cross-NVLink-group, still intra-node)

Inter-node (GPU-to-GPU across network):
  Channel X : 0[0] -> 8[0] [send] via NET/IB/2(3)/GDRDMA
  └── NET/IB = InfiniBand/RoCE network
  └── /2(3) = NIC index 2, port 3
  └── /GDRDMA = GPUDirect RDMA enabled (GPU memory → NIC → wire directly)

Proxy Progress:
  [Proxy Progress] Device 3 CPU core 289
  └── CPU core handling network proxy for GPU 3
  └── Should be on same NUMA node as GPU for best latency
```

### NCCL Initialization Decoded

```text
NCCL INFO NCCL version 2.29.3+cuda13.1
NCCL INFO NCCL git version stable dcf2a2fbe
NCCL INFO cudaDriverVersion 13010
NCCL INFO Bootstrap: Using enol7195np0:10.10.13.10<0>

NCCL INFO 10 coll channels, 10 collnet channels, 0 nvls channels, 16 p2p channels, 2 p2p channels per peer
  └── coll channels: rings/trees for collective ops
  └── p2p channels: point-to-point (send/recv)
  └── nvls channels: 0 means NVLS (NVLink SHARP) not used for this config

NCCL INFO threadThresholds 8/8/64 | 128/8/64 | 512 | 512
  └── Thread thresholds for different protocol sizes

NCCL INFO CC Off, workFifoBytes 1048576
  └── CC (Compute Capability) features; work FIFO size 1MB

NCCL TUNER/Plugin: Could not find: libnccl-tuner.so
  └── No external tuner plugin — using built-in algorithms (fine)
```

### nccl1CommInitRankConfig Decoded

```text
nccl1CommInitRankConfig comm 0x5ac47f7d1bd0 rank 7 nranks 16 cudaDev 7 nvmlDev 7 busId 1c8000 commId 0x61ff503aed8cflcc - Init COMPLETE
  └── rank 7 of 16 total ranks
  └── cudaDev 7 = CUDA device index 7
  └── nvmlDev 7 = NVML device index 7
  └── busId 1c8000 = PCIe bus ID (domain:bus:device)

Init timings - total 16.08 (kernels 0.15, alloc 15.58, bootstrap 0.21, allgathers 0.00, topo 0.05, graphs ...)
  └── total 16.08s initialization
  └── alloc 15.58s = memory allocation (dominant — pre-allocating NCCL buffers)
  └── bootstrap 0.21s = establishing connections between ranks
  └── topo 0.05s = topology detection
```

### Network Plugin Stack

```text
NCCL INFO Assigned NET plugin IB to comm        ← InfiniBand/RoCE network
NCCL INFO Assigned GIN plugin GIN_IB_GDAKT to comm  ← GPU-Initiated Network (DMA)
NCCL INFO Assigned RMA plugin GIN_IB_PROXY to comm  ← Remote Memory Access via proxy
NCCL INFO Using network IB                      ← Confirmed: IB transport active

NCCL INFO NET/IB: Using [0]mlx5_0:1/RoCE [1]mlx5_3:1/RoCE [2]mlx5_5:1/RoCE [3]mlx5_6:1/RoCE [4]mlx5...
  └── 4 Mellanox NICs active for NCCL traffic
  └── :1/RoCE = port 1, RoCE mode (not native IB)

NCCL INFO DMA-BUF is available on GPU device 7
  └── DMA-BUF = kernel interface for GPUDirect RDMA
  └── Must show for each GPU — confirms GDRDMA works
```

### Tuning for Better Results

```yaml
env:
  # Enable NVLink SHARP (if supported)
  - name: NCCL_NVLS_ENABLE
    value: "1"
  # NVLink-centric scheduling (H200/H100)
  - name: NCCL_NVLINK_CENTRIC_SCHED
    value: "1"
  # Use all available NICs
  - name: NCCL_IB_HCA
    value: "mlx5_0,mlx5_3,mlx5_5,mlx5_6"
  # Max channels (more parallelism)
  - name: NCCL_MAX_NCHANNELS
    value: "16"
  # Min channels (avoid idle NICs)
  - name: NCCL_MIN_NCHANNELS
    value: "8"
  # GPUDirect RDMA threshold (use for messages > 0 bytes)
  - name: NCCL_NET_GDR_LEVEL
    value: "5"
  # Protocol selection
  - name: NCCL_PROTO
    value: "Simple,LL,LL128"
  # Buffer sizes
  - name: NCCL_BUFFSIZE
    value: "8388608"
```

## Common Issues

### Peak busbw much lower than expected (< 20 GB/s with 4x 400G NICs)
- **Cause**: GDRDMA not active (missing DMA-BUF); or only 1-2 NICs used instead of 4
- **Fix**: Check for `DMA-BUF is available` per GPU; verify `NCCL_IB_HCA` lists all NICs; check `NET/IB: Using` line

### "Could not find: libnccl-tuner.so" warning
- **Cause**: Optional tuner plugin not installed — NOT an error
- **Fix**: Ignore. NCCL uses built-in algorithms. Install tuner plugin only for specific fabric optimizations

### High latency for small messages (> 50µs)
- **Cause**: Normal for cross-node (network RTT); or proxy thread on wrong NUMA
- **Fix**: Small message latency dominated by network RTT (~5-15µs per hop). For optimization: pin proxy cores to GPU-local NUMA

### #wrong > 0 (data corruption)
- **Cause**: Hardware error (NIC, cable, switch); or software bug (rare)
- **Fix**: Critical — indicates data corruption. Check switch error counters, cable CRC errors, replace hardware

### Bandwidth plateaus below theoretical at large sizes
- **Cause**: Switch congestion; PFC pauses; or insufficient channels
- **Fix**: Check switch port counters for pause frames; increase `NCCL_MAX_NCHANNELS`; verify ECN/PFC config

## Best Practices

1. **Always run all_reduce_perf before production training** — establishes baseline
2. **Test increasing message sizes (-b 8 -e 8G -f 2)** — reveals bandwidth vs latency behavior
3. **Verify GDRDMA per GPU** — every GPU should show `DMA-BUF is available`
4. **Check all NICs are active** — `NET/IB: Using [0]... [1]... [2]... [3]...`
5. **Compare in-place vs out-of-place** — should be similar (if not, memory contention)
6. **Run with `NCCL_DEBUG=INFO`** — confirms transport paths and plugin assignments
7. **Record baselines** — compare after any network/driver/firmware changes

## Key Takeaways

- `all_reduce_perf` is the standard NCCL collective benchmark — measures actual cross-node bandwidth
- **busbw** is the meaningful metric (corrected for algorithm overhead)
- 2-node H200 NVL with 4x 400G RoCE: expect ~35 GB/s peak busbw, ~13-18 GB/s average
- P2P/CUMEM = NVLink intra-node; NET/IB/GDRDMA = RDMA inter-node (both are optimal paths)
- DMA-BUF required per GPU for GPUDirect RDMA — verify in NCCL INFO output
- `nvlinkCentricSched=1` enables NVLink-aware communication scheduling (H100/H200)
- #wrong must always be 0 — non-zero means hardware-level data corruption
