---
title: "Diagnose NVIDIA Memory-Only Kernel Modules ..."
description: "Understand why lsmod shows NVIDIA modules loaded but modinfo fails, and how the GPU Operator's proprietary driver container inserts modules without."
category: "troubleshooting"
difficulty: "advanced"
timeToComplete: "15 minutes"
kubernetesVersion: "1.28+"
prerequisites:
  - "NVIDIA GPU Operator installed"
  - "OpenShift with RHCOS worker nodes"
relatedRecipes:
  - "troubleshoot-nvidia-fs-module-conflict"
  - "configure-clusterpolicy-kernel-module-type"
  - "switch-proprietary-to-open-kernel-modules"
tags:
  - nvidia
  - gpu
  - kernel-modules
  - troubleshooting
  - openshift
  - modinfo
publishDate: "2026-02-18"
author: "Luca Berton"
---

> 💡 **Quick Answer:** `lsmod` reads `/proc/modules` (in-memory state) while `modinfo` searches for `.ko` files on disk. Proprietary NVIDIA driver containers use `insmod` to load modules directly into memory without installing `.ko` files under `/lib/modules/`, causing `modinfo` to fail.


A confusing situation arises on OpenShift when `lsmod` shows NVIDIA modules loaded but `modinfo` cannot find them.

## The Symptom

```bash
lsmod | grep nvidia_fs
# nvidia_fs  323584  0

modinfo nvidia_fs
# modinfo: ERROR: Module nvidia_fs not found.
```

The module is loaded and functioning, yet `modinfo` reports it does not exist.

## Why This Happens

Two tools, two data sources:

| Tool | Data Source | What It Shows |
|---|---|---|
| `lsmod` | `/proc/modules` | Kernel memory — what is currently loaded |
| `modinfo` | `/lib/modules/$(uname -r)/` | Disk — where `.ko` files are stored |

The NVIDIA GPU Operator's proprietary driver flow works like this:

1. Extracts the `.run` installer inside the container
2. Runs with `--no-kernel-modules` flag (skips on-disk installation)
3. Uses `insmod` to directly insert `.ko` files from the container filesystem into the host kernel
4. Does **not** copy `.ko` files to `/lib/modules/` on the host

This leaves the kernel with loaded modules that have no backing file on the host disk.

## How to Confirm

```bash
oc debug node/<node-name>
chroot /host

# Check for .ko files on disk
find /lib/modules/$(uname -r) -name "nvidia*.ko" -o -name "nvidia*.ko.xz"

# Compare with loaded modules
lsmod | grep nvidia
```

If `find` returns fewer files than `lsmod` shows modules, those missing ones are memory-only.

## Impact

Memory-only modules cause problems when:

- **GDS** tries to load its own `nvidia_fs.ko` → `insmod: File exists`
- **Module updates** fail because there is nothing to replace on disk
- **Debugging** cannot inspect module metadata or version info
- **depmod** cannot track module dependencies

## Resolution

Switch to the Open Kernel Module, which properly installs `.ko` files on disk:

```bash
oc edit clusterpolicy gpu-cluster-policy
```

```yaml
spec:
  driver:
    kernelModuleType: open
```

After switching, reboot nodes and restart driver pods. Then verify:

```bash
# Both commands should succeed
lsmod | grep nvidia_fs
modinfo nvidia_fs

# .ko file exists on disk
ls -la /lib/modules/$(uname -r)/extra/nvidia*.ko
```

## Why This Matters

Memory-only modules create invisible version mismatches and block GDS initialization. Switching to the open kernel module provides full on-disk module management, proper `modinfo` output, and compatibility with all GPU Operator features.
