---
title: "How to Use Taints and Tolerations"
description: "Control pod scheduling with taints and tolerations. Dedicate nodes for specific workloads, handle node conditions, and implement advanced scheduling patterns."
category: "deployments"
difficulty: "intermediate"
publishDate: "2026-01-22"
tags: ["taints", "tolerations", "scheduling", "node-affinity", "workload-isolation"]
---

# How to Use Taints and Tolerations

Taints and tolerations work together to ensure pods don't schedule on inappropriate nodes. Taints repel pods, while tolerations allow pods to schedule on tainted nodes.

## Understanding Taints

```bash
# Taint format: key=value:effect
# Effects:
# - NoSchedule: New pods won't schedule
# - PreferNoSchedule: Soft version, scheduler tries to avoid
# - NoExecute: Evicts existing pods and prevents new ones

# Add taint to node
kubectl taint nodes node1 dedicated=gpu:NoSchedule

# View taints
kubectl describe node node1 | grep Taints

# Remove taint
kubectl taint nodes node1 dedicated=gpu:NoSchedule-
```

## Basic Toleration

```yaml
# pod-with-toleration.yaml
apiVersion: v1
kind: Pod
metadata:
  name: gpu-pod
spec:
  containers:
    - name: app
      image: nvidia/cuda:latest
  tolerations:
    - key: "dedicated"
      operator: "Equal"
      value: "gpu"
      effect: "NoSchedule"
```

## Toleration Operators

```yaml
# Equal operator - key, value, and effect must match
tolerations:
  - key: "dedicated"
    operator: "Equal"
    value: "gpu"
    effect: "NoSchedule"

# Exists operator - only key and effect must match (any value)
tolerations:
  - key: "dedicated"
    operator: "Exists"
    effect: "NoSchedule"

# Tolerate all effects for a key
tolerations:
  - key: "dedicated"
    operator: "Exists"

# Tolerate all taints (use with caution!)
tolerations:
  - operator: "Exists"
```

## Dedicated Nodes for Workloads

```bash
# Taint nodes for specific workloads
kubectl taint nodes gpu-node-1 workload=gpu:NoSchedule
kubectl taint nodes gpu-node-2 workload=gpu:NoSchedule
```

```yaml
# gpu-deployment.yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: ml-training
spec:
  replicas: 3
  selector:
    matchLabels:
      app: ml-training
  template:
    metadata:
      labels:
        app: ml-training
    spec:
      tolerations:
        - key: "workload"
          operator: "Equal"
          value: "gpu"
          effect: "NoSchedule"
      nodeSelector:
        accelerator: nvidia-tesla-v100
      containers:
        - name: training
          image: tensorflow/tensorflow:latest-gpu
          resources:
            limits:
              nvidia.com/gpu: 1
```

## Production vs Development Nodes

```bash
# Taint production nodes
kubectl taint nodes prod-node-1 environment=production:NoSchedule
kubectl taint nodes prod-node-2 environment=production:NoSchedule
```

```yaml
# production-workload.yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: critical-api
spec:
  selector:
    matchLabels:
      app: critical-api
  template:
    metadata:
      labels:
        app: critical-api
    spec:
      tolerations:
        - key: "environment"
          operator: "Equal"
          value: "production"
          effect: "NoSchedule"
      affinity:
        nodeAffinity:
          requiredDuringSchedulingIgnoredDuringExecution:
            nodeSelectorTerms:
              - matchExpressions:
                  - key: environment
                    operator: In
                    values:
                      - production
      containers:
        - name: api
          image: myapi:v1
```

## NoExecute for Eviction Control

```bash
# Add NoExecute taint - evicts pods without toleration
kubectl taint nodes node1 maintenance=true:NoExecute
```

```yaml
# toleration-with-seconds.yaml
apiVersion: v1
kind: Pod
metadata:
  name: tolerant-pod
spec:
  containers:
    - name: app
      image: nginx
  tolerations:
    - key: "maintenance"
      operator: "Equal"
      value: "true"
      effect: "NoExecute"
      tolerationSeconds: 3600  # Stay for 1 hour after taint applied
```

## Built-in Taints

```yaml
# Kubernetes automatically adds these taints
# node.kubernetes.io/not-ready - Node not ready
# node.kubernetes.io/unreachable - Node unreachable
# node.kubernetes.io/memory-pressure - Node has memory pressure
# node.kubernetes.io/disk-pressure - Node has disk pressure
# node.kubernetes.io/pid-pressure - Node has PID pressure
# node.kubernetes.io/network-unavailable - Network not available
# node.kubernetes.io/unschedulable - Node is cordoned

# Default tolerations added by admission controller
tolerations:
  - key: "node.kubernetes.io/not-ready"
    operator: "Exists"
    effect: "NoExecute"
    tolerationSeconds: 300
  - key: "node.kubernetes.io/unreachable"
    operator: "Exists"
    effect: "NoExecute"
    tolerationSeconds: 300
```

