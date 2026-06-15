---
title: "ib_write_bw RDMA Bandwidth Testing on Kubernetes GPU Nodes"
description: "Use ib_write_bw from perftest suite to validate RDMA write bandwidth on Kubernetes GPU nodes with SR-IOV. Covers device selection with -d mlx5_X, GID index for RoCE, multi-connection scaling, bidirectional tests, and expected bandwidth for ConnectX-7 400G NICs."
tags:
  - "networking"
  - "rdma"
  - "performance"
  - "benchmarking"
  - "gpu"
category: "networking"
publishDate: "2026-06-15"
author: "Luca Berton"
difficulty: "advanced"
relatedRecipes:
  - "nvidia-doca-bench-dpu-performance-kubernetes"
  - "nccl-all-reduce-perf-benchmark-multi-node"
  - "nccl-network-validation-troubleshooting-checklist"
---

> 💡 **Quick Answer:** Run `ib_write_bw -d mlx5_X -x 3 --report_gbits` to measure raw RDMA write bandwidth on a specific SR-IOV VF. Use `-x 3` for RoCEv2 over IPv4 (GID index 3). Expected: ~49 Gbps per VF on ConnectX-7 400G (single connection), scaling to ~395 Gbps with multiple QPs. This validates the RDMA data plane independently of NCCL before running GPU training.

## The Problem

- Need to validate raw RDMA bandwidth before running NCCL benchmarks
- Multiple mlx5 devices visible (e.g., mlx5_0 through mlx5_25) — must select correct VF
- Default `ib_write_bw` uses IB addressing — RoCE needs GID index override
- Single-connection test may not saturate 400G NIC — multi-QP testing needed
- Must isolate NIC/switch issues from NCCL/GPU topology issues

## The Solution

### Basic ib_write_bw Test

```bash
# Server side (node 1):
ib_write_bw -d mlx5_0 -x 3 --report_gbits

# Client side (node 2):
ib_write_bw -d mlx5_0 -x 3 --report_gbits 192.168.100.1

# Parameters:
#   -d mlx5_0    : Select specific RDMA device (VF or PF)
#   -x 3         : GID index 3 (RoCEv2 over IPv4)
#   --report_gbits: Report in Gbps (not MB/s)
```

### Device Selection with SR-IOV

```bash
# List available RDMA devices in the pod:
ibv_devinfo -l
# Expected:
#   device                 node GUID
#   ------              ----------------
#   mlx5_0              b8cef6030042a1c6
#   mlx5_1              b8cef6030042a1c7
#   ...
#   mlx5_25             b8cef6030042a1df

# When pod has many VFs (e.g., shared RDMA device plugin):
# Use the VF that corresponds to your net1 interface:
ibdev2netdev
# mlx5_0 port 1 ==> net1 (Up)
# mlx5_3 port 1 ==> net2 (Up)

# Select the device backing your SR-IOV network:
ib_write_bw -d mlx5_0 -x 3 --report_gbits    # Uses net1's VF
ib_write_bw -d mlx5_25 -x 3 --report_gbits   # Uses mlx5_25 specifically
```

### Full Test Output

```text
# ib_write_bw -d mlx5_0 -x 3 --report_gbits 192.168.100.1

************************************
* Waiting for client to connect... *
************************************
---------------------------------------------------------------------------------------
                    RDMA_Write BW Test
 Dual-port       : OFF          Device         : mlx5_0
 Number of qps   : 1            Transport type : IB
 Connection type  : RC           Using SRQ      : OFF
 PCIe relaxed order: ON
 ibv_wr* API     : ON
 TX depth        : 128
 CQ Moderation   : 1
 Mtu             : 4096[B]
 Link type       : Ethernet
 GID index       : 3
 Max inline data : 0[B]
 rdma_cm QPs     : OFF
 Data ex. method : Ethernet
---------------------------------------------------------------------------------------
 local address: LID 0000 QPN 0x0104 PSN 0x3cf296 RKey 0x080300 VAddr 0x7f2b78000000
 GID: 00:00:00:00:00:00:00:00:00:00:ff:ff:c0:a8:64:05
 remote address: LID 0000 QPN 0x0109 PSN 0x7a2c14 RKey 0x080300 VAddr 0x7f1a64000000
 GID: 00:00:00:00:00:00:00:00:00:00:ff:ff:c0:a8:64:06
---------------------------------------------------------------------------------------
 #bytes     #iterations    BW peak[Gbps]   BW average[Gbps]   MsgRate[Mpps]
 65536      5000           49.12           49.07              0.093632
---------------------------------------------------------------------------------------
```

