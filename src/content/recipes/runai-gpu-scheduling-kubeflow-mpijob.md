---
title: "Run:ai GPU Scheduling with Kubeflow MPIJob"
description: "Integrate Run:ai GPU scheduler with Kubeflow MPIJob for multi-node NCCL workloads. Covers Run:ai project namespaces, GPU quota annotations, pod group"
tags:
  - "gpu"
  - "scheduling"
  - "openshift"
  - "ai"
  - "mpi"
category: "ai"
publishDate: "2026-06-04"
author: "Luca Berton"
difficulty: "advanced"
relatedRecipes:
  - "nccl-network-validator-production-mpijob"
  - "runai-distributed-inference-vllm-nccl"
  - "ai-batch-processing-volcano"
---

> 💡 **Quick Answer:** Run:ai automatically manages GPU scheduling for Kubeflow MPIJob workloads. Deploy MPIJobs into Run:ai project namespaces (e.g., `my-project`). Run:ai adds tracking annotations (`runai-current-allocated-gpus`, `runai-used-nodes`) and enforces per-project GPU quotas. Use `cleanPodPolicy: None` and `backoffLimit: 0` for validation jobs to preserve logs and prevent retry loops.

## The Problem

- Multi-node GPU jobs need gang scheduling (all workers or none)
- GPU quota must be enforced per team/project
- Need visibility into GPU memory allocation across nodes
- Kubernetes default scheduler doesn't understand multi-node GPU topology
- Failed validation jobs shouldn't retry indefinitely

## The Solution

### Run:ai Project Namespace

```yaml
# MPIJob deployed to a Run:ai project namespace
apiVersion: kubeflow.org/v2beta1
kind: MPIJob
metadata:
  name: nccl-roce-validation
  namespace: my-project          # Run:ai project namespace
spec:
  runPolicy:
    cleanPodPolicy: None         # Keep pods for log inspection
    backoffLimit: 0              # Don't retry on failure
  # ...
```

### Run:ai Annotations (Auto-Added)

```yaml
# Run:ai controller automatically adds these annotations:
metadata:
  annotations:
    # Status tracking
    runai-calculated-status: Running        # Overall job status
    runai-pending-pods: "0"                 # Pods waiting for resources
    runai-running-pods: "2"                 # Active worker pods

    # GPU allocation
    runai-current-allocated-gpus: "4"       # Total GPUs in use
    runai-current-allocated-gpus-memory: "301509"  # MB (~294 GB)
    runai-current-requested-gpus: "4"       # Requested GPU count
    runai-total-requested-gpus: "4"         # Total across all pods

    # Pod group tracking
    runai-podgroup-requested-gpus: "4"      # Gang total
    runai-podgroup-requested-gpus-memory: "0"  # 0 = no memory fraction

    # Topology
    runai-used-nodes: gpu-worker-01, gpu-worker-02  # Placement
```

### GPU Memory Calculation

```text
runai-current-allocated-gpus-memory: "301509"

301509 MB ÷ 4 GPUs = ~75,377 MB per GPU = ~73.6 GB
→ H200 NVL (80 GB HBM3e, usable ~75 GB after ECC)

This confirms:
- 4× NVIDIA H200 NVL GPUs allocated
- Full GPU allocation (not MIG or time-slicing)
- Memory tracking is per-GPU-model aware
```

### Run:ai Scheduling Flow

```text
1. User submits MPIJob to Run:ai project namespace
2. Run:ai admission webhook intercepts the MPIJob
3. Run:ai scheduler evaluates:
   - Project GPU quota (e.g., 8 GPU limit)
   - Current usage in project
   - Node availability with required GPUs
   - Anti-affinity requirements (multi-node)
4. If resources available → schedule all pods together (gang)
5. If resources unavailable → queue job with priority
6. Run:ai adds tracking annotations to MPIJob
7. Pods start → Run:ai updates status annotations
8. Job completes → annotations show final state
```

### Run Policy Configuration

```yaml
runPolicy:
  # Don't retry failed validation jobs
  backoffLimit: 0

  # Keep pods after completion for log access
  cleanPodPolicy: None
  # Options:
  #   None     — keep all pods (launcher + workers) after completion
  #   Running  — delete running pods on failure, keep completed
  #   All      — delete all pods after completion (clean but no logs)

  # Don't suspend by default
  suspend: false
```

### Gang Scheduling Behavior

```yaml
# Run:ai ensures all workers start together (gang scheduling):
# - 2 workers × 2 GPUs = 4 GPUs total must be available
# - If only 2 GPUs available → job stays queued (not partial start)
# - Workers must fit on different nodes (if anti-affinity set)

# slotsPerWorker tells MPI Operator and Run:ai the GPU-per-worker ratio:
spec:
  slotsPerWorker: 2    # Each worker pod gets 2 GPUs (slots)

# Total GPUs = replicas × slotsPerWorker = 2 × 2 = 4
```

### Project Quota Example

```yaml
# Run:ai project configuration (admin sets via UI or API):
# Project: my-project
# Quota: 8 GPUs guaranteed, 16 GPUs over-quota allowed
# Priority: Normal
# Node pools: gpu-h200-pool

# The MPIJob requesting 4 GPUs fits within 8 GPU quota
# No queuing required if other jobs use ≤ 4 GPUs in this project
```

### Monitoring with Run:ai CLI

```bash
# Check job status:
runai describe job nccl-roce-validation -p my-project

# List GPU allocation:
runai list jobs -p my-project
# NAME                    STATUS     GPUs  NODE
# nccl-roce-validation    Running    4     gpu-worker-01,gpu-worker-02

# Check project quota:
runai list projects
# PROJECT       GPU_QUOTA  GPU_USED  OVER_QUOTA
# my-project    8          4         0
```

## Common Issues

### Job stuck in "Pending" with Run:ai
- **Cause**: Project GPU quota exceeded or no nodes with required GPUs
- **Fix**: Check `runai list jobs`; free GPUs or increase quota

### Workers scheduled on same node (not distributed)
- **Cause**: No anti-affinity and Run:ai optimizes for bin-packing
- **Fix**: Add podAntiAffinity or use Run:ai topology-aware scheduling

### "runai-current-allocated-gpus-memory: 0"
- **Cause**: GPU memory tracking not available (older GPU Operator)
- **Fix**: Upgrade GPU Operator; verify DCGM exporter is running

### Job succeeds but runai-calculated-status still "Running"
- **Cause**: Status reconciliation delay with Kubeflow controller
- **Fix**: Wait 30-60 seconds; Run:ai eventually picks up MPIJob condition

## Best Practices

1. **Deploy to Run:ai project namespace** — enables quota and priority
2. **`backoffLimit: 0`** for validation — don't burn GPU hours on retries
3. **`cleanPodPolicy: None`** for debugging — preserves worker logs
4. **`slotsPerWorker` = GPUs per worker** — enables correct gang accounting
5. **Check `runai-used-nodes`** — confirms multi-node placement
6. **Monitor GPU memory** — 301509 MB ÷ 4 confirms H200 full allocation
7. **Use Run:ai priorities** for production vs. benchmark workloads

## Key Takeaways

- Run:ai automatically tracks GPU allocation via annotations on MPIJob
- Gang scheduling ensures all workers start together or none start
- GPU memory tracking confirms correct hardware allocation (H200 = ~75 GB each)
- `cleanPodPolicy: None` + `backoffLimit: 0` = ideal for validation workloads
- `slotsPerWorker` must match GPU count in worker resource requests
- Run:ai node placement visible via `runai-used-nodes` annotation
- Project quotas enforce per-team fairness without manual scheduling
