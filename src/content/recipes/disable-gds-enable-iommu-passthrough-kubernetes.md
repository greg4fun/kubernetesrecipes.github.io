---
title: "Disable GDS and Enable IOMMU Passthrough on K8s GPUs"
description: "Disable GPUDirect Storage (GDS) when not needed and configure IOMMU passthrough mode for GPU and NIC device assignment. Kernel parameters, BIOS settings, VFIO"
tags:
  - "iommu"
  - "passthrough"
  - "gds"
  - "gpu"
  - "vfio"
category: "ai"
publishDate: "2026-06-04"
author: "Luca Berton"
difficulty: "advanced"
relatedRecipes:
  - "gpudirect-rdma-setup-verification-kubernetes"
  - "nvidia-gpu-operator-gitops-openshift"
  - "openshift-machineconfig-mcp-guide"
---

> 💡 **Quick Answer:** Disable GDS with `CUFILE_ENV_PATH_JSON=/dev/null` or uninstall `nvidia-gds` package when not using direct storage I/O. Enable IOMMU passthrough with kernel parameter `iommu=pt` (or `intel_iommu=on iommu=pt`) — this keeps IOMMU active for device isolation but in passthrough mode for DMA performance, avoiding the IOMMU translation overhead that can reduce GPUDirect RDMA throughput by 10-15%.

## The Problem

- GPUDirect Storage (GDS) loads kernel modules and drivers that conflict with some workloads
- GDS is only needed for direct NVMe-to-GPU transfers — unnecessary for training/inference
- IOMMU in full translation mode adds DMA overhead (10-15% bandwidth loss for RDMA)
- Need device passthrough for VFIO (SR-IOV VFs) but without IOMMU performance penalty
- Bare-metal GPU nodes need IOMMU for security isolation without sacrificing performance

## The Solution

### Disable GPUDirect Storage (GDS)

```bash
# Option 1: Disable at runtime (per-pod)
export CUFILE_ENV_PATH_JSON=/dev/null
# This tells libcufile to skip initialization

# Option 2: Unload GDS kernel modules
rmmod nvidia_fs
# Verify
lsmod | grep nvidia_fs
# (should return nothing)

# Option 3: Prevent loading at boot
echo "blacklist nvidia_fs" > /etc/modprobe.d/blacklist-gds.conf
depmod -a

# Option 4: Uninstall GDS package entirely
apt-get remove nvidia-gds
# or
yum remove nvidia-gds
```

### Disable GDS in GPU Operator

```yaml
apiVersion: nvidia.com/v1
kind: ClusterPolicy
metadata:
  name: cluster-policy
spec:
  driver:
    enabled: true
    rdma:
      enabled: true          # Keep RDMA (nvidia-peermem)
      useHostMofed: true
  gds:
    enabled: false           # Disable GPUDirect Storage
  # GDS components won't be deployed
```

### Disable GDS per Container

```yaml
apiVersion: v1
kind: Pod
spec:
  containers:
    - name: training
      image: nvcr.io/nvidia/pytorch:24.04-py3
      env:
        # Disable cuFile/GDS in container
        - name: CUFILE_ENV_PATH_JSON
          value: "/dev/null"
        # Alternative: disable via CUDA env
        - name: CUDA_DISABLE_GDS
          value: "1"
```

### Enable IOMMU Passthrough Mode

```bash
# Check current IOMMU status
dmesg | grep -i iommu
cat /proc/cmdline | grep iommu

# For Intel CPUs: enable IOMMU with passthrough
# Edit /etc/default/grub:
GRUB_CMDLINE_LINUX="intel_iommu=on iommu=pt"

# For AMD CPUs:
GRUB_CMDLINE_LINUX="amd_iommu=on iommu=pt"

# Regenerate GRUB and reboot
grub2-mkconfig -o /boot/grub2/grub.cfg
# or (Ubuntu)
update-grub
reboot
```

