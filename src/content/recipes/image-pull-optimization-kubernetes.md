---
title: "Kubernetes Image Pull Optimization: Faster Pod Starts"
description: "Speed up Kubernetes image pulls: pre-pull DaemonSets, containerd registry mirrors, lazy pulling with eStargz/SOCI, parallel pulls, and GC tuning for AI images."
tags:
  - "container-images"
  - "performance"
  - "caching"
  - "containerd"
  - "cold-start"
  - "image-pull"
  - "registry"
category: "configuration"
publishDate: "2026-05-22"
author: "Luca Berton"
difficulty: "intermediate"
relatedRecipes:
  - "oci-container-image-internals-kubernetes"
  - "private-container-registry-kubernetes"
  - "multi-architecture-container-images-kubernetes"
  - "karpenter-node-autoscaling"
  - "imagepullbackoff-troubleshooting"
  - "containerd-certs-d-registry-ca-trust"
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
# Enable stargz snapshotter in containerd (requires containerd-stargz-grpc running on the node)
[proxy_plugins]
  [proxy_plugins.stargz]
    type = "snapshot"
    address = "/run/containerd-stargz-grpc/containerd-stargz-grpc.sock"

[plugins."io.containerd.grpc.v1.cri".containerd]
  snapshotter = "stargz"
  disable_snapshot_annotations = false   # required so the CRI passes layer info to stargz
```

No pod annotation is needed: with the snapshotter configured, any eStargz image is lazily pulled and non-eStargz images fall back to a normal pull. On EKS, the equivalent is the SOCI snapshotter (no image conversion — a separate SOCI index is pushed next to the image).

```yaml
# The container starts once the files it touches first are fetched;
# remaining layers stream in the background
apiVersion: v1
kind: Pod
metadata:
  name: ai-inference
spec:
  containers:
    - name: model
      image: registry.example.com/ai/model:v1.0-esgz
      resources:
        limits:
          nvidia.com/gpu: "1"
```

### Registry Mirror for Reduced Latency

The old `registry.mirrors` tables in `config.toml` are deprecated and removed in containerd 2.0. Use per-registry `hosts.toml` files:

```toml
# /etc/containerd/config.toml (containerd 1.7; in 2.x the section is
# [plugins."io.containerd.cri.v1.images".registry])
[plugins."io.containerd.grpc.v1.cri".registry]
  config_path = "/etc/containerd/certs.d"
```

```toml
# /etc/containerd/certs.d/docker.io/hosts.toml
server = "https://registry-1.docker.io"

[host."https://mirror.example.com"]
  capabilities = ["pull", "resolve"]
```

```toml
# /etc/containerd/certs.d/nvcr.io/hosts.toml
server = "https://nvcr.io"

[host."http://localhost:5000"]
  capabilities = ["pull", "resolve"]
```

`hosts.toml` is re-read on each pull — no containerd restart needed (changing `config_path` itself does need one). On OpenShift use `ImageDigestMirrorSet` / `ImageTagMirrorSet` instead of editing nodes.

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
          image: registry:2.8   # pull-through cache for ONE upstream per instance
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
serializeImagePulls: false         # Default true: one pull at a time per node
maxParallelImagePulls: 10          # Cap parallel pulls (K8s 1.27+; unset = unlimited)
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
          serviceAccountName: prepull   # needs RBAC: get/list nodes, create/delete pods
          containers:
            - name: prepull
              image: bitnami/kubectl:1.33
              command:
                - /bin/sh
                - -c
                - |
                  # Trigger pull on all GPU nodes via ephemeral pods
                  for node in $(kubectl get nodes -l nvidia.com/gpu.present=true -o name); do
                    n=$(echo $node | cut -d/ -f2)
                    kubectl run prepull-$n -l app=prepull \
                      --image=registry.example.com/ai/model:v1.1 \
                      --restart=Never \
                      --overrides='{"spec":{"nodeName":"'$n'","tolerations":[{"operator":"Exists"}],"containers":[{"name":"pull","image":"registry.example.com/ai/model:v1.1","command":["true"]}]}}' \
                      || true
                  done
                  sleep 300
                  kubectl delete pods -l app=prepull --ignore-not-found
          restartPolicy: OnFailure
```

### Image Pull Policies

| Policy | Behavior | Use When |
|--------|----------|----------|
| `IfNotPresent` | Pull only if not cached | Immutable tags (`:v1.2.3`) or digests — default for non-`latest` tags |
| `Always` | Resolve the tag against the registry every start (layers still cached) | `:latest` / moving tags |
| `Never` | Only use images already on the node | Air-gapped, pre-loaded images |

Air-gapped nodes can be seeded without a registry: `ctr -n k8s.io images import model.tar` (containerd) or `podman load` + CRI-O shared storage.

## Common Issues

### Large image pull times out or is cancelled
- **Cause**: containerd cancels a pull that makes no progress for `image_pull_progress_timeout` (default 5m, CRI plugin config). The old kubelet flag `--image-pull-progress-deadline` was dockershim-only and no longer exists.
- **Fix**: Raise `image_pull_progress_timeout` in containerd config for slow links; pre-pull or mirror large images.

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

## Frequently Asked Questions

### How do I make Kubernetes pull images faster?
Serve images from a nearby pull-through mirror, pre-pull large images onto nodes with a DaemonSet, enable parallel pulls (`serializeImagePulls: false`), keep images small with shared base layers, and use lazy pulling (eStargz, SOCI, Nydus) for multi-GB images.

### Does imagePullPolicy Always re-download the whole image?
No. `Always` resolves the tag's digest with the registry on every container start; layers already on the node are reused. The cost is a registry round-trip and a failure if the registry is unreachable.

### How do I pre-pull an image on every node?
Run a DaemonSet whose initContainers use the images you want cached and exit immediately, with a tiny `pause` main container. Add tolerations and a nodeSelector to target GPU nodes only.

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
