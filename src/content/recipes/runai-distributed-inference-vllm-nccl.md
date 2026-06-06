---
title: "Run:ai Distributed Inference with vLLM and NCCL"
description: "Deploy distributed LLM inference on Run:ai with vLLM tensor parallelism across multiple workers. Covers multi-node GPU splitting, NCCL configuration, PVC model"
tags:
  - "runai"
  - "vllm"
  - "nccl"
  - "distributed-inference"
  - "tensor-parallelism"
category: "ai"
publishDate: "2026-05-08"
author: "Luca Berton"
difficulty: "advanced"
relatedRecipes:
  - "nccl-pxn-cross-nic-nvlink-topology"
  - "dual-fabric-mellanox-gpu-storage-ethernet-infiniband"
  - "nim-multinode-deployment-helm-kubernetes"
  - "iommu-bios-kernel-nccl-gpu-direct"
---

> 💡 **Quick Answer:** Run:ai's `inference distributed submit` deploys vLLM across multiple GPU workers with tensor parallelism. For a 119B parameter model needing 4 GPUs total: use 2 workers × 2 GPUs each with `--tensor-parallel-size 2`. NCCL handles inter-GPU communication — disable InfiniBand (`NCCL_IB_DISABLE=1`) when using Ethernet-only clusters.

## The Problem

Large language models (100B+ parameters) don't fit on a single GPU:

- Mistral-Small-4 119B needs ~240GB VRAM in float16 (3-4× A100 80GB)
- Must split model across GPUs using tensor parallelism
- Multi-node inference needs NCCL for inter-worker communication
- Run:ai manages GPU scheduling, but distributed inference needs specific config
- Security requirements: non-root, specific UID/GID, preemptible workloads

## The Solution

### Run:ai Distributed Inference Command

```bash
runai inference distributed submit my-llm-inference \
  -p my-project \
  -i registry.example.com/vllm-openai:latest \
  --existing-pvc claimname=my-project-models,path=/data \
  --workers 2 \
  -g 2 \
  --serving-port container=8000,authorization-type=authenticatedUsers \
  --environment-variable NCCL_IB_DISABLE=1 \
  --environment-variable NCCL_P2P_DISABLE=0 \
  --run-as-uid 2000 \
  --run-as-gid 2000 \
  --run-as-non-root \
  --preemptibility preemptible \
  -- \
  --model /data/input/Models/Mistral-Small-4-119B-2603 \
  --served-model-name mistral4 \
  --tensor-parallel-size 2 \
  --port 8000
```

### Breaking Down Each Flag

```text
Run:ai Flags:
──────────────────────────────────────────────────────────────────
Flag                              Purpose
──────────────────────────────────────────────────────────────────
inference distributed submit      Distributed inference workload type
my-llm-inference                  Workload name
-p my-project                     Run:ai project (quota + namespace)
-i registry.example.com/...       vLLM container image
--existing-pvc ...                Mount PVC with model weights
--workers 2                       2 worker Pods (1 head + 1 worker)
-g 2                              2 GPUs per worker (4 total)
--serving-port container=8000     Expose inference endpoint
--environment-variable ...        NCCL tuning
--run-as-uid 2000                 Non-root UID
--run-as-gid 2000                 Non-root GID
--run-as-non-root                 Security: forbid root
--preemptibility preemptible      Can be evicted for higher-priority jobs

vLLM Flags (after --):
──────────────────────────────────────────────────────────────────
--model /data/input/Models/...    Path to model weights on PVC
--served-model-name mistral4      API model name for OpenAI-compatible endpoint
--tensor-parallel-size 2          Split model across 2 GPUs per worker
--port 8000                       vLLM HTTP server port
```

### GPU Topology for This Deployment

```text
Total: 2 workers × 2 GPUs = 4 GPUs
──────────────────────────────────────────────────────────────────

Worker 0 (Head):                 Worker 1:
┌──────────────────────┐        ┌──────────────────────┐
│  GPU 0   GPU 1       │        │  GPU 0   GPU 1       │
│  ├────────┤           │        │  ├────────┤           │
│  │ TP rank 0, 1 │     │        │  │ TP rank 0, 1 │     │
│  │ (tensor parallel)│ │        │  │ (tensor parallel)│ │
│  └────────────────┘   │        │  └────────────────┘   │
│  vLLM engine          │        │  vLLM engine          │
│  Port 8000 (API)      │        │                       │
└──────────┬─────────────┘        └──────────┬─────────────┘
           │          NCCL (Ethernet)         │
           └──────────────────────────────────┘

Model split: 119B params / 2 TP = ~60B per GPU
VRAM per GPU: ~120GB (float16) → fits on 2× A100 80GB with KV cache
```

### NCCL Configuration Explained

