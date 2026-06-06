---
title: "NCCL IB HCA Selection and QPS Tuning for RoCE"
description: "Configure NCCL_IB_HCA, NCCL_IB_GID_INDEX, NCCL_IB_QPS_PER_CONNECTION, and NCCL_IB_SPLIT_DATA_ON_QPS for optimal RoCE performance on Kubernetes GPU clusters."
tags:
  - "nccl"
  - "rdma"
  - "performance"
  - "networking"
  - "tuning"
category: "ai"
publishDate: "2026-06-04"
author: "Luca Berton"
difficulty: "advanced"
relatedRecipes:
  - "nccl-gdr-level-tuning-pix-pxb-phb-sys"
  - "nccl-network-validator-production-mpijob"
  - "nvidia-network-operator-rdma-kubernetes"
---

> 💡 **Quick Answer:** Set `NCCL_IB_HCA=mlx5` to use all Mellanox ConnectX devices, `NCCL_IB_GID_INDEX=3` for RoCEv2 over IPv4, `NCCL_IB_QPS_PER_CONNECTION=1` for single QP per peer, and `NCCL_IB_SPLIT_DATA_ON_QPS=1` to distribute data across QPs for better link utilization. These defaults work for most SR-IOV RoCE deployments on OpenShift.

## The Problem

- Multiple mlx5 devices visible in pod (SR-IOV VFs) — NCCL must pick the right ones
- Wrong GID index causes connection failures on RoCE (vs InfiniBand)
- Single queue pair can bottleneck at high message sizes
- Need to balance parallelism vs. overhead for QP-based transfers

## The Solution

### NCCL_IB_HCA — Device Selection

```bash
# Wildcard: use all mlx5 devices (most common for SR-IOV)
export NCCL_IB_HCA="mlx5"
# Matches: mlx5_0, mlx5_1, mlx5_2, ... mlx5_25

# Specific devices (pin to known-good NICs):
export NCCL_IB_HCA="mlx5_0,mlx5_3"
# Only uses these two HCAs

# Exclude specific devices (prefix with ^):
export NCCL_IB_HCA="^mlx5_1"
# Uses all mlx5 except mlx5_1

# Per-NIC port selection:
export NCCL_IB_HCA="mlx5_0:1"
# Only port 1 of mlx5_0
```

```text
Scenario                         │ Recommended NCCL_IB_HCA
─────────────────────────────────┼─────────────────────────────
SR-IOV (1 VF per pod)            │ mlx5 (wildcard, auto-select)
SR-IOV (multiple VFs per pod)    │ mlx5 (let NCCL pick by topology)
Shared RDMA (26 VFs visible)     │ mlx5 (NCCL filters by distance)
Dedicated NIC (bare metal)       │ mlx5_0,mlx5_3 (explicit)
InfiniBand (not RoCE)            │ mlx5 (same wildcard works)
─────────────────────────────────┴─────────────────────────────
```

### NCCL_IB_GID_INDEX — Address Selection

```bash
# GID table for RoCE:
# Index 0: IB default (not for Ethernet/RoCE)
# Index 1: RoCEv1 link-local (same L2 domain only)
# Index 2: RoCEv2 IPv6 (if configured)
# Index 3: RoCEv2 IPv4 (standard for Kubernetes)

export NCCL_IB_GID_INDEX=3   # RoCEv2 over IPv4 — use this for K8s
```

```bash
# Verify GID table contents:
for i in $(seq 0 7); do
  gid=$(cat /sys/class/infiniband/mlx5_0/ports/1/gids/$i 2>/dev/null)
  gid_type=$(cat /sys/class/infiniband/mlx5_0/ports/1/gid_attrs/types/$i 2>/dev/null)
  echo "GID[$i]: ${gid} (${gid_type})"
done

# Expected output:
# GID[0]: fe80:0000:0000:... (IB/RoCE v1)
# GID[1]: fe80:0000:0000:... (RoCE v2)
# GID[2]: 0000:0000:0000:... (RoCE v2 - IPv6)
# GID[3]: 0000:0000:0000:0000:0000:ffff:c0a8:0101 (RoCE v2 - IPv4 192.168.1.1)
```

### NCCL_IB_QPS_PER_CONNECTION — Queue Pair Scaling

```bash
# Default: 1 QP per connection
export NCCL_IB_QPS_PER_CONNECTION=1

# Higher values: multiple QPs per peer connection
# Benefit: more hardware parallelism for large messages
# Cost: more memory, more CQ processing overhead
export NCCL_IB_QPS_PER_CONNECTION=4   # Use for high-bandwidth NICs (400G)
```

