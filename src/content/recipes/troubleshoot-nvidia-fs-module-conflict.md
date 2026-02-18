---
title: "Troubleshoot nvidia-fs Module Conflict on OpenShift"
description: "Diagnose and fix the 'insmod: ERROR: could not insert module nvidia-fs.ko: File exists' error when enabling GPUDirect Storage with the NVIDIA GPU Operator."
category: "troubleshooting"
difficulty: "advanced"
timeToComplete: "30 minutes"
kubernetesVersion: "1.28+"
prerequisites:
  - "NVIDIA GPU Operator with GDS enabled"
  - "OpenShift 4.10+ cluster"
  - "GPU worker nodes with NVIDIA GPUs"
relatedRecipes:
  - "enable-gpudirect-storage-openshift"
  - "configure-clusterpolicy-kernel-module-type"
  - "diagnose-nvidia-memory-only-modules"
tags:
  - nvidia
  - gpu
  - gds
  - nvidia-fs
  - troubleshooting
  - openshift
publishDate: "2026-02-18"
author: "Luca Berton"
---

> 💡 **Quick Answer:** The `insmod: File exists` error for `nvidia-fs.ko` occurs when the host has the module loaded from a previous or proprietary driver installation but the `.ko` file is missing on disk. Switch to `kernelModuleType: open` and reboot the node to clear stale modules.

# Troubleshoot nvidia-fs Module Conflict on OpenShift

When GDS is enabled in the ClusterPolicy, the `nvidia-fs-ctr` container may enter CrashLoopBackOff with the error:

```text
Loading nvidia-fs...
insmod nvidia-fs.ko
insmod: ERROR: could not insert module nvidia-fs.ko: File exists
```

## Root Cause

The host kernel already has `nvidia_fs` loaded in memory, but the module was inserted by the proprietary driver container without placing a matching `.ko` file on disk. When the GDS container tries to load its own copy, the kernel rejects it because a module with that name already exists.

## Diagnose the Problem

SSH into the affected node:

```bash
oc debug node/<node-name>
chroot /host
```

Check module state:

```bash
# Module is loaded in memory
lsmod | grep nvidia_fs
# Output: nvidia_fs  323584  0

# But no .ko file exists on disk
modinfo nvidia_fs
# Output: modinfo: ERROR: Module nvidia_fs not found.

# Confirm the file is missing
find /lib/modules/$(uname -r) -name "nvidia*fs*"
# Output: empty
```

If `lsmod` shows the module but `modinfo` fails, you have memory-only modules from the proprietary driver stack.

## Fix — Switch to Open Kernel Module

GDS v2.17.5+ requires the Open Kernel Module. Update your ClusterPolicy:

```bash
oc edit clusterpolicy gpu-cluster-policy
```

```yaml
spec:
  driver:
    kernelModuleType: open    # Required for GDS
  gds:
    enabled: true
```

## Clear Stale Modules

Reboot each GPU worker node to unload the proprietary modules:

```bash
oc debug node/<node-name>
chroot /host
systemctl reboot
```

After reboot, restart the driver pods:

```bash
oc delete pod -n gpu-operator -l app=nvidia-driver-daemonset
```

## Verify the Fix

```bash
oc debug node/<node-name>
chroot /host

# Module loaded and file exists
lsmod | grep nvidia_fs
modinfo nvidia_fs

# Verify .ko file is on disk
find /lib/modules/$(uname -r) -name "nvidia*fs*"
```

Both `lsmod` and `modinfo` should succeed, and the `.ko` file should exist under `/lib/modules/`.

## Why This Matters

The `File exists` error prevents GDS from initializing, blocking direct GPU-to-storage DMA transfers. Switching to the open kernel module ensures the driver container properly manages all module files on disk.