### Multi-QP Scaling (Saturate 400G)

```bash
# Single QP won't saturate 400G NIC — use multiple queue pairs:

# Server:
ib_write_bw -d mlx5_0 -x 3 --report_gbits -q 8

# Client:
ib_write_bw -d mlx5_0 -x 3 --report_gbits -q 8 192.168.100.1

# -q 8 = 8 queue pairs in parallel
# Expected scaling:
#   -q 1:  ~49 Gbps
#   -q 2:  ~98 Gbps
#   -q 4:  ~196 Gbps
#   -q 8:  ~380-395 Gbps (approaching 400G line rate)
```

### Message Size Sweep

```bash
# Test across different message sizes (models real workload patterns):

# Server:
ib_write_bw -d mlx5_0 -x 3 --report_gbits -a

# Client:
ib_write_bw -d mlx5_0 -x 3 --report_gbits -a 192.168.100.1

# -a = all message sizes (2 bytes to 8MB)

# Expected output (ConnectX-7 400G):
# #bytes     BW peak[Gbps]   BW average[Gbps]
# 2          0.14            0.13
# 4          0.28            0.27
# 64         4.21            4.18
# 1024       42.15           41.89
# 4096       48.92           48.76
# 65536      49.12           49.07
# 1048576    49.15           49.12
# 8388608    49.16           49.14
```

### Bidirectional Test

```bash
# Test both directions simultaneously:

# Server:
ib_write_bw -d mlx5_0 -x 3 --report_gbits -b

# Client:
ib_write_bw -d mlx5_0 -x 3 --report_gbits -b 192.168.100.1

# -b = bidirectional
# Expected: ~49 Gbps each direction (full-duplex)
# Total: ~98 Gbps bidirectional on single QP
```

### Latency Test (ib_write_lat)

```bash
# Complement bandwidth test with latency measurement:

# Server:
ib_write_lat -d mlx5_0 -x 3

# Client:
ib_write_lat -d mlx5_0 -x 3 192.168.100.1

# Expected (ConnectX-7 RoCE, same switch):
# #bytes    t_avg[usec]    t_median[usec]
# 2         1.45           1.42
# 64        1.48           1.45
# 1024      1.62           1.59
# 65536     4.21           4.18
```

### GPUDirect RDMA Test (GPU Memory)

```bash
# Test RDMA directly from GPU memory (validates GPUDirect path):

# Server:
ib_write_bw -d mlx5_0 -x 3 --report_gbits --use_cuda=0

# Client:
ib_write_bw -d mlx5_0 -x 3 --report_gbits --use_cuda=0 192.168.100.1

# --use_cuda=0 : Use GPU 0 memory for RDMA buffers
# This tests the GPUDirect RDMA path (GPU → NIC without CPU)
# Expected: ~45-49 Gbps (slightly less than host memory due to BAR mapping)

# If GPUDirect NOT working, falls back to CPU bounce:
# Expected: ~25-30 Gbps (visible performance gap)
```

### Common perftest Options

```text
Option              │ Purpose                                  │ Default
────────────────────┼──────────────────────────────────────────┼─────────
-d <device>         │ RDMA device name                         │ First found
-x <gid_index>     │ GID index (3 for RoCEv2 IPv4)            │ 0
-q <num_qps>       │ Number of queue pairs                    │ 1
-a                  │ Run all message sizes                    │ 65536
-b                  │ Bidirectional                            │ Unidirectional
-n <iterations>    │ Number of iterations                     │ 5000
-s <size>          │ Message size in bytes                    │ 65536
-D <seconds>       │ Duration mode (run for N seconds)        │ Off
--report_gbits     │ Report in Gbps                           │ MB/s
--use_cuda=<gpu>   │ Use GPU memory (GPUDirect)               │ Host memory
--mtu <mtu>        │ Path MTU (256/512/1024/2048/4096)        │ 4096
-p <port>          │ Listen port                              │ 18515
--rdma_cm          │ Use RDMA CM for connection               │ Off
────────────────────┴──────────────────────────────────────────┴─────────
```

### Kubernetes Job for RDMA Validation

