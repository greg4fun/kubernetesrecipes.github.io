---
title: "Kubernetes Volcano Batch Scheduler Gang Scheduling"
description: "Deploy Volcano batch scheduler for gang scheduling on Kubernetes. Configure minAvailable for all-or-nothing pod group scheduling, queue management, and GPU job scheduling for distributed training workloads."
tags:
  - "volcano"
  - "gang-scheduling"
  - "batch"
  - "gpu"
  - "distributed-training"
  - "scheduling"
category: "ai"
publishDate: "2026-06-01"
author: "Luca Berton"
difficulty: "advanced"
relatedRecipes:
  - "kubernetes-gpu-distributed-training"
  - "kueue-job-queuing-kubernetes"
  - "nccl-rccl-networking-performance-kubernetes"
---

> 💡 **Quick Answer:** Volcano provides gang scheduling via `minAvailable` — all pods in a group must be schedulable simultaneously or none are placed. This prevents deadlocks in distributed training where partial allocation wastes GPUs. Install Volcano via Helm, create a Volcano `Job` with `minAvailable` matching your worker count, and configure queues for multi-tenant GPU sharing.

## The Problem

- Default kube-scheduler places pods one-by-one — partial placement wastes resources
- Distributed training needs all N workers running simultaneously (NCCL requires all peers)
- Without gang scheduling, 7 of 8 workers may start but wait indefinitely for the 8th
- Multiple teams competing for GPUs need fair queuing and priority
- Batch jobs need backfill scheduling to maximize GPU utilization

## The Solution

### Install Volcano

```bash
helm repo add volcano-sh https://volcano-sh.github.io/helm-charts
helm repo update

helm install volcano volcano-sh/volcano \
  --namespace volcano-system \
  --create-namespace \
  --set basic.image_tag_version=v1.9.0 \
  --wait

# Verify
kubectl get pods -n volcano-system
# NAME                                    READY   STATUS    RESTARTS   AGE
# volcano-admission-xxx                   1/1     Running   0          1m
# volcano-controllers-xxx                 1/1     Running   0          1m
# volcano-scheduler-xxx                   1/1     Running   0          1m
```

### Gang Scheduling with Volcano Job

```yaml
apiVersion: batch.volcano.sh/v1alpha1
kind: Job
metadata:
  name: distributed-training
  namespace: ml-workloads
spec:
  minAvailable: 4           # ALL 4 pods must be placed or NONE
  schedulerName: volcano
  queue: gpu-queue
  plugins:
    svc: ["--publish-not-ready-addresses"]
    ssh: []
  policies:
    - event: PodEvicted
      action: RestartJob
    - event: PodFailed
      action: RestartJob
  tasks:
    - replicas: 4
      name: worker
      template:
        spec:
          containers:
            - name: pytorch
              image: nvcr.io/nvidia/pytorch:24.05-py3
              command:
                - torchrun
                - --nproc_per_node=8
                - --nnodes=4
                - --node_rank=$(VK_TASK_INDEX)
                - --master_addr=$(MF_WORKER_0_HOST)
                - --master_port=29500
                - train.py
              env:
                - name: NCCL_SOCKET_IFNAME
                  value: "=eth0"
                - name: NCCL_IB_HCA
                  value: "=mlx5_0,mlx5_1,mlx5_2,mlx5_3"
              resources:
                limits:
                  nvidia.com/gpu: "8"
              ports:
                - containerPort: 29500
                  name: master
              volumeMounts:
                - name: shm
                  mountPath: /dev/shm
          volumes:
            - name: shm
              emptyDir:
                medium: Memory
                sizeLimit: 64Gi
          restartPolicy: OnFailure
```

### Queue Management

```yaml
# Define GPU queues with weight-based fair sharing
apiVersion: scheduling.volcano.sh/v1beta1
kind: Queue
metadata:
  name: gpu-queue
spec:
  weight: 4            # Higher weight = more resources
  capability:
    nvidia.com/gpu: "32"   # Max GPUs this queue can use
  reclaimable: true    # Allow preemption from this queue
---
apiVersion: scheduling.volcano.sh/v1beta1
kind: Queue
metadata:
  name: dev-queue
spec:
  weight: 1
  capability:
    nvidia.com/gpu: "8"
  reclaimable: true
---
apiVersion: scheduling.volcano.sh/v1beta1
kind: Queue
metadata:
  name: priority-queue
spec:
  weight: 8
  capability:
    nvidia.com/gpu: "64"
  reclaimable: false    # Cannot be preempted
```

