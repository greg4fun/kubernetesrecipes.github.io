---
title: "Dual-Fabric Mellanox: GPU InfiniBand + Storage Ethernet"
description: "Design and configure dual-fabric network architecture with separate Mellanox NICs for GPU communication (InfiniBand) and storage traffic (Ethernet). Covers fabric separation, SR-IOV policies per fabric, NCCL binding, and NFS/RoCE coexistence."
tags:
  - "infiniband"
  - "ethernet"
  - "mellanox"
  - "dual-fabric"
  - "storage"
category: "networking"
publishDate: "2026-05-08"
author: "Luca Berton"
difficulty: "advanced"
relatedRecipes:
  - "nccl-pxn-cross-nic-nvlink-topology"
  - "openshift-sriov-rdma-infiniband-device-plugin"
  - "iommu-bios-kernel-nccl-gpu-direct"
  - "kubernetes-nfs-persistent-volumes"
---

> 💡 **Quick Answer:** GPU clusters use separate physical fabrics: InfiniBand NICs for GPU-to-GPU NCCL traffic (highest bandwidth, lowest latency) and Ethernet NICs for storage (NFS/Ceph), management, and Pod networking. Never mix GPU RDMA and storage on the same fabric — congestion on one kills the other.

## The Problem

A GPU node typically has multiple Mellanox ConnectX NICs serving different purposes:

- GPU training needs dedicated low-latency InfiniBand for NCCL all-reduce
- Storage (NFS, Lustre, GPFS) needs reliable high-throughput Ethernet or separate IB subnet
- Management/Pod networking needs standard Ethernet
- Mixing traffic on one fabric causes head-of-line blocking and NCCL timeouts

## The Solution

### Dual-Fabric Architecture

```text
GPU Compute Node:
──────────────────────────────────────────────────────────────────

  ┌─────────────────────────────────────────────────────────┐
  │                    GPU Node                              │
  │                                                         │
  │  ┌─────────┐  ┌─────────┐  ┌─────────┐  ┌─────────┐  │
  │  │  GPU 0  │  │  GPU 1  │  │  GPU 2  │  │  GPU 3  │  │
  │  └────┬────┘  └────┬────┘  └────┬────┘  └────┬────┘  │
  │       │NVLink       │            │            │        │
  │  ┌────┴─────────────┴────────────┴────────────┴────┐   │
  │  │              NVLink / NVSwitch                    │   │
  │  └────┬─────────────┬────────────┬────────────┬────┘   │
  │       │             │            │            │        │
  │  ┌────┴────┐   ┌────┴────┐ ┌────┴────┐  ┌───┴─────┐  │
  │  │ConnectX-7│   │ConnectX-7│ │ConnectX-6│  │ConnectX-6│ │
  │  │ IB HDR  │   │ IB HDR  │ │  25GbE  │  │  25GbE  │  │
  │  │GPU Fabric│   │GPU Fabric│ │Stor Fab │  │Mgmt/Pod │  │
  │  └────┬────┘   └────┬────┘ └────┬────┘  └────┬────┘  │
  └───────┼──────────────┼───────────┼────────────┼────────┘
          │              │           │            │
          ▼              ▼           ▼            ▼
  ┌──────────────┐  ┌──────────┐  ┌──────────────┐
  │ IB Switch    │  │ IB Switch│  │ Ethernet SW  │
  │ (GPU Fabric) │  │(GPU Fab) │  │(Storage+Mgmt)│
  │ Leaf/Spine   │  │          │  │              │
  └──────────────┘  └──────────┘  └──────────────┘
```

### Physical NIC Assignment

```text
NIC Assignment (typical 4-NIC GPU node):
──────────────────────────────────────────────────────────────────
NIC        Type              Fabric         Purpose
──────────────────────────────────────────────────────────────────
mlx5_0     ConnectX-7 IB    GPU Fabric     NCCL inter-node (GPUs 0-3)
mlx5_1     ConnectX-7 IB    GPU Fabric     NCCL inter-node (GPUs 4-7)
mlx5_2     ConnectX-6 Eth   Storage        NFS/Lustre/Ceph (RoCE or TCP)
mlx5_3     ConnectX-6 Eth   Management     Pod network, API, SSH

Alternative (6-NIC for large clusters):
──────────────────────────────────────────────────────────────────
mlx5_0-3   ConnectX-7 IB    GPU Fabric     4× NCCL (1 per GPU pair)
mlx5_4     ConnectX-6 Eth   Storage        NFS/GPFS
mlx5_5     ConnectX-6 Eth   Management     OVN/Calico Pod network
```

