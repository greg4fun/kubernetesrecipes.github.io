---
title: "Enable GPUDirect Storage on OpenShift"
description: "Configure GPUDirect Storage (GDS) with the NVIDIA GPU Operator on OpenShift, including the Open Kernel Module requirement and nvidia-fs verification."
category: "storage"
difficulty: "advanced"
timeToComplete: "45 minutes"
kubernetesVersion: "1.28+"
prerequisites:
  - "NVIDIA GPU Operator v23.9.1+ installed"
  - "OpenShift 4.10+ with kernel 5.12+"
  - "NFS server or NVMe/NVMe-oF storage"
  - "Mellanox ConnectX NIC (optional for RDMA)"
relatedRecipes:
  - "nicclusterpolicy-node-selection"
  - "gds-nvme-nfs-rdma"
  - "sriov-vf-troubleshooting"
  - "gpu-operator-clusterpolicy-reference"
  - "sriov-vf-ai-workloads"
  - "gpu-operator-gds-module"
  - "sriov-nicclusterpolicy-vfs"
  - "clusterpolicy-mofed-upgrade"
  - "gpu-operator-mofed-driver"
  - "configure-gpudirect-rdma-gpu-operator"
  - "configure-clusterpolicy-kernel-module-type"
  - "troubleshoot-nvidia-fs-module-conflict"
  - "csi-drivers-storage"
  - "selinux-scc-gpu-operator-openshift"
  - "local-persistent-volumes"
  - "statefulset-mysql"
tags:
  - nvidia
  - gpu
  - gds
  - gpudirect
  - storage
  - openshift
  - gpu-operator
publishDate: "2026-02-18"
author: "Luca Berton"
---

> 💡 **Quick Answer:** GDS requires the Open Kernel Module (`driver.kernelModuleType: open`). Set `gds.enabled: true` in the ClusterPolicy, and the GPU Operator deploys the `nvidia-fs-ctr` container to load the `nvidia-fs` kernel module.


GPUDirect Storage (GDS) enables direct DMA transfers between GPU memory and storage, bypassing CPU bounce buffers. Starting with GPU Operator v23.9.1, GDS requires the NVIDIA Open Kernel Module.

## Prerequisites

| Requirement | Value |
|---|---|
| GPU Operator | v23.9.1+ |
| GDS Driver | v2.17.5+ |
| Kernel Module | Open (`kernelModuleType: open`) |
| Kernel | 5.12+ |

## Step 1 — Configure the ClusterPolicy

```bash
oc edit clusterpolicy gpu-cluster-policy
```

Set the required fields:

```yaml
spec:
  driver:
    kernelModuleType: open    # Required for GDS
  gds:
    enabled: true
```

## Step 2 — Apply and Restart

```bash
# Restart driver pods to pick up the new configuration
oc delete pod -n gpu-operator -l app=nvidia-driver-daemonset
```

The GPU Operator will:
1. Build the Open Kernel Module for your host kernel
2. Deploy the `nvidia-fs-ctr` container inside each driver pod
3. Load the `nvidia_fs` kernel module on each GPU node

## Step 3 — Verify Pod Structure

```bash
kubectl describe pod -n gpu-operator nvidia-driver-daemonset-xxxxx
```

Confirm these containers are present:
- `nvidia-driver-ctr` — main GPU driver
- `nvidia-fs-ctr` — GDS filesystem module

If `driver.rdma.enabled=true` is also set, you will also see `nvidia-peermem-ctr`.

## Step 4 — Verify Kernel Modules

SSH into a GPU worker node:

```bash
oc debug node/<node-name>
chroot /host
lsmod | grep nvidia_fs
modinfo nvidia_fs
```

Both commands should succeed. If `modinfo` fails, see the related recipe on troubleshooting `nvidia-fs` module conflicts.

## Step 5 — Verify All Pods Are Running

```bash
kubectl get pod -n gpu-operator
```

The driver DaemonSet pods should show `3/3 Running` (driver + peermem + fs containers) with no CrashLoopBackOff errors.

## Common Pitfall

If `gds.enabled=true` is set but `driver.kernelModuleType` is `proprietary` or `auto` (resolving to proprietary), the `nvidia-fs-ctr` container will fail with:

```text
insmod: ERROR: could not insert module nvidia-fs.ko: File exists
```

This happens because the proprietary driver stack inserts modules into kernel memory without placing `.ko` files on disk, creating a mismatch with the GDS container. The fix is to explicitly set `kernelModuleType: open`.

## Why This Matters

GDS eliminates CPU bounce buffers for storage I/O, reducing latency and CPU overhead. This is critical for AI/ML pipelines that load large datasets from NFS or NVMe storage directly into GPU memory.
