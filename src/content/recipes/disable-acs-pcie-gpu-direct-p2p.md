---
title: "Disable PCIe ACS for GPU-Direct P2P"
description: "Disable PCIe Access Control Services (ACS) to enable GPU-Direct peer-to-peer DMA between GPUs and RDMA NICs. Covers BIOS disable, kernel override, and when to skip IOMMU virtualization entirely for bare-metal GPU clusters."
tags:
  - "acs"
  - "pcie"
  - "gpu-direct"
  - "nccl"
  - "performance"
category: "ai"
publishDate: "2026-05-08"
author: "Luca Berton"
difficulty: "advanced"
relatedRecipes:
  - "iommu-bios-kernel-nccl-gpu-direct"
  - "openshift-sriov-rdma-infiniband-device-plugin"
  - "openshift-sriov-mmio-resources-fix"
  - "nvidia-gpu-operator-setup"
---

> 💡 **Quick Answer:** For bare-metal GPU clusters running only AI training (no VMs, no multi-tenant isolation), the simplest path is: disable VT-d/AMD-Vi entirely in BIOS. If you need SR-IOV (which requires IOMMU), then use `pcie_acs_override=downstream,multifunction` in kernel args to allow GPU-Direct P2P across PCIe switches.

## The Problem

ACS (Access Control Services) on PCIe bridges **blocks GPU-to-GPU and GPU-to-NIC direct DMA**:

- GPUs behind the same PCIe switch can't do P2P transfers
- NCCL falls back to CPU-staged copies (10-30x slower)
- GPU-Direct RDMA path broken between NIC and GPU on same root complex
- IOMMU groups become too large or too restrictive

## The Solution

### Decision: Do You Need IOMMU at All?

```text
Question                                          → Action
──────────────────────────────────────────────────────────────────
Running VMs on this node?                         → Keep IOMMU enabled
Running SR-IOV (VFs for Pods)?                    → Keep IOMMU enabled
Multi-tenant with device isolation?               → Keep IOMMU enabled
Bare-metal, single-tenant, GPUs only?             → DISABLE IOMMU entirely
Need SR-IOV + GPU-Direct P2P?                     → IOMMU on + ACS override
```

### Option 1: Disable Virtualization Technology Entirely (Simplest)

If the node is **bare-metal, dedicated to GPU training, no SR-IOV needed**:

```text
BIOS Settings — Disable All Virtualization:
────────────────────────────────────────────────────────────────
Intel:
  • VT-d (Directed I/O):          DISABLED
  • VT-x (Virtualization Tech):   Keep Enabled (for containers)
  • SR-IOV:                        DISABLED (if not using VFs)
  • ACS:                           N/A (no IOMMU = no ACS enforcement)

AMD:
  • AMD-Vi (IOMMU):               DISABLED
  • SVM (Secure Virtual Machine): Keep Enabled (for containers)
  • SR-IOV:                        DISABLED
  • ACS:                           N/A

Result: All DMA is direct, no translation, no ACS enforcement.
GPUDirect P2P and RDMA work at full speed immediately.
```

```bash
# Kernel parameters (no IOMMU at all):
# Simply omit intel_iommu/amd_iommu parameters, or explicitly:
GRUB_CMDLINE_LINUX="intel_iommu=off"
# or just don't set any iommu parameter

# Verify after reboot:
dmesg | grep -i iommu
# Should show: nothing, or "DMAR: IOMMU disabled"

cat /proc/cmdline
# No iommu parameters present
```

**OpenShift MachineConfig (disable IOMMU):**

```yaml
apiVersion: machineconfiguration.openshift.io/v1
kind: MachineConfig
metadata:
  name: 99-gpu-worker-no-iommu
  labels:
    machineconfiguration.openshift.io/role: gpu-worker
spec:
  kernelArguments:
    - intel_iommu=off
    - pci=realloc
```

**Talos Linux:**

