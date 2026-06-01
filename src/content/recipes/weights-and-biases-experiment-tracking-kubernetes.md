---
title: "Weights and Biases Experiment Tracking on Kubernetes"
description: "Deploy Weights & Biases (W&B) on Kubernetes for ML experiment tracking, model registry, and hyperparameter sweeps. Self-hosted W&B Server, agent-based sweeps, artifact management, and integration with distributed training jobs."
tags:
  - "wandb"
  - "mlops"
  - "experiment-tracking"
  - "model-registry"
  - "distributed-training"
category: "ai"
publishDate: "2026-05-31"
author: "Luca Berton"
difficulty: "intermediate"
relatedRecipes:
  - "mlflow-kubernetes-model-registry"
  - "kubeflow-pipelines-kubernetes"
  - "kubernetes-gpu-distributed-training"
  - "nccl-rccl-networking-performance-kubernetes"
---

> 💡 **Quick Answer:** Weights & Biases (W&B) provides experiment tracking, model registry, hyperparameter sweeps, and dataset versioning for ML workloads on Kubernetes. Use the SaaS (wandb.ai) or deploy the self-hosted W&B Server via Helm. Integrate by adding `WANDB_API_KEY` as a Secret and calling `wandb.init()` in training code — all metrics, configs, and artifacts are automatically logged.

## The Problem

- Distributed training jobs across multiple GPU nodes produce metrics that are hard to aggregate
- No single source of truth for model versions, hyperparameters, and training results
- Hyperparameter sweeps require orchestration across many parallel jobs
- Model artifacts scattered across PVCs with no lineage tracking
- Comparing experiments across different runs/configs requires manual spreadsheet tracking
- Self-hosted requirement for air-gapped or regulated environments

## The Solution

### W&B Architecture on Kubernetes

```text
┌─────────────────────────────────────────────────────────────────┐
│ Training Pods (GPU nodes)                                        │
│ ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐               │
│ │ Worker 0 │ │ Worker 1 │ │ Worker 2 │ │ Worker 3 │              │
│ │ wandb.log│ │ wandb.log│ │ wandb.log│ │ wandb.log│              │
│ └────┬─────┘ └────┬─────┘ └────┬─────┘ └────┬─────┘             │
│      └─────────────┴─────────────┴─────────────┘                 │
│                         │ HTTPS                                   │
│                         ▼                                         │
│ ┌───────────────────────────────────────────────────────────┐    │
│ │ W&B Server (self-hosted) or wandb.ai (SaaS)               │    │
│ │ • Experiment tracking    • Model registry                  │    │
│ │ • Hyperparameter sweeps  • Artifact storage                │    │
│ │ • Reports & dashboards   • Team collaboration              │    │
│ └───────────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────────┘
```

### Deploy Self-Hosted W&B Server

```bash
# Add W&B Helm repo
helm repo add wandb https://charts.wandb.ai
helm repo update

# Create namespace
kubectl create namespace wandb
```

```yaml
# wandb-values.yaml
global:
  host: "https://wandb.example.com"
  license: "your-wandb-license-key"

  # Storage backend for artifacts
  bucket:
    provider: "s3"    # s3 | gcs | azure
    name: "wandb-artifacts"
    region: "us-east-1"
    # For MinIO (on-prem S3-compatible):
    # endpoint: "http://minio.storage.svc:9000"

  # Database
  mysql:
    host: "mysql.database.svc"
    port: 3306
    database: "wandb"
    user: "wandb"
    password: ""       # Use existingSecret instead
    existingSecret: "wandb-mysql-credentials"
    existingSecretKey: "password"

# W&B application
app:
  replicas: 2
  resources:
    requests:
      cpu: "2"
      memory: "4Gi"
    limits:
      cpu: "4"
      memory: "8Gi"

# Redis for caching
redis:
  enabled: true
  architecture: standalone
  auth:
    enabled: true
    existingSecret: "wandb-redis-credentials"

# Ingress
ingress:
  enabled: true
  className: "nginx"
  annotations:
    cert-manager.io/cluster-issuer: "letsencrypt-prod"
    nginx.ingress.kubernetes.io/proxy-body-size: "10g"
  hosts:
    - host: wandb.example.com
      paths:
        - path: /
          pathType: Prefix
  tls:
    - secretName: wandb-tls
      hosts:
        - wandb.example.com
```

