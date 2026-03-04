---
title: "Diagnose GPU Peer-to-Peer Latency with NCCL Tests"
description: "Use NCCL point-to-point and collective tests to isolate GPU peer-to-peer latency issues between GPU pairs in multi-node Kubernetes clusters."
category: "troubleshooting"
difficulty: "advanced"
timeToComplete: "25 minutes"
kubernetesVersion: "1.28+"
prerequisites:
  - "NVIDIA GPUs visible in pods"
  - "nccl-tests binaries available"
  - "kubectl or oc CLI access"
relatedRecipes:
  - "validate-gpu-topology-nccl"
  - "debug-nccl-timeouts-kubernetes"
  - "run-nccl-tests-kubernetes"
tags:
  - nccl
  - latency
  - p2p
  - gpu
  - troubleshooting
publishDate: "2026-02-17"
author: "Luca Berton"
---

> 💡 **Quick Answer:** Compare latency with small-message runs such as `all_reduce_perf -b 8 -e 8M -f 2 -g 1` across different GPU pairs and nodes to identify outliers.


High latency usually points to topology or transport path issues.

## Fast Latency Test

```bash
all_reduce_perf -b 8 -e 8M -f 2 -g 1
```

## Isolation Strategy

1. Test within one node first.
2. Test cross-node with same pod specs.
3. Repeat with pinned nodes and interfaces.

## Correlate With Topology

Inside each pod:

```bash
nvidia-smi topo -m
```

Use topology distance to explain expected latency differences.

## Common Root Causes

- Wrong data interface selected
- RDMA disabled or unavailable
- Mixed firmware/driver versions across nodes
