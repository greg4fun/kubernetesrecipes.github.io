---
title: "NVIDIA GPU Topology Matrix Interpretation on Kubernetes"
description: "Read and interpret nvidia-smi topo and nvidia-device-plugin topology matrices on Kubernetes GPU nodes. Understand X, NV, SYS, NODE, PIX, PXB, PHB connection"
tags:
  - "nvidia"
  - "gpu-topology"
  - "nvidia-smi"
  - "numa"
  - "performance"
category: "ai"
publishDate: "2026-06-04"
author: "Luca Berton"
difficulty: "advanced"
relatedRecipes:
  - "nccl-topology-dump-tuning-kubernetes"
  - "nvidia-gpu-operator-setup"
  - "nccl-pxn-cross-nic-nvlink-topology"
  - "kubernetes-topology-manager-gpu-numa"
---

> 💡 **Quick Answer:** The GPU topology matrix (from `nvidia-smi topo -m` or nvidia-device-plugin logs) shows interconnect types between every GPU, NIC, and NVMe device. **NV#** = NVLink (fastest), **PIX** = same PCIe switch, **PHB** = same PCIe Host Bridge (CPU), **SYS** = crosses CPU socket (QPI/UPI), **NODE** = same NUMA node but different PCIe bridges. Use this matrix to ensure GPUs communicating via NCCL share NVLink, and NICs are co-located with their assigned GPUs.

## The Problem

- Multi-GPU training is slow but you don't know why — could be topology mismatch
- NCCL picks suboptimal communication paths because GPU-NIC affinity is wrong
- Need to verify that NVLink is actually connecting the expected GPU pairs
- Kubernetes schedules workloads without considering PCIe topology
- Don't know which NIC to use for GPUDirect RDMA with a specific GPU

## The Solution

### Read the Topology Matrix

```bash
# On a GPU node (or via kubectl exec into nvidia-device-plugin pod)
nvidia-smi topo -m
```

Example output for an 8-GPU server with NVLink Bridge (NVL4):

```text
        GPU0  GPU1  GPU2  GPU3  GPU4  GPU5  GPU6  GPU7  NIC0  NIC1  NIC2  NIC3
GPU0     X    NV6   NV6   NV6   SYS   SYS   SYS   SYS   PIX   NODE  NODE  SYS
GPU1    NV6    X    NV6   NV6   SYS   SYS   SYS   SYS   NODE  PIX   NODE  SYS
GPU2    NV6   NV6    X    NV6   SYS   SYS   SYS   SYS   NODE  NODE  PIX   SYS
GPU3    NV6   NV6   NV6    X    SYS   SYS   SYS   SYS   NODE  NODE  NODE  SYS
GPU4    SYS   SYS   SYS   SYS    X    NV6   NV6   NV6   SYS   SYS   SYS   PIX
GPU5    SYS   SYS   SYS   SYS   NV6    X    NV6   NV6   SYS   SYS   SYS   NODE
GPU6    SYS   SYS   SYS   SYS   NV6   NV6    X    NV6   SYS   SYS   SYS   NODE
GPU7    SYS   SYS   SYS   SYS   NV6   NV6   NV6    X    SYS   SYS   SYS   NODE

CPU Affinity:
GPU0-3: NUMA 0 (CPUs 0,2,4,6,8,10...)
GPU4-7: NUMA 1 (CPUs 1,3,5,7,9,11...)
```

### Connection Type Legend

```text
Type │ Meaning                                          │ Bandwidth    │ Latency
─────┼──────────────────────────────────────────────────┼──────────────┼────────
X    │ Self                                             │ N/A          │ N/A
NV#  │ Bonded set of # NVLinks                         │ 50-900 GB/s  │ Lowest
IX   │ Same NVSwitch fabric (not direct NVLink)        │ High         │ Low
PIX  │ Same PCIe switch (single hop)                   │ ~32 GB/s     │ Low
PXB  │ Multiple PCIe bridges (no Host Bridge)          │ ~32 GB/s     │ Medium
PHB  │ PCIe Host Bridge (same CPU socket)              │ ~32 GB/s     │ Medium
NODE │ Same NUMA node, different PCIe tree              │ ~32 GB/s     │ Higher
SYS  │ Crosses QPI/UPI (different CPU socket)          │ ~20-40 GB/s  │ Highest
ODE  │ Other device (connected but non-standard path)  │ Varies       │ Varies
─────┴──────────────────────────────────────────────────┴──────────────┴────────

Performance ranking (best to worst):
NV# >> PIX > PXB > PHB > NODE > SYS
```

### Interpret NVLink Groups

From the matrix above, identify NVLink groups:

```text
NVL4 Group 1: GPU0, GPU1, GPU2, GPU3 (all NV6 to each other)
  └── NUMA Node 0, CPUs 0,2,4,6,8,10
  └── Local NICs: NIC0 (PIX to GPU0), NIC1 (PIX to GPU1), NIC2 (PIX to GPU2)

NVL4 Group 2: GPU4, GPU5, GPU6, GPU7 (all NV6 to each other)
  └── NUMA Node 1, CPUs 1,3,5,7,9,11
  └── Local NICs: NIC3 (PIX to GPU4)

Cross-group: GPU0↔GPU4 = SYS (crosses CPU socket via QPI/UPI)
  └── 5-10x slower than NVLink for collective ops
```

### GPU-NIC Affinity for GPUDirect RDMA

```text
Best NIC for each GPU (PIX = same PCIe switch = optimal for RDMA):

GPU0 → NIC0 (PIX)     GPU4 → NIC3 (PIX)
GPU1 → NIC1 (PIX)     GPU5 → NIC4 (PIX)  
GPU2 → NIC2 (PIX)     GPU6 → NIC5 (PIX)
GPU3 → NIC2 (NODE)    GPU7 → NIC5 (NODE)

Rule: Always use the NIC with PIX relationship to the GPU for RDMA.
NODE is acceptable. SYS means crossing sockets — avoid for RDMA if possible.
```

