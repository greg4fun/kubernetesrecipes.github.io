---
title: "Benchmark NCCL AllReduce Performance on Kubernetes"
description: "Measure NCCL AllReduce bandwidth and latency on Kubernetes to validate distributed training network performance across multi-GPU clusters."
category: "ai"
difficulty: "intermediate"
timeToComplete: "20 minutes"
kubernetesVersion: "1.28+"
prerequisites:
  - "Kubernetes or OpenShift cluster with NVIDIA GPUs"
  - "NVIDIA GPU Operator installed"
  - "Container image with nccl-tests"
relatedRecipes:
  - "run-nccl-tests-mpijob-kubernetes"
  - "run-nccl-tests-kubernetes"
  - "compare-nccl-intra-inter-node"
  - "tune-nccl-env-rdma-ethernet"
  - "nccl-allgather-benchmark-profile"
tags:
  - nccl
  - allreduce
  - gpu
  - benchmark
  - kubernetes
publishDate: "2026-02-17"
author: "Luca Berton"
---

> 💡 **Quick Answer:** Run `all_reduce_perf -b 8 -e 2G -f 2 -g 1` in GPU pods and track `algbw`/`busbw` over message sizes to validate real cluster throughput.


All-reduce is the key communication primitive for data-parallel training. This test gives a fast signal on cluster readiness.

## Baseline Command

```bash
all_reduce_perf -b 8 -e 2G -f 2 -g 1
```

## Recommended Matrix

- Single node, 2 GPUs
- Single node, all local GPUs
- Two nodes, 1 GPU per node
- Two nodes, multiple GPUs per node

## What to Capture

- `algbw` and `busbw`
- GPU model and driver version
- Node pair tested
- CNI/network path used

## Pass Criteria

- Stable bandwidth at medium and large message sizes
- No repeated NCCL transport warnings
- Inter-node results align with link capabilities
