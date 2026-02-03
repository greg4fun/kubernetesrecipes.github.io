---
title: "How to Use Pod Topology Spread Constraints"
description: "Distribute pods evenly across failure domains using topology spread constraints. Ensure high availability across zones, nodes, and custom topologies."
category: "deployments"
difficulty: "intermediate"
publishDate: "2026-01-22"
tags: ["topology", "scheduling", "high-availability", "zones", "distribution"]
---

> 💡 **Quick Answer:** Add `topologySpreadConstraints` to pod spec with `topologyKey` (e.g., `topology.kubernetes.io/zone`), `maxSkew` (max imbalance allowed), and `whenUnsatisfiable` (DoNotSchedule or ScheduleAnyway). Ensures pods spread across zones/nodes for high availability.
>
> **Key config:** `maxSkew: 1` means pods can differ by at most 1 between topology domains.
>
> **Gotcha:** `DoNotSchedule` can leave pods pending if spread can't be satisfied; use `ScheduleAnyway` for softer constraint. Combine with `minDomains` for minimum availability zones.

# How to Use Pod Topology Spread Constraints

Topology spread constraints distribute pods across failure domains like zones, nodes, or racks. This ensures high availability by preventing all replicas from landing on the same failure domain.

## Basic Topology Spread

```yaml
# spread-across-zones.yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: web-app
spec:
  replicas: 6
  selector:
    matchLabels:
      app: web-app
  template:
    metadata:
      labels:
        app: web-app
    spec:
      topologySpreadConstraints:
        - maxSkew: 1
          topologyKey: topology.kubernetes.io/zone
          whenUnsatisfiable: DoNotSchedule
          labelSelector:
            matchLabels:
              app: web-app
      containers:
        - name: web
          image: nginx:latest
```

## Understanding Parameters

```yaml
topologySpreadConstraints:
  - maxSkew: 1
    # Maximum difference in pod count between any two topology domains
    # maxSkew: 1 means at most 1 pod difference between zones
    
    topologyKey: topology.kubernetes.io/zone
    # Node label to group nodes into topology domains
    # Common keys:
    # - topology.kubernetes.io/zone (availability zone)
    # - topology.kubernetes.io/region (region)
    # - kubernetes.io/hostname (per-node)
    
    whenUnsatisfiable: DoNotSchedule
    # DoNotSchedule - Don't schedule if constraint can't be met
    # ScheduleAnyway - Schedule anyway, try to minimize skew
    
    labelSelector:
      matchLabels:
        app: web-app
    # Pods to count when calculating spread
```

## Spread Across Nodes

```yaml
# spread-across-nodes.yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: distributed-app
spec:
  replicas: 4
  selector:
    matchLabels:
      app: distributed-app
  template:
    metadata:
      labels:
        app: distributed-app
    spec:
      topologySpreadConstraints:
        - maxSkew: 1
          topologyKey: kubernetes.io/hostname
          whenUnsatisfiable: DoNotSchedule
          labelSelector:
            matchLabels:
              app: distributed-app
      containers:
        - name: app
          image: myapp:v1
```

## Multiple Constraints

```yaml
# multi-constraint.yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: ha-app
spec:
  replicas: 9
  selector:
    matchLabels:
      app: ha-app
  template:
    metadata:
      labels:
        app: ha-app
    spec:
      topologySpreadConstraints:
        # First: spread across zones
        - maxSkew: 1
          topologyKey: topology.kubernetes.io/zone
          whenUnsatisfiable: DoNotSchedule
          labelSelector:
            matchLabels:
              app: ha-app
        # Then: spread across nodes within zones
        - maxSkew: 1
          topologyKey: kubernetes.io/hostname
          whenUnsatisfiable: ScheduleAnyway
          labelSelector:
            matchLabels:
              app: ha-app
      containers:
        - name: app
          image: myapp:v1
```

## Soft Constraints

```yaml
# soft-spread.yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: best-effort-spread
spec:
  replicas: 5
  selector:
    matchLabels:
      app: best-effort
  template:
    metadata:
      labels:
        app: best-effort
    spec:
      topologySpreadConstraints:
        - maxSkew: 1
          topologyKey: topology.kubernetes.io/zone
          whenUnsatisfiable: ScheduleAnyway  # Soft constraint
          labelSelector:
            matchLabels:
              app: best-effort
      containers:
        - name: app
          image: myapp:v1
```

## With Node Selectors

```yaml
# spread-with-node-selector.yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: gpu-app
spec:
  replicas: 4
  selector:
    matchLabels:
      app: gpu-app
  template:
    metadata:
      labels:
        app: gpu-app
    spec:
      nodeSelector:
        gpu: "true"  # Only GPU nodes
      topologySpreadConstraints:
        - maxSkew: 1
          topologyKey: topology.kubernetes.io/zone
          whenUnsatisfiable: DoNotSchedule
          labelSelector:
            matchLabels:
              app: gpu-app
          # Only count nodes matching nodeSelector
          matchLabelKeys:
            - pod-template-hash  # Match same deployment revision
      containers:
        - name: app
          image: gpu-app:v1
```