### SR-IOV Policies Per Fabric

```yaml
# Policy 1: GPU Fabric (InfiniBand) — for NCCL RDMA
apiVersion: sriovnetwork.openshift.io/v1
kind: SriovNetworkNodePolicy
metadata:
  name: gpu-fabric-ib
  namespace: openshift-sriov-network-operator
spec:
  nodeSelector:
    node-role.kubernetes.io/gpu-worker: ""
  numVfs: 8
  priority: 98
  resourceName: gpu-rdma
  vendor: "15b3"
  deviceType: netdevice
  isRdma: true
  nicSelector:
    vendor: "15b3"
    deviceID: "101e"          # ConnectX-7 IB
    # Or by PF name:
    # pfNames:
    #   - "ibp65s0f0"
    #   - "ibp65s0f1"
---
# Policy 2: Storage Fabric (Ethernet) — for NFS/Ceph
apiVersion: sriovnetwork.openshift.io/v1
kind: SriovNetworkNodePolicy
metadata:
  name: storage-fabric-eth
  namespace: openshift-sriov-network-operator
spec:
  nodeSelector:
    node-role.kubernetes.io/gpu-worker: ""
  numVfs: 4
  priority: 99
  resourceName: storage-net
  vendor: "15b3"
  deviceType: netdevice
  isRdma: false              # No RDMA needed for NFS over TCP
  nicSelector:
    vendor: "15b3"
    deviceID: "101f"          # ConnectX-6 Eth
    # Or by PF name:
    # pfNames:
    #   - "ens3f0np0"
```

### SriovNetwork Definitions Per Fabric

```yaml
# GPU RDMA network (InfiniBand)
apiVersion: sriovnetwork.openshift.io/v1
kind: SriovNetwork
metadata:
  name: gpu-rdma-network
  namespace: openshift-sriov-network-operator
spec:
  networkNamespace: ai-training
  resourceName: gpu-rdma
  capabilities: '{"rdma": true}'
  ipam: |
    {
      "type": "whereabouts",
      "range": "10.0.100.0/24"
    }
---
# Storage network (Ethernet)
apiVersion: sriovnetwork.openshift.io/v1
kind: SriovNetwork
metadata:
  name: storage-network
  namespace: openshift-sriov-network-operator
spec:
  networkNamespace: ai-training
  resourceName: storage-net
  ipam: |
    {
      "type": "whereabouts",
      "range": "10.0.200.0/24"
    }
```

### Pod with Dual-Fabric Attachment

```yaml
apiVersion: v1
kind: Pod
metadata:
  name: gpu-training
  namespace: ai-training
  annotations:
    k8s.v1.cni.cncf.io/networks: |
      [
        {"name": "gpu-rdma-network", "interface": "rdma0"},
        {"name": "gpu-rdma-network", "interface": "rdma1"},
        {"name": "storage-network", "interface": "stor0"}
      ]
spec:
  containers:
    - name: training
      image: nvcr.io/nvidia/pytorch:24.07-py3
      env:
        # NCCL: use ONLY GPU fabric NICs
        - name: NCCL_IB_HCA
          value: "mlx5_0,mlx5_1"    # GPU fabric only
        - name: NCCL_NET_GDR_LEVEL
          value: "5"
        - name: NCCL_CROSS_NIC
          value: "1"
        # Explicitly exclude storage NIC from NCCL
        - name: NCCL_IB_DISABLE
          value: "mlx5_2"           # Don't use storage NIC for NCCL
        # Socket interface for NCCL bootstrap (uses management network)
        - name: NCCL_SOCKET_IFNAME
          value: "eth0"             # Pod default interface
      volumeMounts:
        - name: training-data
          mountPath: /data
        - name: checkpoints
          mountPath: /checkpoints
      resources:
        requests:
          nvidia.com/gpu: "8"
          openshift.io/gpu-rdma: "2"      # 2 IB VFs for NCCL
          openshift.io/storage-net: "1"    # 1 Eth VF for storage
  volumes:
    - name: training-data
      nfs:                                 # NFS goes over storage fabric
        server: nfs.storage.example.com
        path: /datasets
    - name: checkpoints
      persistentVolumeClaim:
        claimName: checkpoint-pvc          # Also on storage fabric
```

