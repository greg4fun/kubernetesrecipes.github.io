---
title: "InfiniBand Subnet Manager OpenSM on Kubernetes"
description: "Deploy and manage InfiniBand Subnet Manager (OpenSM) on Kubernetes for GPU cluster fabric management. Covers SM architecture, UFM integration, partition"
tags:
  - "infiniband"
  - "opensm"
  - "subnet-manager"
  - "fabric"
  - "gpu-cluster"
category: "networking"
publishDate: "2026-05-09"
author: "Luca Berton"
difficulty: "advanced"
relatedRecipes:
  - "dual-fabric-mellanox-gpu-storage-ethernet-infiniband"
  - "openshift-sriov-rdma-infiniband-device-plugin"
  - "iommu-bios-kernel-nccl-gpu-direct"
  - "nccl-pxn-cross-nic-nvlink-topology"
---

> 💡 **Quick Answer:** InfiniBand requires a Subnet Manager (SM) to initialize the fabric — without it, no IB communication happens. For small GPU clusters, run OpenSM on a management node. For production, use NVIDIA UFM (Unified Fabric Manager) for centralized IB management, monitoring, and adaptive routing.

## The Problem

InfiniBand is not plug-and-play like Ethernet:

- Every IB fabric needs at least one Subnet Manager running
- SM assigns LIDs (Local IDs), configures routing, manages partitions
- Without SM, IB ports stay in "Initializing" state — no RDMA, no NCCL
- Need to choose: switch-based SM, host-based OpenSM, or NVIDIA UFM
- Partition keys (P_Keys) control which hosts can communicate

## The Solution

### InfiniBand SM Architecture

```text
Subnet Manager Responsibilities:
──────────────────────────────────────────────────────────────────
1. Discovery    — Find all nodes, switches, links in the fabric
2. LID Assignment — Assign Local IDs to each port
3. Routing      — Compute forwarding tables for switches
4. Monitoring   — Detect topology changes, link failures
5. Partitioning — Enforce P_Key isolation between tenants
6. QoS          — Service Level (SL) assignment for traffic classes
```

### Deploy OpenSM on Kubernetes

```yaml
# OpenSM DaemonSet — runs on IB management node
apiVersion: apps/v1
kind: DaemonSet
metadata:
  name: opensm
  namespace: infiniband-mgmt
spec:
  selector:
    matchLabels:
      app: opensm
  template:
    metadata:
      labels:
        app: opensm
    spec:
      nodeSelector:
        infiniband/subnet-manager: "true"
      hostNetwork: true
      containers:
        - name: opensm
          image: registry.example.com/opensm:5.18
          command: ["/usr/sbin/opensm"]
          args:
            - "-g"                    # GUID-based routing
            - "0x0000000000000001"    # SM GUID (from ibstat)
            - "-p"                    # Priority (higher = preferred SM)
            - "15"
            - "--log_file"
            - "/var/log/opensm/opensm.log"
            - "--log_flags"
            - "0xFF"
          securityContext:
            privileged: true
          volumeMounts:
            - name: infiniband
              mountPath: /dev/infiniband
            - name: log
              mountPath: /var/log/opensm
      volumes:
        - name: infiniband
          hostPath:
            path: /dev/infiniband
        - name: log
          hostPath:
            path: /var/log/opensm
```

### Check IB Fabric Health

```bash
# Port status (should be Active, not Initializing)
ibstat
# Expected:
#   State: Active
#   Physical state: LinkUp
#   Rate: 200 (HDR) or 400 (NDR)

# List all nodes in the fabric
ibnetdiscover

# Show switch topology
iblinkinfo

# Check SM status
sminfo
# Expected: SM running, priority, GUID

# Show LID assignments
ibnodes | head -20

# Check for errors on all ports
ibdiagnet --ls 10 --lw 4x
# Scans all links for errors, speed mismatches, symbol errors

# Per-port error counters
perfquery -x <lid> <port>
```

### Partition Keys (P_Keys) for Multi-Tenant

