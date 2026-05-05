---
title: "Deep Learning with Large Datasets on K8s"
description: "Optimize deep learning training with large datasets on Kubernetes. Covers data loading, caching strategies, parallel prefetch, and storage architecture for multi-TB datasets."
tags:
  - "training"
  - "datasets"
  - "storage"
  - "performance"
  - "pytorch"
category: "ai"
publishDate: "2026-05-05"
author: "Luca Berton"
difficulty: "advanced"
relatedRecipes:
  - "fio-pscale-nfs-smb-benchmark-kubernetes"
  - "multi-node-training-kubernetes"
  - "fsdp-lora-finetuning-kubernetes"
  - "nvidia-gds-benchmark-kubernetes"
---

> 💡 **Quick Answer:** For multi-TB datasets (Open Images, ImageNet, LAION), use parallel DataLoader workers, NFS/object storage with local SSD caching, and PyTorch IterableDataset with prefetching. The goal: GPU never waits for data.

## The Problem

- **Open Images V7**: ~1.9M images, ~500GB raw
- **LAION-5B**: 5 billion image-text pairs, multi-TB
- **Custom enterprise datasets**: Often 1-10TB

Loading these during training faces:
- Network bandwidth limitations from shared NFS
- Random access patterns kill HDD-based storage
- Single DataLoader thread can't saturate GPU
- Checkpoint writing competes with data reading

## The Solution

### Optimized DataLoader Configuration

```python
from torch.utils.data import DataLoader, DistributedSampler
import torch.multiprocessing as mp

# Set start method for CUDA compatibility
mp.set_start_method('spawn', force=True)

train_loader = DataLoader(
    dataset,
    batch_size=16,
    shuffle=False,                    # DistributedSampler handles this
    sampler=DistributedSampler(dataset),
    num_workers=8,                    # Match CPU cores available
    pin_memory=True,                  # Speeds up CPU→GPU transfer
    prefetch_factor=4,                # Prefetch 4 batches per worker
    persistent_workers=True,          # Don't respawn workers each epoch
    drop_last=True,                   # Avoid uneven batch sizes in DDP
)
```

### Kubernetes Job with Optimal Resources

```yaml
apiVersion: batch/v1
kind: Job
metadata:
  name: train-large-dataset
  namespace: training
spec:
  template:
    spec:
      containers:
        - name: trainer
          image: nvcr.io/nvidia/pytorch:26.02-py3
          command:
            - torchrun
            - --nnodes=2
            - --nproc_per_node=1
            - --node_rank=${RANK}
            - --master_addr=${MASTER_ADDR}
            - --master_port=${MASTER_PORT}
            - train_retinanet.py
            - --batch-size=16
            - --num-workers=8
            - --image-size=800
            - --epochs=50
            - --local-image-dir=/data/cache/images
            - --cache-dir=/data/cache/annotations
          resources:
            limits:
              nvidia.com/gpu: 1
              memory: 64Gi
              cpu: "16"
            requests:
              nvidia.com/gpu: 1
              memory: 32Gi
              cpu: "8"
          volumeMounts:
            - name: dataset
              mountPath: /data/input/Datasets
              readOnly: true
            - name: local-cache
              mountPath: /data/cache
            - name: output
              mountPath: /data/output
            - name: shm
              mountPath: /dev/shm
      volumes:
        - name: dataset
          persistentVolumeClaim:
            claimName: nfs-datasets      # Shared NFS with full dataset
        - name: local-cache
          emptyDir:
            medium: ""                   # Node-local SSD for caching
            sizeLimit: 500Gi
        - name: output
          persistentVolumeClaim:
            claimName: nfs-output
        - name: shm
          emptyDir:
            medium: Memory
            sizeLimit: 32Gi              # For DataLoader shared memory
      nodeSelector:
        nvidia.com/gpu.present: "true"
```

### Local Caching Strategy

```python
"""Cache remote NFS dataset to local SSD on first access."""
import os
import shutil
from pathlib import Path

class CachedDataset:
    def __init__(self, remote_dir, local_cache_dir, max_cache_gb=400):
        self.remote = Path(remote_dir)
        self.local = Path(local_cache_dir)
        self.local.mkdir(parents=True, exist_ok=True)
        self.max_bytes = max_cache_gb * 1024**3
    
    def get_image(self, image_id):
        local_path = self.local / f"{image_id}.jpg"
        
        if local_path.exists():
            return local_path  # Cache hit
        
        # Cache miss: copy from NFS to local SSD
        remote_path = self.remote / f"{image_id}.jpg"
        shutil.copy2(remote_path, local_path)
        return local_path
    
    def prefetch_batch(self, image_ids):
        """Pre-cache a batch of images in background."""
        from concurrent.futures import ThreadPoolExecutor
        with ThreadPoolExecutor(max_workers=4) as executor:
            executor.map(self.get_image, image_ids)
```