```bash
# NCCL_IB_DISABLE=1
# Disable InfiniBand transport — use Ethernet (TCP) for NCCL
# Use when:
#   - Cluster has no InfiniBand fabric
#   - Only Ethernet available between workers
#   - SR-IOV/RDMA not configured

# NCCL_P2P_DISABLE=0
# Enable GPU-to-GPU peer-to-peer within each worker
# P2P via NVLink/PCIe between the 2 GPUs in each worker
# Only disabling IB for inter-node, keeping P2P for intra-node
```

```text
NCCL Transport Selection for This Setup:
──────────────────────────────────────────────────────────────────
Path                      Transport        Performance
──────────────────────────────────────────────────────────────────
GPU0 ↔ GPU1 (same worker) NVLink/PCIe P2P  Best (~600 GB/s NVLink)
Worker0 ↔ Worker1         TCP/Ethernet     Good enough for inference
                                            (~10-25 Gb/s)

For training: IB/RDMA would be critical (all-reduce heavy)
For inference: Ethernet is often sufficient (less cross-node traffic)
```

### Equivalent Kubernetes Manifests

```yaml
# What Run:ai creates under the hood:

# Head worker (rank 0)
apiVersion: apps/v1
kind: Deployment
metadata:
  name: my-llm-inference-head
  namespace: runai-my-project
spec:
  replicas: 1
  template:
    metadata:
      labels:
        run.ai/workload: my-llm-inference
        run.ai/role: head
    spec:
      securityContext:
        runAsUser: 2000
        runAsGroup: 2000
        runAsNonRoot: true
      containers:
        - name: vllm
          image: registry.example.com/vllm-openai:latest
          command:
            - python3
            - -m
            - vllm.entrypoints.openai.api_server
          args:
            - --model
            - /data/input/Models/Mistral-Small-4-119B-2603
            - --served-model-name
            - mistral4
            - --tensor-parallel-size
            - "2"
            - --port
            - "8000"
          env:
            - name: NCCL_IB_DISABLE
              value: "1"
            - name: NCCL_P2P_DISABLE
              value: "0"
          ports:
            - containerPort: 8000
          resources:
            limits:
              nvidia.com/gpu: "2"
          volumeMounts:
            - name: model-data
              mountPath: /data
      volumes:
        - name: model-data
          persistentVolumeClaim:
            claimName: my-project-models
---
# Worker (rank 1+)
apiVersion: apps/v1
kind: Deployment
metadata:
  name: my-llm-inference-worker-0
  namespace: runai-my-project
spec:
  replicas: 1
  template:
    spec:
      securityContext:
        runAsUser: 2000
        runAsGroup: 2000
        runAsNonRoot: true
      containers:
        - name: vllm-worker
          image: registry.example.com/vllm-openai:latest
          env:
            - name: NCCL_IB_DISABLE
              value: "1"
            - name: NCCL_P2P_DISABLE
              value: "0"
          resources:
            limits:
              nvidia.com/gpu: "2"
          volumeMounts:
            - name: model-data
              mountPath: /data
      volumes:
        - name: model-data
          persistentVolumeClaim:
            claimName: my-project-models
```

### PVC for Model Weights

```yaml
# Model PVC — must be ReadWriteMany for multi-node
apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: my-project-models
  namespace: runai-my-project
spec:
  accessModes:
    - ReadWriteMany          # Required for multi-worker access
  resources:
    requests:
      storage: 500Gi         # 119B model ≈ 240GB in float16
  storageClassName: nfs       # NFS, Lustre, or GPFS for RWX
```

### Scaling Options

```bash
# Scale up: more workers for pipeline parallelism
runai inference distributed submit my-llm-large \
  -p my-project \
  -i registry.example.com/vllm-openai:latest \
  --existing-pvc claimname=my-project-models,path=/data \
  --workers 4 \
  -g 4 \
  -- \
  --model /data/input/Models/Large-405B \
  --tensor-parallel-size 4 \
  --pipeline-parallel-size 4 \
  --port 8000
# Total: 4 workers × 4 GPUs = 16 GPUs
# TP=4 (split layers across 4 GPUs per node)
# PP=4 (pipeline across 4 nodes)

# Scale down: single worker for smaller models
runai inference submit my-llm-small \
  -p my-project \
  -i registry.example.com/vllm-openai:latest \
  --existing-pvc claimname=my-project-models,path=/data \
  -g 2 \
  -- \
  --model /data/input/Models/Small-7B \
  --tensor-parallel-size 2 \
  --port 8000
```

### Enable InfiniBand (When Available)

