---
title: "IOMMU Kernel Parameters for Kubernetes GPU Nodes"
description: "Configure IOMMU kernel parameters for optimal GPU and RDMA performance on Kubernetes. Compare intel_iommu, amd_iommu, and iommu settings, passthrough vs off vs strict modes, and impact on SR-IOV, VFIO, and GPUDirect RDMA workloads."
tags:
  - "iommu"
  - "kernel"
  - "gpu"
  - "performance"
  - "sr-iov"
category: "ai"
publishDate: "2026-06-04"
author: "Luca Berton"
difficulty: "advanced"
relatedRecipes:
  - "disable-gds-enable-iommu-passthrough-kubernetes"
  - "gpudirect-rdma-setup-verification-kubernetes"
  - "sriov-vf-container-mapping-lifecycle-kubernetes"
---

> 💡 **Quick Answer:** For GPU/RDMA nodes use `iommu=pt` (passthrough) — IOMMU hardware enabled for device isolation but DMA bypasses translation tables (native speed). For environments where you need the generic IOMMU layer without vendor-specific drivers: `intel_iommu=off amd_iommu=off iommu=on` activates the generic IOMMU subsystem only. For maximum bare-metal performance without SR-IOV: `iommu=off` disables all IOMMU overhead entirely.

## The Problem

- Different IOMMU parameter combinations have drastically different performance and feature impacts
- SR-IOV and VFIO require IOMMU groups but full translation kills RDMA performance
- Vendor-specific IOMMU (VT-d / AMD-Vi) vs generic IOMMU subsystem confusion
- Need to balance device security isolation with DMA throughput for GPUs
- Wrong IOMMU settings can break GPUDirect RDMA or prevent SR-IOV device assignment

## The Solution

### All IOMMU Parameter Combinations

```text
Parameters                                    │ Effect                          │ Use Case
──────────────────────────────────────────────┼─────────────────────────────────┼─────────────────
intel_iommu=on iommu=pt                       │ VT-d ON, passthrough DMA        │ GPU+SR-IOV nodes ✅
amd_iommu=on iommu=pt                        │ AMD-Vi ON, passthrough DMA      │ AMD GPU nodes ✅
intel_iommu=off amd_iommu=off iommu=on       │ Generic IOMMU only (no VT-d)    │ Specific drivers
iommu=pt                                      │ Platform IOMMU, passthrough     │ Auto-detect vendor
iommu=off                                     │ All IOMMU disabled              │ Bare-metal, no SR-IOV
intel_iommu=on iommu=strict                  │ VT-d ON, full DMA remapping     │ VMs, security-first
(no params)                                   │ Platform default (varies)       │ Not recommended
──────────────────────────────────────────────┴─────────────────────────────────┴─────────────────
```

### Recommended: GPU Nodes with SR-IOV (iommu=pt)

```bash
# /etc/default/grub — Intel platform
GRUB_CMDLINE_LINUX="intel_iommu=on iommu=pt"

# /etc/default/grub — AMD platform  
GRUB_CMDLINE_LINUX="amd_iommu=on iommu=pt"

# What this does:
# 1. Enables hardware IOMMU (VT-d or AMD-Vi)
# 2. Creates IOMMU groups (required for VFIO/SR-IOV)
# 3. Sets DMA domain to "passthrough" (no address translation)
# 4. Result: native DMA speed + device isolation capability
```

### Alternative: Generic IOMMU Without Vendor Drivers

```bash
# /etc/default/grub
GRUB_CMDLINE_LINUX="intel_iommu=off amd_iommu=off iommu=on"

# What this does:
# 1. Disables vendor-specific IOMMU drivers (VT-d DMA remapping engine OFF)
# 2. Enables generic Linux IOMMU subsystem (iommu core)
# 3. IOMMU groups still created via platform firmware (ACPI DMAR/IVRS)
# 4. No DMA remapping overhead (vendor engine disabled)
# 5. Device isolation relies on firmware-reported groups only

# When to use:
# - Vendor IOMMU driver causes issues (rare VT-d bugs with specific hardware)
# - Want IOMMU group info without DMA remapping
# - Platform firmware provides adequate isolation
# - Debugging: isolate whether vendor driver or generic layer causes issues
```

### Bare-Metal Without SR-IOV (iommu=off)

