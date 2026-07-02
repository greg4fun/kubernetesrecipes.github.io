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
  - "nvidia-peermem-gpudirect-rdma-k8s"
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

> 💡 **Quick Answer:** The `nvidia-peermem` module fails to load when it was built against the wrong RDMA stack — you'll see `modprobe: ERROR: could not insert 'nvidia_peermem': Invalid argument` and `Unknown symbol ib_register_peer_memory_client` in `dmesg`. Fix it by **(re)installing the NVIDIA driver after MLNX/DOCA-OFED** so it compiles against the RDMA symbols, or on OpenShift by deleting the driver DaemonSet pods to force a rebuild. On modern stacks, prefer migrating to the **DMA-BUF** path, which needs no peer-memory module at all.

## The Problem

GPUDirect RDMA lets your NIC move data **directly in and out of GPU memory** over PCIe, skipping a slow copy through host RAM. The legacy mechanism that enables this is the `nvidia-peermem` kernel module (formerly `nv_peer_mem`). It registers GPU memory with the InfiniBand/RDMA subsystem using symbols exported by the Mellanox OFED stack.

When that module won't load, NCCL and MPI silently fall back to CPU-staged copies and multi-node GPU training slows to a crawl. The give-away messages are:

```text
modprobe: ERROR: could not insert 'nvidia_peermem': Invalid argument
dmesg: nvidia_peermem: Unknown symbol ib_register_peer_memory_client (err -2)
NVIDIA peer memory driver not detected
GPU Direct RDMA Disabled
```

The root issue is almost always an **ordering / ABI mismatch**: the GPU driver was built before the RDMA peer-memory symbols (`ib_register_peer_memory_client` / `ib_unregister_peer_memory_client`) were available, so the module references symbols the running kernel doesn't expose.

## Diagnostic Flow

```mermaid
graph TD
    A[GPU Direct RDMA Disabled] --> B{lsmod shows nvidia_peermem?}
    B -->|Yes, loaded| C[Module OK - check NCCL_NET_GDR_LEVEL + NIC/GPU PCIe affinity]
    B -->|No| D[sudo modprobe nvidia-peermem; dmesg | tail]
    D --> E{Unknown symbol<br/>ib_register_peer_memory_client?}
    E -->|Yes| F[OFED peer-memory symbols missing<br/>=> driver built before OFED]
    F --> G[Reinstall GPU driver AFTER OFED]
    E -->|No, Invalid argument only| H{OFED installed?<br/>ofed_info -s}
    H -->|No| I[Install MLNX/DOCA-OFED, then reinstall driver]
    H -->|Yes| G
    G --> J{Modernizing?}
    J -->|Yes| K[Migrate to DMA-BUF - no module needed]
    style C fill:#bbf7d0
    style K fill:#bbf7d0
    style A fill:#fecaca
```

## Symptoms

Common error messages include:

```text
modprobe: ERROR: could not insert 'nvidia_peermem': Invalid argument
dmesg: Unknown symbol ib_register_peer_memory_client
NVIDIA peer memory driver not detected
GPU Direct RDMA Disabled
```

## Root Causes (in order of likelihood)

| # | Root cause | How to confirm | Fix |
|---|-----------|----------------|-----|
| 1 | GPU driver installed **before** OFED (missing peer-memory symbols) | `dmesg` shows `Unknown symbol ib_register_peer_memory_client` | Reinstall the GPU driver after OFED |
| 2 | OFED not installed at all | `ofed_info -s` fails / not found | Install MLNX-OFED or DOCA-OFED, then reinstall driver |
| 3 | OpenShift driver pod built against stale kernel/OFED | `oc logs` on driver pod shows modprobe error | Delete the driver DaemonSet pods to force rebuild |
| 4 | Kernel upgraded, module not rebuilt | `uname -r` newer than module build | Rebuild driver / restart driver pod |
| 5 | Using a stack where peermem is unsupported | Open kernel module + Linux 5.12+ | Migrate to DMA-BUF (no module required) |

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
NCCL_DEBUG=INFO NCCL_DEBUG_SUBSYS=NET,INIT all_reduce_perf -b 8 -e 1G -f 2 -g 8
```

```text
# ✅ Peer memory / GPUDirect RDMA is working
[0] NCCL INFO NET/IB : Using [0]mlx5_0:1/RoCE ; GDR enabled

# ❌ Still disabled
[0] NCCL INFO NET/IB : GPU Direct RDMA Disabled for HCA 0 'mlx5_0'
```

Also confirm the module is resident and the symbol resolved:

```bash
lsmod | grep nvidia_peermem
dmesg | grep -i peer_memory   # should show "registered", not "Unknown symbol"
```

## Modern Alternative: Skip the Module Entirely

If you are on the **open** GPU kernel module with Linux 5.12+ and Turing-or-newer GPUs, you can avoid `nvidia-peermem` altogether by using the **DMA-BUF** GPUDirect RDMA path. It needs no peer-memory module, makes OFED optional, and ends the per-kernel rebuild cycle that causes this error. See [Switch GPUDirect RDMA from nvidia-peermem to DMA-BUF](/recipes/networking/switch-gpudirect-rdma-dma-buf/).

## Frequently Asked Questions

**What does `modprobe nvidia_peermem invalid argument` mean?**
The module loaded by the kernel references RDMA peer-memory symbols that aren't present, so insertion fails with `Invalid argument`. It means the GPU driver was built before the OFED peer-memory symbols were available — reinstall the driver after OFED, or move to DMA-BUF.

**What is `ib_register_peer_memory_client`?**
It's the OFED-exported symbol `nvidia-peermem` hooks into to register GPU memory with the InfiniBand stack. `Unknown symbol ib_register_peer_memory_client` in `dmesg` is the definitive sign the RDMA stack and GPU driver are out of sync.

**Do I need MLNX-OFED, or is inbox RDMA enough?**
The legacy `nvidia-peermem` path requires the OFED peer-memory symbols (MLNX-OFED or DOCA-OFED). Inbox RDMA drivers generally do **not** export them — which is another reason to prefer DMA-BUF, where OFED is optional.

**Why does it work after I reinstall the driver?**
Reinstalling the GPU driver **after** OFED lets it compile against the peer-memory symbols, resolving the ABI mismatch. Order matters: OFED first, GPU driver second.

**Does a kernel upgrade break this again?**
Yes — any kernel or OFED change can invalidate the built module. Automate a driver rebuild after such upgrades, or migrate to DMA-BUF to remove the dependency.

## Why This Matters

Without `nvidia-peermem` (or DMA-BUF), GPUDirect RDMA is disabled and all GPU-to-GPU communication over the network falls back to CPU-staged copies — cutting effective inter-node bandwidth by an order of magnitude and stalling distributed training and inference at scale.
