---
title: "Kubernetes 1.36 Gang Scheduling"
description: "Use gang scheduling in Kubernetes 1.36 to schedule Pod groups atomically. Essential for distributed ML training, MPI jobs, and Spark workloads."
tags:
  - "kubernetes-1.36"
  - "scheduling"
  - "gang-scheduling"
  - "machine-learning"
  - "distributed-training"
category: "ai"
publishDate: "2026-05-03"
author: "Luca Berton"
difficulty: "advanced"
relatedRecipes:
  - "kubernetes-1-36-restart-all-containers"
  - "kubernetes-1-36-dra-gpu-management"
  - "kueue-batch-gpu-jobs-kubernetes"
  - "distributed-training-tensorflow-pytorch-kubernetes"
---

> 💡 **Quick Answer:** Kubernetes 1.36 advances **Gang Scheduling** (KEP-4671) with Workload Scheduling Cycles and Delayed Preemption. Pod groups are scheduled atomically — all-or-nothing — preventing partial scheduling deadlocks in distributed ML training.

## The Problem

Distributed training needs N Pods running simultaneously. Without gang scheduling:

- **Partial scheduling**: 7 of 8 GPU Pods schedule, the 8th can't find resources. The 7 idle Pods waste expensive GPUs while waiting.
- **Deadlock**: Two 4-Pod jobs each get 2 Pods scheduled. Neither can complete, both hold GPUs hostage.
- **Resource waste**: Partially scheduled jobs block cluster capacity for minutes or hours.
- **Training failures**: Workers that start before all peers are ready crash or timeout on NCCL initialization.

## The Solution

Gang scheduling ensures all Pods in a group schedule together or none do. Kubernetes 1.36 introduces native PodGroup and Workload APIs.

### Define a PodGroup

```yaml
apiVersion: scheduling.k8s.io/v1alpha2
kind: PodGroup
metadata:
  name: llm-training-group
  namespace: ml-training
spec:
  minMember: 4
  scheduleTimeoutSeconds: 300
```

### Training Job with Gang Scheduling

```yaml
apiVersion: batch/v1
kind: Job
metadata:
  name: llm-finetune
  namespace: ml-training
  labels:
    scheduling.k8s.io/pod-group: llm-training-group
spec:
  completions: 4
  parallelism: 4
  template:
    metadata:
      labels:
        scheduling.k8s.io/pod-group: llm-training-group
    spec:
      schedulerName: default-scheduler
      containers:
        - name: trainer
          image: registry.example.com/training:v2.0
          command:
            - torchrun
            - --nnodes=4
            - --nproc_per_node=8
            - --rdzv_backend=c10d
            - --rdzv_endpoint=llm-finetune-0:29400
            - train.py
          resources:
            limits:
              nvidia.com/gpu: 8
              memory: 256Gi
            requests:
              nvidia.com/gpu: 8
              memory: 256Gi
      restartPolicy: Never
```

### Workload API (1.36 Enhancement)

```yaml
apiVersion: scheduling.k8s.io/v1alpha2
kind: Workload
metadata:
  name: distributed-training
  namespace: ml-training
spec:
  podGroups:
    - name: workers
      minMember: 4
      maxMember: 8
      template:
        spec:
          containers:
            - name: trainer
              image: registry.example.com/training:v2.0
              resources:
                limits:
                  nvidia.com/gpu: 8
  schedulingPolicy:
    preemptionPolicy: DelayedPreemption
    schedulingCycle: Atomic
```

### Delayed Preemption (New in 1.36)

Instead of immediately preempting lower-priority Pods, the scheduler waits to see if resources free up naturally:

```yaml
apiVersion: scheduling.k8s.io/v1alpha2
kind: Workload
metadata:
  name: large-training
spec:
  podGroups:
    - name: workers
      minMember: 8
  schedulingPolicy:
    preemptionPolicy: DelayedPreemption
    delayedPreemptionTimeout: 120s    # Wait 2 min before preempting
```

### Integration with Kueue

```yaml
apiVersion: kueue.x-k8s.io/v1beta1
kind: Workload
metadata:
  name: training-workload
spec:
  podSets:
    - name: workers
      count: 4
      minCount: 4    # Gang: require all 4
      template:
        spec:
          containers:
            - name: trainer
              image: registry.example.com/training:v2.0
              resources:
                requests:
                  nvidia.com/gpu: 8
  queueName: gpu-queue
```

### MPI Job with Gang Scheduling

```yaml
apiVersion: kubeflow.org/v2beta1
kind: MPIJob
metadata:
  name: nccl-benchmark
  labels:
    scheduling.k8s.io/pod-group: nccl-bench-group
spec:
  slotsPerWorker: 8
  runPolicy:
    cleanPodPolicy: Running
  mpiReplicaSpecs:
    Launcher:
      replicas: 1
      template:
        metadata:
          labels:
            scheduling.k8s.io/pod-group: nccl-bench-group
        spec:
          containers:
            - name: launcher
              image: registry.example.com/nccl-tests:v2.0
              command:
                - mpirun
                - --allow-run-as-root
                - -np 32
                - -x NCCL_DEBUG=INFO
                - /opt/nccl-tests/build/all_reduce_perf
                - -b 1G -e 8G -f 2
    Worker:
      replicas: 4
      template:
        metadata:
          labels:
            scheduling.k8s.io/pod-group: nccl-bench-group
        spec:
          containers:
            - name: worker
              image: registry.example.com/nccl-tests:v2.0
              resources:
                limits:
                  nvidia.com/gpu: 8
```

### Verify Gang Scheduling

```bash
# Check PodGroup status
kubectl get podgroup llm-training-group -o yaml
# Status shows: scheduled: true, members: 4/4

# Check scheduling events
kubectl get events --field-selector reason=GangScheduled
# Output: PodGroup llm-training-group successfully gang-scheduled (4/4 members)

# Check for deadlocks
kubectl get events --field-selector reason=GangSchedulingTimeout
```

## Common Issues

### PodGroup stuck in Pending
- **Cause**: Not enough resources for all members simultaneously
- **Fix**: Reduce `minMember`, add nodes, or configure preemption

### Scheduling deadlock between groups
- **Cause**: Multiple PodGroups competing for same resource pool
- **Fix**: Use priority classes and Delayed Preemption to break ties

### Timeout before all members scheduled
- **Cause**: `scheduleTimeoutSeconds` too short for cluster size
- **Fix**: Increase timeout or reduce group size

## Best Practices

1. **Set `minMember` carefully** — allow elastic scaling when possible (e.g., 4 min, 8 max)
2. **Use priority classes** — ensure training jobs can preempt lower-priority workloads
3. **Combine with Kueue** — queue management prevents resource contention
4. **Set reasonable timeouts** — 5-10 minutes for large GPU clusters
5. **Monitor scheduling latency** — gang scheduling adds overhead vs individual Pod scheduling

## Key Takeaways

- Gang scheduling is **Alpha v2 in Kubernetes 1.36** with Workload API and Delayed Preemption
- All Pods in a group schedule atomically — prevents partial scheduling waste
- Delayed Preemption avoids unnecessary evictions
- Essential for distributed ML training (PyTorch DDP, Horovod, MPI)
- Integrates with Kueue for enterprise batch scheduling
