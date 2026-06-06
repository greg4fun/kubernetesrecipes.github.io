---
title: "Image Pull Optimization for Kubernetes"
description: "Optimize container image pull performance in Kubernetes. Layer caching, pre-pulling with DaemonSets, image streaming, lazy pulling with stargz/nydus, registry"
tags:
  - "container-images"
  - "performance"
  - "caching"
  - "containerd"
  - "cold-start"
category: "configuration"
publishDate: "2026-05-22"
author: "Luca Berton"
difficulty: "intermediate"
relatedRecipes:
  - "oci-container-image-internals-kubernetes"
  - "private-container-registry-kubernetes"
  - "multi-architecture-container-images-kubernetes"
  - "karpenter-node-autoscaling"
---

> 💡 **Quick Answer:** Large images (especially AI/ML at 10-50GB) cause slow cold starts. Optimize with: layer caching (shared base images), pre-pulling via DaemonSets, lazy pulling (stargz/nydus — container starts before full download), registry mirrors for reduced latency, and image streaming (SOCI/nydus snapshotter). For GPU workloads, pre-pull model images to nodes during off-peak hours.

## The Problem

- AI/ML images are 10-50GB — cold start takes 5-15 minutes on new nodes
- Node autoscaler adds capacity but pods wait for image pull
- Large base images downloaded repeatedly across nodes (no cross-node cache)
- Registry bandwidth becomes bottleneck during cluster-wide rollouts
- `ImagePullBackOff` during spikes when registry can't handle concurrent pulls

## The Solution

### Pre-Pull Images with DaemonSet

```yaml
# Pre-pull large images to all nodes (runs once, stays cached)
apiVersion: apps/v1
kind: DaemonSet
metadata:
  name: image-prepull
  namespace: kube-system
spec:
  selector:
    matchLabels:
      app: image-prepull
  template:
    metadata:
      labels:
        app: image-prepull
    spec:
      initContainers:
        # Pre-pull AI model image (40GB)
        - name: pull-vllm
          image: vllm/vllm-openai:0.5.0
          command: ["sh", "-c", "echo 'Image cached'"]
          resources:
            requests:
              cpu: "10m"
              memory: "10Mi"

        # Pre-pull base inference image
        - name: pull-nvidia
          image: nvcr.io/nvidia/pytorch:24.05-py3
          command: ["sh", "-c", "echo 'Image cached'"]
          resources:
            requests:
              cpu: "10m"
              memory: "10Mi"

      containers:
        - name: pause
          image: registry.k8s.io/pause:3.9
          resources:
            requests:
              cpu: "1m"
              memory: "1Mi"

      nodeSelector:
        nvidia.com/gpu.present: "true"   # Only GPU nodes
      tolerations:
        - key: nvidia.com/gpu
          operator: Exists
          effect: NoSchedule
```

### Lazy Pulling with Stargz Snapshotter

```bash
# Standard image: must download ALL layers before container starts
# Stargz/eStargz: container starts immediately, layers fetched on-demand

# Convert existing image to eStargz format
ctr-remote image optimize \
  --oci \
  registry.example.com/myorg/app:v2.1.0 \
  registry.example.com/myorg/app:v2.1.0-esgz

# containerd config for stargz snapshotter
# /etc/containerd/config.toml
```

```toml
# Enable stargz snapshotter in containerd
[proxy_plugins]
  [proxy_plugins.stargz]
    type = "snapshot"
    address = "/run/containerd-stargz-grpc/containerd-stargz-grpc.sock"

[plugins."io.containerd.grpc.v1.cri".containerd]
  snapshotter = "stargz"
```

```yaml
# Result: 40GB AI image starts in seconds (not minutes)
# Layers are fetched on-demand as files are accessed
# Most model files loaded lazily during inference warm-up

# Pod annotation to enable lazy pulling
apiVersion: v1
kind: Pod
metadata:
  name: ai-inference
  annotations:
    io.containerd.image.lazy-pull: "true"
spec:
  containers:
    - name: model
      image: registry.example.com/ai/model:v1.0-esgz
      resources:
        limits:
          nvidia.com/gpu: "1"
```

### Registry Mirror for Reduced Latency

```yaml
# containerd config — mirror Docker Hub and other registries
# /etc/containerd/config.toml
```

```toml
[plugins."io.containerd.grpc.v1.cri".registry.mirrors]
  [plugins."io.containerd.grpc.v1.cri".registry.mirrors."docker.io"]
    endpoint = ["https://mirror.example.com", "https://registry-1.docker.io"]
  [plugins."io.containerd.grpc.v1.cri".registry.mirrors."registry.example.com"]
    endpoint = ["https://registry-cache.local:5000", "https://registry.example.com"]
```