### IOMMU Modes Explained

```text
Mode          │ Kernel Param    │ DMA Performance │ Device Isolation │ Use Case
──────────────┼─────────────────┼─────────────────┼──────────────────┼──────────────
Off           │ iommu=off       │ Native (best)   │ None             │ Trusted bare-metal
              │ intel_iommu=off │                 │                  │
──────────────┼─────────────────┼─────────────────┼──────────────────┼──────────────
Passthrough   │ iommu=pt        │ Native (best)   │ Groups only      │ GPU/RDMA nodes ✅
              │ intel_iommu=on  │                 │ (no translation) │
──────────────┼─────────────────┼─────────────────┼──────────────────┼──────────────
Full (strict) │ iommu=strict    │ ~85-90%         │ Full DMA remap   │ VMs, untrusted
              │ intel_iommu=on  │ (10-15% loss)   │                  │ devices
──────────────┴─────────────────┴─────────────────┴──────────────────┴──────────────

For GPU/RDMA workloads: iommu=pt is the correct choice.
- IOMMU hardware is active (needed for VFIO/SR-IOV device assignment)
- But DMA operations bypass IOMMU translation (no performance penalty)
- Devices assigned to VFIO still get proper isolation via IOMMU groups
```

### OpenShift MachineConfig for IOMMU Passthrough

```yaml
apiVersion: machineconfiguration.openshift.io/v1
kind: MachineConfig
metadata:
  name: 99-iommu-passthrough
  labels:
    machineconfiguration.openshift.io/role: gpu-worker
spec:
  kernelArguments:
    - "intel_iommu=on"
    - "iommu=pt"
  # Node will reboot after MCP applies this
```

### Combined: Disable GDS + IOMMU Passthrough (OpenShift)

```yaml
apiVersion: machineconfiguration.openshift.io/v1
kind: MachineConfig
metadata:
  name: 99-gpu-node-kernel-params
  labels:
    machineconfiguration.openshift.io/role: gpu-worker
spec:
  kernelArguments:
    - "intel_iommu=on"
    - "iommu=pt"
  config:
    ignition:
      version: 3.4.0
    storage:
      files:
        - path: /etc/modprobe.d/blacklist-gds.conf
          mode: 0644
          contents:
            source: data:,blacklist%20nvidia_fs%0A
        - path: /etc/modules-load.d/nvidia-peermem.conf
          mode: 0644
          contents:
            source: data:,nvidia-peermem%0A
```

### Verify IOMMU Passthrough Active

```bash
# Check kernel command line
cat /proc/cmdline
# ... intel_iommu=on iommu=pt ...

# Check IOMMU is active but in passthrough
dmesg | grep -i "iommu"
# [    0.000000] DMAR: IOMMU enabled
# [    2.345678] iommu: Default domain type: Passthrough

# Verify IOMMU groups exist (needed for VFIO)
find /sys/kernel/iommu_groups/ -type l | head -10
# /sys/kernel/iommu_groups/0/devices/0000:00:00.0
# /sys/kernel/iommu_groups/1/devices/0000:00:01.0

# Check GPU's IOMMU group
GPU_PCI="0000:41:00.0"  # Your GPU's PCIe address
find /sys/kernel/iommu_groups/*/devices -name "$GPU_PCI"
# /sys/kernel/iommu_groups/45/devices/0000:41:00.0

# Verify no DMA translation overhead
dmesg | grep "Passthrough"
# iommu: Default domain type: Passthrough (set via kernel command line)
```

### VFIO Device Assignment with Passthrough

```bash
# VFIO requires IOMMU (even in passthrough mode, it uses IOMMU groups)
# Bind SR-IOV VF to VFIO driver
echo "0000:41:00.2" > /sys/bus/pci/drivers/mlx5_core/unbind
echo "15b3 101e" > /sys/bus/pci/drivers/vfio-pci/new_id
echo "0000:41:00.2" > /sys/bus/pci/drivers/vfio-pci/bind

# Verify
ls /dev/vfio/
# 45  vfio  (group 45 = device's IOMMU group)
```

