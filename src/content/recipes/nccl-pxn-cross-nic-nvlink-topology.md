---
title: "NCCL PXN Cross-NIC Communication via NVLink"
description: "Configure NCCL PXN (PCIe cross-NIC via NVLink) for multi-node GPU training where not every GPU has a direct RDMA NIC. Covers topology"
tags:
  - "nccl"
  - "pxn"
  - "nvlink"
  - "gpu-direct"
  - "rdma"
category: "ai"
publishDate: "2026-05-08"
author: "Luca Berton"
difficulty: "advanced"
relatedRecipes:
  - "iommu-bios-kernel-nccl-gpu-direct"
  - "disable-acs-pcie-gpu-direct-p2p"
  - "openshift-sriov-rdma-infiniband-device-plugin"
  - "kubernetes-ai-infrastructure-scaling"
---

> 💡 **Quick Answer:** NCCL PXN (PCIe cross-NIC via NVLink) allows GPUs without a directly attached RDMA NIC to reach the network through another GPU's NIC via NVLink. This is critical in systems where fewer NICs than GPUs exist (e.g., 4 NICs for 8 GPUs) — NCCL routes traffic over NVLink to a peer GPU that has NIC access.

## The Problem

In multi-GPU servers, the GPU-to-NIC topology is often not 1:1:

- 8 GPUs but only 4 InfiniBand NICs
- NICs connected to specific PCIe switches, not all GPUs
- GPUs without direct NIC access fall back to CPU-staged copies (slow)
- Need inter-node communication for all 8 GPUs, not just the 4 with NICs

## The Solution

### Understanding PXN Topology

```text
Typical 8-GPU Server with 4 NICs:
──────────────────────────────────────────────────────────────────

  CPU0 Socket                          CPU1 Socket
  ┌──────────────────┐                 ┌──────────────────┐
  │  PCIe Switch 0   │                 │  PCIe Switch 2   │
  │  ├── GPU0 ─ NIC0 │  ←─NVLink──→   │  ├── GPU4 ─ NIC2 │
  │  └── GPU1        │                 │  └── GPU5        │
  │                  │                 │                  │
  │  PCIe Switch 1   │                 │  PCIe Switch 3   │
  │  ├── GPU2 ─ NIC1 │  ←─NVLink──→   │  ├── GPU6 ─ NIC3 │
  │  └── GPU3        │                 │  └── GPU7        │
  └──────────────────┘                 └──────────────────┘

Without PXN:
  GPU1, GPU3, GPU5, GPU7 → NO direct NIC → CPU copy fallback (slow)

With PXN:
  GPU1 → NVLink → GPU0 → NIC0 → Network  (GPU0 proxies for GPU1)
  GPU3 → NVLink → GPU2 → NIC1 → Network  (GPU2 proxies for GPU3)
  GPU5 → NVLink → GPU4 → NIC2 → Network  (GPU4 proxies for GPU5)
  GPU7 → NVLink → GPU6 → NIC3 → Network  (GPU6 proxies for GPU7)
```

### NCCL PXN Configuration

```yaml
apiVersion: v1
kind: Pod
metadata:
  name: distributed-training
  namespace: ai-training
  annotations:
    k8s.v1.cni.cncf.io/networks: rdma-net-0,rdma-net-1,rdma-net-2,rdma-net-3
spec:
  containers:
    - name: training
      image: nvcr.io/nvidia/pytorch:24.07-py3
      env:
        # PXN and Cross-NIC settings
        - name: NCCL_CROSS_NIC
          value: "1"              # Allow traffic across different NICs
        - name: NCCL_NET_GDR_LEVEL
          value: "5"              # Full GPU-Direct RDMA
        - name: NCCL_P2P_LEVEL
          value: "NVL"            # Use NVLink for P2P (enables PXN)
        
        # NIC selection
        - name: NCCL_IB_HCA
          value: "mlx5_0,mlx5_1,mlx5_2,mlx5_3"  # All 4 NICs
        
        # Topology detection
        - name: NCCL_TOPO_FILE
          value: "/var/run/nvidia/topo.xml"  # GPU topology file
        - name: NCCL_TOPO_DUMP_FILE
          value: "/tmp/nccl-topo.xml"        # Debug: dump detected topo
        
        # Performance tuning
        - name: NCCL_IB_QPS_PER_CONNECTION
          value: "4"
        - name: NCCL_IB_TIMEOUT
          value: "22"
        - name: NCCL_IB_RETRY_CNT
          value: "7"
        - name: NCCL_ALGO
          value: "Ring,Tree"      # Algorithm selection
        - name: NCCL_PROTO
          value: "Simple,LL,LL128"
        
        # Debug
        - name: NCCL_DEBUG
          value: "INFO"
        - name: NCCL_DEBUG_SUBSYS
          value: "INIT,NET,GRAPH"
      resources:
        requests:
          nvidia.com/gpu: "8"
          openshift.io/mellanoxnics: "4"
```

### Topology File for NCCL

