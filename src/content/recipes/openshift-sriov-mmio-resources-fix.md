---
title: "Fix SR-IOV 'Not Enough MMIO Resources' Error"
description: "Resolve the mlx5_core 'not enough MMIO resources for SR-IOV' error on OpenShift nodes with Mellanox ConnectX NICs. Covers BIOS settings, PCIe BAR"
tags:
  - "sriov"
  - "mmio"
  - "mellanox"
  - "bios"
  - "openshift"
category: "networking"
publishDate: "2026-05-08"
author: "Luca Berton"
difficulty: "advanced"
relatedRecipes:
  - "openshift-sriov-rdma-infiniband-device-plugin"
  - "openshift-machineconfig-mcp-guide"
  - "nvidia-gpu-operator-setup"
---

> 💡 **Quick Answer:** The kernel error `not enough MMIO resources for SR-IOV` (`pci_enable_sriov failed: -12 / ENOMEM`) means the node's BIOS doesn't allocate enough PCIe MMIO/BAR address space for Virtual Functions. Fix by enabling "Above 4G Decoding" and increasing MMIO allocation in BIOS, then cold reboot.

## The Problem

When the SR-IOV Network Operator tries to create VFs on a Mellanox ConnectX NIC, the kernel logs show:

```text
mlx5_core 0000:06:00.0: not enough MMIO resources for SR-IOV
mlx5_core 0000:06:00.0: mlx5_sriov_enable:224:(pid 620392): pci_enable_sriov failed : -12
mlx5_core 0000:06:00.0: E-Switch: Unload vfs: mode(LEGACY), nvfs(16), necvfs(0), active vports(17)
mlx5_core 0000:06:00.0: E-Switch: Disable: mode(LEGACY), nvfs(16), necvfs(0), active vports(1)
```

The error code `-12` is `ENOMEM` — the kernel cannot map enough PCI BAR (Base Address Register) space for the requested Virtual Functions. This is a **BIOS/firmware issue**, not an OpenShift or driver problem.

### Why One Node Works and Another Doesn't

```text
Node 1 (working):   BIOS allocates sufficient MMIO space → VFs created ✅
Node 2 (failing):   BIOS MMIO allocation too small → ENOMEM on pci_enable_sriov ❌

Same hardware model, same NICs, same OpenShift config — different BIOS settings.
This happens with inconsistent BIOS profiles across identical servers.
```

## The Solution

### Step 1: Stop the SR-IOV Retry Loop

Before touching BIOS, prevent the operator from repeatedly trying (and failing) to create VFs:

```bash
# Option A: Set numVfs to 0 for the failing node
# Edit the SriovNetworkNodePolicy to exclude the failing node temporarily
oc edit sriovnetworknodepolicy mellanox-rdma-policy \
  -n openshift-sriov-network-operator

# Or create a node-specific policy override:
cat <<YAML | oc apply -f -
apiVersion: sriovnetwork.openshift.io/v1
kind: SriovNetworkNodePolicy
metadata:
  name: disable-sriov-node2
  namespace: openshift-sriov-network-operator
spec:
  nodeSelector:
    kubernetes.io/hostname: "gpu-worker-02"
  numVfs: 0
  priority: 1    # Higher priority (lower number) overrides
  resourceName: mellanoxnics
  vendor: "15b3"
YAML

# Option B: Cordon the node
oc adm cordon gpu-worker-02
```

### Step 2: Fix BIOS Settings

Access the node's BIOS/UEFI (via BMC/iLO/iDRAC/IPMI) and verify these settings:

