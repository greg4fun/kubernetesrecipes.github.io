---
title: "IOMMU BIOS and Kernel Config for NCCL GPU-Direct"
description: "Configure IOMMU at BIOS and kernel level to enable NCCL GPU-Direct RDMA on Kubernetes. Covers Intel VT-d, AMD-Vi, kernel parameters, passthrough"
tags:
  - "iommu"
  - "nccl"
  - "gpu-direct"
  - "rdma"
  - "bios"
category: "ai"
publishDate: "2026-05-08"
author: "Luca Berton"
difficulty: "advanced"
relatedRecipes:
  - "openshift-sriov-rdma-infiniband-device-plugin"
  - "openshift-sriov-mmio-resources-fix"
  - "nvidia-gpu-operator-gitops-openshift"
  - "kubernetes-ai-infrastructure-scaling"
---

> 💡 **Quick Answer:** NCCL GPU-Direct RDMA requires IOMMU enabled in BIOS (VT-d/AMD-Vi) and configured in the kernel with `iommu=pt` (passthrough mode) so GPUs and RDMA NICs can perform peer-to-peer DMA without CPU involvement, achieving maximum inter-node communication bandwidth.

## The Problem

Multi-GPU distributed training with NCCL needs:

- GPU-to-GPU direct memory access (GPUDirect P2P within a node)
- GPU-to-NIC direct memory access (GPUDirect RDMA across nodes)
- IOMMU must be enabled (required for SR-IOV and device passthrough)
- But IOMMU in strict mode adds DMA translation overhead (kills performance)
- Misconfigured IOMMU = NCCL falls back to CPU-copied transfers (10x slower)

## The Solution

### BIOS Configuration

```text
Required BIOS Settings for NCCL GPU-Direct:
────────────────────────────────────────────────────────────────
Setting                     Intel               AMD
────────────────────────────────────────────────────────────────
IOMMU                       VT-d: Enabled       AMD-Vi: Enabled
SR-IOV                      Enabled             Enabled
Above 4G Decoding           Enabled             Enabled
ACS Override                Disabled*           Disabled*
PCIe ARI                    Enabled             Enabled
PCIe Relaxed Ordering       Enabled             Enabled
PCIe Max Payload Size       Auto/256B           Auto/256B
PCIe Max Read Request       Auto/4096B          Auto/4096B
NUMA                        Enabled             Enabled
NPS (NUMA Per Socket)       —                   NPS1 or NPS4**

* ACS (Access Control Services) must be disabled or overridden
  for GPU-Direct P2P within PCIe switch groups
** NPS4 for best NUMA locality to GPUs; NPS1 for simplicity
```

### Kernel Parameters

```bash
# Required kernel boot parameters for NCCL GPU-Direct RDMA:

# Intel systems:
intel_iommu=on iommu=pt pci=realloc pci=assign-busses

# AMD systems:
amd_iommu=on iommu=pt pci=realloc pci=assign-busses

# Explanation:
# intel_iommu=on / amd_iommu=on  → Enable IOMMU hardware
# iommu=pt                        → Passthrough mode (CRITICAL for performance)
# pci=realloc                     → Re-allocate PCIe resources (helps MMIO)
# pci=assign-busses               → Reassign PCI bus numbers (multi-root systems)
```

### Why `iommu=pt` (Passthrough) is Critical

```text
IOMMU Modes:
────────────────────────────────────────────────────────────────
Mode         DMA Path                    Performance    Security
────────────────────────────────────────────────────────────────
Disabled     Direct DMA (no protection)  Best           None
Strict       All DMA through IOMMU       Worst (-30%)   Full
Passthrough  Bypass for assigned devices Best           Selective
  (iommu=pt)

With iommu=pt:
- Devices assigned to VMs/containers go through IOMMU (security ✅)
- Devices used directly by host bypass IOMMU (performance ✅)
- GPU-to-GPU P2P DMA bypasses translation (GPUDirect P2P ✅)
- GPU-to-NIC DMA bypasses translation (GPUDirect RDMA ✅)

Without iommu=pt (strict mode):
- Every DMA transaction goes through IOMMU page table walk
- GPU-Direct RDMA latency increases 2-5x
- NCCL bandwidth drops 20-30%
- Training throughput degrades significantly
```

### OpenShift MachineConfig for Kernel Parameters

```yaml
apiVersion: machineconfiguration.openshift.io/v1
kind: MachineConfig
metadata:
  name: 99-gpu-worker-iommu
  labels:
    machineconfiguration.openshift.io/role: gpu-worker
spec:
  kernelArguments:
    - intel_iommu=on
    - iommu=pt
    - pci=realloc
    - pci=assign-busses
    - rdma_ucm.disable_raw_qp_enforcement=1
    - nvidia.NVreg_RegisterForACPIEvents=1
    - nvidia.NVreg_EnablePCIeRelaxedOrderingMode=1
```

### Talos Linux Kernel Parameters

