---
title: "K8s Node Affinity and Pod Scheduling"
description: "Configure Kubernetes node affinity, pod affinity, and anti-affinity rules. nodeSelector, requiredDuringScheduling, preferredDuringScheduling, and topology."
publishDate: "2026-05-02"
author: "Luca Berton"
category: "deployments"
difficulty: "intermediate"
timeToComplete: "12 minutes"
kubernetesVersion: "1.28+"
tags:
  - "scheduling"
  - "node-affinity"
  - "pod-affinity"
  - "topology"
  - "cka"
relatedRecipes:
  - "node-taints-tolerations"
  - "debug-scheduling-failures"
  - "kubernetes-node-untolerated-taint-master"
  - "kubernetes-topology-spread-constraints"
---

> 💡 **Quick Answer:** `nodeSelector: {disk: ssd}` schedules pods to nodes with matching labels (hard constraint). For flexible rules, use `nodeAffinity` with `requiredDuringSchedulingIgnoredDuringExecution` (hard) or `preferredDuringSchedulingIgnoredDuringExecution` (soft). Pod affinity/anti-affinity co-locates or spreads pods relative to other pods. `topologySpreadConstraints` distributes pods evenly across zones/nodes.

## The Problem

Default scheduling places pods on any available node:

- GPU workloads land on CPU-only nodes
- Pods for the same service all land on one node (no HA)
- Latency-sensitive pods run on distant nodes
- Compliance requires workloads in specific zones

## The Solution

### nodeSelector (Simple)

```yaml
apiVersion: v1
kind: Pod
metadata:
  name: gpu-pod
spec:
  nodeSelector:
    gpu-type: a100        # Must match node label exactly
    disk: ssd
  containers:
  - name: training
    image: pytorch:latest
```

```bash
# Label a node
kubectl label node worker-1 gpu-type=a100 disk=ssd

# Check node labels
kubectl get nodes --show-labels
```

### Node Affinity (Flexible)

```yaml
apiVersion: v1
kind: Pod
metadata:
  name: web-app
spec:
  affinity:
    nodeAffinity:
      # Hard requirement — must match
      requiredDuringSchedulingIgnoredDuringExecution:
        nodeSelectorTerms:
        - matchExpressions:
          - key: zone
            operator: In
            values: ["us-east-1a", "us-east-1b"]
          - key: instance-type
            operator: NotIn
            values: ["t3.micro"]
      
      # Soft preference — prefer but don't require
      preferredDuringSchedulingIgnoredDuringExecution:
      - weight: 80
        preference:
          matchExpressions:
          - key: disk
            operator: In
            values: ["ssd"]
      - weight: 20
        preference:
          matchExpressions:
          - key: spot
            operator: DoesNotExist
  containers:
  - name: web
    image: nginx:1.27
```

### Operators

| Operator | Meaning |
|----------|---------|
| `In` | Label value in list |
| `NotIn` | Label value not in list |
| `Exists` | Label key exists (any value) |
| `DoesNotExist` | Label key doesn't exist |
| `Gt` | Greater than (numeric) |
| `Lt` | Less than (numeric) |

### Pod Affinity / Anti-Affinity

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: web-frontend
spec:
  replicas: 3
  selector:
    matchLabels:
      app: web-frontend
  template:
    metadata:
      labels:
        app: web-frontend
    spec:
      affinity:
        # Co-locate with cache pods (same node)
        podAffinity:
          requiredDuringSchedulingIgnoredDuringExecution:
          - labelSelector:
              matchLabels:
                app: redis-cache
            topologyKey: kubernetes.io/hostname
        
        # Spread frontend replicas across nodes
        podAntiAffinity:
          preferredDuringSchedulingIgnoredDuringExecution:
          - weight: 100
            podAffinityTerm:
              labelSelector:
                matchLabels:
                  app: web-frontend
              topologyKey: kubernetes.io/hostname
      containers:
      - name: web
        image: frontend:v2
```

### Topology Spread Constraints

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: web-app
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
      # Spread evenly across zones
      - maxSkew: 1
        topologyKey: topology.kubernetes.io/zone
        whenUnsatisfiable: DoNotSchedule
        labelSelector:
          matchLabels:
            app: web
      # Also spread across nodes within zones
      - maxSkew: 1
        topologyKey: kubernetes.io/hostname
        whenUnsatisfiable: ScheduleAnyway
        labelSelector:
          matchLabels:
            app: web
      containers:
      - name: web
        image: nginx:1.27
```

```
# Result with 6 replicas across 3 zones, 6 nodes:
# Zone A: node-1 [web] node-2 [web]
# Zone B: node-3 [web] node-4 [web]
# Zone C: node-5 [web] node-6 [web]
```

## Common Issues

**Pod stuck in Pending — "didn't match node affinity"**

No nodes match the required affinity rules. Check: `kubectl get nodes -l <label>` and `kubectl describe pod <pod>`.

**Anti-affinity too strict — can't schedule all replicas**

With `requiredDuringScheduling` anti-affinity on hostname, you need at least as many nodes as replicas. Use `preferredDuringScheduling` instead.

**topologySpreadConstraints with DoNotSchedule blocks scheduling**

`maxSkew: 1` is strict. Increase maxSkew or use `ScheduleAnyway` for soft spreading.

## Best Practices

- **`nodeSelector` for simple cases** — GPU nodes, SSD nodes
- **`nodeAffinity` for complex rules** — multiple values, preferences
- **`podAntiAffinity` for HA** — spread replicas across nodes/zones
- **`topologySpreadConstraints` over pod anti-affinity** — more granular control
- **Use `preferred` over `required`** when possible — keeps scheduling flexible

## Key Takeaways

- nodeSelector: simple label matching (hard constraint)
- nodeAffinity: flexible with In/NotIn/Exists operators and soft preferences
- podAffinity: co-locate pods on same node/zone as other pods
- podAntiAffinity: spread pods away from each other (HA)
- topologySpreadConstraints: distribute evenly across zones/nodes with maxSkew
