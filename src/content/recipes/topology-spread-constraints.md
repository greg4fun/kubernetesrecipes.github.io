---
title: "How to Use Pod Topology Spread Constraints"
description: "Distribute pods across nodes, zones, and regions using topology spread constraints. Ensure high availability and fault tolerance for your workloads."
category: "deployments"
difficulty: "intermediate"
publishDate: "2026-01-22"
tags: ["topology", "scheduling", "availability", "zones", "spread"]
---

# How to Use Pod Topology Spread Constraints

Topology spread constraints distribute pods evenly across failure domains like nodes, zones, or regions. Ensure high availability by preventing pod concentration.

## Basic Node Spread

```yaml
# spread-across-nodes.yaml
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
          topologyKey: kubernetes.io/hostname
          whenUnsatisfiable: DoNotSchedule
          labelSelector:
            matchLabels:
              app: web-app
      containers:
        - name: web
          image: nginx:1.25
```

Result with 6 pods on 3 nodes:
```
Node-1: 2 pods
Node-2: 2 pods  
Node-3: 2 pods
```

## Zone-Aware Spread

```yaml
# spread-across-zones.yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: api-server
spec:
  replicas: 9
  selector:
    matchLabels:
      app: api-server
  template:
    metadata:
      labels:
        app: api-server
    spec:
      topologySpreadConstraints:
        # Spread across zones
        - maxSkew: 1
          topologyKey: topology.kubernetes.io/zone
          whenUnsatisfiable: DoNotSchedule
          labelSelector:
            matchLabels:
              app: api-server
        # Also spread within each zone across nodes
        - maxSkew: 1
          topologyKey: kubernetes.io/hostname
          whenUnsatisfiable: ScheduleAnyway
          labelSelector:
            matchLabels:
              app: api-server
      containers:
        - name: api
          image: api-server:v1
```

Result with 9 pods across 3 zones:
```
Zone-A: 3 pods (spread across nodes)
Zone-B: 3 pods (spread across nodes)
Zone-C: 3 pods (spread across nodes)
```

## Understanding maxSkew

```yaml
# maxSkew determines acceptable imbalance
topologySpreadConstraints:
  - maxSkew: 1  # Difference between most and least loaded domain
    topologyKey: kubernetes.io/hostname
    whenUnsatisfiable: DoNotSchedule
    labelSelector:
      matchLabels:
        app: myapp

# maxSkew: 1 with 5 pods on 3 nodes:
# Valid:   Node-A: 2, Node-B: 2, Node-C: 1 (diff = 1) ✓
# Invalid: Node-A: 3, Node-B: 2, Node-C: 0 (diff = 3) ✗
```

## whenUnsatisfiable Options

```yaml
# DoNotSchedule - Hard constraint
topologySpreadConstraints:
  - maxSkew: 1
    topologyKey: kubernetes.io/hostname
    whenUnsatisfiable: DoNotSchedule  # Pod stays Pending
    labelSelector:
      matchLabels:
        app: critical-app

# ScheduleAnyway - Soft constraint
topologySpreadConstraints:
  - maxSkew: 1
    topologyKey: kubernetes.io/hostname
    whenUnsatisfiable: ScheduleAnyway  # Best effort, may exceed maxSkew
    labelSelector:
      matchLabels:
        app: flexible-app
```

## Multiple Constraints

```yaml
# multi-constraint-spread.yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: distributed-app
spec:
  replicas: 12
  selector:
    matchLabels:
      app: distributed-app
  template:
    metadata:
      labels:
        app: distributed-app
    spec:
      topologySpreadConstraints:
        # Hard: Spread across regions
        - maxSkew: 1
          topologyKey: topology.kubernetes.io/region
          whenUnsatisfiable: DoNotSchedule
          labelSelector:
            matchLabels:
              app: distributed-app
        # Hard: Spread across zones within region
        - maxSkew: 1
          topologyKey: topology.kubernetes.io/zone
          whenUnsatisfiable: DoNotSchedule
          labelSelector:
            matchLabels:
              app: distributed-app
        # Soft: Spread across nodes within zone
        - maxSkew: 2
          topologyKey: kubernetes.io/hostname
          whenUnsatisfiable: ScheduleAnyway
          labelSelector:
            matchLabels:
              app: distributed-app
      containers:
        - name: app
          image: distributed-app:v1
```

