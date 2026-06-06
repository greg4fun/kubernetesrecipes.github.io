---
title: "Run:ai Training Job Submit Script Pattern"
description: "Production pattern for submitting Run:ai training jobs via shell scripts with GPU fractional allocation, NFS mounts, custom Python environments, and private"
tags:
  - "runai"
  - "training"
  - "gpu"
  - "finetuning"
  - "shell-scripting"
category: "ai"
publishDate: "2026-05-05"
author: "Luca Berton"
difficulty: "intermediate"
relatedRecipes:
  - "runai-fsdp-training-mistral-gpu"
  - "runai-backend-architecture-openshift"
  - "runai-workload-controllers-openshift"
  - "openshift-gpu-node-resource-planning"
---

> 💡 **Quick Answer:** Wrap `runai training standard submit` in a shell script with image pinning (SHA256), GPU fraction requests, NFS shared storage, Python virtual environments, and private PyPI configuration for reproducible fine-tuning job submission.

## The Problem

Submitting Run:ai training jobs manually via CLI is error-prone. You need:

- Reproducible job submission (version-controlled scripts)
- GPU fractional allocation (MIG or time-slicing)
- Shared NFS storage for datasets and checkpoints
- Private container registries with SHA pinning
- Custom Python environments with private PyPI mirrors
- Consistent UID/GID for NFS permission compatibility

## The Solution

### Complete Training Submit Script

```bash
#!/bin/bash

echo "submission job de finetuning"
export MSYS_NO_PATHCONV=1
export MSYS2_ARG_CONV_EXCL="*"

# Clean up previous run (optional)
#runai training standard delete finetune-job

# Pin image by SHA256 for reproducibility
IMAGE="registry.example.com/ml/vscode@sha256:51561bd181fbc8c55859ab6876f79b25af82f57bd5531a5edbf854783a747b45"

runai training standard submit finetune-job-rhel \
  --image $IMAGE \
  --gpu-devices-request 2 \
  --gpu-portion-request 1 \
  --gpu-portion-limit 1 \
  --run-as-uid 2000 \
  --run-as-gid 2000 \
  --working-dir /data/scripts/archive/gen-bench-main/llm/finetune-peft \
  --environment-variable CUDA_HOME=/shared/cuda-13.0 \
  --environment-variable VIRTUAL_ENV=/data/scripts/archive/gen-bench-main/llm/finetune-peft/.venv \
  --environment-variable UV_CACHE_DIR=/data/output/.cache/uv \
  --environment-variable UV_CONFIG_FILE=/data/scripts/archive/gen-bench-main/config/uv.toml \
  --nfs path=/ifs/S1000575/platform/shared,server=nfs-platform.sto.example.com,mountpath=/shared,readwrite \
  --environment-variable CUDA_VISIBLE_DEVICES=0 \
  --environment-variable PIP_INDEX=https://artifactory.example.com/api/pypi/pypi-virtual/pypi \
  --environment-variable PIP_INDEX_URL=https://artifactory.example.com/api/pypi/pypi-virtual/simple \
  --environment-variable PIP_TRUSTED_HOST=artifactory.example.com \
  --existing-pvc claimname=project-001,path=/data \
  --command -- uv run python finetune_mistral.py --config config/devstral_123b_1xH200.yaml

# Useful commands after submission:
#runai training standard exec finetune-job --pod finetune-job-0-0 -- nvidia-smi
#runai training standard describe finetune-job
```

### Script Breakdown

#### GPU Fractional Allocation

```bash
--gpu-devices-request 2 \    # Request 2 physical GPU devices
--gpu-portion-request 1 \    # Request 100% of each GPU (1.0 = full GPU)
--gpu-portion-limit 1 \      # Limit to 100% (no overcommit)
```

```text
GPU allocation modes:
├── --gpu-devices-request N    → Number of physical GPUs
├── --gpu-portion-request 0.5  → 50% of each GPU (MIG or time-slicing)
├── --gpu-portion-limit 1      → Hard cap (prevents burst above allocation)
└── --gpu-memory-request 20Gi  → Request by VRAM instead of portion
```

#### UID/GID for NFS Compatibility

```bash
--run-as-uid 2000 \    # Match NFS export squash UID
--run-as-gid 2000 \    # Match NFS export squash GID
```

This ensures files created in NFS shares have correct ownership, avoiding permission denied errors when multiple users share storage.

#### NFS Mount (Shared Storage)

