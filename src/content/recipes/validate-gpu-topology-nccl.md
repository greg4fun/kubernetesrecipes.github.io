---
title: "Validate GPU and NIC Topology Before NCCL Benchmarks"
description: "Inspect node-level GPU and PCI topology to predict and explain NCCL performance outcomes."
category: "troubleshooting"
difficulty: "intermediate"
timeToComplete: "15 minutes"
kubernetesVersion: "1.28+"
prerequisites:
  - "Access to GPU workload pods"
  - "nvidia-smi and lspci available"
relatedRecipes:
  - "nccl-p2p-latency-diagnostics"
  - "nccl-allreduce-benchmark-profile"
  - "run-nccl-tests-kubernetes"
tags:
  - nccl
  - topology
  - pci
  - gpu
  - troubleshooting
publishDate: "2026-02-17"
author: "Luca Berton"
---

> 💡 **Quick Answer:** Run `nvidia-smi topo -m` and `lspci` mapping checks first; poor physical topology often explains low NCCL bandwidth without any software bug.

# Validate GPU and NIC Topology Before NCCL Benchmarks

Topology awareness prevents false conclusions during NCCL troubleshooting.

## Commands to Run

```bash
nvidia-smi topo -m
lspci | grep -Ei 'NVIDIA|Mellanox|Ethernet|Infiniband'
```

## What to Confirm

- GPUs used by your pod are local to the expected PCI root complex.
- High-speed NICs are attached to suitable CPU/PCI paths.
- Node hardware is homogeneous across benchmark participants.

## Practical Outcome

Use topology results to define realistic performance targets for intra-node and inter-node NCCL tests.