```bash
# When SR-IOV RDMA is configured, enable IB for better performance:
runai inference distributed submit my-llm-ib \
  -p my-project \
  -i registry.example.com/vllm-openai:latest \
  --existing-pvc claimname=my-project-models,path=/data \
  --workers 2 \
  -g 2 \
  --environment-variable NCCL_IB_DISABLE=0 \
  --environment-variable NCCL_IB_HCA=mlx5_0 \
  --environment-variable NCCL_NET_GDR_LEVEL=5 \
  --environment-variable NCCL_P2P_DISABLE=0 \
  -- \
  --model /data/input/Models/Mistral-Small-4-119B-2603 \
  --served-model-name mistral4 \
  --tensor-parallel-size 2 \
  --port 8000
```

### Monitor the Deployment

```bash
# Check workload status
runai describe job my-llm-inference -p my-project

# Check worker Pods
kubectl get pods -n runai-my-project -l run.ai/workload=my-llm-inference

# Check vLLM logs (head worker)
kubectl logs -n runai-my-project -l run.ai/role=head -f

# Look for:
# "INFO: Started server process [pid]"
# "INFO: Application startup complete."
# "INFO: Uvicorn running on http://0.0.0.0:8000"

# Test inference endpoint
curl -X POST http://my-llm-inference:8000/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "mistral4",
    "messages": [{"role": "user", "content": "Hello"}],
    "max_tokens": 100
  }'

# Check GPU utilization across workers
runai exec my-llm-inference -- nvidia-smi
```

### Security: Non-Root Execution

```text
Security Configuration:
──────────────────────────────────────────────────────────────────
--run-as-uid 2000         Container runs as UID 2000 (not root)
--run-as-gid 2000         Container runs as GID 2000
--run-as-non-root         Kubernetes enforces non-root

Requirements:
  • Model files on PVC must be readable by UID 2000
  • vLLM image must support non-root (no bind to port < 1024)
  • /tmp and cache dirs must be writable (or use emptyDir)

Common fix for permission issues:
  chown -R 2000:2000 /data/input/Models/
  # Or set group-readable:
  chmod -R g+r /data/input/Models/
```

### Preemptibility

```text
--preemptibility preemptible
──────────────────────────────────────────────────────────────────
  • Run:ai can evict this workload for higher-priority jobs
  • Inference resumes when GPUs become available
  • Use for dev/staging inference endpoints
  • Production inference: use --preemptibility non-preemptible

Priority order in Run:ai:
  1. Non-preemptible training
  2. Non-preemptible inference
  3. Preemptible training
  4. Preemptible inference  ← this workload
```

## Common Issues

### NCCL timeout between workers
- **Cause**: Workers can't reach each other on NCCL port; network policy blocking
- **Fix**: Ensure Pods can communicate on all ports; check `NCCL_SOCKET_IFNAME`

### Model loading OOM
- **Cause**: 119B model too large for available VRAM with current TP size
- **Fix**: Increase `--tensor-parallel-size` or add `--workers`; check `--max-model-len`

### Permission denied on model files
- **Cause**: PVC files owned by root; container runs as UID 2000
- **Fix**: `chown -R 2000:2000 /data/input/Models/` on the PVC

### Preempted during inference
- **Cause**: Higher-priority job needs GPUs; this workload is preemptible
- **Fix**: Use `--preemptibility non-preemptible` for production endpoints

### Workers start but can't find head
- **Cause**: Head Pod DNS not resolvable; Ray/vLLM cluster init failed
- **Fix**: Check Run:ai creates headless Service; verify head Pod is Running first

## Best Practices

1. **TP size = GPUs per worker** — tensor parallelism within a node (NVLink fast)
2. **PP size = number of workers** — pipeline parallelism across nodes (network)
3. **Disable IB only when unavailable** — InfiniBand is 10x faster than Ethernet for NCCL
4. **RWX PVC for multi-worker** — all workers need to read model weights
5. **Non-root always** — security best practice; fix file permissions on PVC
6. **Preemptible for dev** — save GPU quota; non-preemptible for production
7. **Start with Ethernet** — enable IB/RDMA after validating the setup works

## Key Takeaways

- `runai inference distributed submit` manages multi-worker vLLM with tensor parallelism
- 2 workers × 2 GPUs = 4 GPUs total; TP=2 splits model across GPUs within each worker
- `NCCL_IB_DISABLE=1` uses Ethernet for inter-node (sufficient for inference)
- `NCCL_P2P_DISABLE=0` keeps NVLink P2P for intra-node GPU communication
- PVC must be ReadWriteMany (NFS/Lustre) for multi-worker model access
- Non-root execution (UID/GID 2000) requires model files readable by that UID
- Preemptible workloads yield GPUs to higher priority — use for staging
- When SR-IOV RDMA is ready, switch to `NCCL_IB_DISABLE=0` + `NCCL_IB_HCA=mlx5_0`
