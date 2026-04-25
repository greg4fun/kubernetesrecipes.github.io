---
title: "AI Resource Allocation Optimization"
description: "Optimize GPU and memory allocation for AI workloads on Kubernetes. Right-size GPU requests, bin-packing strategies, gang scheduling."
publishDate: "2026-04-24"
author: "Luca Berton"
category: "ai"
difficulty: "intermediate"
timeToComplete: "20 minutes"
kubernetesVersion: "1.28+"
tags:
  - "gpu"
  - "resource-optimization"
  - "bin-packing"
  - "gang-scheduling"
  - "topology"
relatedRecipes:
  - "kubernetes-cost-optimization-strategies"
  - "gpu-sharing-mig-timeslicing-kubernetes"
  - "runai-topology-aware-scheduling-kubernetes"
---

> 💡 **Quick Answer:** Use gang scheduling (Volcano/Coscheduling) for distributed training — all workers start together or none do. Enable topology-aware scheduling to co-locate GPU pods on the same switch for NCCL performance. Implement priority-based preemption: inference > training > notebooks.

## The Problem

AI/ML workloads have unique scheduling requirements: distributed training needs all workers to start simultaneously (gang scheduling), GPU communication requires network proximity (topology awareness), and mixed workloads (training + inference + notebooks) compete for limited GPU resources.

## The Solution

### Gang Scheduling with Volcano

```yaml
apiVersion: scheduling.volcano.sh/v1beta1
kind: PodGroup
metadata:
  name: training-job
spec:
  minMember: 4
  queue: gpu-queue
  priorityClassName: training
---
apiVersion: batch.volcano.sh/v1alpha1
kind: Job
metadata:
  name: distributed-training
spec:
  schedulerName: volcano
  minAvailable: 4
  policies:
    - event: PodEvicted
      action: RestartJob
  tasks:
    - replicas: 4
      name: worker
      template:
        spec:
          schedulerName: volcano
          containers:
            - name: pytorch
              image: registry.example.com/training:1.0
              resources:
                limits:
                  nvidia.com/gpu: 8
```

All 4 workers (32 GPUs) must be schedulable simultaneously. If only 24 GPUs are available, the job waits rather than partially starting.

### GPU Bin-Packing

```yaml
# Scheduler configuration for GPU bin-packing
apiVersion: kubescheduler.config.k8s.io/v1
kind: KubeSchedulerConfiguration
profiles:
  - schedulerName: default-scheduler
    pluginConfig:
      - name: NodeResourcesFit
        args:
          scoringStrategy:
            type: MostAllocated
            resources:
              - name: nvidia.com/gpu
                weight: 10
              - name: cpu
                weight: 1
              - name: memory
                weight: 1
```

`MostAllocated` packs GPU workloads onto fewer nodes — frees up entire nodes for large multi-GPU jobs.

### Priority Hierarchy for AI Workloads

```yaml
apiVersion: scheduling.k8s.io/v1
kind: PriorityClass
metadata:
  name: inference-critical
value: 100000
description: "Production inference — preempts everything"
---
apiVersion: scheduling.k8s.io/v1
kind: PriorityClass
metadata:
  name: training-standard
value: 10000
preemptionPolicy: Never
description: "Training — queues without preempting"
---
apiVersion: scheduling.k8s.io/v1
kind: PriorityClass
metadata:
  name: notebook-dev
value: 1000
preemptionPolicy: Never
description: "Interactive notebooks — lowest priority"
```

```mermaid
graph TD
    subgraph GPU Cluster - 4 Nodes × 8 GPUs
        N1[Node 1<br/>8/8 GPU used<br/>Training Job A]
        N2[Node 2<br/>8/8 GPU used<br/>Training Job A]
        N3[Node 3<br/>4/8 GPU used<br/>Inference pods]
        N4[Node 4<br/>2/8 GPU used<br/>Notebooks]
    end
    
    GANG[Gang Scheduler<br/>All-or-nothing] -->|16 GPUs| N1 & N2
    BINPACK[Bin-Packing<br/>MostAllocated] -->|Pack inference| N3
    PREEMPT[Priority<br/>Inference > Training] -->|Can preempt| N4
```

## Common Issues

**Gang-scheduled job stuck in Pending**

Not enough GPUs available simultaneously. Check: `kubectl describe podgroup training-job`. Consider preempting lower-priority workloads or adding nodes.

**Training pods scattered across racks — slow NCCL**

Enable topology-aware scheduling. Label nodes with `topology.kubernetes.io/rack` and use topology spread constraints to co-locate training pods.

## Best Practices

- **Gang scheduling for distributed training** — partial starts waste GPU time
- **Bin-pack GPUs** with `MostAllocated` scoring — frees entire nodes for large jobs
- **Priority: inference > training > notebooks** — production SLA always wins
- **Topology-aware placement** — co-locate training pods on same switch for NCCL performance
- **`preemptionPolicy: Never` for training** — queue instead of disrupting other jobs

## Key Takeaways

- Gang scheduling ensures all workers start together — prevents deadlocks and wasted GPUs
- GPU bin-packing consolidates workloads onto fewer nodes
- Priority-based preemption: inference always gets GPUs, training queues
- Topology-aware scheduling reduces NCCL communication latency by 2-5x
- Combine gang scheduling + topology awareness + priority for optimal GPU cluster utilization
