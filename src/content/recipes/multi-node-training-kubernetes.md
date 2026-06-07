---
title: "Multi-Node Distributed Training on Kubernetes"
description: "Run distributed deep learning training across multiple GPU nodes on Kubernetes. Covers PyTorch DDP, DeepSpeed, Horovod, and MPI jobs with NCCL optimization."
tags:
  - "training"
  - "distributed"
  - "multi-node"
  - "pytorch"
  - "deepspeed"
category: "ai"
publishDate: "2026-05-05"
author: "Luca Berton"
difficulty: "advanced"
relatedRecipes:
  - "distributed-multi-gpu-inference-kubernetes"
  - "kubernetes-1-36-gang-scheduling"
  - "kubernetes-1-36-topology-aware-scheduling"
  - "validate-gpu-topology-nccl"
  - "deep-learning-large-dataset-kubernetes"
---

> 💡 **Quick Answer:** Multi-node training on Kubernetes uses PyTorch DDP/FSDP or DeepSpeed with `torchrun`/MPI, scheduled via gang scheduling. Each node runs a worker with 8 GPUs communicating via NCCL over NVLink (intra-node) and RDMA/InfiniBand (inter-node).

## The Problem

Training large models (7B+ parameters) on a single node is too slow:

- **Time**: Fine-tuning a 70B model on 8 GPUs takes weeks vs days on 32 GPUs
- **Memory**: Full model + optimizer states + gradients exceed single-node capacity
- **Throughput**: More GPUs = larger effective batch size = faster convergence
- **Cost**: 4 nodes × 2 days is cheaper than 1 node × 8 days (if using spot/preemptible)

## The Solution

### PyTorch DDP with torchrun (Recommended)

```yaml
apiVersion: batch/v1
kind: Job
metadata:
  name: llm-finetune
  namespace: training
  labels:
    scheduling.k8s.io/pod-group: finetune-group
spec:
  completions: 4
  parallelism: 4
  completionMode: Indexed
  template:
    metadata:
      labels:
        app: llm-finetune
        scheduling.k8s.io/pod-group: finetune-group
    spec:
      subdomain: finetune-workers
      setHostnameAsFQDN: true
      containers:
        - name: trainer
          image: registry.example.com/training:v2.0
          command:
            - torchrun
            - --nnodes=4
            - --nproc_per_node=8
            - --node_rank=$(JOB_COMPLETION_INDEX)
            - --rdzv_backend=c10d
            - --rdzv_endpoint=llm-finetune-0.finetune-workers:29400
            - train.py
            - --model_name=meta-llama/Llama-3.1-70B
            - --batch_size=4
            - --gradient_accumulation_steps=8
            - --learning_rate=2e-5
            - --num_epochs=3
            - --output_dir=/checkpoints/run-001
          env:
            - name: JOB_COMPLETION_INDEX
              valueFrom:
                fieldRef:
                  fieldPath: metadata.labels['batch.kubernetes.io/job-completion-index']
            - name: NCCL_DEBUG
              value: "INFO"
            - name: NCCL_SOCKET_IFNAME
              value: "eth0"
            - name: NCCL_IB_DISABLE
              value: "0"
            - name: MASTER_ADDR
              value: "llm-finetune-0.finetune-workers"
            - name: MASTER_PORT
              value: "29400"
          resources:
            limits:
              nvidia.com/gpu: 8
              memory: 512Gi
              rdma/rdma_shared_device_a: 1
            requests:
              nvidia.com/gpu: 8
              memory: 256Gi
          volumeMounts:
            - name: shm
              mountPath: /dev/shm
            - name: checkpoints
              mountPath: /checkpoints
            - name: dataset
              mountPath: /data
      volumes:
        - name: shm
          emptyDir:
            medium: Memory
            sizeLimit: 64Gi
        - name: checkpoints
          persistentVolumeClaim:
            claimName: training-checkpoints
        - name: dataset
          persistentVolumeClaim:
            claimName: training-dataset
      restartPolicy: Never
---
# Headless Service for DNS resolution between workers
apiVersion: v1
kind: Service
metadata:
  name: finetune-workers
  namespace: training
spec:
  clusterIP: None
  selector:
    app: llm-finetune
  ports:
    - port: 29400
      name: rdzv
```

