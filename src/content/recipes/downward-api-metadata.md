---
title: "How to Use Downward API for Pod Metadata"
description: "Expose pod and container metadata to applications using the Downward API. Access labels, annotations, resource limits, and node information from within pods."
category: "configuration"
difficulty: "beginner"
publishDate: "2026-01-22"
tags: ["downward-api", "metadata", "environment", "configuration", "pods"]
---

# How to Use Downward API for Pod Metadata

The Downward API exposes pod and container metadata to running applications. Access pod name, namespace, labels, annotations, and resource information without calling the Kubernetes API.

## Environment Variables from Pod Fields

```yaml
# pod-metadata-env.yaml
apiVersion: v1
kind: Pod
metadata:
  name: myapp
  namespace: production
  labels:
    app: myapp
    version: v1.2.3
  annotations:
    owner: platform-team
spec:
  containers:
    - name: app
      image: myapp:v1
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
        - name: POD_UID
          valueFrom:
            fieldRef:
              fieldPath: metadata.uid
```

## Labels and Annotations as Environment

```yaml
# pod-labels-env.yaml
apiVersion: v1
kind: Pod
metadata:
  name: myapp
  labels:
    app: myapp
    version: v2.0.0
    environment: production
  annotations:
    config.kubernetes.io/version: "3"
spec:
  containers:
    - name: app
      image: myapp:v1
      env:
        - name: APP_LABEL
          valueFrom:
            fieldRef:
              fieldPath: metadata.labels['app']
        - name: VERSION
          valueFrom:
            fieldRef:
              fieldPath: metadata.labels['version']
        - name: ENVIRONMENT
          valueFrom:
            fieldRef:
              fieldPath: metadata.labels['environment']
        - name: CONFIG_VERSION
          valueFrom:
            fieldRef:
              fieldPath: metadata.annotations['config.kubernetes.io/version']
```

## Container Resource Limits

```yaml
# resource-limits-env.yaml
apiVersion: v1
kind: Pod
metadata:
  name: myapp
spec:
  containers:
    - name: app
      image: myapp:v1
      resources:
        requests:
          cpu: 100m
          memory: 128Mi
        limits:
          cpu: 500m
          memory: 512Mi
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
              divisor: 1Mi  # Convert to Mi
```

## Mount Metadata as Files

```yaml
# pod-metadata-volume.yaml
apiVersion: v1
kind: Pod
metadata:
  name: myapp
  labels:
    app: myapp
    tier: backend
  annotations:
    build: "1234"
    commit: "abc123"
spec:
  containers:
    - name: app
      image: myapp:v1
      volumeMounts:
        - name: podinfo
          mountPath: /etc/podinfo
          readOnly: true
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
```

```bash
# Inside the container:
cat /etc/podinfo/labels
# app="myapp"
# tier="backend"

cat /etc/podinfo/name
# myapp
```

## Resource Limits as Files

```yaml
# resource-volume.yaml
apiVersion: v1
kind: Pod
metadata:
  name: myapp
spec:
  containers:
    - name: app
      image: myapp:v1
      resources:
        limits:
          cpu: "1"
          memory: 1Gi
      volumeMounts:
        - name: resources
          mountPath: /etc/resources
  volumes:
    - name: resources
      downwardAPI:
        items:
          - path: "cpu_limit"
            resourceFieldRef:
              containerName: app
              resource: limits.cpu
              divisor: 1m
          - path: "memory_limit"
            resourceFieldRef:
              containerName: app
              resource: limits.memory
              divisor: 1Mi
```

## Deployment Example

```yaml
# deployment-downward.yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: myapp
spec:
  replicas: 3
  selector:
    matchLabels:
      app: myapp
  template:
    metadata:
      labels:
        app: myapp
        version: v1.0.0
    spec:
      containers:
        - name: app
          image: myapp:v1
          env:
            # Identity
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
            # Version from label
            - name: APP_VERSION
              valueFrom:
                fieldRef:
                  fieldPath: metadata.labels['version']
            # Resources
            - name: MEMORY_LIMIT
              valueFrom:
                resourceFieldRef:
                  resource: limits.memory
          resources:
            limits:
              memory: 512Mi
```

## Use Cases

```yaml
# 1. Logging - Include pod identity
# Application logs with pod name:
# {"pod": "$POD_NAME", "namespace": "$POD_NAMESPACE", "message": "..."}

# 2. Metrics - Label metrics with pod info
# my_metric{pod="$POD_NAME", node="$NODE_NAME"} 123

# 3. Memory-aware applications
# Java heap sizing based on container limits:
# JAVA_OPTS="-Xmx$(($MEMORY_LIMIT * 80 / 100))"

# 4. Unique instance IDs
# Using POD_NAME as unique identifier for distributed systems
```

## Available Fields

```yaml
# Pod fields (fieldRef):
# - metadata.name
# - metadata.namespace
# - metadata.uid
# - metadata.labels['<KEY>']
# - metadata.annotations['<KEY>']
# - spec.nodeName
# - spec.serviceAccountName
# - status.hostIP
# - status.podIP
# - status.podIPs

# Container resources (resourceFieldRef):
# - limits.cpu
# - limits.memory
# - limits.ephemeral-storage
# - requests.cpu
# - requests.memory
# - requests.ephemeral-storage
```

## Read Metadata in Application

```python
# Python example
import os

pod_name = os.getenv('POD_NAME')
pod_namespace = os.getenv('POD_NAMESPACE')
node_name = os.getenv('NODE_NAME')
memory_limit = int(os.getenv('MEMORY_LIMIT', 0))

print(f"Running on {node_name} as {pod_namespace}/{pod_name}")
print(f"Memory limit: {memory_limit / (1024*1024):.0f}Mi")
```

```go
// Go example
package main

import (
    "fmt"
    "os"
)

func main() {
    podName := os.Getenv("POD_NAME")
    namespace := os.Getenv("POD_NAMESPACE")
    fmt.Printf("Pod: %s/%s\n", namespace, podName)
}
```

## Summary

The Downward API exposes pod metadata without requiring API access. Use environment variables for simple values and volumes for labels/annotations. Common uses include logging context, metrics labels, and resource-aware applications. No RBAC permissions required—metadata is available to all pods.

---

## 📘 Go Further with Kubernetes Recipes

**Love this recipe? There's so much more!** This is just one of **100+ hands-on recipes** in our comprehensive **[Kubernetes Recipes book](https://amzn.to/3DzC8QA)**.

Inside the book, you'll master:
- ✅ Production-ready deployment strategies
- ✅ Advanced networking and security patterns  
- ✅ Observability, monitoring, and troubleshooting
- ✅ Real-world best practices from industry experts

> *"The practical, recipe-based approach made complex Kubernetes concepts finally click for me."*

**👉 [Get Your Copy Now](https://amzn.to/3DzC8QA)** — Start building production-grade Kubernetes skills today!