```yaml
# Talos machine config patch
machine:
  install:
    extraKernelArgs:
      - intel_iommu=on
      - iommu=pt
      - pci=realloc
      - pci=assign-busses
  kernel:
    modules:
      - name: nvidia
      - name: nvidia_uvm
      - name: nvidia_peermem    # Required for GPUDirect RDMA
      - name: ib_core
      - name: mlx5_core
      - name: mlx5_ib
```

### Standard Linux (GRUB)

```bash
# Edit GRUB configuration
sudo vim /etc/default/grub

# Add to GRUB_CMDLINE_LINUX:
GRUB_CMDLINE_LINUX="intel_iommu=on iommu=pt pci=realloc pci=assign-busses"

# Regenerate GRUB
sudo grub2-mkconfig -o /boot/grub2/grub.cfg    # RHEL/Rocky
sudo update-grub                                 # Ubuntu/Debian

# Reboot
sudo reboot
```

### Verify IOMMU Configuration

```bash
# Check IOMMU is enabled
dmesg | grep -i iommu
# Expected: "DMAR: IOMMU enabled"
# or:       "AMD-Vi: IOMMU performance counters supported"

# Verify passthrough mode
dmesg | grep -i "iommu.*passthrough\|DMA.*passthrough"
# Expected: "iommu: Default domain type: Passthrough"

# Check kernel command line
cat /proc/cmdline | grep -o "iommu=[^ ]*"
# Expected: iommu=pt

# List IOMMU groups (GPUs and NICs should be in same group for P2P)
for d in /sys/kernel/iommu_groups/*/devices/*; do
  echo "IOMMU Group $(basename $(dirname $(dirname $d))): $(lspci -nns $(basename $d))"
done | grep -E "NVIDIA|Mellanox"

# Verify GPU-Direct RDMA module loaded
lsmod | grep nvidia_peermem
# If not loaded:
modprobe nvidia_peermem

# Check peermem registration
dmesg | grep -i peermem
# Expected: "nvidia peermem registered"
```

### Verify NCCL Can Use GPU-Direct RDMA

```bash
# Inside a Pod with GPUs + RDMA VFs:

# Set NCCL debug to see transport selection
export NCCL_DEBUG=INFO
export NCCL_IB_HCA=mlx5
export NCCL_NET_GDR_LEVEL=5         # GPU-Direct RDMA level
export NCCL_IB_GID_INDEX=3          # RoCE v2 GID index
export NCCL_CROSS_NIC=1             # Allow cross-NIC communication
export NCCL_IB_QPS_PER_CONNECTION=4  # QPs per connection

# Run NCCL test
/usr/bin/all_reduce_perf -b 8 -e 256M -f 2 -g 1

# Look for in output:
# "NET/IB : Using [0]mlx5_0:1/GID ..."  ← IB transport selected
# "GPU Direct RDMA Enabled"              ← GDR active
# "Channel [0] ... GPU Direct RDMA"      ← P2P DMA path confirmed

# If you see instead:
# "NET/Socket" ← Fallback to TCP (BAD)
# "Could not enable GPU Direct RDMA" ← IOMMU or peermem issue
```

### NCCL Environment Variables for GPU-Direct

```yaml
# Pod spec with full NCCL GPU-Direct configuration
apiVersion: v1
kind: Pod
metadata:
  name: nccl-benchmark
  namespace: ai-training
  annotations:
    k8s.v1.cni.cncf.io/networks: rdma-network
spec:
  containers:
    - name: nccl
      image: nvcr.io/nvidia/pytorch:24.07-py3
      env:
        # NCCL Transport
        - name: NCCL_DEBUG
          value: "INFO"
        - name: NCCL_IB_HCA
          value: "mlx5"
        - name: NCCL_NET_GDR_LEVEL
          value: "5"
        # GPU-Direct RDMA
        - name: NCCL_IB_CUDA_SUPPORT
          value: "1"
        - name: NCCL_IB_GID_INDEX
          value: "3"
        # Performance tuning
        - name: NCCL_IB_QPS_PER_CONNECTION
          value: "4"
        - name: NCCL_IB_TIMEOUT
          value: "22"
        - name: NCCL_IB_RETRY_CNT
          value: "7"
        - name: NCCL_CROSS_NIC
          value: "1"
        # Disable SHM for multi-node (use RDMA)
        - name: NCCL_SHM_DISABLE
          value: "0"
        - name: NCCL_P2P_LEVEL
          value: "NVL"
      resources:
        requests:
          nvidia.com/gpu: "8"
          openshift.io/mellanoxnics: "4"
        limits:
          nvidia.com/gpu: "8"
          openshift.io/mellanoxnics: "4"
```

### ACS (Access Control Services) Handling

