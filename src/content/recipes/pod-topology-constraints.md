---
title: "topologySpreadConstraints: maxSkew, minDomains, Examples"
description: "Kubernetes pod topology spread constraints with YAML: maxSkew, whenUnsatisfiable, minDomains, matchLabelKeys, nodeTaintsPolicy, and cluster defaults."
category: "deployments"
difficulty: "intermediate"
publishDate: "2026-01-22"
author: "Luca Berton"
tags: ["topology", "topology-spread", "scheduling", "high-availability", "zones", "distribution", "cka"]
relatedRecipes:
  - "kubernetes-pod-topology-spread-advanced"
  - "pod-disruption-budget-config"
  - "kubernetes-node-affinity-guide"
  - "kubernetes-affinity-guide"
  - "kubernetes-taint-toleration-guide"
  - "karpenter-node-autoscaling"
  - "runai-topology-aware-scheduling-kubernetes"
---

> 💡 **Quick Answer:** Add `topologySpreadConstraints` to pod spec with `topologyKey` (e.g., `topology.kubernetes.io/zone`), `maxSkew` (max imbalance allowed), and `whenUnsatisfiable` (DoNotSchedule or ScheduleAnyway). Ensures pods spread across zones/nodes for high availability.
>
> **Key config:** `maxSkew: 1` means pods can differ by at most 1 between topology domains.
>
> **Gotcha:** `DoNotSchedule` can leave pods pending if spread can't be satisfied; use `ScheduleAnyway` for softer constraint. Combine with `minDomains` for minimum availability zones.


Topology spread constraints distribute pods across failure domains like zones, nodes, or racks. Pod anti-affinity only prevents co-location; it won't stop 6 replicas landing 4-1-1 across 3 zones. `maxSkew: 1` forces 2-2-2.

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

| Field | Default | Since | Effect |
|---|---|---|---|
| `maxSkew` | — | 1.19 | Max difference in matching pods between any domain and the least-loaded eligible domain |
| `whenUnsatisfiable` | — | 1.19 | `DoNotSchedule` (hard) or `ScheduleAnyway` (scoring only) |
| `minDomains` | 1 | GA 1.30 | Treat missing domains as 0 pods until N domains exist; only with `DoNotSchedule` |
| `matchLabelKeys` | — | beta 1.27 | Add the pod's own values for these label keys to the selector (e.g. `pod-template-hash`) |
| `nodeAffinityPolicy` | `Honor` | beta 1.26 | Only nodes matching the pod's nodeSelector/affinity count as domains |
| `nodeTaintsPolicy` | `Ignore` | beta 1.26 | `Honor` excludes tainted nodes the pod doesn't tolerate |

### maxSkew Explained

Skew = pods in a domain − minimum pods in any eligible domain.

```
maxSkew: 1, 3 zones
  6 pods [2, 2, 2] ✅ skew 0
  7 pods [3, 2, 2] ✅ skew 1
  6 pods [4, 1, 1] ❌ skew 3

maxSkew: 2, 3 zones
  8 pods [4, 2, 2] ✅ skew 2
  6 pods [5, 1, 0] ❌ skew 5
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
          # nodeAffinityPolicy: Honor (default) → only gpu=true nodes count as domains
          matchLabelKeys:
            - pod-template-hash  # Count only pods of the same ReplicaSet (rollout-safe)
      containers:
        - name: app
          image: gpu-app:v1
```

## matchLabelKeys: Rolling-Update Safe Spread

Without it, old and new ReplicaSet pods are counted together, so a rollout can pile new pods into one zone (or block with `DoNotSchedule`). With `pod-template-hash`, each revision is spread independently:

```yaml
topologySpreadConstraints:
  - maxSkew: 1
    topologyKey: topology.kubernetes.io/zone
    whenUnsatisfiable: DoNotSchedule
    labelSelector:
      matchLabels:
        app: web-app
    matchLabelKeys:
      - pod-template-hash
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
          nodeTaintsPolicy: Honor  # Skip tainted nodes this pod doesn't tolerate
      tolerations:
        - key: "special"
          operator: "Exists"
      containers:
        - name: app
          image: myapp:v1
```

## Match Label Expressions

`labelSelector` also accepts `matchExpressions` for more precise pod counting — useful when you need to exclude certain versions or environments from the spread calculation:

```yaml
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

## StatefulSet with Spread

Topology spread constraints work the same way on StatefulSets — critical for quorum-based systems like Cassandra or etcd, where losing a whole zone shouldn't take out a majority of replicas:

```yaml
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

## Topology Spread vs Pod Anti-Affinity

| | topologySpreadConstraints | podAntiAffinity |
|---|:---:|:---:|
| Even distribution | ✅ `maxSkew` | ❌ only prevents co-location |
| Replicas > domains | ✅ works | ❌ hard rule leaves pods Pending |
| Soft mode | `ScheduleAnyway` | `preferredDuringScheduling...` |
| Zone + node in one spec | ✅ two constraints | ⚠️ verbose |
| Rollout-safe | ✅ `matchLabelKeys` | ⚠️ old pods count |

Both are evaluated; a `required` anti-affinity term can make a spread constraint unsatisfiable.

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

`defaultConstraints` apply only to pods that set no `topologySpreadConstraints` and belong to a Service, ReplicaSet, StatefulSet or ReplicationController (the selector is derived from them). The built-in defaults (`defaultingType: System`) are zone `maxSkew: 5` and hostname `maxSkew: 3`, both `ScheduleAnyway`.

## Common Issues

| Issue | Cause | Fix |
|---|---|---|
| Pending: `didn't match pod topology spread constraints` | Not enough nodes/zones for `maxSkew` with `DoNotSchedule` | Add capacity, raise `maxSkew`, or `ScheduleAnyway` |
| Rollout stuck or clustered | Old ReplicaSet pods counted | `matchLabelKeys: [pod-template-hash]` |
| Uneven after scale-down or node loss | Spread is only evaluated at scheduling time | Run the Descheduler `RemovePodsViolatingTopologySpreadConstraint` plugin |
| Tainted/control-plane nodes skew results | `nodeTaintsPolicy: Ignore` counts them as domains | `nodeTaintsPolicy: Honor` |
| Pods pile into existing zones while autoscaler adds a new one | Missing zone isn't a domain yet | `minDomains: 3` |
| Spread ignored | `labelSelector` doesn't match the pod's own labels | Selector must match the pod template labels |

## Frequently Asked Questions

### What does maxSkew mean in topologySpreadConstraints?

The maximum allowed difference between the number of matching pods in any topology domain and the least-populated eligible domain. `maxSkew: 1` means zones can differ by at most one pod.

### What is nodeTaintsPolicy: Honor?

It makes the scheduler exclude nodes with taints the pod doesn't tolerate when computing skew. The default `Ignore` counts them, which can leave pods Pending because a tainted, unusable node looks like an empty domain.

### What does minDomains do?

With `DoNotSchedule`, if fewer than `minDomains` eligible domains exist, the global minimum is treated as 0 — forcing pods to wait for (or trigger the autoscaler to create) new domains instead of stacking into existing ones.

### Topology spread constraints vs pod anti-affinity: which should I use?

Use topology spread for balanced HA across zones/nodes, especially when replicas exceed domains. Use anti-affinity to keep specific workloads apart (e.g. never co-locate two cache pods). They can be combined.

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
