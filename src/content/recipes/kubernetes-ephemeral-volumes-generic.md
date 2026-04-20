---
title: "Generic Ephemeral Volumes in Kubernetes"
description: "Use generic ephemeral volumes for per-pod temporary storage with CSI driver features. Scratch space, caching, and temp data without pre-provisioned PVCs."
publishDate: "2026-04-20"
author: "Luca Berton"
category: "storage"
difficulty: "intermediate"
timeToComplete: "10 minutes"
kubernetesVersion: "1.28+"
tags:
  - ephemeral-volumes
  - storage
  - csi
  - scratch-space
relatedRecipes:
  - "kubernetes-storage-best-practices"
  - "kubernetes-hostpath-volume"
  - "model-caching-shared-memory"
---

> 💡 **Quick Answer:** Use `ephemeral` volume type to get per-pod CSI-backed storage that's automatically created and deleted with the pod. Define an inline `volumeClaimTemplate` (like a PVC spec) in the pod spec. Unlike `emptyDir`, you get real persistent storage features (encryption, performance tiers) without manual PVC lifecycle.

## The Problem

You need temporary per-pod storage (scratch space, cache, temp files) but:
- `emptyDir` is limited to node disk and has no storage class features
- Pre-provisioned PVCs require manual lifecycle management
- You want encryption, IOPS guarantees, or specific storage classes for temp data

## The Solution

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: data-processor
spec:
  replicas: 5
  template:
    spec:
      containers:
        - name: processor
          image: data-processor:v2
          volumeMounts:
            - name: scratch
              mountPath: /tmp/processing
            - name: cache
              mountPath: /var/cache/app
      volumes:
        - name: scratch
          ephemeral:
            volumeClaimTemplate:
              metadata:
                labels:
                  type: scratch
              spec:
                accessModes: ["ReadWriteOnce"]
                storageClassName: gp3-encrypted
                resources:
                  requests:
                    storage: 50Gi
        - name: cache
          ephemeral:
            volumeClaimTemplate:
              spec:
                accessModes: ["ReadWriteOnce"]
                storageClassName: local-nvme
                resources:
                  requests:
                    storage: 100Gi
```

## How It Works

```mermaid
graph LR
    A[Pod Created] --> B[PVC auto-created]
    B --> C[PV provisioned by CSI]
    C --> D[Volume mounted to pod]
    D --> E[Pod Deleted]
    E --> F[PVC auto-deleted]
    F --> G[PV reclaimed]
```

The lifecycle is fully automatic:
1. Pod starts → PVC created (owned by pod)
2. CSI driver provisions the volume
3. Volume mounted to pod
4. Pod deleted → PVC garbage collected → PV reclaimed

## Comparison with Other Volume Types

| Feature | emptyDir | hostPath | Generic Ephemeral | PVC |
|---------|----------|----------|-------------------|-----|
| Per-pod lifecycle | ✅ | ❌ | ✅ | ❌ |
| Storage class support | ❌ | ❌ | ✅ | ✅ |
| Encryption | ❌ | ❌ | ✅ | ✅ |
| IOPS control | ❌ | ❌ | ✅ | ✅ |
| Survives pod restart | ❌ | ⚠️ | ❌ | ✅ |
| Size limits | ✅ | ❌ | ✅ | ✅ |
| No manual cleanup | ✅ | ❌ | ✅ | ❌ |

## Use Cases

### AI/ML Scratch Space

```yaml
volumes:
  - name: model-scratch
    ephemeral:
      volumeClaimTemplate:
        spec:
          accessModes: ["ReadWriteOnce"]
          storageClassName: nvme-fast
          resources:
            requests:
              storage: 500Gi
```

### CI/CD Build Cache

```yaml
volumes:
  - name: build-cache
    ephemeral:
      volumeClaimTemplate:
        spec:
          accessModes: ["ReadWriteOnce"]
          storageClassName: ssd
          resources:
            requests:
              storage: 20Gi
```

## Verify Ephemeral PVCs

```bash
# List PVCs created by ephemeral volumes
kubectl get pvc -l type=scratch

# PVC name follows pattern: <pod-name>-<volume-name>
# e.g., data-processor-7f8b9-scratch
kubectl get pvc | grep processor
```

## Common Issues

| Issue | Cause | Fix |
|-------|-------|-----|
| Pod stuck Pending | StorageClass can't provision | Check CSI driver logs |
| PVC not deleted after pod | OwnerReference missing | Ensure K8s 1.23+ (GA) |
| Volume not large enough | Size underestimated | Increase `storage` request |
| Slow mount | Network-attached storage | Use local storage class for scratch |

## Best Practices

1. **Use for truly temporary data** — Don't store anything you need after pod dies
2. **Choose appropriate storage class** — Local NVMe for speed, network for encryption
3. **Set resource quotas** — Ephemeral PVCs count toward namespace quota
4. **Label ephemeral volumes** — Helps identify and audit auto-created PVCs
5. **Prefer over hostPath** — Same performance, better security and lifecycle

## Key Takeaways

- Generic ephemeral volumes = per-pod PVCs with automatic lifecycle
- Get CSI features (encryption, IOPS, snapshots) for temporary storage
- Automatically cleaned up when pod is deleted (owner reference)
- Ideal for scratch space, caches, and temp processing data
- Use instead of hostPath or oversized emptyDir
