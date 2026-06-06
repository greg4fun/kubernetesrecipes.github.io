---
title: "RoCE PFC and ECN Lossless Ethernet for GPU Clusters"
description: "Configure RoCE v2 with Priority Flow Control (PFC) and ECN for lossless Ethernet RDMA on GPU clusters. Covers DSCP mapping, switch configuration, NIC"
tags:
  - "roce"
  - "pfc"
  - "ecn"
  - "rdma"
  - "ethernet"
category: "networking"
publishDate: "2026-05-09"
author: "Luca Berton"
difficulty: "advanced"
relatedRecipes:
  - "dual-fabric-mellanox-gpu-storage-ethernet-infiniband"
  - "iommu-bios-kernel-nccl-gpu-direct"
  - "nccl-pxn-cross-nic-nvlink-topology"
  - "openshift-sriov-rdma-infiniband-device-plugin"
---

> 💡 **Quick Answer:** RoCE v2 (RDMA over Converged Ethernet) gives you RDMA without InfiniBand switches, but requires **lossless Ethernet** via PFC (Priority Flow Control) and ECN (Explicit Congestion Notification). Without PFC, packet drops cause RDMA retransmissions that destroy GPU training performance.

## The Problem

Not every GPU cluster has InfiniBand:

- Ethernet switches are cheaper and already deployed
- RoCE v2 provides RDMA over standard Ethernet (UDP port 4791)
- But Ethernet is lossy by default — packet drops kill RDMA performance
- NCCL over RoCE without PFC: ~30-50% bandwidth vs InfiniBand
- NCCL over RoCE with PFC+ECN: ~80-90% of InfiniBand performance

## The Solution

### RoCE v2 Requirements

```text
Layer              Requirement             Purpose
──────────────────────────────────────────────────────────────────
NIC                RoCE v2 support         RDMA over UDP/IPv4
                   (all ConnectX-5+)
Switch             PFC (802.1Qbb)          Pause frames prevent drops
                   ECN (802.1Qau)          Signal congestion early
                   DSCP-based QoS          Map RoCE to lossless class
Host               DCBX or manual PFC      NIC flow control config
                   ECN marking             NIC marks CE bit on congestion
NCCL               NCCL_IB_GID_INDEX=3     Use RoCE v2 GID
                   NCCL_IB_DISABLE=0       Enable IB/RoCE transport
```

### Configure PFC on Mellanox NIC

```bash
# Check current PFC status
mlnx_qos -i ens1f0np0

# Enable PFC on priority 3 (commonly used for RoCE)
mlnx_qos -i ens1f0np0 --pfc 0,0,0,1,0,0,0,0
# Priority:                0 1 2 3 4 5 6 7
# PFC:                     N N N Y N N N N
# Priority 3 = RoCE traffic class

# Set trust mode to DSCP (not PCP)
mlnx_qos -i ens1f0np0 --trust dscp

# Map DSCP 26 (AF31) to priority 3
mlnx_qos -i ens1f0np0 --dscp2prio set,26,3

# Enable ECN on priority 3
echo 1 > /sys/class/net/ens1f0np0/ecn/roce_np/enable/3
echo 1 > /sys/class/net/ens1f0np0/ecn/roce_rp/enable/3

# Verify
mlnx_qos -i ens1f0np0
cma_roce_mode -d mlx5_0 -p 1    # Should show "RoCE v2"
```

### OpenShift MachineConfig for PFC

```yaml
apiVersion: machineconfiguration.openshift.io/v1
kind: MachineConfig
metadata:
  name: 99-gpu-worker-roce-pfc
  labels:
    machineconfiguration.openshift.io/role: gpu-worker
spec:
  config:
    ignition:
      version: 3.2.0
    systemd:
      units:
        - name: configure-roce-pfc.service
          enabled: true
          contents: |
            [Unit]
            Description=Configure RoCE PFC and ECN
            After=network-online.target
            Wants=network-online.target

            [Service]
            Type=oneshot
            RemainAfterExit=yes
            ExecStart=/bin/bash -c '\
              for nic in ens1f0np0 ens1f1np1; do \
                mlnx_qos -i $nic --pfc 0,0,0,1,0,0,0,0; \
                mlnx_qos -i $nic --trust dscp; \
                mlnx_qos -i $nic --dscp2prio set,26,3; \
                echo 1 > /sys/class/net/$nic/ecn/roce_np/enable/3; \
                echo 1 > /sys/class/net/$nic/ecn/roce_rp/enable/3; \
              done'

            [Install]
            WantedBy=multi-user.target
```

### Switch Configuration (Concept)

```text
Ethernet Switch Configuration for RoCE:
──────────────────────────────────────────────────────────────────
# These are conceptual — syntax varies by vendor
# (Cumulus/SONiC/Arista/Cisco/Mellanox Onyx)

# 1. Enable PFC on priority 3 for GPU-facing ports
interface ethernet 1/1-1/32
  priority-flow-control mode on
  priority-flow-control priority 3 buffer-size 300000

# 2. Map DSCP 26 to traffic class 3
qos map dscp-tc 26 to 3

# 3. Enable ECN on traffic class 3
qos congestion-control ecn tc 3
  ecn-threshold min 150000 max 1500000

# 4. Buffer allocation for lossless class
qos buffer tc 3
  reserved 300000
  shared-headroom 100000

# 5. Enable DCBX for auto-negotiation
dcbx mode ieee
```

