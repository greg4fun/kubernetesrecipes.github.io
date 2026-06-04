---
title: "NCCL Network Validation Troubleshooting Checklist"
description: "Complete troubleshooting checklist for NCCL multi-node GPU bandwidth validation. Covers SR-IOV VF allocation, /dev/infiniband visibility, RoCE GID index, MTU, PFC/ECN, GPUDirect RDMA, NCCL_SOCKET_IFNAME, PCIe/NUMA locality, and per-rank HCA selection verification."
tags:
  - "nccl"
  - "troubleshooting"
  - "rdma"
  - "networking"
  - "performance"
category: "troubleshooting"
publishDate: "2026-06-04"
author: "Luca Berton"
difficulty: "advanced"
relatedRecipes:
  - "nccl-network-validator-production-mpijob"
  - "nccl-gdr-level-tuning-pix-pxb-phb-sys"
  - "nccl-all-reduce-perf-benchmark-multi-node"
---

> 💡 **Quick Answer:** When NCCL all_reduce_perf shows lower-than-expected busbw, systematically check: (1) SR-IOV VF allocation, (2) /dev/infiniband visibility, (3) RoCE GID index, (4) MTU jumbo frames, (5) PFC/ECN flow control, (6) GPUDirect RDMA level, (7) NCCL_SOCKET_IFNAME, (8) PCIe/NUMA locality, (9) per-rank HCA selection. Expected: ~120-160 GB/s for 2×4 GPU RoCE, ~35 GB/s for 2×2 GPU single-VF.

## The Problem

- NCCL bandwidth test completed but busbw is lower than expected
- Need systematic approach to identify the bottleneck
- Multiple layers (NIC, switch, PCIe, GPU, config) can each reduce throughput
- No single command reveals all issues

## The Solution

### Issue 1: SR-IOV VF Allocation

```bash
# Check how many VFs are allocated to the pod
ip link show | grep -c "net"
# Expected: at least 1 (net1)

# Verify VF is RDMA-capable
ibv_devinfo
# Expected output shows device with:
#   transport: InfiniBand (0)
#   or
#   transport: Ethernet (7) with port_state: PORT_ACTIVE

# Check VF link state
ip link show net1
# Expected: state UP, link/ether with valid MAC

# Problem: VF exists but link is DOWN
# Fix: Check SriovNetworkNodePolicy and physical NIC on host
```

### Issue 2: /dev/infiniband Visibility

```bash
# RDMA verbs need /dev/infiniband device files
ls -la /dev/infiniband/
# Expected:
#   uverbs0 → RDMA user verbs device
#   rdma_cm → Connection manager

# If missing:
# - SR-IOV device plugin didn't allocate RDMA resources
# - Check: openshift.io/mellanoxnics in pod resource requests
# - Check: SriovNetworkNodePolicy has isRdma: true

# Verify device is functional
ibv_devinfo -d mlx5_0
# Should show fw_ver, node_guid, port_state=PORT_ACTIVE
```

### Issue 3: RoCE GID Index

```bash
# GID index determines the addressing mode
# Index 0: IB (not for RoCE)
# Index 1: RoCEv1 (link-local, same subnet only)
# Index 2: RoCEv2 IPv6
# Index 3: RoCEv2 IPv4 (most common for K8s)

# Show all GIDs
for i in $(seq 0 7); do
  echo "GID $i: $(cat /sys/class/infiniband/mlx5_0/ports/1/gids/$i 2>/dev/null)"
done

# Set in NCCL:
export NCCL_IB_GID_INDEX=3    # RoCEv2 over IPv4

# Wrong GID index → connection failures or routing issues
# Symptom: "transport retry count exceeded" in NCCL logs
```

### Issue 4: MTU Configuration

