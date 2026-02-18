---
title: "Fix NVIDIA Peer Memory Driver Not Detected"
description: "Diagnose and resolve the 'NVIDIA peer memory driver not detected' error when running GPU workloads with RDMA on Kubernetes and OpenShift."
category: "troubleshooting"
difficulty: "advanced"
timeToComplete: "30 minutes"
kubernetesVersion: "1.28+"
prerequisites:
  - "NVIDIA GPU Operator installed"
  - "Mellanox ConnectX NIC present"
  - "MLNX_OFED or DOCA-OFED drivers installed"
relatedRecipes:
  - "switch-gpudirect-rdma-dma-buf"
  - "configure-clusterpolicy-kernel-module-type"
  - "enable-gpudirect-storage-openshift"
tags:
  - nvidia
  - gpu
  - rdma
  - peermem
  - troubleshooting
  - openshift
publishDate: "2026-02-18"
author: "Luca Berton"
---

> 💡 **Quick Answer:** The `nvidia-peermem` module fails to load when it was compiled against the wrong RDMA stack. Reinstall the NVIDIA driver after MLNX_OFED, or on OpenShift force a driver pod rebuild by deleting the driver DaemonSet.

# Fix NVIDIA Peer Memory Driver Not Detected

GPU workloads using NCCL or MPI may log `NVIDIA peer memory driver not detected` or `GPU Direct RDMA Disabled` when the `nvidia-peermem` kernel module cannot load.

## Symptoms

Common error messages include:

```text
modprobe: ERROR: could not insert 'nvidia_peermem': Invalid argument
dmesg: Unknown symbol ib_register_peer_memory_client
NVIDIA peer memory driver not detected
GPU Direct RDMA Disabled
```

## Root Cause

The `nvidia-peermem` module was compiled without the RDMA peer-memory symbols from MLNX_OFED. This happens when the GPU driver is installed before MOFED, causing an ABI mismatch.

## Diagnose

Check module status and kernel messages:

```bash
sudo modprobe nvidia-peermem
sudo dmesg | tail
lsmod | grep peermem
```

If `dmesg` shows `Unknown symbol ib_register_peer_memory_client`, the RDMA stack and driver are mismatched.

## Fix on Bare Metal Kubernetes

Reinstall the NVIDIA driver after MLNX_OFED:

```bash
# Verify MLNX_OFED is present
ofed_info -s

# Uninstall GPU driver
sudo systemctl stop nvidia-persistenced
sudo apt purge -y nvidia-driver-<version>
sudo reboot

# Reinstall GPU driver (now compiles against MOFED symbols)
sudo apt install nvidia-driver-<version>
sudo reboot

# Verify
sudo modprobe nvidia-peermem
lsmod | grep peermem
```

## Fix on OpenShift

On OpenShift, do not manually install drivers. Force the GPU Operator to rebuild:

```bash
# Delete driver pods to trigger rebuild
oc delete pod -n gpu-operator -l app=nvidia-driver-daemonset

# Verify module loads in driver pod
oc logs -n gpu-operator ds/nvidia-driver-daemonset -c nvidia-peermem-ctr
```

The GPU Operator rebuilds `nvidia-peermem.ko` against the host kernel and MOFED symbols.

## Validate

Run an NCCL test with debug logging:

```bash
NCCL_DEBUG=INFO all_reduce_test
```

Look for `NET/IB: GPU Direct RDMA enabled` in the output.

## Why This Matters

Without `nvidia-peermem`, GPU Direct RDMA is disabled and all GPU-to-GPU communication over the network falls back to CPU-staged copies, severely degrading multi-node training performance.
