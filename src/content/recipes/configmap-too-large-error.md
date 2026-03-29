---
title: "Fix ConfigMap Too Large Error"
description: "Resolve the 1MB ConfigMap size limit error. Split large configurations, use Secrets for binary data, mount volumes, or use external configuration stores like etcd or Vault."
publishDate: "2026-03-19"
author: "Luca Berton"
category: "troubleshooting"
difficulty: "beginner"
timeToComplete: "15 minutes"
kubernetesVersion: "1.28+"
tags:
  - configmap
  - size-limit
  - configuration
  - troubleshooting
  - etcd
relatedRecipes:
  - "openclaw-external-secrets-kubernetes"
---
> 💡 **Quick Answer:** ConfigMaps are limited to ~1MB (etcd value size limit). Split large configs into multiple ConfigMaps, use a PersistentVolume for large files, or use an init container to download configs from external storage (S3, Vault, etc.).

## The Problem

Creating or updating a ConfigMap fails with:
```
The ConfigMap "my-config" is invalid: []: Too long: must have at most 1048576 bytes
```

Your configuration data exceeds the 1MB etcd value size limit.

## The Solution

### Check Current Size

```bash
kubectl get configmap my-config -n myapp -o json | wc -c
# 1234567   ← Over 1MB

# See what's large
kubectl get configmap my-config -n myapp -o json | jq '.data | to_entries[] | {key, size: (.value | length)}' | sort
```

### Option 1: Split Into Multiple ConfigMaps

```yaml
# Split by concern
---
apiVersion: v1
kind: ConfigMap
metadata:
  name: app-config
data:
  application.yaml: |
    # Main app config (~50KB)
---
apiVersion: v1
kind: ConfigMap
metadata:
  name: app-rules
data:
  rules.json: |
    # Business rules (~200KB)
```

Mount both:
```yaml
volumes:
  - name: config
    projected:
      sources:
        - configMap:
            name: app-config
        - configMap:
            name: app-rules
```

### Option 2: Use Init Container to Download

```yaml
initContainers:
  - name: fetch-config
    image: curlimages/curl
    command: ["sh", "-c"]
    args:
      - curl -o /config/large-data.json https://config-server/api/v1/config
    volumeMounts:
      - name: config
        mountPath: /config
containers:
  - name: app
    volumeMounts:
      - name: config
        mountPath: /config
volumes:
  - name: config
    emptyDir: {}
```

### Option 3: Use a PersistentVolume

For truly large configs (ML models, GeoIP databases):
```yaml
volumes:
  - name: large-config
    persistentVolumeClaim:
      claimName: config-pvc
```

## Common Issues

### Binary Data in ConfigMaps

Use `binaryData` field for binary content, but it still counts toward the 1MB limit. For large binaries, use Secrets (also 1MB) or PVs.

### Helm Values Generating Large ConfigMaps

If Helm templates produce ConfigMaps over 1MB, split the template into multiple ConfigMaps.

## Best Practices

- **Keep ConfigMaps small** — configuration, not data storage
- **Use external stores** for large datasets (S3, NFS, databases)
- **Split by concern** — multiple small ConfigMaps are better than one large one
- **Monitor ConfigMap sizes** in CI/CD — catch oversized configs before deployment

## Key Takeaways

- ConfigMaps are capped at ~1MB (etcd limit) — this is by design, not a bug
- Split large configs into multiple ConfigMaps or use projected volumes
- For large data (>1MB): init containers, PVs, or external config stores
- The limit applies to the total size of ALL keys in the ConfigMap combined
