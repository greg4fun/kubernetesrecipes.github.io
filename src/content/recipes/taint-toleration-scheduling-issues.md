---
title: "Debug Taint and Toleration Scheduling"
description: "Fix pods stuck Pending due to node taints. Understand NoSchedule, PreferNoSchedule, NoExecute effects and toleration syntax."
publishDate: "2026-03-19"
author: "Luca Berton"
category: "troubleshooting"
difficulty: "beginner"
timeToComplete: "15 minutes"
kubernetesVersion: "1.28+"
tags:
  - taints
  - tolerations
  - scheduling
  - nodes
  - troubleshooting
relatedRecipes:
  - "debug-crashloopbackoff"
  - "debug-pod-eviction-reasons"
  - "openshift-node-cordon-uncordon"
---
> 💡 **Quick Answer:** Pending pods with "0/N nodes are available: N node(s) had taints that the pod didn't tolerate" need matching tolerations. Check node taints with `kubectl describe node <node> | grep Taints`, then add tolerations to the pod spec.

## The Problem

Pods are stuck in Pending. `kubectl describe pod` shows:
```
Events:
  Warning  FailedScheduling  0/6 nodes are available:
    3 node(s) had untolerated taint {node-role.kubernetes.io/master: },
    3 node(s) had untolerated taint {dedicated: gpu}
```

## The Solution

### Step 1: Check Node Taints

```bash
# List taints on all nodes
kubectl get nodes -o custom-columns='NAME:.metadata.name,TAINTS:.spec.taints[*].key'

# Detailed view for a specific node
kubectl describe node gpu-worker-1 | grep -A3 Taints:
# Taints: dedicated=gpu:NoSchedule
#         nvidia.com/gpu=present:NoSchedule
```

### Step 2: Add Tolerations

```yaml
spec:
  tolerations:
    # Tolerate the gpu taint
    - key: "dedicated"
      operator: "Equal"
      value: "gpu"
      effect: "NoSchedule"
    # Tolerate any NVIDIA GPU taint
    - key: "nvidia.com/gpu"
      operator: "Exists"
      effect: "NoSchedule"
```

### Taint Effects Explained

| Effect | Behavior | Existing Pods |
|--------|----------|---------------|
| `NoSchedule` | New pods without toleration won't schedule | Unaffected |
| `PreferNoSchedule` | Scheduler tries to avoid, but will place if needed | Unaffected |
| `NoExecute` | New pods rejected AND existing pods evicted | Evicted if no toleration |

### Step 3: Common Taint Patterns

```bash
# Add a taint to a node
kubectl taint nodes worker-3 maintenance=true:NoSchedule

# Remove a taint (note the trailing minus)
kubectl taint nodes worker-3 maintenance=true:NoSchedule-

# Taint GPU nodes
kubectl taint nodes gpu-worker-1 dedicated=gpu:NoSchedule
```

## Common Issues

### Toleration Key/Value Mismatch

Tolerations must match exactly:
```yaml
# Node taint: dedicated=gpu:NoSchedule
# ✅ Correct:
- key: "dedicated"
  value: "gpu"
  effect: "NoSchedule"
# ❌ Wrong value:
- key: "dedicated"
  value: "GPU"       # Case-sensitive!
```

### Master Node Taints

Master/control-plane nodes have `node-role.kubernetes.io/master:NoSchedule`. Only add tolerations for this if you intentionally want to schedule on masters.

### NoExecute Evicts Running Pods

Adding a `NoExecute` taint to a node evicts all pods without matching tolerations — use carefully!

## Best Practices

- **Use `NoSchedule` for dedicated node pools** (GPU, infra, storage)
- **Use `PreferNoSchedule`** when you want soft preference, not hard requirement
- **Use `NoExecute` sparingly** — it evicts running pods
- **Combine taints with nodeSelector** — taint to repel others, nodeSelector to attract specific workloads
- **Document taints** — maintain a list of what taints exist and why

## Key Takeaways

- Taints repel pods; tolerations allow pods to schedule on tainted nodes
- `NoSchedule` is the most common — prevents scheduling without evicting
- Tolerations must match the taint's key, value, and effect exactly
- Use `operator: Exists` to tolerate a key regardless of value
- Control-plane taints are normal — don't tolerate them unless needed