### NCCL Configuration for RoCE

```yaml
env:
  # Enable IB/RoCE transport
  - name: NCCL_IB_DISABLE
    value: "0"
  # RoCE v2 GID index (IPv4-based)
  - name: NCCL_IB_GID_INDEX
    value: "3"
  # DSCP value for RoCE traffic
  - name: NCCL_IB_TC
    value: "106"              # DSCP 26 << 2 = 104, + ECN bits
  # Or use traffic class directly:
  - name: NCCL_IB_SL
    value: "3"                # Service Level → maps to priority 3
  # GPU-Direct RDMA
  - name: NCCL_NET_GDR_LEVEL
    value: "5"
  # NIC selection
  - name: NCCL_IB_HCA
    value: "mlx5_0,mlx5_1"
```

### Verify RoCE is Working

```bash
# Check RoCE mode
rdma link show
# mlx5_0/1: state ACTIVE physical_state LINK_UP netdev ens1f0np0
# Should show link type: Ethernet

# Check GID table (RoCE v2 = IPv4-based GID)
show_gids
# DEV   PORT  INDEX  GID                          IPv4            VER   DEV
# mlx5_0 1    0      fe80::... (link-local)       -               v1    ens1f0np0
# mlx5_0 1    3      0000::ffff:10.0.100.17       10.0.100.17     v2    ens1f0np0
#                                                                  ^^^ Use index 3

# Test RDMA connectivity
# Server:
ib_write_bw -d mlx5_0 --rdma_cm -R

# Client:
ib_write_bw -d mlx5_0 --rdma_cm -R 10.0.100.17
# Expected: ~24 GB/s (200Gb/s) or ~48 GB/s (400Gb/s)

# Check PFC counters (should see pause frames, not drops)
ethtool -S ens1f0np0 | grep -i pfc
# rx_pfc3_pause: <count>   ← PFC working (pauses instead of drops)
# rx_prio3_discard: 0       ← Zero drops on priority 3 ✅
```

### InfiniBand vs RoCE Comparison

```text
Feature              InfiniBand          RoCE v2
──────────────────────────────────────────────────────────────────
Transport            Native IB verbs     RDMA over UDP/IPv4
Switches             IB switches ($$)    Standard Ethernet ($)
Lossless             Built-in (credit)   Requires PFC config
Subnet Manager       Required (OpenSM)   Not needed
Bandwidth            400Gb/s (NDR)       400Gb/s (same NICs)
Latency              ~1μs                ~2-3μs (slightly higher)
Congestion control   Built-in            ECN required
Configuration        Simpler (native)    More complex (PFC/ECN)
Cost                 Higher              Lower
NCCL performance     100% baseline       80-90% of IB

When to choose RoCE:
  • Already have Ethernet infrastructure
  • Budget-constrained
  • Smaller GPU cluster (<32 nodes)
  • Inference workloads (less sensitive to latency)

When to choose InfiniBand:
  • Large-scale training (64+ nodes)
  • Maximum performance required
  • Can invest in IB switches
  • Need adaptive routing, SHARP
```

## Common Issues

### RoCE performance much lower than expected
- **Cause**: PFC not enabled — Ethernet dropping packets, RDMA retransmitting
- **Fix**: Enable PFC on both NIC and switch for the RoCE priority class

### PFC storm (network freezes)
- **Cause**: Asymmetric PFC config — one side pausing, other side not responding
- **Fix**: Enable PFC on ALL ports in the RoCE path (NIC, every switch hop)

### ECN not marking packets
- **Cause**: Switch ECN thresholds too high or not configured
- **Fix**: Set ECN min/max thresholds on switch; verify with `ethtool -S | grep ecn`

### "Connection timed out" on RoCE but ping works
- **Cause**: Wrong GID index; NCCL using link-local instead of routable address
- **Fix**: Set `NCCL_IB_GID_INDEX=3` for RoCE v2 over IPv4

## Best Practices

1. **PFC + ECN together** — PFC prevents drops, ECN prevents PFC storms
2. **DSCP-based trust** — more reliable than PCP (works across routed networks)
3. **Priority 3 for RoCE** — industry convention; keeps default traffic unaffected
4. **Test with ib_write_bw** before NCCL — validates RDMA path end-to-end
5. **Monitor PFC counters** — pauses are OK, drops are not
6. **Same PFC config everywhere** — NIC, ToR switch, spine switch, all ports

## Key Takeaways

- RoCE v2 = RDMA over Ethernet, but needs lossless config (PFC + ECN)
- Without PFC, packet drops cause RDMA retransmissions (30-50% bandwidth loss)
- Configure: NIC (`mlnx_qos --pfc`) + switch (PFC on RoCE priority) + NCCL (`GID_INDEX=3`)
- PFC prevents drops; ECN prevents PFC storms — both are needed
- RoCE achieves 80-90% of InfiniBand performance when properly configured
- `NCCL_IB_GID_INDEX=3` selects RoCE v2 over IPv4 (not link-local)
- Monitor `ethtool -S | grep pfc` — pause frames = working; discards = broken
- Choose IB for large training clusters; RoCE for budget-friendly GPU inference