### Kubernetes NCCL Topology Configuration

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: distributed-training
spec:
  template:
    spec:
      containers:
        - name: trainer
          image: registry.example.com/training:v1
          env:
            # Force NCCL to use topology-aware algorithms
            - name: NCCL_TOPO_DUMP_FILE
              value: "/var/run/nvidia/topo.xml"
            # Pin NCCL to local NIC for each GPU
            - name: NCCL_NET_GDR_LEVEL
              value: "PIX"    # Only use GPUDirect when NIC is PIX-local
            # Enable NVLink for intra-node
            - name: NCCL_P2P_LEVEL
              value: "NVL"    # Use NVLink when available
            # Cross-node via RDMA
            - name: NCCL_IB_HCA
              value: "mlx5_0,mlx5_1,mlx5_4,mlx5_6"  # Only local NICs
          resources:
            limits:
              nvidia.com/gpu: 4    # Request one NVL4 group
```

### Verify Topology in Running Pod

```bash
# From inside a GPU pod
nvidia-smi topo -m

# Check which GPUs are NVLink-connected
nvidia-smi nvlink --status

# Per-GPU NVLink bandwidth
nvidia-smi nvlink -gt d    # Data throughput

# Check NUMA node for each GPU
nvidia-smi topo -p 2 -i 0    # GPU 0's PCIe path

# Verify GPU-NIC locality
cat /proc/driver/nvidia/gpus/*/information
ibstat | grep -A5 "Port 1"
```

### Large-Scale Topology (200+ NICs)

On HPC nodes with many NICs (InfiniBand + Ethernet + management):

```text
206 NICs found in the topology, only displaying 56 in the matrix.

The full matrix shows connectivity between:
- 8 GPUs (GPU0-GPU7)
- 10+ InfiniBand NICs (mlx5_0 through mlx5_17)
- 40+ virtual/sub-functions
- CPU affinity and NUMA ID per device

Key insight: Only ~8-10 NICs are relevant for NCCL traffic.
Filter by looking for PIX relationships to GPUs.
```

```bash
# Find which NICs are PIX-local to GPUs
nvidia-smi topo -m | grep -E "^(GPU|NIC)" | head -20

# Or use nvidia-smi topo with specific devices
nvidia-smi topo -mp -i 0,1,2,3    # Matrix for GPU 0-3 only
```

### Topology-Aware Scheduling on Kubernetes

```yaml
# Use GPU Feature Discovery labels for topology-aware placement
apiVersion: v1
kind: Pod
spec:
  nodeSelector:
    # Ensure node has NVLink
    nvidia.com/gpu.family: hopper
  affinity:
    nodeAffinity:
      requiredDuringSchedulingIgnoredDuringExecution:
        nodeSelectorTerms:
          - matchExpressions:
              - key: feature.node.kubernetes.io/pci-10de.present  # NVIDIA GPU
                operator: In
                values: ["true"]
              - key: nvidia.com/gpu.count
                operator: In
                values: ["8"]    # Full 8-GPU node only
```

## Common Issues

### NCCL using SYS path instead of NVLink
- **Cause**: NCCL topology detection failed; or GPUs from different NVL groups assigned
- **Fix**: Request GPUs in multiples matching NVL group size (4 for NVL4); set `NCCL_TOPO_DUMP_FILE`

### GPUDirect RDMA slow — crossing CPU sockets
- **Cause**: NIC has SYS relationship to GPU (wrong NUMA node)
- **Fix**: Pin `NCCL_IB_HCA` to only NICs with PIX/NODE relationship to assigned GPUs

### "NODE" instead of "PIX" for GPU-NIC pair
- **Cause**: NIC and GPU on same NUMA node but different PCIe switches
- **Fix**: Acceptable for RDMA (small penalty). PIX is ideal but NODE works well

### Inconsistent topology after GPU reset
- **Cause**: nvidia-smi topo reads live PCIe state; device errors can change reported topology
- **Fix**: `nvidia-smi -r` (reset); or reboot node if topology looks wrong

## Best Practices

1. **Request full NVL groups** — 4 GPUs for NVL4, 8 for NVL8 (avoid splitting groups)
2. **Map NICs to GPUs** — use PIX-local NICs for GPUDirect RDMA (highest throughput)
3. **Set `NCCL_NET_GDR_LEVEL=PIX`** — prevents NCCL from using distant NICs for RDMA
4. **Dump topology at pod start** — `NCCL_TOPO_DUMP_FILE` lets you verify paths
5. **NUMA-pin application threads** — match CPU affinity to GPU NUMA node
6. **Monitor NVLink utilization** — `nvidia-smi nvlink -gt d` during training
7. **Use GFD labels** — GPU Feature Discovery exposes topology info as node labels

## Key Takeaways

- Topology matrix shows interconnect type between every GPU, NIC, and device pair
- NV# (NVLink) is 10-50x faster than PCIe paths (PIX/SYS) for GPU-to-GPU communication
- NVL4 = 4 GPUs fully connected via NVLink; SYS between groups means crossing CPU sockets
- GPU-NIC affinity critical for GPUDirect RDMA: always use PIX-local NIC
- NUMA affinity: GPU0-3 on NUMA 0, GPU4-7 on NUMA 1 (typical 8-GPU dual-socket)
- Request GPUs in NVLink group multiples (4 or 8) to avoid cross-socket communication
- `nvidia-smi topo -m` is your first diagnostic tool for GPU interconnect performance