## Custom Topology Keys

```bash
# Label nodes with custom topology
kubectl label node node1 rack=rack-a
kubectl label node node2 rack=rack-a
kubectl label node node3 rack=rack-b
kubectl label node node4 rack=rack-b
```

```yaml
# spread-across-racks.yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: rack-aware-app
spec:
  replicas: 4
  selector:
    matchLabels:
      app: rack-aware
  template:
    metadata:
      labels:
        app: rack-aware
    spec:
      topologySpreadConstraints:
        - maxSkew: 1
          topologyKey: rack  # Custom topology key
          whenUnsatisfiable: DoNotSchedule
          labelSelector:
            matchLabels:
              app: rack-aware
      containers:
        - name: app
          image: myapp:v1
```

## MinDomains for Minimum Spread

```yaml
# min-domains.yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: min-spread-app
spec:
  replicas: 6
  selector:
    matchLabels:
      app: min-spread
  template:
    metadata:
      labels:
        app: min-spread
    spec:
      topologySpreadConstraints:
        - maxSkew: 2
          topologyKey: topology.kubernetes.io/zone
          whenUnsatisfiable: DoNotSchedule
          labelSelector:
            matchLabels:
              app: min-spread
          minDomains: 3  # Require at least 3 zones
      containers:
        - name: app
          image: myapp:v1
```

## NodeTaintsPolicy

```yaml
# taint-aware-spread.yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: taint-aware-app
spec:
  replicas: 4
  selector:
    matchLabels:
      app: taint-aware
  template:
    metadata:
      labels:
        app: taint-aware
    spec:
      topologySpreadConstraints:
        - maxSkew: 1
          topologyKey: topology.kubernetes.io/zone
          whenUnsatisfiable: DoNotSchedule
          labelSelector:
            matchLabels:
              app: taint-aware
          nodeTaintsPolicy: Honor  # Ignore tainted nodes in calculations
      tolerations:
        - key: "special"
          operator: "Exists"
      containers:
        - name: app
          image: myapp:v1
```

## Verify Pod Distribution

```bash
# Check pod distribution across zones
kubectl get pods -l app=web-app -o wide

# Count pods per zone
kubectl get pods -l app=web-app -o json | \
  jq -r '.items[] | "\(.spec.nodeName)"' | \
  xargs -I {} kubectl get node {} -o jsonpath='{.metadata.labels.topology\.kubernetes\.io/zone}{"\n"}' | \
  sort | uniq -c

# Detailed node zone info
kubectl get nodes -L topology.kubernetes.io/zone

# Check scheduling events if pods pending
kubectl describe pod <pending-pod> | grep -A 10 Events
```

## Troubleshoot Scheduling

```bash
# Pod stuck in Pending
kubectl describe pod <pod-name>

# Common issues:
# - "does not satisfy spread constraint" - can't meet maxSkew
# - Not enough nodes in topology domains
# - Conflicting with node selectors/affinity

# Check node topology labels
kubectl get nodes --show-labels | grep topology

# Verify zones have enough nodes
kubectl get nodes -L topology.kubernetes.io/zone -o custom-columns=\
'NAME:.metadata.name,ZONE:.metadata.labels.topology\.kubernetes\.io/zone'
```

## Cluster Default Constraints

```yaml
# Set default topology spread at scheduler level
# kube-scheduler config
apiVersion: kubescheduler.config.k8s.io/v1
kind: KubeSchedulerConfiguration
profiles:
  - schedulerName: default-scheduler
    pluginConfig:
      - name: PodTopologySpread
        args:
          defaultConstraints:
            - maxSkew: 1
              topologyKey: topology.kubernetes.io/zone
              whenUnsatisfiable: ScheduleAnyway
          defaultingType: List
```

## Summary

Topology spread constraints ensure pods are distributed across failure domains like zones, nodes, or custom topologies. Set `maxSkew` to control the maximum difference in pod counts between domains. Use `DoNotSchedule` for hard requirements or `ScheduleAnyway` for best-effort spreading. Combine multiple constraints to spread across both zones and nodes. Verify distribution with `kubectl get pods -o wide` and check node labels for topology information. This pattern is essential for high availability in multi-zone clusters.

---

## 📘 Go Further with Kubernetes Recipes

**Love this recipe? There's so much more!** This is just one of **100+ hands-on recipes** in our comprehensive **[Kubernetes Recipes book](https://amzn.to/3DzC8QA)**.

Inside the book, you'll master:
- ✅ Production-ready deployment strategies
- ✅ Advanced networking and security patterns  
- ✅ Observability, monitoring, and troubleshooting
- ✅ Real-world best practices from industry experts

> *"The practical, recipe-based approach made complex Kubernetes concepts finally click for me."*

**👉 [Get Your Copy Now](https://amzn.to/3DzC8QA)** — Start building production-grade Kubernetes skills today!
