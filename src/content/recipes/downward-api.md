---
title: "How to Use Kubernetes Downward API"
description: "Expose pod and container metadata to applications. Access pod name, namespace, labels, annotations, and resource limits from within containers."
category: "configuration"
difficulty: "beginner"
publishDate: "2026-01-22"
tags: ["downward-api", "metadata", "environment", "pod-info", "configuration"]
---

# How to Use Kubernetes Downward API

The Downward API exposes pod and container metadata to running applications. Access pod name, namespace, labels, annotations, and resource information without calling the Kubernetes API.

## Environment Variables Method

```yaml
# env-downward-api.yaml
apiVersion: v1
kind: Pod
metadata:
  name: downward-api-demo
  labels:
    app: demo
    version: v1
  annotations:
    description: "Demo pod for Downward API"
spec:
  containers:
    - name: app
      image: busybox
      command: ["sh", "-c", "env && sleep 3600"]
      env:
        # Pod information
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
        - name: POD_SERVICE_ACCOUNT
          valueFrom:
            fieldRef:
              fieldPath: spec.serviceAccountName
        
        # Node information
        - name: NODE_NAME
          valueFrom:
            fieldRef:
              fieldPath: spec.nodeName
        - name: NODE_IP
          valueFrom:
            fieldRef:
              fieldPath: status.hostIP
        
        # Container resources
        - name: CPU_REQUEST
          valueFrom:
            resourceFieldRef:
              containerName: app
              resource: requests.cpu
        - name: MEMORY_LIMIT
          valueFrom:
            resourceFieldRef:
              containerName: app
              resource: limits.memory
      resources:
        requests:
          cpu: "100m"
          memory: "128Mi"
        limits:
          cpu: "500m"
          memory: "256Mi"
```

## Volume Files Method

```yaml
# volume-downward-api.yaml
apiVersion: v1
kind: Pod
metadata:
  name: downward-api-volume
  labels:
    app: demo
    environment: production
  annotations:
    build: "12345"
    team: platform
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
          - path: "name"
            fieldRef:
              fieldPath: metadata.name
          - path: "namespace"
            fieldRef:
              fieldPath: metadata.namespace
          - path: "labels"
            fieldRef:
              fieldPath: metadata.labels
          - path: "annotations"
            fieldRef:
              fieldPath: metadata.annotations
          - path: "cpu_request"
            resourceFieldRef:
              containerName: app
              resource: requests.cpu
              divisor: "1m"  # millicores
          - path: "memory_limit"
            resourceFieldRef:
              containerName: app
              resource: limits.memory
              divisor: "1Mi"  # mebibytes
```

## Available Fields

```yaml
# Pod fields (fieldRef)
metadata.name           # Pod name
metadata.namespace      # Pod namespace
metadata.uid           # Pod UID
metadata.labels['key'] # Specific label
metadata.annotations['key'] # Specific annotation
spec.nodeName          # Node name
spec.serviceAccountName # Service account
status.hostIP          # Node IP
status.podIP           # Pod IP
status.podIPs          # All pod IPs (dual-stack)

# Resource fields (resourceFieldRef)
requests.cpu           # CPU request
requests.memory        # Memory request
requests.ephemeral-storage # Ephemeral storage request
limits.cpu             # CPU limit
limits.memory          # Memory limit
limits.ephemeral-storage # Ephemeral storage limit
```

## Labels and Annotations

```yaml
# specific-labels.yaml
apiVersion: v1
kind: Pod
metadata:
  name: label-demo
  labels:
    app: myapp
    version: "1.0"
    team: backend
spec:
  containers:
    - name: app
      image: busybox
      command: ["sh", "-c", "echo $APP_NAME $APP_VERSION && sleep 3600"]
      env:
        # Specific label values
        - name: APP_NAME
          valueFrom:
            fieldRef:
              fieldPath: metadata.labels['app']
        - name: APP_VERSION
          valueFrom:
            fieldRef:
              fieldPath: metadata.labels['version']
        - name: TEAM
          valueFrom:
            fieldRef:
              fieldPath: metadata.labels['team']
```

## Resource Units and Divisors