```bash
# Check interface MTU
ip link show net1 | grep mtu
# Expected: mtu 9000 (jumbo frames) for maximum throughput

# Check IB port MTU
cat /sys/class/infiniband/mlx5_0/ports/1/rate
# Expected: 400 Gbps (ConnectX-7) or 200 Gbps (ConnectX-6)

# If MTU is 1500 (default):
# - Throughput capped at ~70% of maximum
# - Fix: Configure jumbo frames on switch AND SriovNetwork CR

# SriovNetwork with MTU:
# apiVersion: sriovnetwork.openshift.io/v1
# kind: SriovNetwork
# spec:
#   networkNamespace: gpu-benchmark
#   resourceName: mellanoxnics
#   ipam: ...
#   mtu: 9000          # ← Must match switch port MTU
```

### Issue 5: PFC / ECN Flow Control

```bash
# Priority Flow Control prevents packet drops under congestion
# Without PFC on RoCE: packet drops → retransmissions → low bandwidth

# Check PFC status (from switch or host):
mlnx_qos -i net1 2>/dev/null || echo "mlnx_qos not available in container"

# On the physical host:
# mlnx_qos -i ens1f0 --pfc 0,0,0,1,0,0,0,0
# (enables PFC on priority 3 for RoCE traffic)

# ECN (Explicit Congestion Notification):
# Reduces throughput proactively before drops occur
# Configure on switch: WRED + ECN marking threshold

# Symptom of missing PFC:
# - Bandwidth varies wildly between runs
# - "timeout" errors in NCCL at large message sizes
# Fix: Configure PFC priority 3 on all switch ports + NIC
```

### Issue 6: GPUDirect RDMA

```bash
# Check if GPUDirect RDMA is active in NCCL logs:
grep "GPU Direct RDMA" /tmp/nccl-output.log
# Expected: "GPU Direct RDMA Enabled for GPU X / HCA Y (distance Z <= W)"

# If NOT enabled:
# 1. Check NCCL_NET_GDR_LEVEL — might be too restrictive
# 2. Check NCCL_DMABUF_ENABLE=1
# 3. Check nvidia-peermem module: lsmod | grep nvidia_peermem
# 4. Check IOMMU: cat /proc/cmdline | grep iommu

# Bandwidth without GPUDirect: ~12-15 GB/s (CPU bounce buffer)
# Bandwidth with GPUDirect:    ~35-45 GB/s (direct GPU-NIC DMA)

# Fix: Set NCCL_NET_GDR_LEVEL=SYS and NCCL_DMABUF_ENABLE=1
```

### Issue 7: NCCL_SOCKET_IFNAME

```bash
# NCCL must use the SR-IOV interface (net1), NOT pod network (eth0)
echo $NCCL_SOCKET_IFNAME
# Expected: net1

# If set to eth0 or empty:
# - NCCL falls back to TCP socket transport
# - No RDMA, no GPUDirect
# - Bandwidth: ~2-5 GB/s (TCP over pod network)

# Verify net1 has an IP:
ip addr show net1
# Expected: inet 192.168.x.x/24 or similar

# If net1 has no IP:
# - IPAM not configured in NetworkAttachmentDefinition
# - Fix: Add whereabouts or nv-ipam configuration
```

### Issue 8: PCIe / NUMA Locality

```bash
# Check GPU-to-NIC NUMA distance
nvidia-smi topo -m
# Expected output shows GPU-NIC affinity:
#   GPU0  GPU1  mlx5_0  mlx5_3  CPU Affinity  NUMA
#   GPU0   X    NV18    PIX     SYS           0-63     0
#   GPU1  NV18   X      SYS     PIX           0-63     0
#
# PIX = same PCIe switch (best)
# PXB = same root complex
# PHB = same NUMA node
# SYS = cross-socket (worst for latency)

# If GPU and NIC are on different NUMA nodes:
# - Extra memory copy through UPI/QPI interconnect
# - Adds 100-300ns latency per operation
# Fix: Use topology-aware scheduling or pin VFs to GPU-local NICs
```

### Issue 9: Per-Rank HCA Selection

