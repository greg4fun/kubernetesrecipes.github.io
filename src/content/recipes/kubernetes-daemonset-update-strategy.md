---
title: "DaemonSet Update Strategies"
description: "Configure DaemonSet rolling updates with maxUnavailable and maxSurge. Understand OnDelete vs RollingUpdate strategies for node-level workloads."
publishDate: "2026-04-21"
author: "Luca Berton"
category: "deployments"
difficulty: "intermediate"
timeToComplete: "10 minutes"
kubernetesVersion: "1.28+"
tags:
  - daemonset
  - update-strategy
  - rolling-update
  - node-agents
relatedRecipes:
  - "kubernetes-rolling-update-strategy"
  - "kubernetes-pod-disruption-budget-guide"
  - "openshift-machineconfig-mcp-guide"
---

> 💡 **Quick Answer:** DaemonSets support `RollingUpdate` (automatic, one node at a time) and `OnDelete` (manual, update only when pod is deleted). Use `maxUnavailable` and `maxSurge` to control rollout speed.

## The Problem

DaemonSets run on every node (monitoring agents, log collectors, network plugins). Updating them requires care:
- Taking down all monitoring at once blinds you during the rollout
- Network plugins (CNI) can't tolerate downtime — traffic drops
- Node-level agents may need the old version removed before the new starts
- Large clusters need parallel updates for speed

## The Solution

### RollingUpdate (Default)

```yaml
apiVersion: apps/v1
kind: DaemonSet
metadata:
  name: node-exporter
spec:
  updateStrategy:
    type: RollingUpdate
    rollingUpdate:
      maxUnavailable: 1
  selector:
    matchLabels:
      app: node-exporter
  template:
    metadata:
      labels:
        app: node-exporter
    spec:
      containers:
        - name: exporter
          image: prom/node-exporter:v1.8.0
          ports:
            - containerPort: 9100
              hostPort: 9100
```

### Fast Parallel Update

```yaml
updateStrategy:
  type: RollingUpdate
  rollingUpdate:
    maxUnavailable: "25%"
    # Update 25% of nodes simultaneously
```

### MaxSurge (Zero Downtime)

```yaml
updateStrategy:
  type: RollingUpdate
  rollingUpdate:
    maxSurge: 1
    maxUnavailable: 0
    # New pod starts BEFORE old is removed
```

### OnDelete (Manual Control)

```yaml
updateStrategy:
  type: OnDelete
  # Pods only update when manually deleted
```

```bash
# Manually trigger update on specific nodes
kubectl delete pod node-exporter-abc12 -n monitoring
# New pod starts with updated image
```

### Monitor Rollout

```bash
kubectl rollout status daemonset/node-exporter -n monitoring
kubectl rollout history daemonset/node-exporter -n monitoring
kubectl rollout undo daemonset/node-exporter -n monitoring
```

```mermaid
graph TD
    subgraph RollingUpdate maxUnavailable=1
        N1[Node 1: Update ✓] --> N2[Node 2: Updating...]
        N2 --> N3[Node 3: Waiting]
        N3 --> N4[Node 4: Waiting]
    end
    subgraph OnDelete
        N5[Node 1: Old version]
        N6[Node 2: Old version]
        N7[Node 3: Deleted → New version]
    end
```

## Common Issues

**DaemonSet rollout stuck**
A pod on one node can't start (resource constraints, node issues):
```bash
kubectl get pods -l app=node-exporter -o wide | grep -v Running
kubectl describe pod <stuck-pod>
```

**maxSurge not working with hostPort**
Two pods can't use the same `hostPort` on one node. `maxSurge` requires the old pod to release the port first. Use `maxUnavailable: 1` instead for hostPort DaemonSets.

**Rollback not working**
DaemonSets track revisions like Deployments:
```bash
kubectl rollout history daemonset/node-exporter
kubectl rollout undo daemonset/node-exporter --to-revision=2
```

## Best Practices

- Use `maxUnavailable: 1` for critical infrastructure (CNI, logging)
- Use `maxUnavailable: 25%` for large clusters (100+ nodes) to speed rollouts
- Use `maxSurge: 1` with `maxUnavailable: 0` for zero-gap monitoring agents
- Use `OnDelete` for CNI plugins where automatic restart is risky
- Combine with node cordoning for controlled cluster-wide upgrades
- Set resource requests to ensure new pod can be scheduled alongside old

## Key Takeaways

- `RollingUpdate` is the default — updates nodes progressively
- `OnDelete` gives full manual control — useful for critical infrastructure
- `maxUnavailable` controls how many nodes lose the DaemonSet pod simultaneously
- `maxSurge` (1.22+) allows new pod to start before old is removed (zero-gap)
- `maxSurge` and `maxUnavailable` can't both be zero
- hostPort DaemonSets can't use `maxSurge` (port conflict)