```xml
<!-- /var/run/nvidia/topo.xml — helps NCCL understand GPU-NIC affinity -->
<system version="1">
  <cpu numaid="0" affinity="0-31" arch="x86_64" vendor="GenuineIntel">
    <pci busid="0000:17:00.0" class="0x030200" vendor="0x10de" device="0x2330"
         subsystem_vendor="0x10de" subsystem_device="0x1626" link_speed="16 GT/s"
         link_width="16">
      <!-- GPU0 -->
      <gpu dev="0" sm="90" mem="81920" bar1="131072"/>
    </pci>
    <pci busid="0000:18:00.0" class="0x020700" vendor="0x15b3" device="0x101e">
      <!-- NIC0 - same PCIe switch as GPU0 -->
      <nic dev="mlx5_0"/>
    </pci>
    <pci busid="0000:65:00.0" class="0x030200" vendor="0x10de" device="0x2330">
      <!-- GPU1 - no direct NIC, will use PXN via GPU0 -->
      <gpu dev="1" sm="90" mem="81920" bar1="131072"/>
    </pci>
  </cpu>
</system>
```

### NCCL_CROSS_NIC Explained

```text
NCCL_CROSS_NIC values:
──────────────────────────────────────────────────────────────────
Value   Behavior
──────────────────────────────────────────────────────────────────
0       Use only the NIC closest to each GPU (strict affinity)
        → Fails if GPU has no local NIC
        
1       Allow GPUs to use any NIC (cross-NIC via NVLink/PXN)
        → Enables PXN path: GPU → NVLink → peer GPU → NIC
        
2       Prefer local NIC but fall back to cross-NIC if needed
        → Best of both: locality when possible, PXN when necessary
```

### Verify PXN is Active

```bash
# Run with NCCL_DEBUG=INFO and look for PXN indicators
export NCCL_DEBUG=INFO
export NCCL_DEBUG_SUBSYS=INIT,NET,GRAPH

# In NCCL output, look for:
# "Channel [X] ... GPU/Y -> NIC/Z via GPU/W"  ← PXN path (GPU W proxies)
# "PXN" in graph info

# Topology dump
export NCCL_TOPO_DUMP_FILE=/tmp/topo.xml
# Run training, then inspect /tmp/topo.xml for GPU-NIC paths

# Check which algo/path NCCL selected
# "Ring" with cross-NIC paths = PXN active
# "Tree" = hierarchical (also uses PXN for leaf GPUs without NICs)
```

### Multi-NIC Bandwidth Optimization

```bash
# With 4× ConnectX-7 400Gb/s NICs:
# Theoretical: 4 × 400 = 1600 Gb/s bidirectional per node
# With PXN overhead (~5% NVLink hop): ~1520 Gb/s effective

# Optimize NIC-to-GPU mapping:
export NCCL_IB_HCA="mlx5_0:1,mlx5_1:1,mlx5_2:1,mlx5_3:1"
# :1 = port 1 (InfiniBand port number)

# Pin NCCL threads to correct NUMA
export NCCL_SOCKET_NTHREADS=4
export NCCL_NSOCKS_PERTHREAD=4

# For DGX-style systems (NVSwitch):
export NCCL_NVLS_ENABLE=1         # NVLink SHARP (H100+)
export NCCL_P2P_NET_CHUNKSIZE=524288  # 512KB chunks for NVLink
```

## Common Issues

### GPU without NIC falls back to SHM/CPU copy
- **Cause**: `NCCL_CROSS_NIC=0` or NVLink not detected between GPUs
- **Fix**: Set `NCCL_CROSS_NIC=1`; verify NVLink with `nvidia-smi topo -m`

### PXN not used despite NVLink present
- **Cause**: Topology file missing or incorrect; NCCL can't determine affinity
- **Fix**: Provide `NCCL_TOPO_FILE`; or let GPU Operator generate it via GFD

### Uneven bandwidth across GPUs
- **Cause**: PXN GPUs share NIC bandwidth with the GPU that has direct access
- **Fix**: Expected — 2 GPUs share 1 NIC. Design for it in placement strategy.

## Best Practices

1. **Set `NCCL_CROSS_NIC=1`** for systems with fewer NICs than GPUs
2. **Provide topology file** — helps NCCL make optimal path decisions
3. **Match VF count to NIC count** (not GPU count) in SR-IOV policy
4. **Use `NCCL_DEBUG=INFO`** to verify PXN paths are selected
5. **Pin workloads to full nodes** — partial allocation breaks PXN topology
6. **NVSwitch systems (DGX)**: all GPUs can reach all NICs efficiently
7. **PCIe-only systems**: PXN limited to GPUs connected via NVLink bridges

## Key Takeaways

- PXN = GPU uses another GPU's NIC via NVLink for network access
- Critical when NIC count < GPU count (common: 4 NICs for 8 GPUs)
- `NCCL_CROSS_NIC=1` enables cross-NIC routing via NVLink
- ~5% overhead per NVLink hop compared to direct NIC access
- Topology file helps NCCL find optimal GPU→NIC paths
- Works with both InfiniBand and RoCE (Ethernet RDMA)
- DGX/NVSwitch systems: all GPUs have equal NIC access (no PXN penalty)
- PCIe systems: PXN only works between NVLink-connected GPU pairs
