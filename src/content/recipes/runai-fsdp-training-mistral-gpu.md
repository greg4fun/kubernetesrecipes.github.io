---
title: "FSDP Distributed Training on Run:ai"
description: "Run PyTorch FSDP distributed training workloads on Run:ai with GPU scheduling, event tracking, and GPU memory monitoring. Covers Mistral-class model"
tags:
  - "runai"
  - "distributed-training"
  - "fsdp"
  - "pytorch"
  - "gpu"
category: "ai"
publishDate: "2026-05-05"
author: "Luca Berton"
difficulty: "advanced"
relatedRecipes:
  - "runai-backend-architecture-openshift"
  - "runai-workload-controllers-openshift"
  - "nvidia-gpu-operator-gitops-openshift"
  - "openshift-gpu-node-resource-planning"
  - "runai-training-submit-script-pattern"
---

> 💡 **Quick Answer:** Submit PyTorch FSDP (Fully Sharded Data Parallel) training jobs through Run:ai to automatically schedule multi-GPU workloads with preemption, fairness queuing, and real-time GPU utilization monitoring. Run:ai handles container lifecycle, GPU allocation, and metrics collection.

## The Problem

Training large language models (7B-100B+ parameters) requires:

- Multiple GPUs with FSDP sharding across devices
- Fair scheduling when multiple teams share a GPU cluster
- Real-time GPU compute and memory utilization monitoring
- Automatic container lifecycle management (pull, create, start)
- Preemption support for priority workloads

## The Solution

### Submit FSDP Training Workload via Run:ai CLI

```bash
# Submit a Mistral-class model fine-tuning job
runai submit mistral-fsdp \
  --project team-nlp \
  --type training \
  --gpu 4 \
  --image registry.example.com/ml/pytorch-fsdp:2.3.0-cuda12.4 \
  --pvc data-vol:/data \
  --pvc model-vol:/models \
  --environment MASTER_PORT=29500 \
  --environment NCCL_DEBUG=INFO \
  --environment TORCH_DISTRIBUTED_DEBUG=DETAIL \
  --command "torchrun --nproc_per_node=4 train_fsdp.py \
    --model_name mistral-small \
    --dataset /data/finetune-dataset \
    --output_dir /models/checkpoints \
    --fsdp_sharding_strategy FULL_SHARD \
    --per_device_train_batch_size 2 \
    --gradient_accumulation_steps 4 \
    --num_train_epochs 3 \
    --bf16 true"
```

### Run:ai Workload YAML (Declarative)

```yaml
apiVersion: run.ai/v2alpha1
kind: TrainingWorkload
metadata:
  name: mistral-fsdp
  namespace: runai-team-nlp
spec:
  gpu:
    value: "4"
  image:
    value: registry.example.com/ml/pytorch-fsdp:2.3.0-cuda12.4
  name:
    value: mistral-fsdp
  pvcs:
    items:
      - claimName: data-vol
        path: /data
      - claimName: model-vol
        path: /models
  environment:
    items:
      - name: MASTER_PORT
        value: "29500"
      - name: NCCL_DEBUG
        value: INFO
      - name: FSDP_SHARDING_STRATEGY
        value: FULL_SHARD
  command:
    value: >-
      torchrun --nproc_per_node=4 train_fsdp.py
      --model_name mistral-small
      --fsdp_sharding_strategy FULL_SHARD
      --bf16 true
  priority:
    value: low
  preemptible:
    value: true
```

### Workload Lifecycle Events

```text
Date & Time              Event      Type     Issuer    Component    Details
─────────────────────────────────────────────────────────────────────────────
05/05/2026 15:32:36.000  Started    Normal   kubelet   Pod          Started container pytorch
05/05/2026 15:32:36.000  Created    Normal   kubelet   Pod          Created container pytorch
05/05/2026 15:32:56.173  Status     -        -         -            Running
05/05/2026 15:33:00.000  Running    Normal   status-   PodGroup     Job status changed from
                                             updater                ContainerCreating to Run
05/05/2026 15:34:01.000  Pulled     Normal   kubelet   Pod          Container image already
                                                                    present on machine
05/05/2026 15:34:03.000  Created    Normal   kubelet   Pod          Created container pytorch
05/05/2026 15:34:03.000  Started    Normal   kubelet   Pod          Started container pytorch
```

### GPU Metrics During Training

```text
GPU Compute Utilization:
├── Ramp-up phase: 0% → 95% (first 30s as FSDP initializes)
├── Steady-state: 85-98% (training loop active)
├── Checkpoint intervals: drops to ~20% briefly
└── End of epoch: brief 0% during eval

GPU Memory Usage:
├── Model shards loaded: ~12 GB per GPU (FSDP FULL_SHARD)
├── Optimizer states: ~8 GB per GPU
├── Activation memory: ~4 GB per GPU (with gradient checkpointing)
├── NCCL buffers: ~2 GB
└── Total per GPU: ~26 GB / 80 GB (A100)

GPU Memory Utilization:
├── Steady-state: ~32% of 80GB A100
├── Peak (during all-gather): ~65%
└── With gradient accumulation: ~45%
```