### NCCL NIC Binding (Prevent Fabric Crosstalk)

```bash
# Critical: tell NCCL exactly which NICs to use
# Otherwise NCCL may pick storage NICs and congest that fabric

# Option 1: Whitelist GPU fabric NICs
export NCCL_IB_HCA="mlx5_0,mlx5_1"

# Option 2: Blacklist storage/management NICs
export NCCL_IB_DISABLE="mlx5_2,mlx5_3"

# Option 3: By PCI bus ID (most precise)
export NCCL_IB_HCA="mlx5_0000:65:00"    # PCI prefix match

# For InfiniBand specifically:
export NCCL_IB_HCA="mlx5_0:1,mlx5_1:1"  # device:port

# Bootstrap socket (TCP control plane) — use management network
export NCCL_SOCKET_IFNAME="eth0"          # NOT the IB interface
```

### InfiniBand vs Ethernet: When to Use Each

```text
Traffic Type       Protocol          Fabric          Why
──────────────────────────────────────────────────────────────────
GPU NCCL           IB Verbs/RDMA     InfiniBand      Lowest latency, highest BW
                                                      No TCP overhead
                                                      GPU-Direct RDMA capable

Storage (NFS)      TCP or NFS/RDMA   Ethernet        Commodity switches
                                     or IB            TCP works fine for sequential I/O
                                                      RoCE if ultra-low latency needed

Storage (Lustre)   LNET over IB      InfiniBand      Native IB support
                   or TCP/Ethernet   or Ethernet     Depends on cluster size

Storage (Ceph)     TCP/msgr2         Ethernet        Ceph doesn't need RDMA
                                                      Standard 25GbE sufficient

Management         TCP               Ethernet        API server, SSH, monitoring
Pod Network        OVN/Calico        Ethernet        Standard container networking

NCCL Bootstrap     TCP               Ethernet        Initial rank discovery only
                                                      Low bandwidth, use mgmt net
```

### Storage over RoCE (Ethernet RDMA)

```yaml
# If storage needs RDMA (NFS over RDMA, NVMe-oF):
apiVersion: sriovnetwork.openshift.io/v1
kind: SriovNetworkNodePolicy
metadata:
  name: storage-roce
  namespace: openshift-sriov-network-operator
spec:
  nodeSelector:
    node-role.kubernetes.io/gpu-worker: ""
  numVfs: 4
  priority: 99
  resourceName: storage-roce
  vendor: "15b3"
  deviceType: netdevice
  isRdma: true               # Enable RDMA for RoCE
  nicSelector:
    pfNames:
      - "ens3f0np0"          # Storage Ethernet NIC
```

```bash
# RoCE requires proper flow control (PFC) on the Ethernet switch
# Without PFC, RoCE performance degrades under congestion

# Verify RoCE is working:
ibv_devinfo | grep -A10 mlx5_2
# Look for: transport: InfiniBand (for IB) or Ethernet (for RoCE)
# link_layer: Ethernet confirms RoCE mode

# Test RoCE bandwidth:
ib_write_bw -d mlx5_2 --rdma_cm    # Server
ib_write_bw -d mlx5_2 --rdma_cm <server-ip>  # Client
```

### Network Separation at Switch Level

