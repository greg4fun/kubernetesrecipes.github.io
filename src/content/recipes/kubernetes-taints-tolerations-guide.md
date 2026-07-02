---
title: "K8s Taints and Tolerations Explained"
description: "Configure Kubernetes taints and tolerations for pod scheduling. NoSchedule, PreferNoSchedule, NoExecute effects, GPU node taints, and drain behavior."
publishDate: "2026-05-02"
author: "Luca Berton"
category: "configuration"
difficulty: "intermediate"
timeToComplete: "10 minutes"
kubernetesVersion: "1.28+"
tags:
  - "taints"
  - "tolerations"
  - "scheduling"
  - "nodes"
  - "cka"
relatedRecipes:
  - "kubernetes-taint-toleration-guide"
  - "kubernetes-node-affinity-guide"
  - "kubernetes-node-untolerated-taint-master"
  - "debug-scheduling-failures"
---

> 💡 **Quick Answer:** Taints repel pods from nodes: `kubectl taint nodes node1 gpu=true:NoSchedule`. Tolerations allow pods to schedule on tainted nodes: `tolerations: [{key: "gpu", operator: "Equal", value: "true", effect: "NoSchedule"}]`. Three effects: **NoSchedule** (hard block), **PreferNoSchedule** (soft, avoid if possible), **NoExecute** (evict existing pods too). Control plane nodes have `node-role.kubernetes.io/control-plane:NoSchedule` by default.

## The Problem

Some nodes are special — you don't want arbitrary workloads on them:

- GPU nodes should only run GPU workloads
- Control plane nodes shouldn't run user pods
- Nodes being drained shouldn't accept new pods
- Dedicated nodes for specific teams or workloads

## The Solution

### Add Taints to Nodes

```bash
# Taint a node
kubectl taint nodes gpu-node-1 nvidia.com/gpu=true:NoSchedule

# Multiple taints
kubectl taint nodes gpu-node-1 dedicated=ml-team:NoSchedule

# PreferNoSchedule (soft — try to avoid, not hard block)
kubectl taint nodes spot-node-1 spot=true:PreferNoSchedule

# NoExecute (evicts existing pods without toleration!)
kubectl taint nodes node-1 maintenance=true:NoExecute

# Remove a taint (add minus at end)
kubectl taint nodes gpu-node-1 nvidia.com/gpu=true:NoSchedule-

# Check taints
kubectl describe node gpu-node-1 | grep Taint
# Taints: nvidia.com/gpu=true:NoSchedule
```

### Add Tolerations to Pods

```yaml
apiVersion: v1
kind: Pod
metadata:
  name: gpu-training
spec:
  tolerations:
  # Tolerate specific taint
  - key: "nvidia.com/gpu"
    operator: "Equal"
    value: "true"
    effect: "NoSchedule"
  
  # Tolerate by key existence (any value)
  - key: "dedicated"
    operator: "Exists"
    effect: "NoSchedule"
  
  # Tolerate NoExecute with timeout
  - key: "maintenance"
    operator: "Equal"
    value: "true"
    effect: "NoExecute"
    tolerationSeconds: 300    # Stay for 5 min, then evicted
  
  containers:
  - name: training
    image: pytorch:latest
    resources:
      limits:
        nvidia.com/gpu: 1
```

### Taint Effects

| Effect | New pods without toleration | Existing pods without toleration |
|--------|---------------------------|--------------------------------|
| `NoSchedule` | ❌ Not scheduled | ✅ Stay running |
| `PreferNoSchedule` | ⚠️ Avoid if possible | ✅ Stay running |
| `NoExecute` | ❌ Not scheduled | ❌ Evicted immediately |

### Tolerate Everything (DaemonSets)

```yaml
# System DaemonSets should run on ALL nodes including tainted ones
tolerations:
- operator: "Exists"    # Tolerates ALL taints
```

### Common Taint Patterns

```bash
# GPU nodes — only GPU workloads
kubectl taint nodes gpu-node-1 nvidia.com/gpu=present:NoSchedule

# Dedicated team nodes
kubectl taint nodes team-a-node dedicated=team-a:NoSchedule

# Spot/preemptible nodes
kubectl taint nodes spot-1 cloud.google.com/gke-spot=true:NoSchedule

# Master/control-plane (built-in)
# node-role.kubernetes.io/control-plane:NoSchedule

# Node drain (automatic)
kubectl drain node-1
# Adds: node.kubernetes.io/unschedulable:NoSchedule
```

### Schedule Pods on Control Plane

```yaml
# Tolerate control-plane taint (for small clusters / dev)
tolerations:
- key: "node-role.kubernetes.io/control-plane"
  operator: "Exists"
  effect: "NoSchedule"
```

```bash
# Or remove the taint from control plane
kubectl taint nodes control-plane-1 node-role.kubernetes.io/control-plane:NoSchedule-
```

### Built-in Node Condition Taints

```bash
# Kubernetes auto-adds these taints based on node conditions:
# node.kubernetes.io/not-ready:NoExecute
# node.kubernetes.io/unreachable:NoExecute
# node.kubernetes.io/memory-pressure:NoSchedule
# node.kubernetes.io/disk-pressure:NoSchedule
# node.kubernetes.io/pid-pressure:NoSchedule
# node.kubernetes.io/network-unavailable:NoSchedule

# Default toleration for not-ready/unreachable: 300s (5 min)
# After 5 min of node being unreachable, pods are evicted
```

## Common Issues

**"1 node(s) had untolerated taint"**

Pod doesn't tolerate node's taint. Add matching toleration or remove the taint. See: `kubectl describe pod <pod>` Events section.

**Pods evicted after adding NoExecute taint**

By design — NoExecute evicts existing pods. Use `tolerationSeconds` to give pods time to gracefully shutdown.

**DaemonSet pods not scheduling on tainted nodes**

Add `tolerations: [{operator: "Exists"}]` to the DaemonSet template. System DaemonSets (kube-proxy, CNI) already have this.

## Best Practices

- **Use taints + tolerations for node dedication** — GPUs, teams, special hardware
- **Prefer `NoSchedule` over `NoExecute`** — less disruptive
- **Use `PreferNoSchedule` for soft preferences** — scheduling falls back if needed
- **Combine with node affinity** — taints repel, affinity attracts
- **DaemonSets should tolerate all taints** — monitoring/logging must run everywhere

## Key Takeaways

- Taints on nodes repel pods; tolerations on pods override taints
- NoSchedule blocks new pods; NoExecute also evicts existing ones
- Control plane nodes are tainted by default — tolerate to schedule there
- Kubernetes auto-taints nodes with conditions (not-ready, memory-pressure)
- Combine taints (repel unwanted) with node affinity (attract wanted) for full control
