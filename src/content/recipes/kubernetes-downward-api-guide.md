---
title: "Kubernetes Downward API: Complete Guide"
description: "Expose pod and container metadata to applications using the Downward API. Environment variables, volume files, fieldRef, resourceFieldRef, and common patterns."
publishDate: "2026-04-25"
author: "Luca Berton"
category: "configuration"
difficulty: "beginner"
timeToComplete: "15 minutes"
kubernetesVersion: "1.28+"
tags:
  - "downward-api"
  - "metadata"
  - "environment-variables"
  - "fieldref"
relatedRecipes:
  - "kubernetes-labels-annotations-guide"
  - "kubernetes-envfrom-configmapref"
  - "kubernetes-pod-security-standards"
  - "kubernetes-rbac-least-privilege"
---

> 💡 **Quick Answer:** Expose pod and container metadata to applications using the Downward API. Environment variables, volume files, fieldRef, resourceFieldRef, and common patterns.

## The Problem

Applications often need to know things about their own pod — its name, namespace, IP, node, labels, or the resource limits it's running under — for logging context, metrics labels, or sizing internal buffers/heaps. Calling the Kubernetes API for this needs RBAC and adds a dependency; the Downward API exposes it for free, with no API access required.

## The Solution

### Pod Metadata as Environment Variables

```yaml
env:
  - name: POD_NAME
    valueFrom: {fieldRef: {fieldPath: metadata.name}}
  - name: POD_NAMESPACE
    valueFrom: {fieldRef: {fieldPath: metadata.namespace}}
  - name: POD_IP
    valueFrom: {fieldRef: {fieldPath: status.podIP}}
  - name: NODE_NAME
    valueFrom: {fieldRef: {fieldPath: spec.nodeName}}
  - name: SERVICE_ACCOUNT
    valueFrom: {fieldRef: {fieldPath: spec.serviceAccountName}}
  - name: APP_VERSION
    valueFrom: {fieldRef: {fieldPath: "metadata.labels['version']"}}
```

### Container Resource Limits as Environment Variables

```yaml
env:
  - name: MEMORY_LIMIT
    valueFrom:
      resourceFieldRef:
        containerName: app
        resource: limits.memory
        divisor: 1Mi   # value arrives pre-converted to MiB
  - name: CPU_LIMIT
    valueFrom:
      resourceFieldRef: {containerName: app, resource: limits.cpu}
```

### Labels and Annotations — Volume Mount Only

`fieldRef` env vars can't read multi-value maps like the full label/annotation set, and env vars are fixed at container start — they don't update if labels change later. For that, mount a `downwardAPI` volume instead:

```yaml
volumes:
  - name: podinfo
    downwardAPI:
      items:
        - path: "labels"
          fieldRef: {fieldPath: metadata.labels}
        - path: "annotations"
          fieldRef: {fieldPath: metadata.annotations}
        - path: "cpu_limit"
          resourceFieldRef: {containerName: app, resource: limits.cpu, divisor: "1m"}
volumeMounts:
  - name: podinfo
    mountPath: /etc/podinfo
    readOnly: true
```

```bash
cat /etc/podinfo/labels
# app="myapp"
# tier="backend"
```

Files under a `downwardAPI` volume mount **do** update automatically when the pod's labels/annotations change — env vars never do, since they're resolved once at container start.

### Reading It in Application Code

```python
import os
pod_name = os.getenv("POD_NAME")
memory_limit = int(os.getenv("MEMORY_LIMIT", 0))
print(f"Running as {os.getenv('POD_NAMESPACE')}/{pod_name}, memory limit {memory_limit}Mi")
```

```go
podName := os.Getenv("POD_NAME")
namespace := os.Getenv("POD_NAMESPACE")
fmt.Printf("Pod: %s/%s\n", namespace, podName)
```

### Available Fields Reference

```text
# fieldRef (pod-level)
metadata.name / metadata.namespace / metadata.uid
metadata.labels['<KEY>'] / metadata.annotations['<KEY>']
spec.nodeName / spec.serviceAccountName
status.hostIP / status.podIP / status.podIPs

# resourceFieldRef (container-level)
limits.cpu / limits.memory / limits.ephemeral-storage
requests.cpu / requests.memory / requests.ephemeral-storage
```

## Common Issues

| Issue | Cause | Fix |
|-------|-------|-----|
| Env var doesn't reflect a label change | Env vars are resolved once at container start | Use a `downwardAPI` volume mount instead — those files update live |
| `metadata.labels` as a single env var fails | `fieldRef` env vars only support one scalar value, not a map | Use `metadata.labels['<KEY>']` for one key, or a volume for the whole map |
| Memory value is in bytes when MiB was expected | Missing `divisor` | Set `divisor: 1Mi` (or `1m` for millicores) to get pre-converted units |
| `resourceFieldRef` fails with no explicit limit set | Container has no `resources.limits` for that resource | Set an explicit limit — resourceFieldRef reads the effective value, not a default |

## Best Practices

- **Use env vars for scalars** (pod name, namespace, IP, node, a single label) — simplest to read in application code
- **Use volume mounts for anything that changes** (labels, annotations) or anything multi-valued — volumes update live, env vars don't
- **Always set `divisor`** on `resourceFieldRef` so the app receives units it expects (MiB, millicores) instead of raw bytes
- **No RBAC required** — Downward API data comes from the pod spec itself, not an API call, so every pod can read its own metadata for free
- **Use it for log/metric context** — stamping `POD_NAME`/`NODE_NAME` into structured logs makes cross-referencing a specific replica trivial

## Key Takeaways

- The Downward API exposes pod/container metadata without any API server calls or RBAC
- `fieldRef` → environment variables for scalars; `downwardAPI` volumes for labels, annotations, or anything that must update live
- `resourceFieldRef` with a `divisor` gives resource limits/requests in the units your app expects
- Env vars are fixed at container start; volume-mounted downward API files update automatically when metadata changes
- Common uses: log/metric context, memory-aware runtime sizing (JVM heap = % of `limits.memory`), and unique instance IDs in distributed systems