```bash
# Each MPI rank should use the NIC closest to its allocated GPU
# With NCCL_IB_HCA=mlx5 (wildcard), NCCL picks based on topology

# Check in NCCL debug logs which HCA each rank selected:
grep "NET/IB" /tmp/nccl-output.log
# NCCL INFO NET/IB: Dev 0 IBDev 0 Port 1 qpn 364 mtu 5 GID 3
#                        ^          ^
#                        device      IB device index

# If all ranks select the same HCA:
# - Bandwidth shared/halved
# - Fix: Set NCCL_IB_HCA=mlx5_0,mlx5_3 (specific devices per socket)
# - Or: Ensure VF allocation is NUMA-aware

# Ideal: Rank on GPU0 → mlx5_0, Rank on GPU1 → mlx5_3
# Verify with: "Whether each MPI rank selected the HCA backing its own net1"
```

### Quick Diagnostic Script

```bash
#!/bin/bash
echo "=== NCCL Network Diagnostic ==="
echo ""
echo "1. SR-IOV VF:"
ip link show net1 2>/dev/null || echo "  ❌ net1 not found"
echo ""
echo "2. /dev/infiniband:"
ls /dev/infiniband/ 2>/dev/null || echo "  ❌ Missing"
echo ""
echo "3. IB devices:"
ibv_devinfo -l 2>/dev/null || echo "  ❌ ibv_devinfo not available"
echo ""
echo "4. MTU:"
ip link show net1 2>/dev/null | grep -oP 'mtu \K[0-9]+'
echo ""
echo "5. GPU topology:"
nvidia-smi topo -m 2>/dev/null | head -20 || echo "  ❌ nvidia-smi not available"
echo ""
echo "6. NCCL env:"
env | grep NCCL | sort
echo ""
echo "7. Kernel modules:"
lsmod 2>/dev/null | grep -E "nvidia_peermem|mlx5|rdma" || echo "  (can't check from container)"
echo ""
echo "=== End Diagnostic ==="
```

## Common Issues

### Bandwidth ~2-5 GB/s (TCP fallback)
- **Root cause**: NCCL using socket transport, not RDMA
- **Check**: `NCCL_SOCKET_IFNAME=net1`, `NCCL_IB_DISABLE=0`, remove `NCCL_NET_PLUGIN=none`

### Bandwidth ~12-15 GB/s (no GPUDirect)
- **Root cause**: RDMA active but going through CPU bounce buffer
- **Check**: `NCCL_NET_GDR_LEVEL`, `NCCL_DMABUF_ENABLE=1`, nvidia-peermem loaded

### Bandwidth ~25-35 GB/s (single NIC bottleneck)
- **Root cause**: All ranks sharing one HCA, or single VF per pod
- **Check**: Per-rank HCA selection logs, VF count, `openshift.io/mellanoxnics` count

### Bandwidth varies ±50% between runs
- **Root cause**: PFC not configured, causing drops and retransmissions
- **Check**: Switch PFC settings, ECN thresholds, `mlnx_qos` output

## Best Practices

1. **Run diagnostics BEFORE the benchmark** — catch config issues early
2. **Save full NCCL_DEBUG=INFO logs** — needed for post-mortem analysis
3. **Compare single-node first** — NVLink busbw validates GPU/driver health
4. **Test one variable at a time** — don't change GDR level AND MTU simultaneously
5. **Document baseline** — record expected vs. actual for each hardware config
6. **Check ALL 9 items** — a chain is only as strong as its weakest link

## Key Takeaways

- Low bandwidth has 9 potential root causes — check systematically
- TCP fallback (2-5 GB/s) vs no-GPUDirect (12-15 GB/s) vs full RDMA (35-45 GB/s per VF)
- `NCCL_NET_PLUGIN=none` is the #1 accidental performance killer (forces socket transport)
- PFC/ECN is the most commonly missed switch-side configuration
- Per-rank HCA affinity determines whether bandwidth scales with NIC count
- Always save full NCCL_DEBUG=INFO logs for troubleshooting
