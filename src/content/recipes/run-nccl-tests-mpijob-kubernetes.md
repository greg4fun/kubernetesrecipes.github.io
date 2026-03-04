---
title: "Run NCCL Tests with MPIJob on Kubernetes"
description: "Launch multi-pod NCCL benchmarks using MPIJob for repeatable distributed GPU communication tests."
category: "deployments"
difficulty: "advanced"
timeToComplete: "35 minutes"
kubernetesVersion: "1.28+"
prerequisites:
  - "Kubeflow MPI Operator installed"
  - "GPU-enabled nodes and runtime"
  - "nccl-tests included in training image"
relatedRecipes:
  - "run-nccl-tests-kubernetes"
  - "compare-nccl-intra-inter-node"
  - "automate-nccl-preflight-ci"
tags:
  - nccl
  - mpijob
  - kubeflow
  - distributed
  - gpu
publishDate: "2026-02-17"
author: "Luca Berton"
---

> 💡 **Quick Answer:** Use an `MPIJob` with one launcher and N workers, then execute `all_reduce_perf` through `mpirun` to test real multi-pod communication paths.


MPIJob provides a repeatable way to run multi-process NCCL tests across pods and nodes.

## Minimal Flow

1. Create an MPIJob with launcher and worker replicas.
2. Request one GPU per worker pod.
3. Run `mpirun ... all_reduce_perf` from launcher.
4. Collect logs from launcher and workers.

## Suggested Command

```bash
mpirun -np 4 -N 1 all_reduce_perf -b 8 -e 1G -f 2 -g 1
```

## Validation

- All workers join the run successfully.
- No transport or rendezvous failures.
- Bandwidth trends are consistent across repeated runs.

## When to Use

- Before enabling distributed training in production
- After network changes on GPU nodes
- As a periodic cluster health check
