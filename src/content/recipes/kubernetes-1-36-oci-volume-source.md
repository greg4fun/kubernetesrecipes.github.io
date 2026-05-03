---
title: "Kubernetes 1.36 OCI Volume Source"
description: "Use OCI VolumeSource in Kubernetes 1.36 to pull OCI artifacts directly into Pod volumes. No init containers needed for ML models, configs, or data."
tags:
  - "kubernetes-1.36"
  - "oci"
  - "volumes"
  - "containers"
  - "ml-models"
category: "storage"
publishDate: "2026-05-03"
author: "Luca Berton"
difficulty: "intermediate"
relatedRecipes:
  - "kubernetes-1-36-user-namespaces"
  - "kubernetes-1-36-selinux-mount-labeling"
  - "kubernetes-persistent-volume-guide"
  - "kubernetes-init-containers-guide"
  - "nim-model-profiles-selection-kubernetes"
---

> 💡 **Quick Answer:** Kubernetes 1.36 graduates **OCI VolumeSource to Stable**. You can now natively mount OCI artifacts (ML models, configs, datasets) as Pod volumes without init containers or custom scripts.

## The Problem

Before OCI VolumeSource, loading artifacts into Pods required hacky workarounds:

- **Init containers** that download models or configs before the main container starts
- **Custom sidecar scripts** pulling data from registries
- **Baked-in container images** with models embedded (huge images, slow pulls)
- **PVC pre-population** requiring manual steps

These approaches added complexity, increased startup times, and made deployments brittle.

## The Solution

OCI VolumeSource lets you reference any OCI artifact directly as a volume. The kubelet pulls it natively, just like container images.

### Mount an OCI Artifact as a Volume

```yaml
apiVersion: v1
kind: Pod
metadata:
  name: ml-inference
spec:
  containers:
    - name: inference
      image: registry.example.com/vllm:v0.8.0
      volumeMounts:
        - name: model
          mountPath: /models/llama
          readOnly: true
  volumes:
    - name: model
      image:
        reference: registry.example.com/models/llama-3.1-8b:v1.0
        pullPolicy: IfNotPresent
```

### Pull Policies

```yaml
volumes:
  - name: model
    image:
      reference: registry.example.com/models/llama-3.1-8b:v1.0
      pullPolicy: IfNotPresent   # Cache locally, pull once
      # pullPolicy: Always       # Always pull latest
      # pullPolicy: Never        # Must exist locally
```

### Using with Private Registries

```yaml
apiVersion: v1
kind: Pod
metadata:
  name: ml-inference
spec:
  imagePullSecrets:
    - name: registry-credentials
  containers:
    - name: inference
      image: registry.example.com/vllm:v0.8.0
      volumeMounts:
        - name: model
          mountPath: /models
          readOnly: true
  volumes:
    - name: model
      image:
        reference: registry.example.com/models/mistral-7b:latest
        pullPolicy: IfNotPresent
```

### Publishing OCI Artifacts

Push models or configs as OCI artifacts using ORAS:

```bash
# Install ORAS CLI
brew install oras  # or download from oras.land

# Push a model directory as OCI artifact
oras push registry.example.com/models/llama-3.1-8b:v1.0 \
  --artifact-type application/vnd.example.ml-model.v1 \
  ./model-weights/:application/octet-stream

# Push a config bundle
oras push registry.example.com/configs/app-config:v2.0 \
  ./config.yaml:application/yaml \
  ./certs/:application/octet-stream
```

### Multiple OCI Volumes

```yaml
apiVersion: v1
kind: Pod
metadata:
  name: multi-model-server
spec:
  containers:
    - name: server
      image: registry.example.com/triton:24.05
      volumeMounts:
        - name: llama-model
          mountPath: /models/llama
          readOnly: true
        - name: embeddings-model
          mountPath: /models/embeddings
          readOnly: true
        - name: tokenizer
          mountPath: /models/tokenizer
          readOnly: true
  volumes:
    - name: llama-model
      image:
        reference: registry.example.com/models/llama-3.1-8b:v1.0
        pullPolicy: IfNotPresent
    - name: embeddings-model
      image:
        reference: registry.example.com/models/bge-large:v1.5
        pullPolicy: IfNotPresent
    - name: tokenizer
      image:
        reference: registry.example.com/tokenizers/llama:v1.0
        pullPolicy: IfNotPresent
```

## Common Issues

### ImagePullBackOff on volume
- **Cause**: Missing `imagePullSecrets` for private registry
- **Fix**: Add pull secret to Pod spec — same as container image pulls

### Volume mount empty
- **Cause**: OCI artifact has no file layers
- **Fix**: Verify artifact contents with `oras manifest fetch <ref>`

### Slow Pod startup with large models
- **Cause**: Multi-GB model pulled on every Pod start
- **Fix**: Use `pullPolicy: IfNotPresent` and pin tags (avoid `latest`)

## Best Practices

1. **Pin artifact tags** — use `v1.0` not `latest` for reproducibility
2. **Use `IfNotPresent`** — avoid re-pulling multi-GB models on every restart
3. **Mount as `readOnly`** — OCI volumes should be immutable
4. **Leverage registry caching** — use Harbor or registry mirrors near your clusters
5. **Store models as OCI artifacts** — better than baking into container images
6. **Use ORAS for publishing** — standard tooling for OCI artifact management

## Key Takeaways

- OCI VolumeSource is **GA in Kubernetes 1.36** — no feature gates needed
- Mount OCI artifacts (models, configs, data) directly as Pod volumes
- Eliminates init container hacks for artifact loading
- Uses same pull infrastructure as container images (secrets, caching, mirrors)
- Perfect for ML model deployment — load models without bloating container images