```text
Required BIOS Settings:
────────────────────────────────────────────────────────────────
Setting                          Required Value    Notes
────────────────────────────────────────────────────────────────
SR-IOV                          Enabled           Global SR-IOV toggle
Above 4G Decoding               Enabled           CRITICAL — maps BARs above 4GB
PCIe ARI Support                Enabled / Auto    Alternative Routing-ID
IOMMU / VT-d / AMD-Vi           Enabled           Required for device passthrough
MMIO High Base                  Auto / Large      Some BIOS have explicit MMIO size
MMIO Allocation                 Large             Vendor-specific label
Memory Mapped I/O above 4GB     Enabled           Same as Above 4G Decoding
SR-IOV Global Enable            Enabled           Some BIOS separate global/per-slot
```

```text
Common BIOS Locations by Vendor:
────────────────────────────────────────────────────────────────
Dell (iDRAC):
  System BIOS → Integrated Devices → SR-IOV Global Enable
  System BIOS → Memory Settings → Memory Mapped I/O above 4GB

HPE (iLO):
  System Configuration → BIOS/Platform → PCIe Settings
  → SR-IOV, Above 4G Decoding, MMIO High Base

Lenovo (XClarity):
  UEFI Setup → System Settings → Devices and I/O Ports
  → PCIe SR-IOV Support, Above 4G Decoding

Supermicro:
  Advanced → PCIe/PCI/PnP Configuration
  → Above 4G Decoding, SR-IOV Support
```

### Step 3: Cold Reboot

```bash
# IMPORTANT: Cold reboot (full power cycle), not warm reboot
# PCIe BAR allocation happens at POST — warm reboot may not re-enumerate

# Via BMC/IPMI if available:
ipmitool -I lanplus -H bmc-gpu-worker-02.example.com \
  -U admin -P <password> chassis power cycle

# Or from OpenShift (warm reboot — less reliable for PCIe changes):
oc debug node/gpu-worker-02 -- chroot /host systemctl reboot
```

### Step 4: Test VF Creation Manually

```bash
# After BIOS fix + cold reboot, test before re-enabling SR-IOV policy
oc debug node/gpu-worker-02
chroot /host

# Find the PF network device name
ls /sys/class/net/ | grep -E "ens|eno|enp"

# Try creating 1 VF first
echo 1 > /sys/class/net/ens1f0np0/device/sriov_numvfs
cat /sys/class/net/ens1f0np0/device/sriov_numvfs
# Should return: 1

# Check dmesg for errors
dmesg | tail -20 | grep -i "mmio\|sriov\|mlx5"
# Should NOT show "not enough MMIO resources"

# Clean up test VF
echo 0 > /sys/class/net/ens1f0np0/device/sriov_numvfs
```

### Step 5: Gradual VF Enablement

```bash
# Don't jump straight to 16 VFs — scale up gradually:

# Phase 1: 1 PF × 1 VF
echo 1 > /sys/class/net/ens1f0np0/device/sriov_numvfs
dmesg | tail -5
# ✅ Success? Continue.

# Phase 2: 1 PF × 4 VFs
echo 0 > /sys/class/net/ens1f0np0/device/sriov_numvfs
echo 4 > /sys/class/net/ens1f0np0/device/sriov_numvfs
dmesg | tail -5
# ✅ Success? Continue.

# Phase 3: 1 PF × 16 VFs (full target)
echo 0 > /sys/class/net/ens1f0np0/device/sriov_numvfs
echo 16 > /sys/class/net/ens1f0np0/device/sriov_numvfs
dmesg | tail -5
# ✅ Success? Now test all PFs.

# Phase 4: All PFs × target VFs
# Repeat for each PF (ens1f1np1, ens2f0np0, etc.)

# Clean up — let the SR-IOV operator manage from here
echo 0 > /sys/class/net/ens1f0np0/device/sriov_numvfs
exit  # exit chroot
exit  # exit debug pod
```

### Step 6: Re-Enable SR-IOV Policy