### DeepSpeed ZeRO-3 Multi-Node

```yaml
apiVersion: batch/v1
kind: Job
metadata:
  name: deepspeed-training
  namespace: training
spec:
  completions: 4
  parallelism: 4
  completionMode: Indexed
  template:
    spec:
      subdomain: ds-workers
      containers:
        - name: trainer
          image: registry.example.com/deepspeed-training:v3.0
          command:
            - torchrun
            - --nnodes=4
            - --nproc_per_node=8
            - --node_rank=$(JOB_COMPLETION_INDEX)
            - --rdzv_backend=c10d
            - --rdzv_endpoint=deepspeed-training-0.ds-workers:29400
            - train.py
            - --deepspeed
            - --deepspeed_config=ds_config.json
          resources:
            limits:
              nvidia.com/gpu: 8
          volumeMounts:
            - name: shm
              mountPath: /dev/shm
            - name: config
              mountPath: /app/ds_config.json
              subPath: ds_config.json
      volumes:
        - name: shm
          emptyDir:
            medium: Memory
            sizeLimit: 64Gi
        - name: config
          configMap:
            name: deepspeed-config
      restartPolicy: Never
---
apiVersion: v1
kind: ConfigMap
metadata:
  name: deepspeed-config
  namespace: training
data:
  ds_config.json: |
    {
      "train_batch_size": 128,
      "gradient_accumulation_steps": 4,
      "fp16": {"enabled": true},
      "zero_optimization": {
        "stage": 3,
        "offload_optimizer": {"device": "none"},
        "offload_param": {"device": "none"},
        "overlap_comm": true,
        "contiguous_gradients": true,
        "reduce_bucket_size": 5e8,
        "stage3_prefetch_bucket_size": 5e8,
        "stage3_param_persistence_threshold": 1e6
      },
      "communication_data_type": "fp16",
      "gradient_clipping": 1.0
    }
```

### Kubeflow MPIJob (Horovod/NCCL)

```yaml
apiVersion: kubeflow.org/v2beta1
kind: MPIJob
metadata:
  name: nccl-training
  namespace: training
spec:
  slotsPerWorker: 8
  runPolicy:
    cleanPodPolicy: Running
  mpiReplicaSpecs:
    Launcher:
      replicas: 1
      template:
        spec:
          containers:
            - name: launcher
              image: registry.example.com/horovod-training:v2.0
              command:
                - mpirun
                - --allow-run-as-root
                - -np 32
                - -x NCCL_DEBUG=INFO
                - -x NCCL_SOCKET_IFNAME=eth0
                - -x LD_LIBRARY_PATH
                - --mca btl_tcp_if_include eth0
                - python train.py
                  --epochs 10
                  --batch-size 64
    Worker:
      replicas: 4
      template:
        spec:
          containers:
            - name: worker
              image: registry.example.com/horovod-training:v2.0
              resources:
                limits:
                  nvidia.com/gpu: 8
                  memory: 512Gi
              volumeMounts:
                - name: shm
                  mountPath: /dev/shm
          volumes:
            - name: shm
              emptyDir:
                medium: Memory
                sizeLimit: 64Gi
```

### NCCL Environment Optimization