```bash
# Install W&B Server
helm install wandb wandb/wandb \
  --namespace wandb \
  --values wandb-values.yaml \
  --wait --timeout 600s

# Verify
kubectl get pods -n wandb
# NAME                          READY   STATUS    RESTARTS   AGE
# wandb-app-5f8b9c7d4-xxxxx    1/1     Running   0          2m
# wandb-app-5f8b9c7d4-yyyyy    1/1     Running   0          2m
# wandb-redis-master-0          1/1     Running   0          2m
```

### Configure W&B API Key Secret

```yaml
# Store API key as Kubernetes Secret
apiVersion: v1
kind: Secret
metadata:
  name: wandb-api-key
  namespace: training
type: Opaque
stringData:
  WANDB_API_KEY: "your-api-key-from-wandb-settings"
```

### Integrate with Training Jobs

```yaml
apiVersion: batch/v1
kind: Job
metadata:
  name: train-llm-experiment
  namespace: training
spec:
  template:
    spec:
      containers:
        - name: trainer
          image: registry.example.com/ml/trainer:v2.0
          command:
            - python3
            - train.py
            - --epochs=100
            - --batch-size=64
            - --learning-rate=3e-4
          env:
            - name: WANDB_API_KEY
              valueFrom:
                secretKeyRef:
                  name: wandb-api-key
                  key: WANDB_API_KEY
            - name: WANDB_PROJECT
              value: "llm-training"
            - name: WANDB_ENTITY
              value: "ml-team"
            - name: WANDB_RUN_GROUP
              value: "experiment-v2"
            # For self-hosted:
            - name: WANDB_BASE_URL
              value: "https://wandb.example.com"
            # Offline mode (air-gapped, sync later):
            # - name: WANDB_MODE
            #   value: "offline"
          resources:
            limits:
              nvidia.com/gpu: "8"
          volumeMounts:
            - name: shm
              mountPath: /dev/shm
            - name: data
              mountPath: /data
      volumes:
        - name: shm
          emptyDir:
            medium: Memory
            sizeLimit: 32Gi
        - name: data
          persistentVolumeClaim:
            claimName: training-data
      restartPolicy: Never
```

### Training Script with W&B

```python
# train.py — W&B integration example
import wandb
import torch
import torch.distributed as dist
from torch.nn.parallel import DistributedDataParallel as DDP

def main():
    # Initialize distributed training
    dist.init_process_group("nccl")
    rank = dist.get_rank()
    world_size = dist.get_world_size()

    # Only rank 0 logs to W&B (avoid duplicate runs)
    if rank == 0:
        wandb.init(
            project="llm-training",
            config={
                "model": "llama-7b",
                "epochs": 100,
                "batch_size": 64 * world_size,  # effective batch size
                "learning_rate": 3e-4,
                "world_size": world_size,
                "gpu_type": torch.cuda.get_device_name(0),
            },
            tags=["distributed", "h100", "nccl"],
        )

    model = build_model().cuda()
    model = DDP(model)

    for epoch in range(100):
        loss, accuracy = train_epoch(model, dataloader)

        if rank == 0:
            wandb.log({
                "epoch": epoch,
                "train/loss": loss,
                "train/accuracy": accuracy,
                "train/learning_rate": scheduler.get_last_lr()[0],
                "system/gpu_memory_allocated": torch.cuda.memory_allocated() / 1e9,
                "system/gpu_utilization": get_gpu_utilization(),
                "throughput/samples_per_sec": samples_per_sec,
                "throughput/tokens_per_sec": tokens_per_sec,
            })

        # Validation
        if epoch % 10 == 0 and rank == 0:
            val_loss, val_acc = validate(model, val_loader)
            wandb.log({
                "val/loss": val_loss,
                "val/accuracy": val_acc,
            })

    # Save model artifact
    if rank == 0:
        artifact = wandb.Artifact("llama-7b-finetuned", type="model")
        artifact.add_file("checkpoint.pt")
        wandb.log_artifact(artifact)
        wandb.finish()

if __name__ == "__main__":
    main()
```