## Custom Eviction Behavior

```yaml
# fast-eviction.yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: stateless-app
spec:
  template:
    spec:
      tolerations:
        # Evict quickly when node is not ready
        - key: "node.kubernetes.io/not-ready"
          operator: "Exists"
          effect: "NoExecute"
          tolerationSeconds: 30
        # Evict quickly when node is unreachable
        - key: "node.kubernetes.io/unreachable"
          operator: "Exists"
          effect: "NoExecute"
          tolerationSeconds: 30
      containers:
        - name: app
          image: myapp:v1
```

## DaemonSet Tolerations

```yaml
# daemonset-all-nodes.yaml
apiVersion: apps/v1
kind: DaemonSet
metadata:
  name: monitoring-agent
spec:
  selector:
    matchLabels:
      app: monitoring-agent
  template:
    metadata:
      labels:
        app: monitoring-agent
    spec:
      tolerations:
        # Tolerate all taints to run on every node
        - operator: "Exists"
      containers:
        - name: agent
          image: monitoring/agent:v1
```

## Taint-Based Eviction for Maintenance

```bash
#!/bin/bash
# maintenance.sh - Graceful node maintenance

NODE=$1

# Add taint to stop new pods and gradually evict existing
kubectl taint nodes $NODE maintenance=true:NoSchedule

# Wait for workloads to migrate (pods with tolerationSeconds)
sleep 60

# Drain remaining pods
kubectl drain $NODE --ignore-daemonsets --delete-emptydir-data

# Perform maintenance...
echo "Performing maintenance on $NODE"

# Restore node
kubectl uncordon $NODE
kubectl taint nodes $NODE maintenance=true:NoSchedule-
```

## Spot/Preemptible Node Handling

```bash
# Taint spot instances
kubectl taint nodes spot-node-1 cloud.google.com/gke-preemptible=true:NoSchedule
```

```yaml
# spot-tolerant-workload.yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: batch-processor
spec:
  template:
    spec:
      tolerations:
        - key: "cloud.google.com/gke-preemptible"
          operator: "Exists"
          effect: "NoSchedule"
        - key: "kubernetes.azure.com/scalesetpriority"
          operator: "Equal"
          value: "spot"
          effect: "NoSchedule"
      containers:
        - name: processor
          image: batch/processor:v1
```

## Multi-Tenant Isolation

```bash
# Taint nodes for different teams
kubectl taint nodes team-a-node-1 team=team-a:NoSchedule
kubectl taint nodes team-b-node-1 team=team-b:NoSchedule
```

```yaml
# team-a-deployment.yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: team-a-app
  namespace: team-a
spec:
  template:
    spec:
      tolerations:
        - key: "team"
          operator: "Equal"
          value: "team-a"
          effect: "NoSchedule"
      nodeSelector:
        team: team-a
      containers:
        - name: app
          image: team-a/app:v1
```

## Check Taint Status

```bash
# View all node taints
kubectl get nodes -o custom-columns='NAME:.metadata.name,TAINTS:.spec.taints'

# View taints on specific node
kubectl describe node node1 | grep -A 5 Taints

# Find nodes without taints
kubectl get nodes -o json | jq '.items[] | select(.spec.taints == null) | .metadata.name'

# Find pods that can tolerate a taint
kubectl get pods -A -o json | jq '.items[] | select(.spec.tolerations[]? | .key == "dedicated") | .metadata.name'
```

## Common Patterns

```yaml
# Pattern 1: Dedicated nodes with both taint and label
# Taint prevents unwanted pods
# Node selector ensures pods go to right nodes

# Pattern 2: Soft preference with PreferNoSchedule
tolerations:
  - key: "preferred-nodes"
    operator: "Exists"
    effect: "PreferNoSchedule"

# Pattern 3: Graceful degradation
tolerations:
  - key: "degraded-performance"
    operator: "Exists"
    effect: "NoSchedule"  # Still schedule on degraded nodes
  - key: "node-offline"
    operator: "Exists"
    effect: "NoExecute"
    tolerationSeconds: 60  # But leave quickly if offline
```

## Summary

Taints and tolerations control pod scheduling by repelling pods from nodes unless they have matching tolerations. Use `NoSchedule` for hard restrictions, `PreferNoSchedule` for soft preferences, and `NoExecute` for eviction control. Combine with node selectors or affinity for complete scheduling control. Always consider built-in taints for node conditions and set appropriate `tolerationSeconds` for graceful handling.

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
