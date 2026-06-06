---
title: "VT-x vs VT-d vs SR-IOV Explained"
description: "Understand the difference between CPU virtualization (VT-x/SVM), I/O virtualization (VT-d/AMD-Vi/IOMMU), and SR-IOV. Which to enable or disable for GPU"
tags:
  - "virtualization"
  - "iommu"
  - "sriov"
  - "bios"
  - "gpu-direct"
category: "networking"
publishDate: "2026-05-08"
author: "Luca Berton"
difficulty: "intermediate"
relatedRecipes:
  - "disable-acs-pcie-gpu-direct-p2p"
  - "iommu-bios-kernel-nccl-gpu-direct"
  - "openshift-sriov-rdma-infiniband-device-plugin"
  - "openshift-sriov-mmio-resources-fix"
---

> 💡 **Quick Answer:** VT-x (CPU virtualization) and VT-d (I/O virtualization/IOMMU) are completely different technologies. You can disable VT-d (IOMMU) to fix GPU-Direct P2P issues without affecting containers — containers only need VT-x. SR-IOV specifically requires VT-d enabled.

## The Problem

Three BIOS settings are often confused:

- **VT-x** — "do I need this for containers?"
- **VT-d** — "can I disable this for GPU performance?"
- **SR-IOV** — "why does this need VT-d?"

Disabling the wrong one breaks your cluster. Disabling the right one gives you GPU-Direct P2P at full speed.

## The Solution

### The Three Virtualization Technologies

```text
Technology    Full Name                  Layer     What It Does
──────────────────────────────────────────────────────────────────────────
VT-x / SVM   CPU Virtualization         CPU       Hardware-assisted VM execution
              (Intel VT-x / AMD-V SVM)             Containers use this via namespaces
                                                    NEVER disable on K8s nodes

VT-d / AMD-Vi I/O Virtualization        PCIe/DMA  IOMMU — translates DMA addresses
              (Intel VT-d / AMD-Vi)                Isolates device DMA per VM/container
                                                    SAFE to disable if no SR-IOV/VMs

SR-IOV        Single Root I/O Virt.     NIC/PCIe  Splits 1 physical NIC into N VFs
                                                    Each VF appears as separate device
                                                    REQUIRES VT-d enabled
```

### Relationship Diagram

```text
┌─────────────────────────────────────────────────────────────┐
│                         BIOS                                │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐     │
│  │   VT-x/SVM   │  │  VT-d/AMD-Vi │  │   SR-IOV     │     │
│  │  (CPU layer)  │  │ (PCIe/IOMMU) │  │ (NIC layer)  │     │
│  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘     │
│         │                  │                  │             │
│         │                  │    DEPENDS ON ───┘             │
│         │                  │                               │
└─────────┼──────────────────┼───────────────────────────────┘
          │                  │
          ▼                  ▼
   ┌─────────────┐    ┌─────────────┐
   │ Containers  │    │ DMA Isolation│
   │ VMs         │    │ Device Pass- │
   │ KVM/QEMU    │    │ through      │
   │ cgroups     │    │ SR-IOV VFs   │
   └─────────────┘    └─────────────┘

VT-x: Required for containers and VMs (CPU instruction trapping)
VT-d: Required ONLY for DMA isolation / SR-IOV / VM device passthrough
SR-IOV: Requires VT-d (VFs need IOMMU address translation)
```

### What Each Technology Is Used For

```text
VT-x / AMD-V SVM (CPU Virtualization):
────────────────────────────────────────
Used by:
  ✅ Docker / containerd (via Linux namespaces/cgroups)
  ✅ KVM / QEMU virtual machines
  ✅ Kata Containers (microVMs)
  ✅ Kubernetes (all Pod execution)
  
Disable? NEVER on a K8s/OpenShift node
Impact if disabled: Containers still work (they don't use VT-x directly)
                    but some runtimes (Kata) and all VMs will break

─────────────────────────────────────────────────────────────────
VT-d / AMD-Vi (I/O Virtualization / IOMMU):
────────────────────────────────────────
Used by:
  ✅ SR-IOV Virtual Functions (VF address translation)
  ✅ VM device passthrough (GPU passthrough to VM)
  ✅ VFIO (device assignment)
  ❌ NOT needed for standard containers
  ❌ NOT needed for GPU-Direct P2P (actually hurts it)

Disable? SAFE if you don't use SR-IOV or VM passthrough
Impact if disabled: 
  • GPU-Direct P2P works at full speed ✅
  • Containers work perfectly ✅
  • SR-IOV VFs will NOT work ❌
  • VM device passthrough will NOT work ❌

─────────────────────────────────────────────────────────────────
SR-IOV (Single Root I/O Virtualization):
────────────────────────────────────────
Used by:
  ✅ Network VFs for Pods (high-performance networking)
  ✅ RDMA VFs for GPU-Direct RDMA (inter-node NCCL)
  
Requires: VT-d/AMD-Vi ENABLED
Disable? If you don't need VFs (use host networking instead)
Impact if disabled: No Virtual Functions, Pods get regular veth interfaces
```

### Decision Matrix for GPU Clusters