```yaml
machine:
  install:
    extraKernelArgs:
      - intel_iommu=off
      - pci=realloc
```

### Option 2: Keep IOMMU + Disable ACS (Need SR-IOV + GPU-Direct)

When you need both SR-IOV (for RDMA VFs) **and** GPU-Direct P2P:

```bash
# Kernel parameter to override ACS on all PCIe bridges:
pcie_acs_override=downstream,multifunction

# Full kernel args for SR-IOV + GPU-Direct:
intel_iommu=on iommu=pt pcie_acs_override=downstream,multifunction pci=realloc
```

**OpenShift MachineConfig:**

```yaml
apiVersion: machineconfiguration.openshift.io/v1
kind: MachineConfig
metadata:
  name: 99-gpu-worker-acs-override
  labels:
    machineconfiguration.openshift.io/role: gpu-worker
spec:
  kernelArguments:
    - intel_iommu=on
    - iommu=pt
    - pcie_acs_override=downstream,multifunction
    - pci=realloc
```

**Talos Linux:**

```yaml
machine:
  install:
    extraKernelArgs:
      - intel_iommu=on
      - iommu=pt
      - pcie_acs_override=downstream,multifunction
      - pci=realloc
```

### Option 3: Disable ACS in BIOS Only (Some Vendors)

Some server BIOS expose ACS as a toggle:

```text
BIOS Location (vendor-specific):
────────────────────────────────────────────────────────────────
Dell:
  System BIOS → Integrated Devices → PCIe ACS: Disabled

HPE:
  System Configuration → BIOS → PCIe → ACS Control: Disabled

Supermicro:
  Advanced → PCIe/PCI/PnP → Access Control Services: Disabled

Lenovo:
  UEFI → Devices and I/O → PCIe ACS: Disabled

Note: Not all BIOS versions expose this. If not available,
use kernel parameter override instead.
```

### Verify ACS Status

```bash
# Check if ACS is active on PCIe bridges
for bridge in $(lspci -d ::0604 | awk '{print $1}'); do
  acs=$(setpci -s "$bridge" ECAP_ACS+6.w 2>/dev/null)
  if [ -n "$acs" ] && [ "$acs" != "0000" ]; then
    echo "⚠️  ACS ACTIVE on bridge $bridge: control=$acs"
    lspci -s "$bridge"
  fi
done

# If no output → ACS disabled/overridden ✅
# If bridges listed → ACS still blocking P2P ❌
```

### Verify GPU-Direct P2P Works

```bash
# Check P2P connectivity matrix
nvidia-smi topo -m

# Expected output (P2P enabled):
#         GPU0  GPU1  GPU2  GPU3  mlx5_0
# GPU0     X    NV12  NV12  NV12  SYS
# GPU1    NV12   X    NV12  NV12  SYS
# GPU2    NV12  NV12   X    NV12  NODE
# GPU3    NV12  NV12  NV12   X    NODE

# Legend:
# NV12 = NVLink (best)
# PIX  = PCIe switch (good, means P2P works)
# NODE = Same NUMA node via PCIe (good)
# SYS  = Cross-NUMA (works but slower)
# X    = Same device

# If you see "Connection not supported" → ACS is blocking

# Test P2P bandwidth directly
/usr/local/cuda/samples/bin/p2pBandwidthLatencyTest
# or
cuda-samples p2pBandwidthLatencyTest

# Expected: P2P bandwidth ~25 GB/s per direction (PCIe 4.0 x16)
# If P2P disabled: shows 0 or "P2P not supported"
```

### NCCL Transport Verification After ACS Disable

