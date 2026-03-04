---
title: "Run NCCL Tests on Kubernetes for GPU Network Validation"
description: "Benchmark GPU-to-GPU communication using NVIDIA nccl-tests on Kubernetes or OpenShift to validate bandwidth and latency."
category: "ai"
difficulty: "intermediate"
timeToComplete: "25 minutes"
kubernetesVersion: "1.28+"
prerequisites:
  - "Kubernetes or OpenShift cluster with NVIDIA GPUs"
  - "NVIDIA GPU Operator installed"
  - "At least 2 GPUs across one or more nodes"
  - "Container image with nccl-tests binaries"
relatedRecipes:
  - "nvidia-gpu-operator-install"
  - "validate-sriov-on-multiple-nodes"
  - "verify-ovn-underlay-interface"
tags:
  - nccl
  - nccl-tests
  - gpu
  - kubernetes
  - performance
  - ai-workloads
publishDate: "2026-02-17"
author: "Luca Berton"
---

> 💡 **Quick Answer:** Run `all_reduce_perf` from the official NVIDIA `nccl-tests` project to validate GPU communication: `all_reduce_perf -b 8 -e 512M -f 2 -g 1`. Use one pod per GPU node for multi-node tests and compare measured bandwidth against expected network/GPU limits.


[NVIDIA nccl-tests](https://github.com/NVIDIA/nccl-tests) provides standard micro-benchmarks for collective operations like all-reduce, broadcast, and all-gather. This recipe shows how to run these tests in Kubernetes/OpenShift to validate interconnect quality before deploying distributed training workloads.

## Why Run NCCL Tests

Use NCCL benchmarks to quickly detect:

- Misconfigured RDMA, RoCE, or InfiniBand paths
- Underperforming pod-to-pod GPU traffic
- Topology issues between GPUs, NICs, and nodes
- Regressions after driver, firmware, or CNI changes

## Example Benchmark Pod

Use an image that includes `nccl-tests` binaries (`all_reduce_perf`, `all_gather_perf`, and so on).

```yaml
apiVersion: v1
kind: Pod
metadata:
  name: nccl-test-single
  namespace: ai-inference
spec:
  restartPolicy: Never
  containers:
    - name: nccl-tests
      image: nvcr.io/nvidia/pytorch:24.10-py3
      command: ["/bin/bash", "-lc"]
      args:
        - |
          nvidia-smi
          all_reduce_perf -b 8 -e 512M -f 2 -g 1
      resources:
        limits:
          nvidia.com/gpu: "1"
        requests:
          nvidia.com/gpu: "1"
```

Apply and check logs:

```bash
kubectl apply -f nccl-test-single.yaml
kubectl logs -n ai-inference nccl-test-single
```

## Multi-Node Pattern

For distributed checks, run one pod per node and launch NCCL with `mpirun` or your scheduler/runtime wrapper.

Minimum checklist:

1. Pin pods to target nodes using `nodeSelector` or affinity.
2. Ensure all pods request GPU resources.
3. Confirm high-speed NIC visibility inside pods.
4. Set required NCCL env vars for your fabric.

Common environment variables:

```bash
export NCCL_DEBUG=INFO
export NCCL_IB_DISABLE=0
export NCCL_SOCKET_IFNAME=eth0
```

Adjust `NCCL_SOCKET_IFNAME` to your real data interface.

## Interpreting Results

Key outputs from `all_reduce_perf`:

- **algbw**: algorithm bandwidth (effective collective throughput)
- **busbw**: communication bus bandwidth estimate
- **time**: operation latency per message size

Healthy runs show:

- No repeated NCCL transport warnings
- Stable bandwidth scaling as message size increases
- Predictable differences between intra-node and inter-node tests

## Troubleshooting Tips

- `unhandled system error`: verify GPU plugin/driver health and device visibility.
- Very low bandwidth: check CNI path, MTU, and RDMA configuration.
- Inconsistent runs: confirm pods are on intended nodes and not CPU-throttled.
- Socket fallback instead of RDMA: review NCCL and network interface variables.

## Recommended Next Steps

- Store baseline numbers for each cluster environment.
- Re-run tests after firmware or networking changes.
- Add NCCL tests to pre-production validation pipelines.