```text
QPs/Connection │ Best For                    │ Trade-off
───────────────┼─────────────────────────────┼──────────────────────
1              │ Most deployments            │ Simple, low overhead
2              │ 200G NICs with large msgs   │ Moderate improvement
4              │ 400G NICs, 8+ GPUs/node     │ Maximum NIC utilization
8+             │ Rarely needed               │ Diminishing returns
───────────────┴─────────────────────────────┴──────────────────────
```

### NCCL_IB_SPLIT_DATA_ON_QPS — Data Distribution

```bash
# When QPS_PER_CONNECTION > 1:
export NCCL_IB_SPLIT_DATA_ON_QPS=1    # Split large messages across QPs
# 0 = send entire message on one QP (round-robin between messages)
# 1 = split each message across all QPs (better latency for large msgs)

# With SPLIT=1 and QPS=4:
# A 4GB message becomes 4× 1GB transfers in parallel across 4 QPs
# Result: ~4× bandwidth improvement if NIC has the capacity
```

### Complete Configuration Block

```yaml
env:
  # Device selection — wildcard for all mlx5 SR-IOV VFs
  - name: NCCL_IB_HCA
    value: "mlx5"

  # RoCEv2 over IPv4 addressing
  - name: NCCL_IB_GID_INDEX
    value: "3"

  # Enable IB transport (0 = enabled, 1 = disabled)
  - name: NCCL_IB_DISABLE
    value: "0"

  # Queue pair tuning
  - name: NCCL_IB_QPS_PER_CONNECTION
    value: "1"

  # Split data across QPs for large messages
  - name: NCCL_IB_SPLIT_DATA_ON_QPS
    value: "1"
```

### Verifying HCA Selection in Logs

```text
# NCCL_DEBUG=INFO shows which devices are selected:

NCCL INFO NET/IB: Dev 0 IBDev 0 Port 1 qpn 364 mtu 5 GID 3 \
  (0/B9D4E80AFFFF0000) fifoRkey=0x41200 fifoLkey=0x41200
NCCL INFO NET/IB: Dev 0 IBDev 0 Port 1 qpn 236 mtu 5 GID 3 \
  (0/B5D4E80AFFEF0000) fifoRkey=0x21300 fifoLkey=0x21300

# Decode:
#   Dev 0   = first network device
#   IBDev 0 = first IB device (mlx5_0 or first VF)
#   Port 1  = physical port
#   qpn 364 = queue pair number
#   mtu 5   = 4096 bytes (IB MTU encoding: 1=256, 2=512, 3=1024, 4=2048, 5=4096)
#   GID 3   = using GID index 3 (RoCEv2 IPv4) ✓
```

## Common Issues

### "Transport retry count exceeded"
- **Cause**: Wrong GID index — packets routed incorrectly or dropped
- **Fix**: Verify `NCCL_IB_GID_INDEX=3` matches actual IPv4 GID in device

### All ranks use same IBDev (bandwidth halved)
- **Cause**: Only one VF allocated, or topology makes NCCL pick same device
- **Fix**: Request more `openshift.io/mellanoxnics` or use explicit HCA list

### "No IB device found" despite /dev/infiniband existing
- **Cause**: `NCCL_IB_DISABLE=1` or `NCCL_NET_PLUGIN=none`
- **Fix**: Set `NCCL_IB_DISABLE=0` and remove `NCCL_NET_PLUGIN` entirely

### QPS_PER_CONNECTION > 1 causes OOM
- **Cause**: Each QP allocates send/receive buffers (typically 64KB-1MB each)
- **Fix**: Reduce QPS or increase pod memory limit

## Best Practices

1. **Start with `mlx5` wildcard** — let NCCL auto-select by PCIe topology
2. **Always use `GID_INDEX=3`** for RoCE on Kubernetes (IPv4)
3. **Keep `QPS_PER_CONNECTION=1`** unless you've verified higher helps
4. **Enable `SPLIT_DATA_ON_QPS=1`** — low cost, potential benefit for large messages
5. **Check logs for qpn and GID** — confirms correct device and addressing
6. **Never set `NCCL_IB_DISABLE=1`** in production RDMA workloads

## Key Takeaways

- `NCCL_IB_HCA=mlx5` wildcard is sufficient for most SR-IOV deployments
- GID index 3 = RoCEv2 IPv4 — the standard for Kubernetes GPU clusters
- QPS tuning provides marginal gains; topology and GDR level matter more
- SPLIT_DATA_ON_QPS=1 is safe to enable by default (splits large messages)
- Verify in NCCL logs: check IBDev, Port, GID index, and qpn values
- Multiple visible mlx5 devices (e.g., 26) is normal with shared RDMA plugin