```bash
# Remove the override policy
oc delete sriovnetworknodepolicy disable-sriov-node2 \
  -n openshift-sriov-network-operator

# Or uncordon the node
oc adm uncordon gpu-worker-02

# Watch the SR-IOV operator apply the policy
oc get sriovnetworknodestate gpu-worker-02 \
  -n openshift-sriov-network-operator -w

# Wait for sync to complete
# syncStatus: Succeeded

# Verify resources are registered
oc describe node gpu-worker-02 | grep -A5 -B2 mellanox
# Expected:
#   openshift.io/mellanoxnics: 16
```

### Diagnostic Commands

```bash
# Check current MMIO allocation on a node
oc debug node/gpu-worker-02 -- chroot /host \
  lspci -vvv -s 06:00.0 2>/dev/null | grep -i "memory\|region\|bar"

# Compare BAR sizes between working and failing nodes
# Working node:
oc debug node/gpu-worker-01 -- chroot /host \
  lspci -vvv -s 06:00.0 | grep "Region"

# Failing node:
oc debug node/gpu-worker-02 -- chroot /host \
  lspci -vvv -s 06:00.0 | grep "Region"

# Check total VFs supported by hardware
oc debug node/gpu-worker-02 -- chroot /host \
  cat /sys/class/net/ens1f0np0/device/sriov_totalvfs
# Usually: 127 (hardware supports it, MMIO is the bottleneck)

# Check kernel messages for MMIO errors
oc debug node/gpu-worker-02 -- chroot /host \
  dmesg | grep -i "mmio\|bar\|sriov\|mlx5" | tail -30

# Check iommu groups
oc debug node/gpu-worker-02 -- chroot /host \
  find /sys/kernel/iommu_groups/ -type l | head -20
```

## Common Issues

### BIOS changed but VFs still fail
- **Cause**: Warm reboot doesn't re-enumerate PCIe; BAR allocation unchanged
- **Fix**: Full cold reboot (power off → power on); verify via BMC

### VFs work for 1 PF but fail on second PF
- **Cause**: Total MMIO space shared across all PCIe devices; not enough for multiple PFs
- **Fix**: Reduce numVfs per PF, or increase MMIO High allocation further in BIOS

### SR-IOV works after manual echo but operator fails
- **Cause**: Operator applies to all PFs simultaneously; manual test was 1 PF
- **Fix**: Reduce numVfs in policy; apply per-PF policies with lower VF counts

### Different BIOS versions across identical servers
- **Cause**: Fleet not uniformly provisioned; BIOS defaults differ by version
- **Fix**: Standardize BIOS settings via BMC redfish API or vendor management tool

### Error returns after BIOS update
- **Cause**: BIOS update reset settings to defaults
- **Fix**: Re-apply SR-IOV BIOS settings; document in runbook for future updates

## Best Practices

1. **Standardize BIOS across fleet** — identical settings on all GPU/RDMA nodes
2. **Always cold reboot** after BIOS PCIe changes — warm reboot is insufficient
3. **Test VFs manually first** — `echo 1 > sriov_numvfs` before operator
4. **Scale VFs gradually** — 1 → 4 → 16 to find the MMIO ceiling
5. **Document BIOS profile** — save BMC configuration for fleet reprovisioning
6. **Compare working vs failing** — `lspci -vvv` Region output reveals BAR differences
7. **Monitor dmesg** after SR-IOV policy changes — catch MMIO errors early

## Key Takeaways

- `not enough MMIO resources for SR-IOV` = BIOS doesn't allocate enough PCIe BAR space
- Error code `-12` (ENOMEM) on `pci_enable_sriov` confirms memory-mapped I/O shortage
- Fix: Enable "Above 4G Decoding" + increase MMIO allocation in BIOS
- Cold reboot required (power cycle, not warm reboot) for PCIe re-enumeration
- One working node + one failing node with same hardware = BIOS config difference
- Test manually (`echo N > sriov_numvfs`) before re-enabling SR-IOV operator
- Gradual VF enablement (1 → 4 → 16) identifies the MMIO ceiling per node
- Fleet consistency: standardize BIOS profiles across all GPU/RDMA nodes
