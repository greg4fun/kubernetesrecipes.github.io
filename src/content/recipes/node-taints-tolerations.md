---
title: "How to Implement Kubernetes Taints and Tolerations"
description: "Control pod scheduling with taints and tolerations. Dedicate nodes for specific workloads, handle node conditions, and implement scheduling constraints."
category: "configuration"
difficulty: "intermediate"
publishDate: "2026-01-22"
tags: ["taints", "tolerations", "scheduling", "dedicated-nodes", "workloads"]
---

# How to Implement Kubernetes Taints and Tolerations

Taints and tolerations control which pods can schedule on which nodes. Taints repel pods, while tolerations allow pods to schedule on tainted nodes.

## Understanding Taints

```bash
# Taint syntax: key=value:effect
# Effects:
# - NoSchedule: Don't schedule new pods (existing pods stay)
# - PreferNoSchedule: Soft version, avoid if possible
# - NoExecute: Evict existing pods and don't schedule new ones

# Add taint to node
kubectl taint nodes node1 dedicated=gpu:NoSchedule

# View node taints
kubectl describe node node1 | grep Taints

# Remove taint (note the minus sign)
kubectl taint nodes node1 dedicated=gpu:NoSchedule-
```

## Basic Taint and Toleration

```bash
# Taint a node for special workloads
kubectl taint nodes node1 workload=ml:NoSchedule
```

```yaml
# Pod that tolerates the taint
apiVersion: v1
kind: Pod
metadata:
  name: ml-pod
spec:
  tolerations:
    - key: "workload"
      operator: "Equal"
      value: "ml"
      effect: "NoSchedule"
  containers:
    - name: ml
      image: ml-image:v1
```

## Toleration Operators

```yaml
# Equal operator (key, value, and effect must match)
tolerations:
  - key: "dedicated"
    operator: "Equal"
    value: "gpu"
    effect: "NoSchedule"

# Exists operator (only key and effect must match)
tolerations:
  - key: "dedicated"
    operator: "Exists"
    effect: "NoSchedule"

# Tolerate all taints with specific key
tolerations:
  - key: "dedicated"
    operator: "Exists"

# Tolerate all taints (use carefully!)
tolerations:
  - operator: "Exists"
```

## Dedicated GPU Nodes

```bash
# Taint GPU nodes
kubectl taint nodes gpu-node-1 nvidia.com/gpu=present:NoSchedule
kubectl taint nodes gpu-node-2 nvidia.com/gpu=present:NoSchedule
```

```yaml
# gpu-deployment.yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: gpu-workload
spec:
  replicas: 2
  selector:
    matchLabels:
      app: gpu-workload
  template:
    metadata:
      labels:
        app: gpu-workload
    spec:
      tolerations:
        - key: "nvidia.com/gpu"
          operator: "Equal"
          value: "present"
          effect: "NoSchedule"
      nodeSelector:
        accelerator: nvidia  # Also require the node label
      containers:
        - name: cuda
          image: nvidia/cuda:latest
          resources:
            limits:
              nvidia.com/gpu: 1
```

## Production Node Isolation

```bash
# Taint production nodes
kubectl taint nodes prod-node-1 environment=production:NoSchedule
kubectl taint nodes prod-node-2 environment=production:NoSchedule
```

```yaml
# Only production workloads can run on these nodes
apiVersion: apps/v1
kind: Deployment
metadata:
  name: prod-app
  namespace: production
spec:
  template:
    spec:
      tolerations:
        - key: "environment"
          operator: "Equal"
          value: "production"
          effect: "NoSchedule"
      containers:
        - name: app
          image: myapp:v1
```

## NoExecute Taint with Eviction

```bash
# Taint with NoExecute evicts existing pods
kubectl taint nodes node1 maintenance=scheduled:NoExecute
```

```yaml
# Pod with tolerationSeconds (will be evicted after delay)
apiVersion: v1
kind: Pod
metadata:
  name: tolerant-pod
spec:
  tolerations:
    - key: "maintenance"
      operator: "Equal"
      value: "scheduled"
      effect: "NoExecute"
      tolerationSeconds: 3600  # Stay for 1 hour, then evict
  containers:
    - name: app
      image: nginx
```