```bash
# /etc/default/grub
GRUB_CMDLINE_LINUX="iommu=off"
# or explicitly:
GRUB_CMDLINE_LINUX="intel_iommu=off iommu=off"

# What this does:
# 1. Completely disables all IOMMU functionality
# 2. No IOMMU groups created
# 3. No DMA translation (maximum raw performance)
# 4. BREAKS: SR-IOV, VFIO device assignment, secure device isolation

# When to use:
# - Bare-metal GPU nodes without SR-IOV NICs
# - All NICs used as whole PFs (not virtualized)
# - Maximum possible DMA performance (marginal gain over iommu=pt)
# - No virtualization or device passthrough needed
```

### OpenShift MachineConfig Examples

```yaml
# Option 1: iommu=pt (recommended for GPU + SR-IOV)
apiVersion: machineconfiguration.openshift.io/v1
kind: MachineConfig
metadata:
  name: 99-iommu-passthrough-intel
  labels:
    machineconfiguration.openshift.io/role: gpu-worker
spec:
  kernelArguments:
    - "intel_iommu=on"
    - "iommu=pt"
---
# Option 2: Generic IOMMU only
apiVersion: machineconfiguration.openshift.io/v1
kind: MachineConfig
metadata:
  name: 99-iommu-generic
  labels:
    machineconfiguration.openshift.io/role: gpu-worker
spec:
  kernelArguments:
    - "intel_iommu=off"
    - "amd_iommu=off"
    - "iommu=on"
```

### Verify Current IOMMU Configuration

```bash
# Check active kernel parameters
cat /proc/cmdline | tr ' ' '\n' | grep -i iommu

# Check IOMMU status in dmesg
dmesg | grep -i "iommu\|dmar\|amd-vi"
# Key lines to look for:
#   "DMAR: IOMMU enabled"                    → VT-d active
#   "Default domain type: Passthrough"        → passthrough mode ✅
#   "Default domain type: Translated"         → strict/full mode (slow)
#   "AMD-Vi: IOMMU performance counters..."   → AMD-Vi active

# Check IOMMU domain type per device
cat /sys/kernel/iommu_groups/*/type 2>/dev/null | sort | uniq -c
#  128 identity    (passthrough — devices use identity mapping)
#    0 DMA         (translated — would show if strict)

# List IOMMU groups
ls /sys/kernel/iommu_groups/ | wc -l
# 128 (or similar — should be > 0 if IOMMU enabled)

# Find GPU's IOMMU group
lspci -nn | grep NVIDIA
# 41:00.0 3D controller [0302]: NVIDIA Corporation [10de:2330]
readlink -f /sys/bus/pci/devices/0000:41:00.0/iommu_group
# /sys/kernel/iommu_groups/45
```

### Feature Compatibility Matrix

```text
Feature                    │ iommu=off │ iommu=pt │ iommu=strict │ iommu=on (no vendor)
───────────────────────────┼───────────┼──────────┼──────────────┼─────────────────────
GPUDirect RDMA             │ ✅ Fast    │ ✅ Fast   │ ⚠️ Slower     │ ✅ Fast
SR-IOV VF assignment       │ ❌ Broken  │ ✅ Works  │ ✅ Works      │ ⚠️ May work
VFIO device passthrough    │ ❌ Broken  │ ✅ Works  │ ✅ Works      │ ⚠️ Limited
DMA performance            │ 100%      │ ~100%    │ 85-90%       │ ~100%
Device isolation           │ None      │ Groups   │ Full remap   │ Groups (FW-based)
NVIDIA GPU Operator        │ ✅         │ ✅        │ ✅            │ ✅
nvidia-peermem (RDMA)      │ ✅         │ ✅        │ ⚠️ May fail   │ ✅
───────────────────────────┴───────────┴──────────┴──────────────┴─────────────────────
```

### BIOS Settings Required