```yaml
# resource-divisors.yaml
apiVersion: v1
kind: Pod
metadata:
  name: resource-demo
spec:
  containers:
    - name: app
      image: busybox
      command: ["sh", "-c", "cat /etc/podinfo/*"]
      resources:
        requests:
          cpu: "250m"
          memory: "64Mi"
        limits:
          cpu: "1"
          memory: "256Mi"
      volumeMounts:
        - name: podinfo
          mountPath: /etc/podinfo
  volumes:
    - name: podinfo
      downwardAPI:
        items:
          # CPU in millicores (250)
          - path: "cpu_request_millicores"
            resourceFieldRef:
              containerName: app
              resource: requests.cpu
              divisor: "1m"
          # CPU as decimal (0.25)
          - path: "cpu_request_cores"
            resourceFieldRef:
              containerName: app
              resource: requests.cpu
              divisor: "1"
          # Memory in bytes
          - path: "memory_limit_bytes"
            resourceFieldRef:
              containerName: app
              resource: limits.memory
              divisor: "1"
          # Memory in mebibytes (256)
          - path: "memory_limit_mi"
            resourceFieldRef:
              containerName: app
              resource: limits.memory
              divisor: "1Mi"
```

## Use in Application

```python
# Python - read from environment
import os

pod_name = os.environ.get('POD_NAME')
pod_namespace = os.environ.get('POD_NAMESPACE')
node_name = os.environ.get('NODE_NAME')
memory_limit = os.environ.get('MEMORY_LIMIT')

print(f"Running {pod_name} in {pod_namespace} on {node_name}")
print(f"Memory limit: {memory_limit}")
```

```go
// Go - read from environment
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

```javascript
// Node.js - read from files
const fs = require('fs');

const podName = fs.readFileSync('/etc/podinfo/name', 'utf8').trim();
const labels = fs.readFileSync('/etc/podinfo/labels', 'utf8');

console.log(`Pod name: ${podName}`);
console.log(`Labels:\n${labels}`);
```

## Practical Use Cases

```yaml
# logging-context.yaml
# Add pod context to application logs
apiVersion: apps/v1
kind: Deployment
metadata:
  name: logging-app
spec:
  template:
    spec:
      containers:
        - name: app
          image: myapp:v1
          env:
            - name: LOG_POD_NAME
              valueFrom:
                fieldRef:
                  fieldPath: metadata.name
            - name: LOG_NODE_NAME
              valueFrom:
                fieldRef:
                  fieldPath: spec.nodeName
            - name: LOG_NAMESPACE
              valueFrom:
                fieldRef:
                  fieldPath: metadata.namespace
```

```yaml
# memory-aware-app.yaml
# Application adjusts based on available memory
apiVersion: apps/v1
kind: Deployment
metadata:
  name: memory-aware-app
spec:
  template:
    spec:
      containers:
        - name: app
          image: jvm-app:v1
          env:
            - name: MEMORY_LIMIT_BYTES
              valueFrom:
                resourceFieldRef:
                  resource: limits.memory
          command:
            - java
            - -XX:MaxRAMPercentage=75.0  # Use 75% of container limit
            - -jar
            - app.jar
          resources:
            limits:
              memory: "2Gi"
```

```yaml
# prometheus-labels.yaml
# Expose labels as Prometheus metrics
apiVersion: v1
kind: Pod
metadata:
  name: metrics-app
  labels:
    app: myapp
    version: v2
spec:
  containers:
    - name: app
      image: myapp:v2
      env:
        - name: APP_LABEL
          valueFrom:
            fieldRef:
              fieldPath: metadata.labels['app']
        - name: VERSION_LABEL
          valueFrom:
            fieldRef:
              fieldPath: metadata.labels['version']
      # App exposes these as metric labels
```

## File Updates (Volume Method)

```yaml
# Labels and annotations via volume are updated
# when they change (unlike env vars)
volumes:
  - name: podinfo
    downwardAPI:
      items:
        - path: "labels"
          fieldRef:
            fieldPath: metadata.labels  # Updates dynamically
```

```bash
# Verify file contents
kubectl exec downward-api-volume -- cat /etc/podinfo/labels

# Update labels and check again
kubectl label pod downward-api-volume newlabel=value
kubectl exec downward-api-volume -- cat /etc/podinfo/labels
```

## Summary

The Downward API exposes pod metadata to containers via environment variables or volume files. Use environment variables for static values like pod name, namespace, and node name. Use volume files for labels and annotations that may change. Resource fields expose CPU and memory requests/limits with configurable units via divisors. Common use cases include logging context, memory-aware JVM tuning, and Prometheus metric labeling. Volume-mounted files update dynamically when labels/annotations change, while environment variables are set at container start.

---

## 📘 Go Further with Kubernetes Recipes

**Love this recipe? There's so much more!** This is just one of **100+ hands-on recipes** in our comprehensive **[Kubernetes Recipes book](/book)**.

Inside the book, you'll master:
- ✅ Production-ready deployment strategies
- ✅ Advanced networking and security patterns  
- ✅ Observability, monitoring, and troubleshooting
- ✅ Real-world best practices from industry experts

> *"The practical, recipe-based approach made complex Kubernetes concepts finally click for me."*

**👉 [Get Your Copy Now](/book)** — Start building production-grade Kubernetes skills today!
