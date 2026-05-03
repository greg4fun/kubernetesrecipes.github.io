---
title: "Kubernetes 1.36 RestartAllContainers for ML"
description: "Use the RestartAllContainers policy in Kubernetes 1.36 to restart all Pod containers in-place when a worker fails, avoiding costly ML training rescheduling."
tags:
  - "kubernetes-1.36"
  - "machine-learning"
  - "gpu"
  - "restart-policy"
  - "distributed-training"
category: "ai"
publishDate: "2026-05-03"
author: "Luca Berton"
difficulty: "advanced"
relatedRecipes:
  - "kubernetes-1-36-oci-volume-source"
  - "kubernetes-1-36-selinux-mount-labeling"
  - "gpu-sharing-mig-timeslicing-kubernetes"
  - "distributed-training-tensorflow-pytorch-kubernetes"
  - "nccl-environment-variables-guide"
---

> 💡 **Quick Answer:** Kubernetes 1.36 introduces **RestartAllContainers** (Alpha). When one container in a multi-container Pod fails, all containers restart in-place instead of the Pod being rescheduled — saving hours of ML training checkpoint recovery time.

## The Problem

In distributed ML training, a multi-container Pod might have:
- A training worker container
- A communication sidecar (NCCL, MPI)
- A metrics/logging sidecar

When **one container crashes**, Kubernetes only restarts that container. But the other containers hold stale state (old NCCL communicator handles, dead rank connections). The training job hangs or produces corrupted results.

The only reliable fix was **deleting the entire Pod**, which means:
- Waiting for GPU re-scheduling (minutes to hours)
- Reloading model checkpoints (minutes)
- Re-establishing distributed communication (NCCL ring setup)
- Potential loss of uncheckpointed progress

## The Solution

`RestartAllContainers` restarts **every container in the Pod** when any single container fails, keeping the Pod on the same node with the same GPU allocation.

### Enable the Feature Gate (Alpha)

```bash
# Add to kube-apiserver and kubelet flags
--feature-gates=RestartAllContainers=true
```

### Configure a Training Pod

```yaml
apiVersion: v1
kind: Pod
metadata:
  name: training-worker-0
spec:
  restartPolicy: Always
  containerRestartPolicy: RestartAllContainers    # NEW in 1.36
  containers:
    - name: trainer
      image: registry.example.com/training:v2.0
      command: ["torchrun", "--nproc_per_node=8", "train.py"]
      resources:
        limits:
          nvidia.com/gpu: 8
      env:
        - name: NCCL_SOCKET_IFNAME
          value: "eth0"
        - name: MASTER_ADDR
          value: "training-worker-0.training.default.svc"
    - name: nccl-healthcheck
      image: registry.example.com/nccl-monitor:v1.0
      command: ["nccl-watchdog", "--timeout=300"]
      resources:
        limits:
          nvidia.com/gpu: 0
```

### PyTorchJob with RestartAllContainers

```yaml
apiVersion: kubeflow.org/v1
kind: PyTorchJob
metadata:
  name: llm-finetune
spec:
  pytorchReplicaSpecs:
    Master:
      replicas: 1
      template:
        spec:
          containerRestartPolicy: RestartAllContainers
          containers:
            - name: pytorch
              image: registry.example.com/training:v2.0
              command:
                - torchrun
                - --nnodes=4
                - --nproc_per_node=8
                - --rdzv_backend=c10d
                - train.py
              resources:
                limits:
                  nvidia.com/gpu: 8
    Worker:
      replicas: 3
      template:
        spec:
          containerRestartPolicy: RestartAllContainers
          containers:
            - name: pytorch
              image: registry.example.com/training:v2.0
              resources:
                limits:
                  nvidia.com/gpu: 8
```

### Comparison: Without vs With RestartAllContainers

```bash
# WITHOUT RestartAllContainers:
# 1. Container "nccl-healthcheck" crashes
# 2. Only nccl-healthcheck restarts
# 3. trainer container holds stale NCCL state
# 4. Training hangs → timeout → Pod deleted → rescheduled
# 5. Total recovery: 10-30 minutes (GPU re-allocation + checkpoint reload)

# WITH RestartAllContainers:
# 1. Container "nccl-healthcheck" crashes
# 2. ALL containers restart together
# 3. Fresh NCCL state, fresh training from last checkpoint
# 4. Pod stays on same node, same GPUs
# 5. Total recovery: 30-60 seconds (checkpoint reload only)
```

## Common Issues

### Feature gate not recognized
- **Cause**: Running Kubernetes < 1.36
- **Fix**: Upgrade to 1.36+ and enable `RestartAllContainers` feature gate

### Containers restart too aggressively
- **Cause**: One flaky container causes constant full-Pod restarts
- **Fix**: Fix the flaky container; consider using `restartPolicy: OnFailure` for non-critical sidecars

### GPU not released during restart
- **Cause**: Expected behavior — in-place restart keeps GPU allocation
- **Fix**: This is the desired behavior. GPUs stay allocated to the Pod.

## Best Practices

1. **Use for ML training Pods** — the primary use case for this feature
2. **Implement checkpointing** — restart is only useful if training can resume
3. **Monitor restart counts** — frequent full restarts indicate a deeper issue
4. **Combine with liveness probes** — detect hangs early, trigger clean restarts
5. **Pin to specific nodes** — use nodeSelector/affinity to keep GPU locality

## Key Takeaways

- `RestartAllContainers` is **Alpha in Kubernetes 1.36** — requires feature gate
- All containers restart together when any single container fails
- Pod stays on the same node with the same resource allocation (GPUs)
- Reduces ML training recovery from **30 minutes to 30 seconds**
- Essential for distributed training with NCCL sidecars and multi-container Pods
