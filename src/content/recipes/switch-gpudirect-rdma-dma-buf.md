---
title: "Switch GPUDirect RDMA from nvidia-peermem t..."
description: "Migrate from the legacy nvidia-peermem kernel module to the recommended DMA-BUF GPUDirect RDMA path using the NVIDIA GPU Operator."
category: "networking"
difficulty: "advanced"
timeToComplete: "45 minutes"
kubernetesVersion: "1.28+"
prerequisites:
  - "NVIDIA GPU Operator v23+ installed"
  - "Linux kernel 5.12 or higher"
  - "CUDA 11.7+ (provided by the driver)"
  - "Turing architecture or newer GPU"
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
  - "fix-nvidia-peermem-not-detected"
  - "configure-clusterpolicy-kernel-module-type"
  - "validate-gpudirect-rdma-performance"
tags:
  - nvidia
  - gpu
  - rdma
  - dma-buf
  - gpudirect
  - networking
publishDate: "2026-02-18"
author: "Luca Berton"
---

> 💡 **Quick Answer:** Do **not** set `driver.rdma.enabled=true` — that activates the legacy `nvidia-peermem` path. Instead, set `driver.kernelModuleType=open` and leave RDMA disabled to use the recommended DMA-BUF GPUDirect RDMA transport.


NVIDIA recommends DMA-BUF over the legacy `nvidia-peermem` kernel module for GPUDirect RDMA. DMA-BUF avoids a separate kernel module and is more future-proof.

## Prerequisites Comparison

| Requirement | DMA-BUF | Legacy nvidia-peermem |
|---|---|---|
| GPU Driver | Open Kernel Module | Any |
| CUDA | 11.7+ | No minimum |
| GPU | Turing+ data center | All data center |
| MOFED | Optional | Required |
| Linux Kernel | 5.12+ | No minimum |

## Step 1 — Verify Prerequisites

```bash
# Kernel version must be 5.12+
uname -r

# Check GPU architecture
nvidia-smi --query-gpu=gpu_name,compute_cap --format=csv

# Verify current module state
lsmod | grep peermem
```

## Step 2 — Install GPU Operator for DMA-BUF

For new installations, simply omit `driver.rdma.enabled=true`:

```bash
# With Network Operator managing NIC drivers
helm install --wait --generate-name \
  -n gpu-operator --create-namespace \
  nvidia/gpu-operator \
  --version=v25.10.1

# With host-installed MOFED
helm install --wait --generate-name \
  -n gpu-operator --create-namespace \
  nvidia/gpu-operator \
  --version=v25.10.1 \
  --set driver.rdma.useHostMofed=true
```

## Step 3 — Migrate Existing Installation

If you previously had `driver.rdma.enabled=true`, update the ClusterPolicy:

```bash
oc edit clusterpolicy gpu-cluster-policy
```

```yaml
spec:
  driver:
    kernelModuleType: open
    rdma:
      enabled: false    # Disables legacy nvidia-peermem
```

Restart driver pods:

```bash
oc delete pod -n gpu-operator -l app=nvidia-driver-daemonset
```

## Step 4 — Verify DMA-BUF is Active

Confirm `nvidia-peermem-ctr` container is absent:

```bash
kubectl get ds -n gpu-operator nvidia-driver-daemonset -o yaml | grep -i peermem
# Expected: no output
```

Check node annotations:

```bash
oc get nodes -o json | jq '.items[].metadata.annotations["nvidia.com/gpudirect-dmabuf"]'
```

## Step 5 — Validate with NCCL

```bash
NCCL_DEBUG=INFO NCCL_IB_HCA=mlx5_0 NCCL_NET_GDR_LEVEL=5 all_reduce_test
```

Look for `GPUDirect RDMA DMA-BUF enabled` and confirm no `using peer memory driver` fallback.

## Why This Matters

DMA-BUF is the modern, NVIDIA-recommended path that eliminates the `nvidia-peermem` kernel module dependency, reduces kernel version incompatibilities, and provides better long-term support.