```text
# /etc/opensm/partitions.conf

# Default partition — all nodes
Default=0x7FFF,ipoib:ALL=full

# GPU training partition — isolated fabric segment
GPUFabric=0x0001,ipoib:
  # GPU worker nodes (by GUID)
  0x0002c903000001,full;
  0x0002c903000002,full;
  0x0002c903000003,full;
  0x0002c903000004,full;

# Storage partition — NFS/Lustre servers
StorageFabric=0x0002,ipoib:
  0x0002c903000010,full;
  0x0002c903000011,full;
```

```yaml
# SR-IOV policy with P_Key for GPU fabric partition
apiVersion: sriovnetwork.openshift.io/v1
kind: SriovNetwork
metadata:
  name: gpu-rdma-pkey
  namespace: openshift-sriov-network-operator
spec:
  networkNamespace: ai-training
  resourceName: gpu-rdma
  capabilities: '{"rdma": true}'
  linkState: auto
  vlan: 0
  # P_Key for GPU fabric partition
  # networkDeviceType: "ib"   # InfiniBand mode
  ipam: |
    {
      "type": "nv-ipam",
      "poolName": "gpu-ib-fabric"
    }
```

### Switch-Based SM vs Host-Based SM

```text
Option              Pros                       Cons
──────────────────────────────────────────────────────────────────
Switch SM           No host resources needed    Limited configuration
(built into IB      Survives host failures      Basic routing only
 switch firmware)   Always available            No advanced features

Host OpenSM         Full control, P_Keys, QoS   Needs dedicated host
                    Custom routing algorithms   Host failure = fabric down
                    Open source, free           Must manage HA manually

NVIDIA UFM          Enterprise management       Licensed, cost
                    Adaptive routing            Requires UFM appliance
                    Health monitoring dashboard Additional infrastructure
                    Telemetry, SHARP support    
```

### Verify NCCL Uses IB After SM Setup

```bash
# After SM is running, ports should be Active:
ibstat | grep -E "State|Rate"
#   State: Active
#   Rate: 200

# NCCL should now show NET/IB:
export NCCL_DEBUG=INFO
# "NET/IB : Using [0]mlx5_0:1/IB [1]mlx5_1:1/IB"

# If still showing "Initializing":
# 1. Check SM is running: sminfo
# 2. Check cable: ibstat (Physical state: LinkUp?)
# 3. Check switch port: iblinkinfo | grep Down
```

## Common Issues

### IB ports stuck in "Initializing"
- **Cause**: No Subnet Manager running on the fabric
- **Fix**: Start OpenSM or enable SM on the IB switch

### SM failover takes too long
- **Cause**: Single SM with no standby; failover requires new SM election
- **Fix**: Run standby SM on second node with lower priority

### "No path to destination" RDMA errors
- **Cause**: SM routing tables not yet computed, or P_Key mismatch
- **Fix**: Wait for SM sweep (check `opensm.log`); verify P_Key membership

## Best Practices

1. **Always run standby SM** — two OpenSM instances with different priorities
2. **Use switch SM for small clusters** (<16 nodes) — simpler, no host dependency
3. **UFM for large clusters** (50+ nodes) — adaptive routing, telemetry, health monitoring
4. **P_Keys for multi-tenant** — isolate GPU fabric from storage traffic at IB level
5. **Monitor with `ibdiagnet`** — catches cable issues, speed mismatches, error counters
6. **Log SM events** — topology changes, port state changes, rerouting events

## Key Takeaways

- InfiniBand requires a Subnet Manager — no SM means no communication
- OpenSM is free and runs as DaemonSet on a management node
- SM assigns LIDs, computes routing, manages P_Keys for isolation
- IB ports show "Initializing" without SM, "Active" with SM
- P_Keys partition the fabric (GPU vs storage vs management)
- NVIDIA UFM for production (adaptive routing, monitoring, SHARP)
- Always run standby SM for high availability
- Verify with `ibstat`, `sminfo`, `ibnetdiscover` after setup