```text
Scenario                              VT-x    VT-d    SR-IOV   ACS
──────────────────────────────────────────────────────────────────────
Single-node training (no RDMA)        ON      OFF     OFF      N/A
  → Max GPU-Direct P2P, simplest

Multi-node training with host NIC     ON      OFF     OFF      N/A
  → NCCL uses host InfiniBand directly

Multi-node with SR-IOV RDMA VFs       ON      ON+pt   ON       Override
  → VFs for Pods + GPU-Direct RDMA

Mixed (VMs + GPUs on same node)       ON      ON+pt   ON       Override
  → Full virtualization stack

Inference only (no P2P needed)        ON      ON      ON       Don't care
  → Single GPU per Pod, no P2P
```

### BIOS Settings Summary

```text
Bare-metal GPU training (no SR-IOV):
────────────────────────────────────────
VT-x / AMD-V:              ENABLED  (containers need it)
VT-d / AMD-Vi:             DISABLED (removes IOMMU overhead + ACS)
SR-IOV:                    DISABLED (no VFs needed)
Above 4G Decoding:         ENABLED  (large BAR GPUs)
ACS:                       N/A      (no IOMMU = no ACS enforcement)

Kernel args: (none needed, or intel_iommu=off)

────────────────────────────────────────

GPU training with SR-IOV RDMA:
────────────────────────────────────────
VT-x / AMD-V:              ENABLED
VT-d / AMD-Vi:             ENABLED  (SR-IOV requires it)
SR-IOV:                    ENABLED
Above 4G Decoding:         ENABLED
ACS:                       DISABLED in BIOS (or kernel override)

Kernel args: intel_iommu=on iommu=pt pcie_acs_override=downstream,multifunction
```

### Common Misconception

```text
❌ WRONG: "Disable VT-x to improve GPU performance"
   → VT-x is CPU-level. Has ZERO impact on GPU/PCIe performance.
   → Disabling breaks Kata, KVM, and some security features.

❌ WRONG: "Containers need VT-d"
   → Containers use Linux namespaces + cgroups, NOT IOMMU.
   → VT-d is only for DMA address translation (device isolation).

❌ WRONG: "SR-IOV works without IOMMU"
   → VFs need IOMMU to translate their DMA addresses.
   → Without VT-d, pci_enable_sriov will fail.

✅ RIGHT: "Disable VT-d (not VT-x) to fix GPU-Direct P2P"
   → IOMMU off = no DMA translation = direct P2P between GPU↔GPU/NIC
   → Containers still work perfectly (they don't use IOMMU)
   → You lose SR-IOV capability (acceptable if using host networking)
```

### Verify Current State

```bash
# Check VT-x status
grep -E "vmx|svm" /proc/cpuinfo | head -1
# vmx = Intel VT-x enabled
# svm = AMD-V enabled

# Check VT-d / IOMMU status
dmesg | grep -i -E "DMAR|AMD-Vi|IOMMU"
# "DMAR: IOMMU enabled" = VT-d active
# Nothing = VT-d disabled

# Check SR-IOV VFs available
lspci | grep "Virtual Function"
# Lists VFs if SR-IOV enabled + VFs created

# Quick status script
echo "=== Virtualization Status ==="
echo -n "VT-x/SVM: "
grep -qE "vmx|svm" /proc/cpuinfo && echo "ENABLED ✅" || echo "DISABLED ❌"
echo -n "VT-d/IOMMU: "
dmesg 2>/dev/null | grep -qi "IOMMU enabled\|AMD-Vi init" && echo "ENABLED" || echo "DISABLED"
echo -n "SR-IOV VFs: "
lspci 2>/dev/null | grep -c "Virtual Function"
```

## Common Issues

### Disabled VT-d but SR-IOV stopped working
- **Cause**: SR-IOV requires IOMMU for VF DMA translation — this is expected
- **Fix**: Choose one: VT-d on (with ACS override) for SR-IOV, or VT-d off (use host NIC)

### Containers broken after disabling VT-x
- **Cause**: Kata Containers or gVisor require hardware virtualization
- **Fix**: Never disable VT-x; disable VT-d instead for GPU performance

### Confused by BIOS labels
- **Cause**: BIOS vendors use different names for the same thing
- **Fix**: Intel VT-d = Intel Directed I/O = IOMMU = DMAR. AMD-Vi = AMD IOMMU.

## Best Practices

1. **Never disable VT-x** on Kubernetes nodes — containers and security depend on it
2. **VT-d is safe to disable** on dedicated GPU compute nodes (no SR-IOV needed)
3. **If you need SR-IOV VFs**: keep VT-d on + `iommu=pt` + ACS override
4. **Label nodes by capability** — `gpu-direct: true` vs `sriov: true` for scheduling
5. **Document per-node BIOS profile** — "why is VT-d off on these 8 nodes?"
6. **Separate node pools** — SR-IOV nodes (VT-d on) vs bare GPU nodes (VT-d off)

## Key Takeaways

- **VT-x** (CPU) ≠ **VT-d** (I/O/IOMMU) ≠ **SR-IOV** (NIC virtualization)
- Containers need VT-x, NOT VT-d — safe to disable IOMMU for GPU performance
- SR-IOV requires VT-d — you can't have VFs without IOMMU
- Disabling VT-d removes IOMMU overhead AND eliminates ACS blocking
- The simple path for GPU training: VT-d OFF, SR-IOV OFF, use host InfiniBand directly
- If SR-IOV needed: VT-d ON + `iommu=pt` + `pcie_acs_override` (slight overhead)
- Never confuse VT-x with VT-d — disabling VT-x can break your cluster
