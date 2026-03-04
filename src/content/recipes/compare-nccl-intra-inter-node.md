---
title: "Compare NCCL Intra-Node vs Inter-Node Performance"
description: "Build a repeatable comparison between local and cross-node NCCL throughput to validate cluster scaling behavior."
category: "ai"
difficulty: "intermediate"
timeToComplete: "20 minutes"
kubernetesVersion: "1.28+"
prerequisites:
  - "At least two GPU nodes"
  - "NCCL tests runnable in pods"
relatedRecipes:
  - "nccl-allreduce-benchmark-profile"
  - "run-nccl-tests-kubernetes"
  - "validate-gpu-topology-nccl"
tags:
  - nccl
  - intra-node
  - inter-node
  - benchmarking
  - gpu
publishDate: "2026-02-17"
author: "Luca Berton"
---

> 💡 **Quick Answer:** Run the same `all_reduce_perf` profile in single-node and dual-node scenarios, then compare bandwidth ratios to detect network bottlenecks.


This comparison shows whether your network fabric is limiting distributed workloads.

## Standard Test Profile

```bash
all_reduce_perf -b 8 -e 1G -f 2 -g 1
```

## Test Design

- Intra-node: two or more GPUs on one node
- Inter-node: same GPU count split across two nodes

## Analysis

- Record top `algbw` for both scenarios
- Compute inter/intra ratio
- Investigate large drops with topology and network checks

## Target Outcome

Clear and documented baseline for expected communication penalty when crossing nodes.