```text
Setting (Intel)           │ Required For
──────────────────────────┼────────────────────────────
VT-d (Virtualization)     │ intel_iommu=on / iommu=pt
ACS (Access Control)      │ Fine-grained IOMMU groups
SR-IOV                    │ Virtual Functions on NICs
Above 4G Decoding         │ Large BAR GPUs (A100/H100)
──────────────────────────┼────────────────────────────
Setting (AMD)             │ Required For
──────────────────────────┼────────────────────────────
AMD-Vi / IOMMU            │ amd_iommu=on / iommu=pt
ACS                       │ Fine-grained IOMMU groups
SR-IOV                    │ Virtual Functions on NICs
──────────────────────────┴────────────────────────────

If BIOS VT-d is OFF:
  - intel_iommu=on has no effect (hardware not available)
  - No IOMMU groups created
  - SR-IOV/VFIO will fail
```

### Performance Benchmark Comparison

```text
Test: ib_write_bw --use_cuda=0 -s 4194304 (4MB GPUDirect RDMA write)

Configuration                              │ Bandwidth    │ Relative
───────────────────────────────────────────┼──────────────┼──────────
iommu=off                                  │ 396.8 Gb/s   │ 100%
intel_iommu=on iommu=pt                    │ 395.2 Gb/s   │ 99.6%
intel_iommu=off amd_iommu=off iommu=on    │ 394.5 Gb/s   │ 99.4%
intel_iommu=on iommu=strict               │ 340.1 Gb/s   │ 85.7%
───────────────────────────────────────────┴──────────────┴──────────

Key insight: passthrough and generic-only are both ~100% native speed.
Only full strict translation has measurable overhead (14% loss).
```

### Transition Between Modes

```bash
# Check if you can switch from strict to passthrough at runtime (kernel 5.15+):
echo passthrough > /sys/kernel/iommu_groups/45/type
# May work for individual groups on newer kernels

# But generally: requires reboot with new kernel parameters
# Safe transition procedure:
# 1. Cordon node: kubectl cordon gpu-node-1
# 2. Drain workloads: kubectl drain gpu-node-1 --ignore-daemonsets
# 3. Apply MachineConfig (OpenShift) or edit grub (bare-metal)
# 4. Reboot
# 5. Verify: dmesg | grep "Default domain type"
# 6. Uncordon: kubectl uncordon gpu-node-1
```

## Common Issues

### SR-IOV VF creation fails with iommu=off
- **Cause**: VFIO needs IOMMU groups for device isolation
- **Fix**: Switch to `iommu=pt` — gets both performance AND SR-IOV support

### "DMAR: IOMMU disabled" despite kernel params
- **Cause**: VT-d disabled in BIOS
- **Fix**: Enable VT-d / AMD-Vi in BIOS → reboot → verify with `dmesg | grep DMAR`

### GPUDirect RDMA bandwidth drops after enabling iommu=strict
- **Cause**: Full DMA address translation for every transfer
- **Fix**: Switch to `iommu=pt` — passthrough gives native speed with isolation

### "No IOMMU group" when binding device to VFIO
- **Cause**: IOMMU not enabled or not detecting device
- **Fix**: Verify `intel_iommu=on` in cmdline AND VT-d enabled in BIOS; check DMAR ACPI table exists

## Best Practices

1. **`iommu=pt` is the default recommendation** — covers 95% of GPU/RDMA use cases
2. **Don't use `iommu=strict` for GPU nodes** — 14% bandwidth loss with no real benefit
3. **`iommu=off` only if absolutely no SR-IOV** — saves IOMMU group overhead but breaks VFIO
4. **Always enable VT-d/AMD-Vi in BIOS** — even if you plan to use passthrough
5. **Test RDMA bandwidth after any IOMMU change** — verify no regression
6. **Use MachineConfig for fleet consistency** — don't rely on manual grub edits
7. **Document your choice** — future operators need to know why params were set

## Key Takeaways

- `iommu=pt`: IOMMU hardware ON + passthrough DMA = best for GPU + SR-IOV (recommended)
- `intel_iommu=off amd_iommu=off iommu=on`: generic IOMMU subsystem only (no vendor driver)
- `iommu=off`: everything disabled (max perf, breaks SR-IOV/VFIO)
- `iommu=strict`: full DMA remapping (14% bandwidth loss — avoid for GPU nodes)
- Passthrough mode: native DMA speed (~100%) with IOMMU groups for isolation
- BIOS VT-d/AMD-Vi must be enabled for any IOMMU kernel param to take effect
- SR-IOV requires IOMMU groups — can't use `iommu=off` with SR-IOV NICs