```yaml
# Deploy registry mirror per availability zone
apiVersion: apps/v1
kind: DaemonSet
metadata:
  name: registry-mirror
  namespace: kube-system
spec:
  selector:
    matchLabels:
      app: registry-mirror
  template:
    metadata:
      labels:
        app: registry-mirror
    spec:
      containers:
        - name: mirror
          image: registry:2.8
          env:
            - name: REGISTRY_PROXY_REMOTEURL
              value: "https://registry.example.com"
          ports:
            - containerPort: 5000
              hostPort: 5000      # Accessible at node's localhost:5000
          volumeMounts:
            - name: cache
              mountPath: /var/lib/registry
      volumes:
        - name: cache
          hostPath:
            path: /var/lib/registry-mirror
            type: DirectoryOrCreate
```

### Optimize Dockerfile for Layer Caching

```dockerfile
# BAD: Any code change invalidates ALL layers below
FROM python:3.12-slim
COPY . /app
RUN pip install -r /app/requirements.txt

# GOOD: Dependencies cached separately from code
FROM python:3.12-slim

# Layer 1: System deps (rarely changes)
RUN apt-get update && apt-get install -y --no-install-recommends \
    libpq-dev && rm -rf /var/lib/apt/lists/*

# Layer 2: Python deps (changes when requirements.txt changes)
COPY requirements.txt /app/
RUN pip install --no-cache-dir -r /app/requirements.txt

# Layer 3: Application code (changes frequently, but layer is small)
COPY . /app
WORKDIR /app
CMD ["python", "main.py"]
```

### Parallel Pull Configuration

```yaml
# kubelet config — increase concurrent image pulls
apiVersion: kubelet.config.k8s.io/v1beta1
kind: KubeletConfiguration
maxParallelImagePulls: 10          # Default: 5 (K8s 1.27+)
serializeImagePulls: false         # Allow parallel pulls
imageGCHighThresholdPercent: 85    # GC when disk 85% full
imageGCLowThresholdPercent: 80     # GC down to 80%
```

### Scheduled Pre-Pull CronJob

```yaml
# Pre-pull during off-peak hours (new model versions)
apiVersion: batch/v1
kind: CronJob
metadata:
  name: prepull-models
  namespace: ai-inference
spec:
  schedule: "0 2 * * *"            # 2 AM daily
  jobTemplate:
    spec:
      template:
        spec:
          nodeSelector:
            nvidia.com/gpu.present: "true"
          containers:
            - name: prepull
              image: bitnami/kubectl:latest
              command:
                - /bin/sh
                - -c
                - |
                  # Trigger pull on all GPU nodes via ephemeral pods
                  for node in $(kubectl get nodes -l nvidia.com/gpu.present=true -o name); do
                    kubectl run prepull-$(echo $node | cut -d/ -f2) \
                      --image=registry.example.com/ai/model:latest \
                      --restart=Never \
                      --overrides='{"spec":{"nodeName":"'$(echo $node | cut -d/ -f2)'","containers":[{"name":"pull","image":"registry.example.com/ai/model:latest","command":["true"]}]}}' \
                      || true
                  done
                  sleep 300
                  kubectl delete pods -l run=prepull --ignore-not-found
          restartPolicy: OnFailure
```

## Common Issues

### ImagePullBackOff during scale-up
- **Cause**: Registry bandwidth saturated; or rate limited
- **Fix**: Deploy registry mirror per AZ; increase `maxParallelImagePulls`; pre-pull

### Node disk full from cached images
- **Cause**: Too many images cached; GC not aggressive enough
- **Fix**: Lower `imageGCHighThresholdPercent`; use faster storage; prune unused images

### Lazy pull slower than full pull for small images
- **Cause**: Per-file HTTP range requests add overhead for small layers
- **Fix**: Only use lazy pulling for images >5GB; use standard pull for small images

### Pre-pull DaemonSet consuming too much bandwidth
- **Cause**: All nodes pulling simultaneously on deploy
- **Fix**: Use `maxUnavailable: 1` in DaemonSet update strategy; or stagger with CronJob

## Best Practices

1. **Share base images** — standardize on 2-3 base images; layers are deduplicated
2. **Pre-pull for AI/ML** — 10-50GB images should never be pulled on-demand
3. **Lazy pull for giant images** — eStargz/nydus starts containers in seconds
4. **Mirror per AZ** — reduce cross-zone egress and improve pull speed
5. **Order Dockerfile layers** — rarely-changing deps first, frequently-changing code last
6. **Parallel pulls** — set `serializeImagePulls: false` and increase max parallel
7. **Monitor pull times** — `kubelet_image_pull_duration_seconds` histogram

## Key Takeaways

- Layer caching is automatic — nodes reuse shared layers across images
- Pre-pull via DaemonSet eliminates cold start for large images
- Lazy pulling (stargz/nydus) = container starts before full download completes
- Registry mirrors reduce latency and avoid rate limits
- Dockerfile layer ordering directly impacts pull efficiency (shared layers first)
- `maxParallelImagePulls=10` + `serializeImagePulls=false` for fast multi-image pulls
- AI/ML workloads benefit most — 40GB image goes from 15-min pull to instant start
