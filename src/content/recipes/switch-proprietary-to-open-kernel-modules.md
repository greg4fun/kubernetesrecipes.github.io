---
title: "Switch to Open NVIDIA Kernel Modules on Ope..."
description: "Step-by-step guide to migrate the NVIDIA GPU Operator from proprietary to open kernel modules on OpenShift, enabling DMA-BUF and GPUDirect Storage support."
category: "configuration"
difficulty: "advanced"
timeToComplete: "60 minutes"
kubernetesVersion: "1.28+"
prerequisites:
  - "NVIDIA GPU Operator v25.3.0+ installed"
  - "OpenShift 4.10+ cluster"
  - "Turing architecture or newer GPU"
  - "Maintenance window for node reboots"
relatedRecipes:
  - "kubernetes-image-pull-policy-always-never"
  - "kubernetes-finalizers-explained"
  - "kubernetes-crossplane-infrastructure"
  - "kubernetes-configmap"
  - "kubernetes-configmap-from-file"
  - "selinux-scc-gpu-operator-openshift"
  - "configure-clusterpolicy-kernel-module-type"
  - "enable-gpudirect-storage-openshift"
  - "switch-gpudirect-rdma-dma-buf"
tags:
  - nvidia
  - gpu-operator
  - kernel-modules
  - open-kernel
  - openshift
  - migration
publishDate: "2026-02-18"
author: "Luca Berton"
---

> 💡 **Quick Answer:** Set `driver.kernelModuleType: open` in the ClusterPolicy, reboot GPU worker nodes to clear proprietary modules from kernel memory, then let the GPU Operator rebuild driver pods with open kernel modules.


The NVIDIA Open Kernel Module is required for DMA-BUF GPUDirect RDMA and GPUDirect Storage. This recipe walks through the migration from proprietary to open modules with minimal disruption.

## Before You Start

Verify your GPUs support open kernel modules (Turing architecture or newer):

```bash
nvidia-smi --query-gpu=gpu_name,compute_cap --format=csv
```

Compute capability 7.5+ (Turing) is required.

## Step 1 — Check Current Module Type

```bash
# Check what the Operator is currently using
oc get clusterpolicy gpu-cluster-policy -o jsonpath='{.spec.driver.kernelModuleType}'

# Check what modules are loaded on a node
oc debug node/<gpu-node>
chroot /host
modinfo nvidia | grep -E "license|filename"
```

Proprietary modules show `license: NVIDIA`. Open modules show `license: Dual MIT/GPL`.

## Step 2 — Update the ClusterPolicy

```bash
oc edit clusterpolicy gpu-cluster-policy
```

```yaml
spec:
  driver:
    kernelModuleType: open
```

At this point the driver pods will attempt to restart, but proprietary modules may still be loaded in kernel memory on the host.

## Step 3 — Cordon and Drain GPU Nodes

Process one node at a time to maintain cluster availability:

```bash
# Cordon the node to prevent scheduling
oc adm cordon <gpu-node>

# Drain workloads
oc adm drain <gpu-node> --ignore-daemonsets --delete-emptydir-data
```

## Step 4 — Reboot the Node

Reboot clears all in-memory kernel modules:

```bash
oc debug node/<gpu-node>
chroot /host
systemctl reboot
```

## Step 5 — Verify Open Modules After Reboot

```bash
oc debug node/<gpu-node>
chroot /host

# Verify open kernel module loaded
modinfo nvidia | grep license
# Expected: license: Dual MIT/GPL

# Verify all NVIDIA modules are on disk
find /lib/modules/$(uname -r) -name "nvidia*.ko" | head -10

# modinfo should work for all modules
modinfo nvidia_fs
modinfo nvidia_uvm
```

## Step 6 — Uncordon the Node

```bash
oc adm uncordon <gpu-node>
```

## Step 7 — Repeat for All GPU Nodes

Repeat Steps 3–6 for each GPU worker node in the cluster.

## Step 8 — Verify Cluster-Wide Status

```bash
# All driver pods should be Running
oc get pods -n gpu-operator -l app=nvidia-driver-daemonset

# Check driver container logs for open module confirmation
oc logs -n gpu-operator ds/nvidia-driver-daemonset -c nvidia-driver-ctr | grep kernel_module_type
# Expected: kernel_module_type=open
```

## Rollback

If you need to revert:

```bash
oc edit clusterpolicy gpu-cluster-policy
```

```yaml
spec:
  driver:
    kernelModuleType: proprietary
```

Reboot nodes and restart driver pods. Note that DMA-BUF and GDS will no longer be available.

## Why This Matters

Open kernel modules provide full on-disk module management, enable DMA-BUF and GPUDirect Storage, and align with NVIDIA's recommended configuration for modern GPU Operator deployments.