### Hyperparameter Sweeps on Kubernetes

```yaml
# sweep-config.yaml (W&B sweep definition)
program: train.py
method: bayes      # bayes | random | grid
metric:
  name: val/loss
  goal: minimize
parameters:
  learning_rate:
    distribution: log_uniform_values
    min: 1e-5
    max: 1e-3
  batch_size:
    values: [16, 32, 64, 128]
  weight_decay:
    distribution: uniform
    min: 0.0
    max: 0.3
  warmup_steps:
    values: [100, 500, 1000, 2000]
  optimizer:
    values: ["adam", "adamw", "sgd"]
early_terminate:
  type: hyperband
  min_iter: 10
  eta: 3
```

```yaml
# Sweep agent as Kubernetes Job
apiVersion: batch/v1
kind: Job
metadata:
  name: wandb-sweep-agent
  namespace: training
spec:
  parallelism: 4          # Run 4 sweep agents in parallel
  completions: 20         # Total 20 sweep runs
  template:
    spec:
      containers:
        - name: sweep-agent
          image: registry.example.com/ml/trainer:v2.0
          command:
            - wandb
            - agent
            - "ml-team/llm-training/sweep-id-here"
          env:
            - name: WANDB_API_KEY
              valueFrom:
                secretKeyRef:
                  name: wandb-api-key
                  key: WANDB_API_KEY
            - name: WANDB_BASE_URL
              value: "https://wandb.example.com"
          resources:
            limits:
              nvidia.com/gpu: "1"
      restartPolicy: Never
  backoffLimit: 4
```

```bash
# Create sweep and get ID
wandb sweep sweep-config.yaml
# wandb: Creating sweep from: sweep-config.yaml
# wandb: Created sweep with ID: abc123de
# wandb: View sweep at: https://wandb.example.com/ml-team/llm-training/sweeps/abc123de

# Launch agents (or use the Job above)
wandb agent ml-team/llm-training/abc123de
```

### Model Registry and Promotion

```python
# Register best model to W&B Model Registry
import wandb

# Link artifact to registry
run = wandb.init(project="llm-training")
artifact = run.use_artifact("llama-7b-finetuned:latest")

# Promote to production
artifact.link("model-registry/llama-7b", aliases=["production", "v2.1"])

# Download model in inference service
run = wandb.init(project="llm-inference")
artifact = run.use_artifact("model-registry/llama-7b:production")
artifact_dir = artifact.download("/models/llama-7b")
```

```yaml
# Inference deployment pulling model from W&B registry
apiVersion: apps/v1
kind: Deployment
metadata:
  name: llm-inference
  namespace: serving
spec:
  replicas: 2
  selector:
    matchLabels:
      app: llm-inference
  template:
    spec:
      initContainers:
        - name: model-download
          image: python:3.11-slim
          command:
            - bash
            - -c
            - |
              pip install wandb
              python3 -c "
              import wandb
              run = wandb.init(project='llm-inference', job_type='serving')
              artifact = run.use_artifact('model-registry/llama-7b:production')
              artifact.download('/models/llama-7b')
              wandb.finish()
              "
          env:
            - name: WANDB_API_KEY
              valueFrom:
                secretKeyRef:
                  name: wandb-api-key
                  key: WANDB_API_KEY
          volumeMounts:
            - name: models
              mountPath: /models
      containers:
        - name: vllm
          image: vllm/vllm-openai:v0.8.0
          args:
            - "--model=/models/llama-7b"
            - "--port=8000"
          volumeMounts:
            - name: models
              mountPath: /models
          resources:
            limits:
              nvidia.com/gpu: "1"
      volumes:
        - name: models
          emptyDir:
            sizeLimit: 50Gi
```