```bash
--nfs path=/ifs/S1000575/platform/shared,\
      server=nfs-platform.sto.example.com,\
      mountpath=/shared,\
      readwrite
```

```text
NFS mount options in Run:ai:
├── path       → Export path on NFS server
├── server     → NFS server hostname/IP
├── mountpath  → Mount point inside container
└── readwrite  → Access mode (readwrite | readonly)
```

#### Existing PVC (Dataset Storage)

```bash
--existing-pvc claimname=project-001,path=/data
```

Pre-provisioned PVC containing datasets and output directories. Persists across job restarts.

#### Python Environment (uv + Private PyPI)

```bash
--environment-variable VIRTUAL_ENV=/data/.../finetune-peft/.venv \
--environment-variable UV_CACHE_DIR=/data/output/.cache/uv \
--environment-variable UV_CONFIG_FILE=/data/.../config/uv.toml \
--environment-variable PIP_INDEX=https://artifactory.example.com/.../pypi \
--environment-variable PIP_INDEX_URL=https://artifactory.example.com/.../simple \
--environment-variable PIP_TRUSTED_HOST=artifactory.example.com \
```

Using `uv` (fast Python package manager) with:
- Shared virtual environment on persistent storage (no reinstall per job)
- Private Artifactory PyPI mirror (air-gapped environments)
- Cache directory on persistent volume (speeds up subsequent runs)

#### Image Pinning by SHA256

```bash
IMAGE="registry.example.com/ml/vscode@sha256:51561bd181..."
```

Never use `:latest` in production training. SHA pinning ensures:
- Exact same image across all runs
- No surprise dependency changes mid-experiment
- Audit trail of which image produced which results

### Training Config File Pattern

```yaml
# config/devstral_123b_1xH200.yaml
model:
  name: mistral-small-instruct
  size: 123b
  dtype: bfloat16

training:
  strategy: fsdp
  sharding: full_shard
  batch_size_per_device: 1
  gradient_accumulation_steps: 8
  num_epochs: 3
  learning_rate: 2.0e-5
  warmup_steps: 100

hardware:
  gpus: 1
  gpu_type: H200
  precision: bf16

data:
  dataset_path: /data/datasets/instruction-tuning
  max_seq_length: 4096
  
output:
  checkpoint_dir: /data/output/checkpoints
  save_steps: 500
  logging_steps: 10
```

### Management Commands

```bash
# Check job status
runai training standard describe finetune-job

# Exec into running Pod
runai training standard exec finetune-job \
  --pod finetune-job-0-0 -- nvidia-smi

# Stream logs
runai training standard logs finetune-job -f

# Delete job
runai training standard delete finetune-job

# List all training jobs in project
runai training standard list
```

## Common Issues

### Permission denied on NFS mount
- **Cause**: Container UID doesn't match NFS export `anonuid`
- **Fix**: Set `--run-as-uid` and `--run-as-gid` to match NFS server config

### CUDA_HOME not found
- **Cause**: CUDA toolkit on shared NFS not in expected path
- **Fix**: Verify NFS mount succeeded; check path with `ls /shared/cuda-13.0`

### uv fails to install packages
- **Cause**: Private PyPI mirror unreachable from GPU node
- **Fix**: Verify network policy allows egress to Artifactory; check `PIP_TRUSTED_HOST`

### GPU portion request denied
- **Cause**: Requested GPU fraction not available (MIG not configured for that slice)
- **Fix**: Check available GPU fractions with `runai list nodes`; adjust portion request

## Best Practices

1. **Pin images by SHA256** — never `:latest` for training reproducibility
2. **Version-control submit scripts** — treat them as code in GitLab
3. **Use NFS for shared CUDA/datasets** — avoid downloading per job
4. **Set UID/GID explicitly** — NFS permission errors are the #1 time waste
5. **`uv` over `pip`** — 10-100x faster package resolution
6. **Config files over CLI args** — easier to track experiments
7. **Separate existing-pvc for data** — survives job deletion; shared across experiments

## Key Takeaways

- Shell scripts wrap `runai training standard submit` for reproducibility
- GPU fraction allocation: `--gpu-devices-request` × `--gpu-portion-request`
- NFS mounts provide shared CUDA toolkit, datasets, and model weights
- Private PyPI (Artifactory) enables air-gapped package installation
- `uv run python` executes within the persistent virtual environment
- UID/GID alignment critical for NFS permission compatibility
- SHA256 image pinning ensures experiment reproducibility
- Config YAML files (e.g., `devstral_123b_1xH200.yaml`) parametrize training runs
