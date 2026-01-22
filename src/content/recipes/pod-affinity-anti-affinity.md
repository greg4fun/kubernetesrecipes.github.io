---
title: "How to Configure Pod Affinity and Anti-Affinity"
description: "Control pod placement using affinity and anti-affinity rules. Co-locate related pods or spread them across nodes and zones for high availability."
category: "deployments"
difficulty: "intermediate"
publishDate: "2026-01-22"
tags: ["affinity", "scheduling", "placement", "high-availability", "topology"]
---

# How to Configure Pod Affinity and Anti-Affinity

Pod affinity and anti-affinity control how pods are scheduled relative to other pods. Co-locate related workloads for performance or spread them for high availability.

## Pod Anti-Affinity (Spread Pods)

```yaml
# spread-across-nodes.yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: web-server
spec:
  replicas: 3
  selector:
    matchLabels:
      app: web-server
  template:
    metadata:
      labels:
        app: web-server
    spec:
      affinity:
        podAntiAffinity:
          requiredDuringSchedulingIgnoredDuringExecution:
            - labelSelector:
                matchLabels:
                  app: web-server
              topologyKey: kubernetes.io/hostname
      containers:
        - name: nginx
          image: nginx:1.25
```

## Spread Across Availability Zones

```yaml
# spread-across-zones.yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: critical-app
spec:
  replicas: 3
  selector:
    matchLabels:
      app: critical-app
  template:
    metadata:
      labels:
        app: critical-app
    spec:
      affinity:
        podAntiAffinity:
          requiredDuringSchedulingIgnoredDuringExecution:
            - labelSelector:
                matchLabels:
                  app: critical-app
              topologyKey: topology.kubernetes.io/zone
      containers:
        - name: app
          image: myapp:v1
```

## Pod Affinity (Co-locate Pods)

```yaml
# colocate-with-cache.yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: web-app
spec:
  replicas: 3
  selector:
    matchLabels:
      app: web-app
  template:
    metadata:
      labels:
        app: web-app
    spec:
      affinity:
        podAffinity:
          requiredDuringSchedulingIgnoredDuringExecution:
            - labelSelector:
                matchLabels:
                  app: redis-cache
              topologyKey: kubernetes.io/hostname
      containers:
        - name: app
          image: myapp:v1
```

## Preferred (Soft) Anti-Affinity

```yaml
# soft-anti-affinity.yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: web-server
spec:
  replicas: 5
  selector:
    matchLabels:
      app: web-server
  template:
    metadata:
      labels:
        app: web-server
    spec:
      affinity:
        podAntiAffinity:
          preferredDuringSchedulingIgnoredDuringExecution:
            - weight: 100
              podAffinityTerm:
                labelSelector:
                  matchLabels:
                    app: web-server
                topologyKey: kubernetes.io/hostname
            - weight: 50
              podAffinityTerm:
                labelSelector:
                  matchLabels:
                    app: web-server
                topologyKey: topology.kubernetes.io/zone
      containers:
        - name: nginx
          image: nginx:1.25
```

## Combined Affinity and Anti-Affinity

```yaml
# combined-affinity.yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: frontend
spec:
  replicas: 3
  selector:
    matchLabels:
      app: frontend
  template:
    metadata:
      labels:
        app: frontend
    spec:
      affinity:
        # Co-locate with backend
        podAffinity:
          preferredDuringSchedulingIgnoredDuringExecution:
            - weight: 100
              podAffinityTerm:
                labelSelector:
                  matchLabels:
                    app: backend
                topologyKey: kubernetes.io/hostname
        # Spread frontend replicas
        podAntiAffinity:
          requiredDuringSchedulingIgnoredDuringExecution:
            - labelSelector:
                matchLabels:
                  app: frontend
              topologyKey: kubernetes.io/hostname
      containers:
        - name: frontend
          image: frontend:v1
```

## Node Affinity

```yaml
# node-affinity.yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: gpu-workload
spec:
  replicas: 2
  selector:
    matchLabels:
      app: gpu-workload
  template:
    metadata:
      labels:
        app: gpu-workload
    spec:
      affinity:
        nodeAffinity:
          requiredDuringSchedulingIgnoredDuringExecution:
            nodeSelectorTerms:
              - matchExpressions:
                  - key: gpu-type
                    operator: In
                    values:
                      - nvidia-a100
                      - nvidia-v100
          preferredDuringSchedulingIgnoredDuringExecution:
            - weight: 80
              preference:
                matchExpressions:
                  - key: gpu-type
                    operator: In
                    values:
                      - nvidia-a100
      containers:
        - name: ml-training
          image: ml-training:v1
```

## Match Expressions

```yaml
# match-expressions.yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: myapp
spec:
  replicas: 3
  selector:
    matchLabels:
      app: myapp
  template:
    metadata:
      labels:
        app: myapp
        version: v2
    spec:
      affinity:
        podAntiAffinity:
          requiredDuringSchedulingIgnoredDuringExecution:
            - labelSelector:
                matchExpressions:
                  - key: app
                    operator: In
                    values:
                      - myapp
                  - key: version
                    operator: In
                    values:
                      - v1
                      - v2
              topologyKey: kubernetes.io/hostname
      containers:
        - name: app
          image: myapp:v2
```

## Namespace Selector

```yaml
# cross-namespace-affinity.yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: monitoring-agent
  namespace: monitoring
spec:
  replicas: 3
  selector:
    matchLabels:
      app: monitoring-agent
  template:
    metadata:
      labels:
        app: monitoring-agent
    spec:
      affinity:
        podAffinity:
          requiredDuringSchedulingIgnoredDuringExecution:
            - labelSelector:
                matchLabels:
                  tier: backend
              topologyKey: kubernetes.io/hostname
              namespaceSelector:
                matchLabels:
                  environment: production
      containers:
        - name: agent
          image: monitoring-agent:v1
```

## StatefulSet Anti-Affinity

```yaml
# statefulset-spread.yaml
apiVersion: apps/v1
kind: StatefulSet
metadata:
  name: cassandra
spec:
  serviceName: cassandra
  replicas: 3
  selector:
    matchLabels:
      app: cassandra
  template:
    metadata:
      labels:
        app: cassandra
    spec:
      affinity:
        podAntiAffinity:
          requiredDuringSchedulingIgnoredDuringExecution:
            - labelSelector:
                matchLabels:
                  app: cassandra
              topologyKey: topology.kubernetes.io/zone
      containers:
        - name: cassandra
          image: cassandra:4.1
```

## Verify Pod Placement

```bash
# Check pod distribution across nodes
kubectl get pods -o wide -l app=web-server

# Check node labels
kubectl get nodes --show-labels

# Describe pod to see scheduling decisions
kubectl describe pod web-server-xxx | grep -A 10 "Events"

# Check which zone pods are in
kubectl get pods -o custom-columns=\
NAME:.metadata.name,\
NODE:.spec.nodeName,\
ZONE:.spec.nodeSelector
```

## Common Topology Keys

```yaml
# Available topology keys:
# - kubernetes.io/hostname      # Per node
# - topology.kubernetes.io/zone # Per availability zone
# - topology.kubernetes.io/region # Per region
# - node.kubernetes.io/instance-type # Per instance type
```

## Summary

Pod affinity co-locates related pods for low-latency communication. Anti-affinity spreads pods for high availability. Use `required` rules for strict placement and `preferred` for best-effort. Combine with topology keys to control distribution across nodes, zones, or regions.