```yaml
env:
  # Network interface selection
  - name: NCCL_SOCKET_IFNAME
    value: "eth0"                    # Or specific RDMA interface
  
  # InfiniBand/RDMA
  - name: NCCL_IB_DISABLE
    value: "0"                       # 0 = enable IB
  - name: NCCL_IB_HCA
    value: "mlx5"                    # Mellanox HCA device
  - name: NCCL_IB_GID_INDEX
    value: "3"                       # RoCE v2 GID index
  
  # Performance tuning
  - name: NCCL_BUFFSIZE
    value: "8388608"                 # 8MB buffer
  - name: NCCL_NTHREADS
    value: "512"
  - name: NCCL_ALGO
    value: "Ring,Tree"               # Algorithm selection
  
  # Debugging
  - name: NCCL_DEBUG
    value: "WARN"                    # INFO for troubleshooting
  - name: NCCL_DEBUG_SUBSYS
    value: "ALL"
```

### Checkpoint Management

```yaml
# Shared storage for checkpoints (all workers write)
apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: training-checkpoints
  namespace: training
spec:
  accessModes:
    - ReadWriteMany          # Must be RWX for multi-node access
  storageClassName: nfs-csi
  resources:
    requests:
      storage: 2Ti
```

### Monitoring Training Progress

```bash
# Watch GPU utilization across training nodes
kubectl get pods -n training -l app=llm-finetune -o wide

# Check NCCL initialization
kubectl logs -n training llm-finetune-0 | grep "NCCL"
# Expected: "NCCL INFO Connected all ... ranks"

# Monitor GPU memory and compute
kubectl exec -n training llm-finetune-0 -- nvidia-smi

# Check training throughput (tokens/sec or samples/sec from logs)
kubectl logs -n training llm-finetune-0 --tail=20
```

### Scaling Formula

```text
Effective batch size = micro_batch × gradient_accumulation × num_gpus × num_nodes

Example:
  micro_batch = 4
  gradient_accumulation = 8
  num_gpus = 8
  num_nodes = 4
  Effective batch = 4 × 8 × 8 × 4 = 1024

Linear scaling rule: lr_new = lr_base × (effective_batch / base_batch)
```

## Common Issues

### NCCL timeout between nodes
- **Cause**: Firewall blocking ports, wrong interface, or network too slow
- **Fix**: Open ports 29400-29500; set `NCCL_SOCKET_IFNAME`; verify connectivity between all Pod IPs

### Workers not finding each other (rendezvous failure)
- **Cause**: DNS not resolving headless service names
- **Fix**: Ensure `subdomain` matches Service name; use `setHostnameAsFQDN: true`

### Training slower with more nodes (negative scaling)
- **Cause**: Communication overhead exceeds compute benefit (model too small)
- **Fix**: Increase batch size proportionally; use gradient accumulation; ensure RDMA is active

### OOM during backward pass
- **Cause**: Activation memory peak exceeds GPU RAM
- **Fix**: Enable gradient checkpointing; use DeepSpeed ZeRO-3; reduce micro batch size

### Checkpoint corruption with multi-node writes
- **Cause**: Multiple ranks writing simultaneously without coordination
- **Fix**: Only rank 0 saves full checkpoint; use `dist.barrier()` before/after

## Best Practices

1. **Use gang scheduling** — all workers must start together or not at all
2. **Size `/dev/shm` at 32-64Gi** — NCCL uses shared memory extensively
3. **Use RWX storage for checkpoints** — NFS or parallel filesystem (Lustre, GPFS)
4. **Enable RDMA/InfiniBand** — 200+ Gbps vs 25 Gbps Ethernet
5. **Gradient checkpointing** — trades compute for memory (essential for large models)
6. **Monitor NCCL bandwidth** — should see near line-rate for well-configured clusters
7. **Use Indexed Job completion mode** — each Pod gets a unique index for rank assignment

## Key Takeaways

- Multi-node training uses **PyTorch DDP/FSDP** (torchrun) or **DeepSpeed ZeRO** or **Horovod** (MPI)
- `torchrun` with `completionMode: Indexed` is the simplest Kubernetes-native approach
- Headless Service + `subdomain` enables DNS-based worker discovery
- NCCL performance depends on network: **RDMA/InfiniBand >> Ethernet**
- Gang scheduling prevents resource waste from partial scheduling
- Checkpoint to RWX shared storage for fault tolerance