```bash
export NCCL_DEBUG=INFO
export NCCL_P2P_LEVEL=NVL    # Use NVLink for intra-node
export NCCL_NET_GDR_LEVEL=5  # GPU-Direct RDMA for inter-node
export NCCL_IB_HCA=mlx5

# Run all_reduce benchmark
all_reduce_perf -b 8 -e 1G -f 2 -g 8

# Look for:
# "P2P/CUMEM" or "P2P/IPC" in channel info → P2P active ✅
# "SHM" → Shared memory (fallback, slower) ⚠️
# "NET/Socket" → TCP (worst case, ACS or RDMA broken) ❌
```

### Comparison: Performance Impact

```text
Configuration                              All-Reduce BW    Impact
──────────────────────────────────────────────────────────────────
IOMMU off + no ACS                         ~380 Gb/s        Baseline (best)
IOMMU pt + ACS override                    ~370 Gb/s        -3% (negligible)
IOMMU pt + ACS enabled                     ~180 Gb/s        -53% (P2P blocked)
IOMMU strict + ACS enabled                 ~120 Gb/s        -68% (worst)

(8× A100/H100 + 4× ConnectX-7, all-reduce across 2 nodes)
```

### Quick Decision Flowchart

```text
Do you run VMs or need device isolation?
├── YES → Keep IOMMU on
│         Do you need SR-IOV?
│         ├── YES → iommu=pt + pcie_acs_override=downstream,multifunction
│         └── NO  → iommu=pt (ACS won't matter without VFs)
│
└── NO (bare-metal GPU training only)
          → DISABLE VT-d/AMD-Vi in BIOS
            Simplest. Best performance. No ACS issues.
            (You lose: SR-IOV VFs, VM device passthrough)
```

## Common Issues

### "P2P not supported" in nvidia-smi topo after ACS override
- **Cause**: Kernel compiled without ACS override support (some distros strip it)
- **Fix**: Check `grep ACS /boot/config-$(uname -r)`; use BIOS disable instead

### SR-IOV fails after disabling IOMMU
- **Cause**: SR-IOV VFs require IOMMU for address translation
- **Fix**: Can't use SR-IOV without IOMMU; use Option 2 (IOMMU + ACS override)

### ACS override in kernel but `setpci` still shows active
- **Cause**: `pcie_acs_override` doesn't change hardware register — it tells kernel to ignore ACS
- **Fix**: This is expected; IOMMU grouping changes even if setpci shows ACS bits

### Node won't boot after removing IOMMU
- **Cause**: Some hyperconverged setups depend on IOMMU for storage
- **Fix**: Only disable IOMMU on dedicated GPU compute nodes, not infra nodes

## Best Practices

1. **Bare-metal AI clusters: just disable VT-d** — simplest, fastest, no ACS issues
2. **Mixed clusters: per-MachineConfigPool** — gpu-worker pool has different kernel args
3. **Document the decision** — why IOMMU is off (team will forget in 6 months)
4. **Test after every BIOS update** — updates can reset VT-d to Enabled
5. **Verify with `nvidia-smi topo -m`** — the ground truth for P2P connectivity
6. **One config per node role** — don't apply GPU kernel args to infra nodes
7. **Cold reboot after BIOS changes** — PCIe topology enumerated at POST only

## Key Takeaways

- **Simplest fix**: Disable VT-d/AMD-Vi in BIOS entirely (if no VMs, no SR-IOV needed)
- If SR-IOV required: keep IOMMU on + `iommu=pt` + `pcie_acs_override=downstream,multifunction`
- ACS blocks GPU-to-GPU and GPU-to-NIC peer-to-peer DMA (53%+ bandwidth loss)
- `pcie_acs_override` tells kernel to ignore ACS on bridges (hardware unchanged)
- Some BIOS have explicit ACS toggle (Dell, HPE, Supermicro) — disable there
- Verify with: `nvidia-smi topo -m` (P2P matrix) + `NCCL_DEBUG=INFO` (transport selection)
- Performance: IOMMU off ≈ IOMMU pt + ACS override >> ACS enabled (-53%)
- Decision: bare-metal single-tenant → disable VT-d; multi-tenant/SR-IOV → keep + override