## Built-in Node Condition Taints

```bash
# Kubernetes automatically adds taints for node conditions:
# node.kubernetes.io/not-ready:NoExecute
# node.kubernetes.io/unreachable:NoExecute
# node.kubernetes.io/memory-pressure:NoSchedule
# node.kubernetes.io/disk-pressure:NoSchedule
# node.kubernetes.io/pid-pressure:NoSchedule
# node.kubernetes.io/network-unavailable:NoSchedule
# node.kubernetes.io/unschedulable:NoSchedule

# View automatic taints
kubectl describe node <node> | grep Taints
```

```yaml
# Tolerate node conditions (for critical pods)
apiVersion: v1
kind: Pod
metadata:
  name: critical-pod
spec:
  tolerations:
    - key: "node.kubernetes.io/not-ready"
      operator: "Exists"
      effect: "NoExecute"
      tolerationSeconds: 300
    - key: "node.kubernetes.io/unreachable"
      operator: "Exists"
      effect: "NoExecute"
      tolerationSeconds: 300
  containers:
    - name: critical
      image: critical-app:v1
```

## Spot/Preemptible Instance Taints

```yaml
# Cloud providers taint spot instances automatically
# AWS: eks.amazonaws.com/capacityType=SPOT:NoSchedule
# Azure: kubernetes.azure.com/scalesetpriority=spot:NoSchedule
# GCP: cloud.google.com/gke-preemptible=true:NoSchedule

apiVersion: apps/v1
kind: Deployment
metadata:
  name: spot-workload
spec:
  template:
    spec:
      tolerations:
        - key: "kubernetes.azure.com/scalesetpriority"
          operator: "Equal"
          value: "spot"
          effect: "NoSchedule"
        - key: "eks.amazonaws.com/capacityType"
          operator: "Equal"
          value: "SPOT"
          effect: "NoSchedule"
      containers:
        - name: batch
          image: batch-processor:v1
```

## Control Plane Tolerations

```yaml
# Run pod on control plane nodes
apiVersion: v1
kind: Pod
metadata:
  name: control-plane-pod
spec:
  tolerations:
    - key: "node-role.kubernetes.io/control-plane"
      operator: "Exists"
      effect: "NoSchedule"
    - key: "node-role.kubernetes.io/master"
      operator: "Exists"
      effect: "NoSchedule"
  nodeSelector:
    node-role.kubernetes.io/control-plane: ""
  containers:
    - name: monitoring
      image: monitoring-agent:v1
```

## DaemonSet Tolerations

```yaml
# DaemonSet that runs on all nodes including tainted ones
apiVersion: apps/v1
kind: DaemonSet
metadata:
  name: node-exporter
spec:
  selector:
    matchLabels:
      app: node-exporter
  template:
    metadata:
      labels:
        app: node-exporter
    spec:
      tolerations:
        - operator: "Exists"  # Tolerate all taints
      containers:
        - name: exporter
          image: prom/node-exporter:latest
```

## Manage Taints in Batch

```bash
# Taint multiple nodes
kubectl taint nodes node1 node2 node3 environment=staging:NoSchedule

# Remove taint from multiple nodes
kubectl taint nodes node1 node2 node3 environment=staging:NoSchedule-

# Taint all nodes with label
kubectl taint nodes -l node-type=compute dedicated=compute:NoSchedule

# List all tainted nodes
kubectl get nodes -o custom-columns='NAME:.metadata.name,TAINTS:.spec.taints[*].key'
```

## Summary

Taints and tolerations control pod placement by allowing nodes to repel pods that don't tolerate their taints. Use `NoSchedule` to prevent new pods, `PreferNoSchedule` for soft preference, and `NoExecute` to evict existing pods. Common patterns include dedicating nodes for GPU workloads, isolating production environments, and handling spot instances. Kubernetes automatically adds taints for node conditions like `not-ready` and `memory-pressure`. Combine taints with node selectors for precise scheduling control. DaemonSets often need broad tolerations to run on all nodes.
