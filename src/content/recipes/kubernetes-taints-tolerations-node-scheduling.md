---
title: "Kubernetes Taints and Tolerations Node Scheduling"
description: "Control pod scheduling with Kubernetes taints and tolerations. Dedicate nodes to specific workloads, prevent scheduling on control-plane nodes, implement GPU"
tags:
  - "taints"
  - "tolerations"
  - "scheduling"
  - "node-affinity"
  - "gpu"
category: "configuration"
publishDate: "2026-06-01"
author: "Luca Berton"
difficulty: "intermediate"
relatedRecipes:
  - "kubernetes-taint-toleration"
  - "kubernetes-pod-priority-preemption-scheduling"
  - "nvidia-gpu-operator-setup"
---

> 💡 **Quick Answer:** Taints on nodes repel pods; tolerations on pods allow them to schedule on tainted nodes. Taint a node: `kubectl taint nodes gpu-node nvidia.com/gpu=present:NoSchedule`. Only pods with a matching toleration will schedule there. Three effects: `NoSchedule` (hard), `PreferNoSchedule` (soft), `NoExecute` (evict existing pods too).

## The Problem

- GPU nodes getting filled with non-GPU workloads
- Batch jobs scheduling on production nodes, consuming resources
- Need to drain a node for maintenance without killing critical pods
- Control-plane nodes running user workloads
- Want dedicated node pools for specific teams or workload types

## The Solution

### Taint a Node

```bash
# Add taint (NoSchedule — new pods won't schedule without toleration)
kubectl taint nodes gpu-node-1 nvidia.com/gpu=present:NoSchedule

# Add taint (NoExecute — evicts existing pods without toleration)
kubectl taint nodes node-maintenance dedicated=maintenance:NoExecute

# Add taint (PreferNoSchedule — soft preference, not hard block)
kubectl taint nodes spot-node-1 cloud.example.com/spot=true:PreferNoSchedule

# Remove taint (trailing minus)
kubectl taint nodes gpu-node-1 nvidia.com/gpu=present:NoSchedule-

# View taints on a node
kubectl describe node gpu-node-1 | grep -A5 Taints
```

### Toleration in Pod Spec

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: ml-training
spec:
  template:
    spec:
      # Tolerate the GPU node taint
      tolerations:
        - key: "nvidia.com/gpu"
          operator: "Equal"
          value: "present"
          effect: "NoSchedule"
      # Also use nodeSelector to ONLY schedule on GPU nodes
      nodeSelector:
        node-type: gpu
      containers:
        - name: training
          image: registry.example.com/ml-trainer:v1
          resources:
            limits:
              nvidia.com/gpu: 1
```

### Taint Effects Explained

```text
Effect          │ New Pods                    │ Existing Pods
────────────────┼─────────────────────────────┼──────────────────────────
NoSchedule      │ Won't schedule without      │ Not affected
                │ matching toleration         │ (keep running)
────────────────┼─────────────────────────────┼──────────────────────────
PreferNoSchedule│ Tries to avoid scheduling   │ Not affected
                │ (soft, not guaranteed)      │
────────────────┼─────────────────────────────┼──────────────────────────
NoExecute       │ Won't schedule without      │ EVICTED if no toleration
                │ matching toleration         │ (with optional grace period)
────────────────┴─────────────────────────────┴──────────────────────────
```

### Toleration Operators

```yaml
# Equal: key, value, and effect must all match
tolerations:
  - key: "dedicated"
    operator: "Equal"
    value: "gpu"
    effect: "NoSchedule"

# Exists: matches any value for the key (value field ignored)
tolerations:
  - key: "dedicated"
    operator: "Exists"
    effect: "NoSchedule"

# Tolerate all taints with specific key (any effect)
tolerations:
  - key: "dedicated"
    operator: "Exists"

# Tolerate ALL taints (dangerous — schedule anywhere)
tolerations:
  - operator: "Exists"
```

### NoExecute with Grace Period

```yaml
# Pod will stay on tainted node for 300 seconds before eviction
tolerations:
  - key: "node.kubernetes.io/unreachable"
    operator: "Exists"
    effect: "NoExecute"
    tolerationSeconds: 300    # Evict after 5 minutes