### Performance Impact Measurement

```bash
# Test RDMA bandwidth with IOMMU modes:

# 1. With iommu=pt (passthrough):
ib_write_bw -d mlx5_0 --use_cuda=0 -s 4194304
#  4194304  5000  395.2 Gb/sec

# 2. With iommu=strict (full translation):
ib_write_bw -d mlx5_0 --use_cuda=0 -s 4194304
#  4194304  5000  340.1 Gb/sec  (14% slower!)

# 3. With iommu=off:
ib_write_bw -d mlx5_0 --use_cuda=0 -s 4194304
#  4194304  5000  396.8 Gb/sec  (same as passthrough)
```

### When to Keep GDS Enabled

```text
Keep GDS enabled when:
  ✅ Running checkpoint saves to NVMe (direct GPU → NVMe, skips CPU)
  ✅ Loading datasets from local NVMe directly to GPU memory
  ✅ Running GDS-optimized frameworks (RAPIDS, cuDF, Magnum IO)

Disable GDS when:
  ❌ Training with data loaded from network storage (NFS, S3, Ceph)
  ❌ Running inference only (model weights loaded once at startup)
  ❌ GDS modules conflict with other drivers
  ❌ No local NVMe drives on the node
  ❌ Debugging GPU/RDMA issues (reduce variable count)
```

## Common Issues

### "nvidia_fs: Unknown symbol" after driver update
- **Cause**: GDS module version mismatch with NVIDIA driver
- **Fix**: Reinstall `nvidia-gds` matching driver version; or blacklist if not needed

### IOMMU groups too large (multiple devices in one group)
- **Cause**: Platform doesn't support ACS (Access Control Services) on PCIe switches
- **Fix**: Enable ACS in BIOS; or use `pcie_acs_override=downstream,multifunction` (less secure)

### GPUDirect RDMA stops working after enabling iommu=strict
- **Cause**: Full IOMMU translation breaks nvidia-peermem DMA mappings on some drivers
- **Fix**: Use `iommu=pt` instead of `iommu=strict` — keeps isolation with native DMA speed

### VFIO bind fails: "No IOMMU group"
- **Cause**: IOMMU disabled in BIOS (VT-d / AMD-Vi) or kernel
- **Fix**: Enable VT-d in BIOS; add `intel_iommu=on` to kernel parameters; reboot

## Best Practices

1. **`iommu=pt` for all GPU/RDMA nodes** — best performance with device isolation
2. **Disable GDS unless actively using NVMe-to-GPU transfers** — reduces module conflicts
3. **Keep nvidia-peermem loaded** — needed for GPUDirect RDMA regardless of GDS status
4. **Enable VT-d in BIOS** — required for IOMMU even in passthrough mode
5. **Use MachineConfig/kernel args for consistency** — not manual modprobe
6. **Verify passthrough after reboot** — check `dmesg | grep "Default domain"`
7. **Don't use `iommu=off`** — breaks VFIO/SR-IOV device assignment entirely

## Key Takeaways

- GDS (GPUDirect Storage) ≠ GDRDMA — GDS is for NVMe, GDRDMA is for networking
- Disable GDS: `CUFILE_ENV_PATH_JSON=/dev/null` (runtime) or blacklist nvidia_fs (persistent)
- IOMMU passthrough (`iommu=pt`): IOMMU hardware active for isolation, no DMA translation overhead
- Performance: passthrough = native speed; strict = 10-15% DMA bandwidth loss
- GPU Operator: `gds.enabled: false` disables GDS; `driver.rdma.enabled: true` keeps RDMA
- OpenShift: `kernelArguments` in MachineConfig for IOMMU; storage files for module blacklist
- VFIO/SR-IOV requires IOMMU enabled — passthrough mode satisfies both performance and isolation