## Match Label Expressions

```yaml
# advanced-label-selector.yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: microservice
spec:
  template:
    spec:
      topologySpreadConstraints:
        - maxSkew: 1
          topologyKey: kubernetes.io/hostname
          whenUnsatisfiable: DoNotSchedule
          labelSelector:
            matchLabels:
              app: microservice
            matchExpressions:
              - key: version
                operator: In
                values: ["v1", "v2"]
              - key: environment
                operator: NotIn
                values: ["test"]
```

## minDomains (Kubernetes 1.25+)

```yaml
# min-domains.yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: ha-service
spec:
  replicas: 6
  selector:
    matchLabels:
      app: ha-service
  template:
    metadata:
      labels:
        app: ha-service
    spec:
      topologySpreadConstraints:
        - maxSkew: 2
          topologyKey: topology.kubernetes.io/zone
          whenUnsatisfiable: DoNotSchedule
          minDomains: 3  # Require at least 3 zones
          labelSelector:
            matchLabels:
              app: ha-service
      containers:
        - name: app
          image: ha-service:v1
```

## nodeAffinityPolicy and nodeTaintsPolicy

```yaml
# affinity-aware-spread.yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: gpu-workload
spec:
  template:
    spec:
      topologySpreadConstraints:
        - maxSkew: 1
          topologyKey: kubernetes.io/hostname
          whenUnsatisfiable: DoNotSchedule
          labelSelector:
            matchLabels:
              app: gpu-workload
          # Honor nodeAffinity when calculating spread
          nodeAffinityPolicy: Honor  # or Ignore
          # Honor node taints when calculating spread
          nodeTaintsPolicy: Honor    # or Ignore
      affinity:
        nodeAffinity:
          requiredDuringSchedulingIgnoredDuringExecution:
            nodeSelectorTerms:
              - matchExpressions:
                  - key: gpu
                    operator: Exists
      containers:
        - name: app
          image: gpu-workload:v1
```

## StatefulSet with Spread

```yaml
# statefulset-spread.yaml
apiVersion: apps/v1
kind: StatefulSet
metadata:
  name: cassandra
spec:
  serviceName: cassandra
  replicas: 6
  selector:
    matchLabels:
      app: cassandra
  template:
    metadata:
      labels:
        app: cassandra
    spec:
      topologySpreadConstraints:
        - maxSkew: 1
          topologyKey: topology.kubernetes.io/zone
          whenUnsatisfiable: DoNotSchedule
          labelSelector:
            matchLabels:
              app: cassandra
        - maxSkew: 1
          topologyKey: kubernetes.io/hostname
          whenUnsatisfiable: DoNotSchedule
          labelSelector:
            matchLabels:
              app: cassandra
      containers:
        - name: cassandra
          image: cassandra:4.1
```

## Cluster-Level Defaults

```yaml
# Set default constraints for all pods (scheduler config)
# /etc/kubernetes/scheduler-config.yaml
apiVersion: kubescheduler.config.k8s.io/v1
kind: KubeSchedulerConfiguration
profiles:
  - schedulerName: default-scheduler
    pluginConfig:
      - name: PodTopologySpread
        args:
          defaultConstraints:
            - maxSkew: 1
              topologyKey: kubernetes.io/hostname
              whenUnsatisfiable: ScheduleAnyway
          defaultingType: List
```

## Verify Pod Distribution

```bash
# Check pod distribution across nodes
kubectl get pods -l app=web-app -o wide

# Check distribution by zone
kubectl get pods -l app=web-app -o json | \
  jq -r '.items[] | "\(.metadata.name)\t\(.spec.nodeName)"' | \
  while read pod node; do
    zone=$(kubectl get node $node -o jsonpath='{.metadata.labels.topology\.kubernetes\.io/zone}')
    echo "$pod $node $zone"
  done | sort -k3
```

## Summary

Topology spread constraints ensure pods distribute across failure domains for high availability. Use `maxSkew: 1` for even distribution, combine zone and node constraints for comprehensive coverage, and choose `DoNotSchedule` for critical workloads.

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