### Offline Mode (Air-Gapped Clusters)

```yaml
# For disconnected environments: log locally, sync later
env:
  - name: WANDB_MODE
    value: "offline"
  - name: WANDB_DIR
    value: "/output/wandb"
```

```bash
# After job completes, sync from PVC or copied data
wandb sync /output/wandb/offline-run-*

# Or batch sync all offline runs
find /output/wandb -name "offline-run-*" -exec wandb sync {} \;
```

### W&B Alerts and Automation

```python
# Set up alerts for training anomalies
wandb.alert(
    title="Training Loss Spike",
    text=f"Loss jumped to {loss:.4f} at epoch {epoch}",
    level=wandb.AlertLevel.WARN,
)

# Programmatic sweep early stopping
if val_loss > best_loss * 1.5:
    wandb.alert(
        title="Early Stopping Triggered",
        text=f"Validation loss {val_loss:.4f} exceeds threshold",
        level=wandb.AlertLevel.INFO,
    )
    wandb.finish()
    sys.exit(0)
```

## Common Issues

### Runs not appearing in W&B dashboard
- **Cause**: `WANDB_API_KEY` not set or invalid; or `WANDB_BASE_URL` wrong for self-hosted
- **Fix**: Verify Secret is mounted; test with `wandb login --verify` in pod

### Duplicate runs from distributed training
- **Cause**: All ranks calling `wandb.init()` independently
- **Fix**: Only rank 0 should initialize W&B; other ranks skip logging

### Large artifact upload failures (OOM or timeout)
- **Cause**: Uploading multi-GB model checkpoints exceeds pod memory or ingress timeout
- **Fix**: Increase `proxy-body-size` annotation on ingress; use `wandb.save()` for streaming upload

### Sweep agents crashing after GPU OOM
- **Cause**: Sweep tried batch_size too large for available VRAM
- **Fix**: Add try/except around training; report failed run to W&B; use `early_terminate` in sweep config

### Self-hosted W&B slow with many concurrent writers
- **Cause**: MySQL or artifact storage bottleneck
- **Fix**: Scale app replicas; use managed MySQL (RDS/CloudSQL); use S3/GCS with high IOPS

## Best Practices

1. **Only rank 0 logs** — avoids N duplicate runs in distributed training
2. **Log system metrics** — GPU utilization, memory, throughput alongside training metrics
3. **Use artifacts for model lineage** — track which data + code + config produced each model
4. **Tag runs meaningfully** — enables filtering in dashboard (gpu_type, experiment_phase)
5. **Set `WANDB_RUN_GROUP`** — groups related runs (e.g., all workers in one distributed job)
6. **Use sweeps for HPO** — Bayesian optimization converges faster than grid search
7. **Store credentials in Secrets** — never embed API keys in container images
8. **Enable offline mode for air-gapped** — sync runs when connectivity is available
9. **Size artifact storage generously** — model checkpoints add up fast (100+ GB per project)
10. **Set up alerts** — catch loss spikes, NaN gradients, and OOM early

## Key Takeaways

- W&B provides experiment tracking, model registry, sweeps, and artifacts for ML on Kubernetes
- Self-hosted via Helm chart (MySQL + S3/GCS + Redis); or use wandb.ai SaaS
- Integration is 3 lines: Secret with API key + `wandb.init()` + `wandb.log()`
- Distributed training: only rank 0 logs to avoid N duplicate runs
- Hyperparameter sweeps: Bayesian optimization with parallel agents as Kubernetes Jobs
- Model Registry: promote artifacts through staging → production with aliases
- Offline mode for air-gapped: log locally to PVC, `wandb sync` when connected
- Artifact storage: S3/GCS/MinIO backend for multi-GB model checkpoints
- Alerts: programmatic notifications for training anomalies (loss spikes, early stopping)