```

### Dedicated Node Pools Pattern

```bash
# Taint nodes by purpose
kubectl taint nodes -l node-pool=gpu nvidia.com/gpu=present:NoSchedule
kubectl taint nodes -l node-pool=highmem dedicated=highmem:NoSchedule
kubectl taint nodes -l node-pool=batch dedicated=batch:NoSchedule
```

```yaml
# GPU workload
spec:
  tolerations:
    - key: "nvidia.com/gpu"
      operator: "Equal"
      value: "present"
      effect: "NoSchedule"
  nodeSelector:
    node-pool: gpu
---
# High-memory workload
spec:
  tolerations:
    - key: "dedicated"
      operator: "Equal"
      value: "highmem"
      effect: "NoSchedule"
  nodeSelector:
    node-pool: highmem
```

### Node Maintenance (Drain)

```bash
# Cordon (prevent new scheduling) + drain (evict existing pods)
kubectl drain node-1 --ignore-daemonsets --delete-emptydir-data

# This automatically adds taint:
# node.kubernetes.io/unschedulable:NoSchedule

# After maintenance, uncordon
kubectl uncordon node-1
```

### Built-in Taints (Added Automatically)

```text
Taint                                    │ Added When
─────────────────────────────────────────┼────────────────────────────
node.kubernetes.io/not-ready             │ Node condition NotReady
node.kubernetes.io/unreachable           │ Node controller loses contact
node.kubernetes.io/memory-pressure       │ Node under memory pressure
node.kubernetes.io/disk-pressure         │ Node disk full
node.kubernetes.io/pid-pressure          │ Too many processes on node
node.kubernetes.io/unschedulable         │ kubectl cordon
node-role.kubernetes.io/control-plane    │ Control-plane node (kubeadm)
─────────────────────────────────────────┴────────────────────────────
```

### Taint + Toleration + NodeSelector Pattern

```yaml
# Best practice: use BOTH taint+toleration AND nodeSelector
# - Taint: repels unwanted pods FROM the node
# - NodeSelector: attracts the pod TO the specific node
# Without nodeSelector, toleration just means "allowed" not "required"

spec:
  tolerations:
    - key: "dedicated"
      operator: "Equal"
      value: "ml"
      effect: "NoSchedule"
  nodeSelector:
    workload-type: ml    # REQUIRED to ensure pod goes to ML nodes
```

## Common Issues

### Pod with toleration scheduling on wrong nodes
- **Cause**: Toleration allows scheduling on tainted nodes, but doesn't restrict to them
- **Fix**: Add `nodeSelector` or `nodeAffinity` to force scheduling on specific nodes

### DaemonSet pods not running on tainted nodes
- **Cause**: DaemonSet pods need explicit tolerations for node taints
- **Fix**: Add tolerations to DaemonSet pod spec (common for monitoring/logging DaemonSets)

### All pods evicted after adding NoExecute taint
- **Cause**: `NoExecute` evicts all existing pods without matching toleration
- **Fix**: Use `NoSchedule` if you only want to prevent new pods; or add tolerations before tainting

### Can't schedule system pods after tainting all nodes
- **Cause**: CoreDNS, metrics-server need to run somewhere
- **Fix**: System pods typically tolerate control-plane taints; ensure at least some nodes are available

## Best Practices

1. **Taint + NodeSelector together** — taint repels others; nodeSelector attracts yours
2. **NoSchedule over NoExecute** — less disruptive for existing workloads
3. **Label nodes alongside taints** — labels for selection, taints for repulsion
4. **Tolerate built-in taints in critical DaemonSets** — monitoring, logging, CNI
5. **Use `tolerationSeconds` with NoExecute** — graceful eviction, not immediate
6. **Don't tolerate all (`operator: Exists`)** — defeats the purpose of taints
7. **Document your taint strategy** — maintain a node pool design doc

## Key Takeaways

- Taints on nodes repel pods; tolerations on pods allow scheduling on tainted nodes
- Three effects: `NoSchedule` (block new), `PreferNoSchedule` (soft), `NoExecute` (evict existing)
- Toleration = "I can schedule here" not "I must schedule here" — add nodeSelector for that
- `operator: Equal` matches specific key+value; `operator: Exists` matches any value
- Built-in taints auto-applied: not-ready, unreachable, memory-pressure, disk-pressure
- `kubectl drain` = cordon + evict; `kubectl uncordon` = remove unschedulable taint
- Pattern: dedicated node pools with taint + label + nodeSelector + toleration
