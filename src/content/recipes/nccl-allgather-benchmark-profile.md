---
title: "Run NCCL AllGather Benchmarks for Model Parallel Validation"
description: "Use all-gather NCCL tests to evaluate communication behavior for tensor/model parallel AI workloads."
category: "ai"
difficulty: "intermediate"
timeToComplete: "20 minutes"
kubernetesVersion: "1.28+"
prerequisites:
  - "Kubernetes or OpenShift with NVIDIA GPUs"
  - "nccl-tests binaries in container"
  - "At least 2 GPUs"
relatedRecipes:
  - "run-nccl-tests-kubernetes"
  - "validate-gpu-topology-nccl"
  - "nccl-allreduce-benchmark-profile"
tags:
  - nccl
  - allgather
  - ai
  - model-parallel
  - performance
publishDate: "2026-02-17"
author: "Luca Berton"
---

> 💡 **Quick Answer:** Execute `all_gather_perf -b 8 -e 1G -f 2 -g 1` to validate communication efficiency for model-parallel patterns.

# Run NCCL AllGather Benchmarks for Model Parallel Validation

All-gather performance is important for tensor-parallel inference and training pipelines.

## Benchmark Command

```bash
all_gather_perf -b 8 -e 1G -f 2 -g 1
```

## Execution Tips

- Keep pod CPU/memory limits realistic to avoid host bottlenecks.
- Use fixed node placement between runs.
- Run at least 3 iterations and compare averages.

## Troubleshooting Signals

- Large variance between runs suggests noisy neighbors or unstable links.
- Sudden drops at specific sizes can indicate MTU or transport fallback issues.

## Output to Store

Save logs with node names, GPU count, and NIC interface metadata for trend analysis.