```yaml
apiVersion: batch/v1
kind: Job
metadata:
  name: ib-write-bw-server
  namespace: gpu-benchmark
spec:
  template:
    metadata:
      annotations:
        k8s.v1.cni.cncf.io/networks: sriov-rdma-net
    spec:
      nodeSelector:
        kubernetes.io/hostname: gpu-worker-01
      containers:
        - name: perftest
          image: registry.example.com/rdma-perftest:latest
          command: ["ib_write_bw", "-d", "mlx5_0", "-x", "3",
                   "--report_gbits", "-D", "30"]
          securityContext:
            capabilities:
              add: ["IPC_LOCK", "NET_RAW"]
          resources:
            limits:
              openshift.io/mellanoxnics: 1
      restartPolicy: Never

---
apiVersion: batch/v1
kind: Job
metadata:
  name: ib-write-bw-client
  namespace: gpu-benchmark
spec:
  template:
    metadata:
      annotations:
        k8s.v1.cni.cncf.io/networks: sriov-rdma-net
    spec:
      nodeSelector:
        kubernetes.io/hostname: gpu-worker-02
      containers:
        - name: perftest
          image: registry.example.com/rdma-perftest:latest
          command: ["sh", "-c",
                   "sleep 5 && ib_write_bw -d mlx5_0 -x 3 --report_gbits -D 30 192.168.100.5"]
          securityContext:
            capabilities:
              add: ["IPC_LOCK", "NET_RAW"]
          resources:
            limits:
              openshift.io/mellanoxnics: 1
      restartPolicy: Never
```

### Interpreting Results

```text
Measured BW         │ Diagnosis
────────────────────┼─────────────────────────────────────────────────
~49 Gbps (1 QP)    │ ✓ Normal for single QP on 400G
~395 Gbps (8 QP)   │ ✓ Full line rate saturated
~25 Gbps            │ ⚠ PCIe bottleneck or wrong NUMA
~12 Gbps            │ ⚠ CPU bounce buffer (no GPUDirect)
~5 Gbps             │ ❌ Falling to TCP/socket transport
~0.5 Gbps           │ ❌ MTU mismatch or PFC not configured
0 Gbps (timeout)    │ ❌ No connectivity (GID index, IP, firewall)
────────────────────┴─────────────────────────────────────────────────
```

## Common Issues

### "Unable to find GID with index 3"
- **Cause**: No IPv4 address on the RDMA interface
- **Fix**: Verify `ip addr show net1` has an IPv4 address; check IPAM

### Timeout waiting for client connection
- **Cause**: Server and client not on same L2/L3 network
- **Fix**: Verify both pods on same SR-IOV subnet; check switch VLAN config

### Bandwidth ~25 Gbps instead of ~49 Gbps
- **Cause**: PCIe Gen4 instead of Gen5, or wrong NUMA zone
- **Fix**: Check `lspci -vvv` for link speed; verify NUMA locality with `numactl`

### "Couldn't allocate MR" error
- **Cause**: Missing IPC_LOCK capability or memlock ulimit too low
- **Fix**: Add `IPC_LOCK` capability; set `ulimit -l unlimited`

### Different BW on different mlx5_X devices
- **Cause**: VFs from different physical NICs have different PCIe paths
- **Fix**: Use `ibdev2netdev` to map device→interface; pick NUMA-local device

## Best Practices

1. **Always specify `-x 3`** for RoCE on Kubernetes (GID index for IPv4)
2. **Test single QP first** — establishes baseline per-connection bandwidth
3. **Scale QPs to saturate** — `-q 4` or `-q 8` for 400G NICs
4. **Use `--use_cuda`** to validate GPUDirect RDMA path specifically
5. **Run `-a` (all sizes)** to catch small-message latency issues
6. **Compare with `ib_write_lat`** — bandwidth + latency gives full picture
7. **Test before NCCL** — isolates NIC/switch from GPU topology issues
8. **Use duration mode (`-D 30`)** for stable measurements (avoids warmup noise)

## Key Takeaways

- `ib_write_bw` from perftest suite is the standard RDMA bandwidth micro-benchmark
- `-d mlx5_X` selects specific SR-IOV VF — use `ibdev2netdev` to map device to interface
- Single QP: ~49 Gbps on 400G; need 4-8 QPs to reach line rate (~395 Gbps)
- GID index 3 (`-x 3`) is mandatory for RoCEv2 over IPv4 in Kubernetes
- `--use_cuda=0` validates the GPUDirect RDMA path end-to-end
- Run ib_write_bw BEFORE nccl-tests to isolate networking from GPU issues
- If ib_write_bw shows full bandwidth but NCCL is slow → problem is topology/config, not network