```bash
# Check queue status
kubectl get queues
# NAME            WEIGHT   STATE    PENDING   RUNNING   INQUEUE
# gpu-queue       4        Open     0         2         1
# dev-queue       1        Open     1         0         0
# priority-queue  8        Open     0         1         0
```

### PodGroup (Gang Scheduling Without Volcano Job)

```yaml
# Use PodGroup with standard Kubernetes Jobs/Deployments
apiVersion: scheduling.volcano.sh/v1beta1
kind: PodGroup
metadata:
  name: training-group
  namespace: ml-workloads
spec:
  minMember: 4           # Minimum pods that must co-schedule
  queue: gpu-queue
  priorityClassName: high-priority
  minResources:
    nvidia.com/gpu: "32"  # Total resources needed
---
# Standard Job referencing the PodGroup
apiVersion: batch/v1
kind: Job
metadata:
  name: training-worker
  namespace: ml-workloads
spec:
  parallelism: 4
  completions: 4
  template:
    metadata:
      annotations:
        scheduling.volcano.sh/group-name: training-group
    spec:
      schedulerName: volcano
      containers:
        - name: worker
          image: registry.example.com/training:v1
          resources:
            limits:
              nvidia.com/gpu: "8"
      restartPolicy: Never
```

### Job Lifecycle Policies

```yaml
apiVersion: batch.volcano.sh/v1alpha1
kind: Job
metadata:
  name: resilient-training
spec:
  minAvailable: 3       # Can tolerate 1 failure (3 of 4)
  maxRetry: 3           # Retry up to 3 times
  ttlSecondsAfterFinished: 3600
  schedulerName: volcano
  queue: gpu-queue
  policies:
    - event: PodEvicted
      action: RestartJob    # Restart all tasks
    - event: PodFailed
      action: RestartJob
    - event: TaskCompleted
      action: CompleteJob   # Finish when tasks complete
    - event: OutOfSync
      action: EnqueueJob    # Re-queue if sync lost
  tasks:
    - replicas: 4
      name: worker
      policies:
        - event: TaskFailed
          action: RestartJob
          exitCodes:
            - 137    # OOMKilled → restart
            - 143    # SIGTERM → restart
      template:
        spec:
          containers:
            - name: trainer
              image: registry.example.com/trainer:v1
              resources:
                limits:
                  nvidia.com/gpu: "8"
          restartPolicy: OnFailure
```

## Common Issues

### Job stuck in "Pending" — minAvailable not satisfied
- **Cause**: Not enough GPUs/resources available in cluster to schedule all pods simultaneously
- **Fix**: Reduce `minAvailable`; check queue capacity; wait for running jobs to complete

### Gang scheduling deadlock between two jobs
- **Cause**: Two jobs each need more GPUs than available; neither can fully schedule
- **Fix**: Configure job priority; use queue weights; enable preemption (`reclaimable: true`)

### Volcano scheduler not picking up pods
- **Cause**: Pod doesn't specify `schedulerName: volcano`
- **Fix**: Add `schedulerName: volcano` to pod spec; or use Volcano Job CRD directly

### Job restarts but loses checkpoints
- **Cause**: `RestartJob` policy recreates all pods, losing local storage
- **Fix**: Use shared PVC for checkpoints; save checkpoints every N steps

## Best Practices

1. **Set `minAvailable` = total workers** — ensures all-or-nothing scheduling
2. **Use queues for multi-tenancy** — weight-based fair sharing between teams
3. **Configure restart policies** — `RestartJob` on pod failure for distributed training
4. **Use PVC for checkpoints** — survive restarts without losing progress
5. **Set TTL on completed jobs** — automatic cleanup after `ttlSecondsAfterFinished`
6. **Monitor queue backlog** — `kubectl get queues` shows pending vs running
7. **Priority for production training** — separate queues for dev experiments vs production

## Key Takeaways

- Volcano provides gang scheduling — all pods placed simultaneously or none (prevents deadlocks)
- `minAvailable` is the key field — set to total worker count for distributed training
- Queues enable multi-tenant GPU sharing with weight-based fair scheduling
- PodGroups work with standard K8s Jobs when Volcano Job CRD isn't needed
- Lifecycle policies automate restart/completion behavior on pod events
- Essential for distributed training — NCCL requires all peers running before communication
- Alternative to Kueue (which focuses on queuing, not gang scheduling)
