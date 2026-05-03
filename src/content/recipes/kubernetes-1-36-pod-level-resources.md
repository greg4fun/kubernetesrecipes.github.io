---
title: "Kubernetes 1.36 Pod-Level Resource Limits"
description: "Set resource requests and limits at the Pod level in Kubernetes 1.36 instead of per-container. Simplifies multi-container Pod resource management."
tags:
  - "kubernetes-1.36"
  - "resources"
  - "pods"
  - "vertical-scaling"
  - "sidecar"
category: "configuration"
publishDate: "2026-05-03"
author: "Luca Berton"
difficulty: "intermediate"
relatedRecipes:
  - "kubernetes-resource-limits-cpu-memory-format"
  - "kubernetes-resource-quota-limitrange"
  - "kubernetes-sidecar-containers-guide"
---

> 💡 **Quick Answer:** Kubernetes 1.36 introduces **Pod-level resource requests and limits** (KEP-5419). Set a single resource budget for the entire Pod instead of configuring each container individually — ideal for sidecar-heavy workloads.

## The Problem

With per-container resource limits, multi-container Pods are hard to manage:

- **Sidecar overhead**: Envoy, logging, and monitoring sidecars each need their own resource config
- **Over-provisioning**: Each container gets headroom "just in case," wasting cluster resources
- **Rigid allocation**: Container A can't borrow idle CPU from Container B within the same Pod
- **VPA complexity**: Vertical Pod Autoscaler must tune each container independently
- **Init container gotcha**: Init container resources are added separately, inflating Pod requests

## The Solution

Pod-level resources define a shared budget that all containers in the Pod draw from.

### Set Pod-Level Resources

```yaml
apiVersion: v1
kind: Pod
metadata:
  name: app-with-sidecars
spec:
  resources:
    requests:
      cpu: "2"
      memory: "4Gi"
    limits:
      cpu: "4"
      memory: "8Gi"
  containers:
    - name: app
      image: registry.example.com/app:v3.0
      # No per-container resources needed!
    - name: envoy
      image: envoyproxy/envoy:v1.32
    - name: log-collector
      image: fluent/fluent-bit:3.2
    - name: otel-collector
      image: otel/opentelemetry-collector:0.100
```

All four containers share the 2 CPU / 4Gi request and 4 CPU / 8Gi limit pool.

### Mixed: Pod-Level + Container-Level

```yaml
apiVersion: v1
kind: Pod
metadata:
  name: mixed-resources
spec:
  resources:
    requests:
      cpu: "4"
      memory: "8Gi"
    limits:
      cpu: "8"
      memory: "16Gi"
  containers:
    - name: app
      image: registry.example.com/app:v3.0
      resources:
        requests:
          cpu: "2"        # Guaranteed minimum within Pod budget
          memory: "4Gi"
    - name: gpu-sidecar
      image: registry.example.com/inference:v1.0
      # Uses remaining Pod budget (2 CPU, 4Gi)
```

### Deployment with Pod-Level Resources

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: microservice
spec:
  replicas: 3
  selector:
    matchLabels:
      app: microservice
  template:
    metadata:
      labels:
        app: microservice
    spec:
      resources:
        requests:
          cpu: "1"
          memory: "2Gi"
        limits:
          cpu: "2"
          memory: "4Gi"
      containers:
        - name: app
          image: registry.example.com/api:v2.0
          ports:
            - containerPort: 8080
        - name: envoy
          image: envoyproxy/envoy:v1.32
```

### With In-Place Vertical Scaling

```yaml
apiVersion: v1
kind: Pod
metadata:
  name: elastic-pod
spec:
  resources:
    requests:
      cpu: "2"
      memory: "4Gi"
    limits:
      cpu: "8"
      memory: "16Gi"
  resizePolicy:
    - resourceName: cpu
      restartPolicy: NotRequired
    - resourceName: memory
      restartPolicy: NotRequired
  containers:
    - name: app
      image: registry.example.com/app:v3.0
```

The Pod can scale from 2→8 CPU without restart, and the budget is shared across all containers.

## Common Issues

### Pod rejected by admission controller
- **Cause**: LimitRange enforces per-container limits, conflicts with Pod-level
- **Fix**: Update LimitRange policies to support Pod-level resource specifications

### ResourceQuota not accounting correctly
- **Cause**: Quota controller using old per-container calculation
- **Fix**: Ensure cluster is fully upgraded to 1.36; quota respects Pod-level resources

### Container OOMKilled despite Pod having headroom
- **Cause**: Kernel cgroup limits are still per-container in some configurations
- **Fix**: Verify kubelet cgroup driver supports Pod-level cgroup hierarchy

## Best Practices

1. **Use Pod-level for sidecar-heavy workloads** — 3+ containers benefit most
2. **Keep per-container limits for critical containers** — guarantee minimums where needed
3. **Combine with VPA** — VPA can tune the Pod-level budget automatically
4. **Monitor per-container usage** — even with Pod-level limits, track which container uses what
5. **Update LimitRange policies** — ensure admission policies support the new model

## Key Takeaways

- Pod-level resources are available in **Kubernetes 1.36** (KEP-5419)
- Set one resource budget shared by all containers in a Pod
- Containers can borrow idle resources from each other within the Pod
- Combines with in-place vertical scaling for elastic Pod resizing
- Simplifies resource management for sidecar-heavy microservice architectures
