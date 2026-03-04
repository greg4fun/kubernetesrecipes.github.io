---
title: "Tune NCCL Environment Variables for RDMA and Ethernet"
description: "Apply safe NCCL environment variable profiles for RDMA-capable and Ethernet-only GPU clusters to maximize collective communication throughput."
category: "configuration"
difficulty: "advanced"
timeToComplete: "20 minutes"
kubernetesVersion: "1.28+"
prerequisites:
  - "NCCL workloads running in Kubernetes"
  - "Knowledge of network interfaces used by pods"
relatedRecipes:
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