```text
Physical Switch Topology:
──────────────────────────────────────────────────────────────────

GPU Fabric (InfiniBand):
  ┌─────────────────────────────────────────┐
  │  IB Leaf Switch 1        IB Leaf Switch 2│
  │  (HDR 200Gb/s)           (HDR 200Gb/s)  │
  │     │ │ │ │                │ │ │ │      │
  │     ▼ ▼ ▼ ▼                ▼ ▼ ▼ ▼      │
  │  Node1  Node2           Node3  Node4    │
  │  GPU NICs               GPU NICs        │
  └─────────────┬───────────────────┬───────┘
                │    IB Spine       │
                └───────────────────┘

Storage Fabric (Ethernet):
  ┌─────────────────────────────────────────┐
  │  Eth Switch 1 (25/100GbE)              │
  │     │ │ │ │                             │
  │     ▼ ▼ ▼ ▼                             │
  │  Node1  Node2  Node3  Node4            │
  │  Stor NICs                              │
  │         │                               │
  │         ▼                               │
  │  NFS Server / Ceph OSD / Lustre MDS    │
  └─────────────────────────────────────────┘

Management (Ethernet):
  ┌─────────────────────────────────────────┐
  │  Mgmt Switch (10/25GbE)                │
  │     │ │ │ │                             │
  │     ▼ ▼ ▼ ▼                             │
  │  All Nodes (BMC + OS mgmt)             │
  │  API Server, Monitoring, SSH            │
  └─────────────────────────────────────────┘

Rules:
  • GPU fabric: ONLY NCCL/MPI traffic. No storage. No management.
  • Storage fabric: ONLY storage I/O. No GPU training traffic.
  • Management: Everything else (API, SSH, monitoring, Pod network)
  • NEVER cross-connect fabrics at switch level
```

### Verifying Fabric Separation

```bash
# Confirm which NIC handles which traffic:

# GPU fabric — should see RDMA counters during training
rdma stat show link mlx5_0
# rx_write_requests, tx_write_requests should be high during training

# Storage fabric — should see TCP/NFS traffic during data load
ethtool -S ens3f0np0 | grep -E "rx_bytes|tx_bytes"

# Check no NCCL traffic on storage NIC (should be zero IB counters)
rdma stat show link mlx5_2
# rx_write_requests should be 0 if NCCL correctly uses mlx5_0/1 only

# Monitor during training:
watch -n1 "rdma stat show link mlx5_0 | grep write; echo '---'; \
           rdma stat show link mlx5_2 | grep write"
```

## Common Issues

### NCCL uses storage NIC, congests NFS
- **Cause**: `NCCL_IB_HCA` not set; NCCL auto-discovers all Mellanox NICs
- **Fix**: Explicitly set `NCCL_IB_HCA=mlx5_0,mlx5_1` (GPU fabric only)

### NFS timeouts during training
- **Cause**: NCCL traffic leaking to storage fabric, or storage NIC saturated
- **Fix**: Verify fabric separation; add dedicated NFS NIC; check switch PFC config

### InfiniBand port down on GPU fabric
- **Cause**: Cable issue, switch port config, or subnet manager not running
- **Fix**: `ibstat` to check port state; verify OpenSM or UFM is managing the IB fabric

### RoCE storage drops under GPU training load
- **Cause**: ECN/PFC not configured on Ethernet switch; RoCE needs lossless Ethernet
- **Fix**: Configure PFC (Priority Flow Control) on storage switch ports

## Best Practices

1. **Physical separation** — different switches for GPU and storage fabrics
2. **Explicit NCCL NIC binding** — always set `NCCL_IB_HCA` to GPU fabric NICs
3. **InfiniBand for GPU, Ethernet for storage** — unless storage is Lustre (native IB)
4. **Separate SR-IOV policies per fabric** — different resourceNames
5. **PFC for RoCE** — if storage uses Ethernet RDMA, configure lossless
6. **Monitor per-NIC** — alert if RDMA traffic appears on storage NICs
7. **Document the cable map** — which port on which switch for each NIC

## Key Takeaways

- GPU clusters need physically separate fabrics: IB for NCCL, Ethernet for storage
- Never let NCCL auto-discover NICs — explicitly bind with `NCCL_IB_HCA`
- InfiniBand = lowest latency + GPU-Direct RDMA for training traffic
- Ethernet = commodity, cost-effective, sufficient for NFS/Ceph sequential I/O
- SR-IOV policies should be per-fabric (separate resourceNames)
- RoCE (Ethernet RDMA) needs PFC — without it, performance collapses under congestion
- Physical switch separation prevents one fabric's congestion from affecting the other
- `NCCL_SOCKET_IFNAME=eth0` — bootstrap over management, not GPU fabric
