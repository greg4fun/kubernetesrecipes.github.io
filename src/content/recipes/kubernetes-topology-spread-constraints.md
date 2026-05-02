---
title: "K8s Topology Spread: Distribute Pods"
description: "Configure Kubernetes topology spread constraints to distribute pods across zones, nodes, and regions. maxSkew, whenUnsatisfiable, and scheduling strategies."
publishDate: "2026-05-02"
author: "Luca Berton"
category: "deployments"
difficulty: "intermediate"
timeToComplete: "10 minutes"
kubernetesVersion: "1.28+"
tags:
  - "topology"
  - "scheduling"
  - "high-availability"
  - "deployments"
  - "cka"
relatedRecipes:
  - "kubernetes-node-affinity-guide"
  - "kubernetes-taints-tolerations-guide"
  - "kubernetes-pod-disruption-budget"
  - "kubernetes-priority-preemption-guide"
  - "kubernetes-replicaset-guide"
---

> 💡 **Quick Answer:** `topologySpreadConstraints` distributes pods evenly across failure domains. Set `maxSkew: 1` with `topologyKey: topology.kubernetes.io/zone` to spread pods across availability zones. Use `whenUnsatisfiable: DoNotSchedule` (strict) or `ScheduleAnyway` (best-effort). Combine with pod anti-affinity for maximum HA.

## The Problem

Without topology spread:

- All replicas might land on the same node or zone
- Node failure takes down all instances
- Zone outage causes complete service downtime
- Uneven resource utilization across the cluster

## The Solution

### Spread Across Zones

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: web
spec:
  replicas: 6
  selector:
    matchLabels:
      app: web
  template:
    metadata:
      labels:
        app: web
    spec:
      topologySpreadConstraints:
      - maxSkew: 1                           # Max difference between zones
        topologyKey: topology.kubernetes.io/zone
        whenUnsatisfiable: DoNotSchedule     # Strict: don't schedule if skewed
        labelSelector:
          matchLabels:
            app: web
      containers:
      - name: web
        image: nginx:1.27
        resources:
          requests:
            cpu: 100m
            memory: 128Mi

# Result with 3 zones, 6 replicas:
# zone-a: 2 pods
# zone-b: 2 pods
# zone-c: 2 pods  ← evenly distributed
```

### Spread Across Nodes

```yaml
topologySpreadConstraints:
# Spread across zones (primary)
- maxSkew: 1
  topologyKey: topology.kubernetes.io/zone
  whenUnsatisfiable: DoNotSchedule
  labelSelector:
    matchLabels:
      app: web

# Also spread across nodes within zones
- maxSkew: 1
  topologyKey: kubernetes.io/hostname
  whenUnsatisfiable: ScheduleAnyway        # Best-effort for nodes
  labelSelector:
    matchLabels:
      app: web
```

### maxSkew Explained

```
maxSkew: 1 with 6 pods, 3 zones:
✅ Allowed: [2, 2, 2] — skew = 0
✅ Allowed: [3, 2, 2] — skew = 1
❌ Rejected: [4, 1, 1] — skew = 3

maxSkew: 2 with 6 pods, 3 zones:
✅ Allowed: [4, 2, 2] — skew = 2
❌ Rejected: [5, 1, 0] — skew = 5
```

### whenUnsatisfiable Options

```yaml
# DoNotSchedule — strict, pod stays Pending if constraint can't be met
whenUnsatisfiable: DoNotSchedule

# ScheduleAnyway — best-effort, scheduler tries but doesn't block
whenUnsatisfiable: ScheduleAnyway

# Recommendation:
# - Zone spread: DoNotSchedule (HA is critical)
# - Node spread: ScheduleAnyway (flexibility for resource constraints)
```

### matchLabelKeys (K8s 1.27+)

```yaml
# Spread per-revision (during rolling updates)
topologySpreadConstraints:
- maxSkew: 1
  topologyKey: topology.kubernetes.io/zone
  whenUnsatisfiable: DoNotSchedule
  labelSelector:
    matchLabels:
      app: web
  matchLabelKeys:
  - pod-template-hash    # Only count pods from same ReplicaSet
  
# Without matchLabelKeys: old + new pods counted together
# → new pods might cluster on one zone
# With matchLabelKeys: only new revision pods counted
# → new pods spread evenly regardless of old pod placement
```

### Combined with Affinity

```yaml
spec:
  topologySpreadConstraints:
  - maxSkew: 1
    topologyKey: topology.kubernetes.io/zone
    whenUnsatisfiable: DoNotSchedule
    labelSelector:
      matchLabels:
        app: web
  
  affinity:
    # Prefer nodes with SSD storage
    nodeAffinity:
      preferredDuringSchedulingIgnoredDuringExecution:
      - weight: 100
        preference:
          matchExpressions:
          - key: disk-type
            operator: In
            values: ["ssd"]
    
    # Avoid co-locating with cache pods
    podAntiAffinity:
      preferredDuringSchedulingIgnoredDuringExecution:
      - weight: 50
        podAffinityTerm:
          labelSelector:
            matchLabels:
              app: cache
          topologyKey: kubernetes.io/hostname
```

### Cluster-Level Defaults

```yaml
# Set default topology spread for all pods (kube-scheduler config)
apiVersion: kubescheduler.config.k8s.io/v1
kind: KubeSchedulerConfiguration
profiles:
- pluginConfig:
  - name: PodTopologySpread
    args:
      defaultingType: List
      defaultConstraints:
      - maxSkew: 1
        topologyKey: topology.kubernetes.io/zone
        whenUnsatisfiable: ScheduleAnyway
      - maxSkew: 1
        topologyKey: kubernetes.io/hostname
        whenUnsatisfiable: ScheduleAnyway
```

## Common Issues

**Pods stuck Pending: "doesn't satisfy spread constraint"**

Not enough zones/nodes to satisfy maxSkew. Reduce replicas, increase maxSkew, or switch to `ScheduleAnyway`.

**Uneven distribution after node failure**

Topology spread only affects scheduling — it doesn't rebalance running pods. Use [Descheduler](https://github.com/kubernetes-sigs/descheduler) for rebalancing.

**Rolling update clusters new pods**

Use `matchLabelKeys: [pod-template-hash]` (K8s 1.27+) to spread per revision.

## Best Practices

- **Zone spread with `DoNotSchedule`** — HA is non-negotiable
- **Node spread with `ScheduleAnyway`** — best-effort avoids Pending pods
- **Set `maxSkew: 1`** for even distribution
- **Use `matchLabelKeys`** for proper rolling update behavior
- **Combine with PDB** — topology spread prevents placement issues, PDB prevents disruption

## Key Takeaways

- Topology spread constraints distribute pods across zones, nodes, or regions
- `maxSkew` controls how uneven the distribution can be (1 = perfectly balanced)
- `DoNotSchedule` enforces strictly; `ScheduleAnyway` is best-effort
- Use `matchLabelKeys` for per-revision spreading during rolling updates
- Combine zone spread + node spread + PDB for maximum availability
