---
title: "Debug NCCL Timeouts and Hangs in Kubernetes"
description: "Systematically troubleshoot NCCL runs that stall or timeout across multi-GPU and multi-node Kubernetes jobs with step-by-step diagnostic commands."
category: "troubleshooting"
difficulty: "advanced"
timeToComplete: "30 minutes"
kubernetesVersion: "1.28+"
prerequisites:
  - "NCCL workloads deployed"
  - "Access to pod logs and events"
  - "Basic understanding of cluster networking"
relatedRecipes:
  - "tune-nccl-env-rdma-ethernet"
  - "nccl-p2p-latency-diagnostics"
  - "run-nccl-tests-mpijob-kubernetes"
tags:
  - nccl
  - timeout
  - hang
  - troubleshooting
  - kubernetes
publishDate: "2026-02-17"
author: "Luca Berton"
---

> 💡 **Quick Answer:** Enable `NCCL_DEBUG=INFO`, inspect transport selection logs, verify interface configuration, and re-run with a reduced pod/node matrix to isolate the failing path.


NCCL hangs usually come from transport setup failures, network asymmetry, or inconsistent node state.

## Step-by-Step

1. Enable detailed logs:

```bash
export NCCL_DEBUG=INFO
```

2. Check pod events and restart reasons:

```bash
kubectl describe pod <pod-name> -n <namespace>
```

3. Validate interface and routing inside each pod.

4. Re-run with fewer nodes/GPUs to isolate the issue.

## High-Value Checks

- Same container image across all participants
- Same driver/runtime compatibility on all nodes
- No hidden policy blocking east-west traffic

## Resolution Pattern

Start from a known-good single-node run, then scale one dimension at a time.
