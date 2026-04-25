---
title: "DaemonSet Update Strategies Kubernetes"
description: "Configure DaemonSet rolling updates with maxUnavailable, OnDelete strategy, partition rollouts, and canary updates for node-level workloads like log collec."
publishDate: "2026-04-24"
author: "Luca Berton"
category: "deployments"
difficulty: "intermediate"
timeToComplete: "15 minutes"
kubernetesVersion: "1.28+"
tags:
  - "daemonset"
  - "rolling-update"
  - "ondelete"
  - "node-agent"
relatedRecipes:
  - "kubernetes-rolling-update-strategies"
  - "kubernetes-node-affinity-scheduling"
---

> 💡 **Quick Answer:** Use `updateStrategy.type: RollingUpdate` with `maxUnavailable: 1` for controlled DaemonSet rollouts. Use `OnDelete` for manual control — pods only update when manually deleted. For canary updates, use node selectors to target specific nodes first.

## The Problem

DaemonSets run on every node (log collectors, monitoring agents, CNI plugins). Updating them affects all nodes simultaneously by default. A bad update can break networking or observability cluster-wide. You need controlled rollout strategies.

## The Solution

### RollingUpdate Strategy

```yaml
apiVersion: apps/v1
kind: DaemonSet
metadata:
  name: fluentd
spec:
  updateStrategy:
    type: RollingUpdate
    rollingUpdate:
      maxUnavailable: 1
      maxSurge: 0
  template:
    spec:
      containers:
        - name: fluentd
          image: registry.example.com/fluentd:v1.17
```

`maxUnavailable: 1` means only one node at a time loses its DaemonSet pod during updates.

### OnDelete Strategy (Manual Control)

```yaml
updateStrategy:
  type: OnDelete
```

Pods only update when manually deleted: `kubectl delete pod fluentd-xxxxx`. Use for CNI plugins where simultaneous updates could break networking.

### Canary with Node Selectors

```yaml
# Step 1: Label canary nodes
kubectl label nodes worker-1 worker-2 daemonset-canary=true

# Step 2: Deploy canary DaemonSet targeting labeled nodes
spec:
  template:
    spec:
      nodeSelector:
        daemonset-canary: "true"
```

```mermaid
graph TD
    subgraph RollingUpdate maxUnavailable=1
        N1[Node 1: v2 ✅] --> N2[Node 2: updating...] --> N3[Node 3: v1 waiting]
    end
    subgraph OnDelete
        N4[Node 1: v1] --> DEL[Manual delete] --> N5[Node 1: v2]
    end
```

## Common Issues

**DaemonSet rollout stuck**

Check `kubectl rollout status daemonset/fluentd`. If pods can't schedule (resource limits, node taints), the rollout blocks. Use `kubectl describe pod` on pending pods.

**CNI plugin update breaks networking**

Use `OnDelete` strategy for CNI DaemonSets. Rolling updates can cause brief network outages as the old CNI pod terminates before the new one is ready.

## Best Practices

- **`maxUnavailable: 1` for most DaemonSets** — safe, controlled rollout
- **`OnDelete` for CNI plugins** — manual control prevents network disruptions
- **Canary with node labels** before full rollout — validate on 2-3 nodes first
- **Monitor with `kubectl rollout status`** — watch progress in real-time
- **`minReadySeconds: 30`** — ensure pod is stable before moving to next node

## Key Takeaways

- RollingUpdate with `maxUnavailable: 1` is the safe default for DaemonSets
- OnDelete gives manual control — pods only update when explicitly deleted
- Canary updates use node selectors to target specific nodes first
- CNI and networking DaemonSets should use OnDelete to prevent cluster-wide outages
- `minReadySeconds` prevents cascading failures from fast but unhealthy updates
