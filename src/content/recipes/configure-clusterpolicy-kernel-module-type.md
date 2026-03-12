---
title: "Configure ClusterPolicy kernelModuleType for GPU Operator"
description: "Understand and configure the driver.kernelModuleType field in the NVIDIA GPU Operator ClusterPolicy to choose between auto, open, and proprietary kernel."
category: "configuration"
difficulty: "intermediate"
timeToComplete: "20 minutes"
kubernetesVersion: "1.28+"
prerequisites:
  - "NVIDIA GPU Operator v25.3.0+ installed"
  - "Turing architecture or newer GPU"
relatedRecipes:
  - "tune-nccl-env-rdma-ethernet"
  - "switch-gpudirect-rdma-dma-buf"
  - "enable-gpudirect-storage-openshift"
  - "switch-proprietary-to-open-kernel-modules"
  - "api-versions-deprecations"
  - "selinux-scc-gpu-operator-openshift"
  - "scheduler-configuration-tuning"
  - "environment-variables-configmaps"
  - "kubernetes-api-aggregation"
  - "kubernetes-cluster-upgrade"
tags:
  - nvidia
  - gpu-operator
  - clusterpolicy
  - kernel-modules
  - configuration
  - openshift
publishDate: "2026-02-18"
author: "Luca Berton"
---

> 💡 **Quick Answer:** Set `driver.kernelModuleType: open` to enable DMA-BUF and GPUDirect Storage. The `auto` default selects the recommended type based on driver branch and GPU model, but `open` guarantees compatibility with modern features.


The `driver.kernelModuleType` field in the ClusterPolicy controls which NVIDIA kernel module variant the GPU Operator builds and loads on each node.

## Available Options

| Value | Behavior |
|---|---|
| `auto` | GPU Operator chooses based on driver branch and GPU devices (default since v25.3.0) |
| `open` | Forces the Open GPU Kernel Module (required for DMA-BUF and GDS) |
| `proprietary` | Forces the proprietary kernel module (legacy) |

## When to Use Each Option

- **`auto`** — Safe default for most clusters. Newer driver versions automatically select `open`.
- **`open`** — Required when you need DMA-BUF GPUDirect RDMA, GPUDirect Storage (GDS v2.17.5+), or want to ensure forward compatibility.
- **`proprietary`** — Only needed for legacy GPU architectures that do not support open modules.

## Check Current Setting

```bash
oc get clusterpolicy gpu-cluster-policy -o jsonpath='{.spec.driver.kernelModuleType}'
```

## Change the Setting

```bash
oc edit clusterpolicy gpu-cluster-policy
```

```yaml
spec:
  driver:
    kernelModuleType: open
```

Restart driver pods to apply:

```bash
oc delete pod -n gpu-operator -l app=nvidia-driver-daemonset
```

## Verify the Active Module Type

Check the driver container logs for the resolution:

```bash
oc logs -n gpu-operator ds/nvidia-driver-daemonset -c nvidia-driver-ctr | grep -i kernel
```

With `auto`, look for the line:

```text
nvidia-installer --print-recommended-kernel-module-type
kernel_module_type=open
```

This confirms the Operator resolved `auto` → `open` for your hardware.

## Verify on the Host

```bash
oc debug node/<node-name>
chroot /host
modinfo nvidia | grep license
```

Open kernel modules show `Dual MIT/GPL` licensing. Proprietary modules show `NVIDIA` only.

## Feature Dependency Matrix

| Feature | Requires `open` |
|---|---|
| DMA-BUF GPUDirect RDMA | Yes |
| GPUDirect Storage (GDS v2.17.5+) | Yes |
| Legacy nvidia-peermem RDMA | No |
| Standard GPU compute | No |

## Why This Matters

Choosing the correct kernel module type determines which GPU features are available. Setting `open` unlocks DMA-BUF and GDS while maintaining full compute compatibility on Turing+ GPUs.
