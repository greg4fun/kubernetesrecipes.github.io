---
title: "Tune NCCL Env Variables for RDMA & Ethernet"
description: "Apply safe NCCL environment variable profiles for RDMA-capable and Ethernet-only GPU clusters to maximize collective communication throughput."
category: "configuration"
difficulty: "advanced"
timeToComplete: "20 minutes"
kubernetesVersion: "1.28+"
prerequisites:
  - "NCCL workloads running in Kubernetes"
  - "Knowledge of network interfaces used by pods"
relatedRecipes:
  - "kubernetes-change-management-enterprise"
  - "kubernetes-api-priority-fairness"
  - "kubernetes-affinity-anti-affinity"
  - "kubecon-eu-2026-book-giveaway-success"
  - "install-kubernetes-fedora-kubeadm"
  - "databases-kubernetes-memory-overcommit"
  - "run-nccl-tests-kubernetes"
  - "debug-nccl-timeouts-kubernetes"
  - "nccl-allreduce-benchmark-profile"
tags:
  - nccl
  - rdma
  - ethernet
  - tuning
  - configuration
publishDate: "2026-02-17"
author: "Luca Berton"
---

> 💡 **Quick Answer:** Start with `NCCL_DEBUG=INFO`, set `NCCL_SOCKET_IFNAME` to the correct data interface, and enable or disable InfiniBand explicitly using `NCCL_IB_DISABLE`.


Use explicit NCCL environment configuration to reduce transport ambiguity and improve repeatability.

## RDMA-Oriented Profile

```bash
NCCL_DEBUG=INFO
NCCL_IB_DISABLE=0
NCCL_SOCKET_IFNAME=eth0
```

## Ethernet-Only Profile

```bash
NCCL_DEBUG=INFO
NCCL_IB_DISABLE=1
NCCL_SOCKET_IFNAME=eth0
```

## Validation Loop

1. Apply one profile.
2. Run `all_reduce_perf` and keep logs.
3. Compare bandwidth and error rates.

## Best Practices

- Change one variable at a time when troubleshooting.
- Keep per-cluster baseline profiles under version control.
- Re-test after CNI, firmware, or driver upgrades.

## NCCL Environment Tuning for RDMA and Ethernet

Configure NCCL environment variables to optimize GPU communication over RDMA (InfiniBand/RoCE) and Ethernet networks.

### RDMA Configuration

```yaml
apiVersion: v1
kind: Pod
metadata:
  name: nccl-rdma-training
spec:
  containers:
  - name: training
    image: nvcr.io/nvidia/pytorch:25.11-py3
    env:
    # Force RDMA transport (disable TCP fallback)
    - name: NCCL_IB_DISABLE
      value: "0"
    # Select IB interface
    - name: NCCL_IB_HCA
      value: "mlx5_0,mlx5_1"
    # Enable GPUDirect RDMA
    - name: NCCL_NET_GDR_LEVEL
      value: "SYS"
    # Tune buffer sizes for large messages
    - name: NCCL_BUFFSIZE
      value: "8388608"
    # Use adaptive routing if switch supports it
    - name: NCCL_IB_ADAPTIVE_ROUTING
      value: "1"
    resources:
      limits:
        nvidia.com/gpu: 8
        rdma/rdma_shared_device_a: 1
```

### Ethernet/RoCE Configuration

```yaml
env:
# Disable IB (use RoCE over Ethernet)
- name: NCCL_IB_DISABLE
  value: "0"
# Force specific NIC for TCP socket communication
- name: NCCL_SOCKET_IFNAME
  value: "eth0"
# RoCE-specific GID index (usually 3 for RoCEv2)
- name: NCCL_IB_GID_INDEX
  value: "3"
# Enable ECN for RoCE congestion control
- name: NCCL_IB_TC
  value: "106"
```

### Debugging NCCL Transport Selection

```bash
# Enable detailed NCCL logging
export NCCL_DEBUG=INFO
export NCCL_DEBUG_SUBSYS=NET,INIT

# Verify RDMA is being used (look for "NET/IB" not "NET/Socket")
# Good: [0] NCCL INFO NET/IB : Using [0]mlx5_0:1/RoCE
# Bad:  [0] NCCL INFO NET/Socket : Using [0]eth0
```

### Performance Comparison

| Transport | Bandwidth | Latency | Use Case |
|-----------|-----------|---------|----------|
| NVLink | 900 GB/s | <1μs | Intra-node GPU-GPU |
| IB HDR | 200 Gb/s | 1-2μs | Inter-node RDMA |
| RoCE v2 | 100 Gb/s | 2-5μs | Inter-node Ethernet |
| TCP | 25-100 Gb/s | 10-50μs | Fallback only |