### Open Images Dataset Download on Kubernetes

```yaml
# Pre-download dataset using the official downloader
apiVersion: batch/v1
kind: Job
metadata:
  name: download-openimages
  namespace: datasets
spec:
  template:
    spec:
      containers:
        - name: downloader
          image: python:3.11-slim
          command:
            - /bin/bash
            - -c
            - |
              pip install boto3 tqdm
              
              # Download the downloader script
              wget https://raw.githubusercontent.com/openimages/dataset/master/downloader.py
              
              # Create image list file (format: $SPLIT/$IMAGE_ID)
              # e.g., train/f9e0434389a1d4dd
              
              # Download with parallel processes
              python downloader.py image_list.txt \
                --download_folder=/data/datasets/openimages \
                --num_processes=16
          resources:
            requests:
              cpu: "8"
              memory: 8Gi
          volumeMounts:
            - name: dataset-storage
              mountPath: /data/datasets
      volumes:
        - name: dataset-storage
          persistentVolumeClaim:
            claimName: nfs-datasets
      restartPolicy: Never
```

### Storage Architecture for Large Datasets

```text
┌─────────────────────────────────────────────────────┐
│                  Training Cluster                     │
├─────────────────────────────────────────────────────┤
│                                                      │
│  GPU Node 0          GPU Node 1          GPU Node 2 │
│  ┌──────────┐       ┌──────────┐       ┌──────────┐│
│  │ Local SSD│       │ Local SSD│       │ Local SSD││
│  │ (cache)  │       │ (cache)  │       │ (cache)  ││
│  └─────┬────┘       └─────┬────┘       └─────┬────┘│
│        │                   │                   │     │
│        └───────────────────┴───────────────────┘     │
│                        │ NFS/RDMA                    │
│        ┌───────────────┴───────────────┐             │
│        │    Scale-Out NAS Cluster       │             │
│        │  Node0  Node1  Node2  Node3   │             │
│        │  10TB   10TB   10TB   10TB    │             │
│        └───────────────────────────────┘             │
└─────────────────────────────────────────────────────┘

Access pattern:
  Epoch 1: Cold cache → read from NFS → cache to local SSD
  Epoch 2+: Hot cache → read from local SSD (10× faster)
```

### Performance Tuning Checklist

```bash
# 1. Verify DataLoader isn't the bottleneck
#    GPU util should be > 80%. If < 50%, data loading is too slow.
nvidia-smi dmon -s u -d 5

# 2. Check I/O wait on node
iostat -x 1 5

# 3. Monitor NFS client stats
nfsstat -c

# 4. Verify num_workers matches available CPUs
echo "CPU request: $(kubectl get pod $POD -o jsonpath='{.spec.containers[0].resources.requests.cpu}')"

# 5. Check /dev/shm usage (DataLoader shared memory)
df -h /dev/shm
```

## Common Issues

### DataLoader workers killed (OOM)
- **Cause**: `num_workers × prefetch_factor × batch_size` exceeds shared memory
- **Fix**: Increase `/dev/shm` size or reduce `prefetch_factor`

### GPU utilization drops periodically
- **Cause**: Epoch boundary — DataLoader restarts, cache cold
- **Fix**: Use `persistent_workers=True` and IterableDataset for seamless epochs

### NFS timeouts during training
- **Cause**: Too many concurrent random reads saturating NFS server
- **Fix**: Use local SSD caching; sequential access patterns; increase NFS `nconnect`

## Best Practices

1. **`num_workers=CPU_cores`** — one worker per available CPU core
2. **`pin_memory=True`** — eliminates one CPU→GPU copy
3. **`persistent_workers=True`** — avoid worker respawn overhead
4. **Local SSD cache** — first epoch is slow, subsequent epochs are fast
5. **`/dev/shm` sizing** — at least `num_workers × prefetch_factor × batch_memory`
6. **Separate read/write storage** — datasets on NFS, checkpoints on separate PVC

## Key Takeaways

- DataLoader with 8+ workers and prefetch hides I/O latency
- Local SSD caching transforms NFS bottleneck after first epoch
- `/dev/shm` must be sized for DataLoader shared memory
- Open Images/LAION-scale datasets need parallel download jobs
- Monitor GPU utilization — if below 70%, data loading is the bottleneck
- GDS can further accelerate by bypassing CPU for storage→GPU transfers