```bash
# ACS can block GPU-Direct P2P between devices behind the same PCIe switch
# Check if ACS is enabled on PCIe bridges

# Find PCIe bridges above GPUs
lspci -tv | grep -A2 "NVIDIA"

# Check ACS status
for bridge in $(lspci -d ::0604 | awk '{print $1}'); do
  acs=$(setpci -s $bridge ECAP_ACS+6.w 2>/dev/null)
  if [ -n "$acs" ] && [ "$acs" != "0000" ]; then
    echo "ACS active on bridge $bridge: $acs"
  fi
done

# Disable ACS if blocking P2P (kernel parameter)
# Add to kernel args: pcie_acs_override=downstream,multifunction

# OpenShift MachineConfig:
spec:
  kernelArguments:
    - pcie_acs_override=downstream,multifunction
```

### NUMA Topology Verification

```bash
# GPU-Direct RDMA is fastest when GPU and NIC are on same NUMA node
# Verify topology

# Check GPU NUMA node
nvidia-smi topo -m
# Shows GPU<->NIC affinity matrix

# Check NIC NUMA node
cat /sys/class/net/ens1f0np0/device/numa_node
# Should match GPU NUMA node

# Check PCI device NUMA
lspci -vvv -s 0000:06:00.0 | grep "NUMA node"

# If GPU and NIC on different NUMA nodes:
# Performance penalty ~10-15% due to cross-NUMA memory access
# Solution: Pin workloads to NUMA node with topology-aware scheduling
```

### Performance Validation

```bash
# Expected GPU-Direct RDMA bandwidth (ConnectX-7, 400Gb/s)
# Single direction: ~48 GB/s per NIC
# Bidirectional: ~96 GB/s per NIC

# Test with ib_write_bw (raw RDMA bandwidth)
# Server:
ib_write_bw --use_cuda=0 -d mlx5_0

# Client:
ib_write_bw --use_cuda=0 -d mlx5_0 <server-ip>

# NCCL all-reduce benchmark (multi-node)
# Expected: ~380 Gb/s bus bandwidth with 8x GPUs + 4x ConnectX-7

# If bandwidth is significantly lower:
# 1. Check iommu=pt is set (cat /proc/cmdline)
# 2. Check nvidia_peermem is loaded (lsmod | grep peermem)
# 3. Check ACS not blocking P2P
# 4. Check NUMA locality (GPU and NIC same NUMA node)
# 5. Check NCCL_NET_GDR_LEVEL=5
```

## Common Issues

### NCCL falls back to NET/Socket (TCP)
- **Cause**: RDMA devices not visible to Pod, or nvidia_peermem not loaded
- **Fix**: Verify `openshift.io/mellanoxnics` allocated; load nvidia_peermem module

### "GPU Direct RDMA disabled" in NCCL logs
- **Cause**: `iommu=pt` not set (strict mode blocks GPU-NIC DMA)
- **Fix**: Add `iommu=pt` to kernel parameters; cold reboot

### Low bandwidth despite GPU-Direct RDMA active
- **Cause**: GPU and NIC on different NUMA nodes; ACS blocking P2P path
- **Fix**: Check `nvidia-smi topo -m`; add `pcie_acs_override` if needed

### nvidia_peermem fails to load
- **Cause**: nvidia driver version mismatch or ib_core not loaded
- **Fix**: Load `ib_core` first; ensure NVIDIA driver matches kernel module version

### IOMMU groups too large (all devices in one group)
- **Cause**: ACS not supported on PCIe bridge; kernel groups all downstream devices
- **Fix**: `pcie_acs_override` splits groups; or accept shared group (less isolation)

## Best Practices

1. **Always `iommu=pt`** — passthrough mode is mandatory for GPU-Direct performance
2. **Load nvidia_peermem** at boot — add to kernel module autoload
3. **Verify NUMA locality** — schedule GPU workloads on nodes where GPU↔NIC share NUMA
4. **Use `NCCL_NET_GDR_LEVEL=5`** — enables full GPU-Direct RDMA path
5. **Cold reboot after IOMMU changes** — warm reboot doesn't re-enumerate PCIe
6. **Test with `all_reduce_perf`** — validates full NCCL stack end-to-end
7. **Monitor `NCCL_DEBUG=INFO`** — confirms transport selection (IB vs Socket)
8. **Match VFs to GPUs 1:1** — one RDMA VF per GPU for optimal topology

## Key Takeaways

- IOMMU must be enabled (VT-d/AMD-Vi) for SR-IOV device passthrough
- `iommu=pt` (passthrough) is critical — strict mode adds 20-30% overhead to DMA
- nvidia_peermem module bridges NVIDIA GPU memory to RDMA subsystem
- NCCL selects GPU-Direct RDMA automatically when: IOMMU=pt + peermem + VF allocated
- ACS on PCIe bridges can block P2P — override with kernel parameter if needed
- NUMA topology matters: GPU and NIC on same NUMA node = best latency
- Verify with `NCCL_DEBUG=INFO` — look for "GPU Direct RDMA Enabled"
- Full stack: BIOS (VT-d + Above 4G) → Kernel (iommu=pt + peermem) → SR-IOV (VFs) → NCCL (GDR_LEVEL=5)
