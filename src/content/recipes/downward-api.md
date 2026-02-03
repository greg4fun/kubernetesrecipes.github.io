---
title: "How to Use the Downward API"
description: "Expose pod and container metadata to applications using the Downward API. Access labels, annotations, resource limits, and pod information from within containers."
category: "configuration"
difficulty: "beginner"
publishDate: "2026-01-22"
tags: ["downward-api", "metadata", "environment-variables", "volumes", "configuration"]
author: "Luca Berton"
---

> 💡 **Quick Answer:** Downward API exposes pod/container metadata to containers via **environment variables** (`fieldRef`, `resourceFieldRef`) or **volume files**. Access pod name, namespace, labels, annotations, IP, resource requests/limits without hardcoding or API calls.
>
> **Key fields:** `metadata.name`, `metadata.namespace`, `metadata.labels`, `status.podIP`, `spec.nodeName`, `requests.cpu`, `limits.memory`.
>
> **Gotcha:** Environment variables are set at container start and don't update. Use volume files for dynamic data like labels/annotations that might change.

# How to Use the Downward API

The Downward API exposes pod and container information to running containers without requiring API server calls. Access metadata via environment variables or files.

## Environment Variables from Pod Fields

```yaml
# env-from-pod-fields.yaml
apiVersion: v1
kind: Pod
metadata:
  name: downward-env
  labels:
    app: my-app
    version: v1
  annotations:
    description: "Demo pod"
spec:
  containers:
    - name: app
      image: busybox
      command: ["sh", "-c", "env && sleep 3600"]
      env:
        - name: POD_NAME
          valueFrom:
            fieldRef:
              fieldPath: metadata.name
        - name: POD_NAMESPACE
          valueFrom:
            fieldRef:
              fieldPath: metadata.namespace
        - name: POD_IP
          valueFrom:
            fieldRef:
              fieldPath: status.podIP
        - name: NODE_NAME
          valueFrom:
            fieldRef:
              fieldPath: spec.nodeName
        - name: SERVICE_ACCOUNT
          valueFrom:
            fieldRef:
              fieldPath: spec.serviceAccountName
        - name: HOST_IP
          valueFrom:
            fieldRef:
              fieldPath: status.hostIP
```

## Environment Variables from Resource Fields

```yaml
# env-from-resources.yaml
apiVersion: v1
kind: Pod
metadata:
  name: resource-env
spec:
  containers:
    - name: app
      image: busybox
      command: ["sh", "-c", "env && sleep 3600"]
      resources:
        requests:
          cpu: "250m"
          memory: "64Mi"
        limits:
          cpu: "500m"
          memory: "128Mi"
      env:
        - name: CPU_REQUEST
          valueFrom:
            resourceFieldRef:
              containerName: app
              resource: requests.cpu
        - name: CPU_LIMIT
          valueFrom:
            resourceFieldRef:
              containerName: app
              resource: limits.cpu
        - name: MEMORY_REQUEST
          valueFrom:
            resourceFieldRef:
              containerName: app
              resource: requests.memory
        - name: MEMORY_LIMIT
          valueFrom:
            resourceFieldRef:
              containerName: app
              resource: limits.memory
```

## Volume Files (Labels and Annotations)

```yaml
# volume-downward-api.yaml
apiVersion: v1
kind: Pod
metadata:
  name: downward-volume
  labels:
    app: my-app
    environment: production
  annotations:
    build: "1234"
    owner: "team-a"
spec:
  containers:
    - name: app
      image: busybox
      command: ["sh", "-c", "cat /etc/podinfo/* && sleep 3600"]
      volumeMounts:
        - name: podinfo
          mountPath: /etc/podinfo
  volumes:
    - name: podinfo
      downwardAPI:
        items:
          - path: "labels"
            fieldRef:
              fieldPath: metadata.labels
          - path: "annotations"
            fieldRef:
              fieldPath: metadata.annotations
          - path: "name"
            fieldRef:
              fieldPath: metadata.name
          - path: "namespace"
            fieldRef:
              fieldPath: metadata.namespace
          - path: "cpu_limit"
            resourceFieldRef:
              containerName: app
              resource: limits.cpu
```

## Available Fields

### Pod Fields (fieldRef)

| Field | Description |
|-------|-------------|
| `metadata.name` | Pod name |
| `metadata.namespace` | Pod namespace |
| `metadata.uid` | Pod UID |
| `metadata.labels` | All labels (volume only) |
| `metadata.labels['key']` | Specific label |
| `metadata.annotations` | All annotations (volume only) |
| `metadata.annotations['key']` | Specific annotation |
| `spec.nodeName` | Node name |
| `spec.serviceAccountName` | Service account |
| `status.podIP` | Pod IP address |
| `status.hostIP` | Node IP address |

### Resource Fields (resourceFieldRef)

| Field | Description |
|-------|-------------|
| `requests.cpu` | CPU request |
| `requests.memory` | Memory request |
| `requests.ephemeral-storage` | Storage request |
| `limits.cpu` | CPU limit |
| `limits.memory` | Memory limit |
| `limits.ephemeral-storage` | Storage limit |

## Practical Use Cases

### Use Case 1: Logging Context

```yaml
env:
  - name: POD_NAME
    valueFrom:
      fieldRef:
        fieldPath: metadata.name
  - name: POD_NAMESPACE
    valueFrom:
      fieldRef:
        fieldPath: metadata.namespace
# Application includes POD_NAME and NAMESPACE in log entries
```

### Use Case 2: Self-Registration

```yaml
env:
  - name: POD_IP
    valueFrom:
      fieldRef:
        fieldPath: status.podIP
  - name: POD_NAME
    valueFrom:
      fieldRef:
        fieldPath: metadata.name
# Application registers itself with service discovery using POD_IP
```

### Use Case 3: Resource-Aware JVM

```yaml
env:
  - name: JAVA_OPTS
    value: "-XX:MaxRAMPercentage=75.0"
  - name: MEMORY_LIMIT
    valueFrom:
      resourceFieldRef:
        resource: limits.memory
# JVM adjusts heap based on container memory limit
```

### Use Case 4: Prometheus Labels

```yaml
# Include pod metadata in metrics
env:
  - name: POD_NAME
    valueFrom:
      fieldRef:
        fieldPath: metadata.name
  - name: POD_NAMESPACE
    valueFrom:
      fieldRef:
        fieldPath: metadata.namespace
  - name: NODE_NAME
    valueFrom:
      fieldRef:
        fieldPath: spec.nodeName
```

## Verify Downward API

```bash
# Check environment variables
kubectl exec downward-env -- env | grep POD

# Check volume files
kubectl exec downward-volume -- cat /etc/podinfo/labels
kubectl exec downward-volume -- cat /etc/podinfo/annotations

# Watch for updates (volume only)
kubectl exec downward-volume -- watch cat /etc/podinfo/labels
```

## Best Practices

1. **Use env vars** for static info needed at startup
2. **Use volumes** for labels/annotations that may change
3. **Include context** in logs (pod name, namespace)
4. **Size containers** based on resource fields
5. **Don't hardcode** - use Downward API for portability