### Monitor Running Workload

```bash
# Check workload status
runai describe job mistral-fsdp -p team-nlp

# Stream logs
runai logs mistral-fsdp -p team-nlp --tail 100 -f

# Check GPU utilization via Run:ai
runai top job mistral-fsdp -p team-nlp

# Or via oc/kubectl
oc exec -n runai-team-nlp mistral-fsdp-0-0 -- nvidia-smi

# DCGM metrics (if DCGM exporter running)
oc exec -n runai-team-nlp mistral-fsdp-0-0 -- \
  dcgmi dmon -e 203,204,1001,1002 -d 1000
```

### FSDP Configuration for Run:ai

```python
# train_fsdp.py - Key FSDP configuration
import torch
from torch.distributed.fsdp import (
    FullyShardedDataParallel as FSDP,
    ShardingStrategy,
    MixedPrecision,
    BackwardPrefetch,
)
from torch.distributed.fsdp.wrap import transformer_auto_wrap_policy

# FSDP wrapping policy for transformer models
auto_wrap_policy = transformer_auto_wrap_policy(
    transformer_layer_cls={MistralDecoderLayer},
)

# Mixed precision for memory efficiency
mp_policy = MixedPrecision(
    param_dtype=torch.bfloat16,
    reduce_dtype=torch.bfloat16,
    buffer_dtype=torch.bfloat16,
)

# Wrap model
model = FSDP(
    model,
    sharding_strategy=ShardingStrategy.FULL_SHARD,
    mixed_precision=mp_policy,
    auto_wrap_policy=auto_wrap_policy,
    backward_prefetch=BackwardPrefetch.BACKWARD_PRE,
    device_id=torch.cuda.current_device(),
    limit_all_gathers=True,  # Reduces peak memory
)
```

### Run:ai Scheduling Behavior

```text
Scheduling flow:
1. User submits training workload (priority: low, preemptible: true)
2. Run:ai scheduler checks project GPU quota
3. If GPUs available → schedule immediately
4. If over-quota → queue until resources free
5. If higher-priority job arrives → preempt this job
6. Preempted job re-queues and resumes from last checkpoint

Priority levels:
├── Critical  — never preempted
├── High      — preempts low/medium
├── Medium    — preempts low
└── Low       — preempted by all (good for training experiments)
```

### Multi-Node FSDP (Large Models)

```bash
# For models that don't fit on a single node (70B+)
runai submit mistral-large-fsdp \
  --project team-nlp \
  --type training \
  --gpu 8 \
  --workers 2 \
  --image registry.example.com/ml/pytorch-fsdp:2.3.0-cuda12.4 \
  --environment NCCL_IB_DISABLE=0 \
  --environment NCCL_NET_GDR_LEVEL=5 \
  --environment NCCL_SOCKET_IFNAME=eth0 \
  --command "torchrun \
    --nnodes=2 \
    --nproc_per_node=8 \
    --rdzv_backend=c10d \
    --rdzv_endpoint=\$MASTER_ADDR:\$MASTER_PORT \
    train_fsdp.py --model_name mistral-large --fsdp_sharding_strategy HYBRID_SHARD"
```

## Common Issues

### Job stuck in "Initializing" state
- **Cause**: Image pull taking long (large PyTorch images ~15GB)
- **Fix**: Pre-pull images on GPU nodes; use `imagePullPolicy: IfNotPresent`

### GPU memory OOM during training
- **Cause**: Batch size too large or gradient accumulation not enabled
- **Fix**: Reduce `per_device_train_batch_size`; enable gradient checkpointing

### NCCL timeout errors
- **Cause**: Network issues between GPUs/nodes; one rank slower
- **Fix**: Set `NCCL_TIMEOUT=1800`; check for stragglers; verify InfiniBand/RoCE

### Job preempted mid-training
- **Cause**: Higher-priority job needed GPUs
- **Fix**: Save checkpoints frequently; use `--save_steps 500`; set higher priority

## Best Practices

1. **Always use `preemptible: true`** for experimental training — improves cluster utilization
2. **Checkpoint every N steps** — protects against preemption and OOM
3. **Use FULL_SHARD** for memory efficiency on single-node multi-GPU
4. **Use HYBRID_SHARD** for multi-node (shards within node, replicates across)
5. **Set NCCL_DEBUG=INFO** initially, then disable for production runs (reduces overhead)
6. **Monitor GPU memory** via Run:ai metrics — stay below 80% to avoid OOM spikes

## Key Takeaways

- Run:ai handles GPU scheduling, queuing, and preemption for FSDP training jobs
- Workload lifecycle: Pulled → Created → Started → Running (tracked via events)
- GPU metrics: compute utilization, memory usage, and GPU usage graphs in Run:ai UI
- FSDP FULL_SHARD splits model, optimizer, and gradients across all GPUs
- Preemptible + low priority = maximum cluster utilization for training experiments
- Multi-node FSDP uses HYBRID_SHARD with NCCL RDMA for cross-node communication
- Run:ai + Thanos collects historical GPU metrics (when Thanos Receive is healthy 😄)
