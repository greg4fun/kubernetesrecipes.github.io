---
title: "NCCL Test Benchmark Kubernetes"
description: "Run NCCL tests on Kubernetes for GPU communication benchmarking. all_reduce_perf, all_gather_perf, multi-node bandwidth, and latency validation."
publishDate: "2026-04-25"
author: "Luca Berton"
category: "ai"
difficulty: "advanced"
timeToComplete: "20 minutes"
kubernetesVersion: "1.28+"
tags:
  - "nccl"
  - "benchmark"
  - "gpu"
  - "all-reduce"
relatedRecipes:
  - "nccl-environment-variables-guide"
  - "nccl-allgather-benchmark-profile"
  - "nvidia-peermem-gpudirect-rdma-k8s"
  - "run-nccl-tests-mpijob-kubernetes"
  - "compare-nccl-intra-inter-node"
---

> 💡 **Quick Answer:** Run `all_reduce_perf -b 8 -e 2G -f 2 -g 1` in GPU pods and track `algbw`/`busbw` over message sizes to validate real cluster throughput. Use `all_gather_perf` with the same flags for collective-specific gather bandwidth.

## The Problem

All-reduce and all-gather are the key communication primitives for distributed training. Before trusting a cluster with a multi-day training job, you need a fast, repeatable way to confirm the GPU interconnect and network fabric actually deliver the expected bandwidth.

## The Solution

### Baseline Command

```bash
all_reduce_perf -b 8 -e 2G -f 2 -g 1
```

- `-b 8` — start at 8 bytes
- `-e 2G` — sweep up to 2 GB
- `-f 2` — multiply size by 2 each step
- `-g 1` — GPUs per process (adjust for multi-GPU-per-rank runs)

For all-gather instead of all-reduce, swap the binary:

```bash
all_gather_perf -b 8 -e 2G -f 2 -g 1
```

### Recommended Matrix

Run each test across these topologies to isolate where bottlenecks appear:

- Single node, 2 GPUs
- Single node, all local GPUs
- Two nodes, 1 GPU per node
- Two nodes, multiple GPUs per node

### What to Capture

- `algbw` and `busbw` (algorithm and bus bandwidth) at each message size
- GPU model and driver version
- Node pair tested
- CNI/network path used (NVLink, InfiniBand, RoCE, etc.)

### Pass Criteria

- Stable bandwidth at medium and large message sizes
- No repeated NCCL transport warnings in the log output
- Inter-node results align with the link capabilities (e.g., near-line-rate on InfiniBand/RoCE)

## Common Issues

**Bandwidth far below link speed on multi-node runs**

Usually a transport fallback — check for `NCCL INFO NET/Socket` in logs, which means NCCL fell back to TCP instead of using RDMA. Verify GPUDirect RDMA is active (see [nvidia-peermem-gpudirect-rdma-k8s](/recipes/ai/nvidia-peermem-gpudirect-rdma-k8s/)).

**Results vary run-to-run**

Check for noisy neighbors on the same NIC/switch, or CPU governor throttling. Pin NCCL to specific interfaces with `NCCL_SOCKET_IFNAME` / `NCCL_IB_HCA` (see [nccl-environment-variables-guide](/recipes/ai/nccl-environment-variables-guide/)).

## Best Practices

- Always run the full size sweep (`-b 8 -e 2G`) — small-message latency and large-message bandwidth fail independently
- Baseline single-node before testing multi-node — isolates NVLink/PCIe issues from network issues
- Re-run after any driver, CNI, or NCCL version upgrade — regressions here are silent until training jobs slow down
- Store results per node-pair so historical comparisons catch fabric degradation early

## Key Takeaways

- `all_reduce_perf` and `all_gather_perf` are the standard NCCL collective benchmarks
- Test single-node and multi-node topologies separately to localize bottlenecks
- `algbw`/`busbw` at large message sizes is the number that matters for real training throughput
- NCCL falling back to TCP sockets instead of RDMA is the most common cause of bad multi-node numbers

---

## 📘 Go Further with Kubernetes Recipes

**Love this recipe? There's so much more!** This is just one of **100+ hands-on recipes** in our comprehensive **[Kubernetes Recipes book](https://amzn.to/3DzC8QA)**.

Inside the book, you'll master:
- ✅ Production-ready deployment strategies
- ✅ Advanced networking and security patterns  
- ✅ Observability, monitoring, and troubleshooting
- ✅ Real-world best practices from industry experts

> *"The practical, recipe-based approach made complex Kubernetes concepts finally click for me."*

**👉 [Get Your Copy Now](https://amzn.to/3DzC8QA)** — Start building production-grade Kubernetes skills today!
