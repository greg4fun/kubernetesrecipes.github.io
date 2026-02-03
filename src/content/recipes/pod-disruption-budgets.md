---
title: "How to Implement Pod Disruption Budgets"
description: "Configure Pod Disruption Budgets (PDB) for high availability during voluntary disruptions. Ensure minimum availability during node maintenance and cluster upgrades."
category: "deployments"
difficulty: "intermediate"
publishDate: "2026-01-22"
tags: ["pdb", "disruption", "availability", "maintenance", "reliability"]
---

> **💡 Quick Answer:** PDB protects against voluntary disruptions (node drain, upgrades). Set `minAvailable: 2` or `maxUnavailable: 1` (not both). Example: `kubectl create pdb my-pdb --selector=app=web --min-available=2`. Blocks `kubectl drain` if it would violate the budget. Doesn't protect against crashes or OOMKills. Always create PDBs for production stateful apps and databases.

# How to Implement Pod Disruption Budgets

Pod Disruption Budgets protect applications from voluntary disruptions like node drains, cluster upgrades, and autoscaling. Ensure minimum availability during planned maintenance.

## Understanding Disruptions

**Voluntary Disruptions (PDB applies):**
- Node drain for maintenance
- Cluster autoscaler scale-down
- Deployment rolling updates
- kubectl delete pod

**Involuntary Disruptions (PDB doesn't apply):**
- Node crash
- VM deletion
- Kernel panic
- Out of resources

## Basic PDB with minAvailable

```yaml
# pdb-min-available.yaml
apiVersion: policy/v1
kind: PodDisruptionBudget
metadata:
  name: web-app-pdb
  namespace: production
spec:
  minAvailable: 2  # At least 2 pods must be available
  selector:
    matchLabels:
      app: web-app
```

## PDB with maxUnavailable

```yaml
# pdb-max-unavailable.yaml
apiVersion: policy/v1
kind: PodDisruptionBudget
metadata:
  name: api-server-pdb
spec:
  maxUnavailable: 1  # At most 1 pod can be unavailable
  selector:
    matchLabels:
      app: api-server
```

## Percentage-Based PDB

```yaml
# pdb-percentage.yaml
apiVersion: policy/v1
kind: PodDisruptionBudget
metadata:
  name: worker-pdb
spec:
  minAvailable: "75%"  # 75% must remain available
  selector:
    matchLabels:
      app: worker
---
# Or using maxUnavailable
apiVersion: policy/v1
kind: PodDisruptionBudget
metadata:
  name: cache-pdb
spec:
  maxUnavailable: "25%"  # Max 25% can be unavailable
  selector:
    matchLabels:
      app: cache
```

## PDB for StatefulSet

```yaml
# statefulset-pdb.yaml
apiVersion: policy/v1
kind: PodDisruptionBudget
metadata:
  name: database-pdb
spec:
  minAvailable: 2  # Quorum for 3-node cluster
  selector:
    matchLabels:
      app: postgres
---
apiVersion: apps/v1
kind: StatefulSet
metadata:
  name: postgres
spec:
  replicas: 3
  selector:
    matchLabels:
      app: postgres
  template:
    metadata:
      labels:
        app: postgres
    spec:
      containers:
        - name: postgres
          image: postgres:15
```

## Multiple PDBs for Different Components

```yaml
# frontend-pdb.yaml
apiVersion: policy/v1
kind: PodDisruptionBudget
metadata:
  name: frontend-pdb
  namespace: production
spec:
  minAvailable: 3
  selector:
    matchLabels:
      tier: frontend
---
# backend-pdb.yaml
apiVersion: policy/v1
kind: PodDisruptionBudget
metadata:
  name: backend-pdb
  namespace: production
spec:
  maxUnavailable: 1
  selector:
    matchLabels:
      tier: backend
---
# cache-pdb.yaml
apiVersion: policy/v1
kind: PodDisruptionBudget
metadata:
  name: cache-pdb
  namespace: production
spec:
  minAvailable: "50%"
  selector:
    matchLabels:
      tier: cache
```

## PDB with Deployment

```yaml
# deployment-with-pdb.yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: web-app
spec:
  replicas: 5
  selector:
    matchLabels:
      app: web-app
  template:
    metadata:
      labels:
        app: web-app
    spec:
      # Spread across nodes for better availability
      topologySpreadConstraints:
        - maxSkew: 1
          topologyKey: kubernetes.io/hostname
          whenUnsatisfiable: ScheduleAnyway
          labelSelector:
            matchLabels:
              app: web-app
      containers:
        - name: web
          image: web-app:v1
---
apiVersion: policy/v1
kind: PodDisruptionBudget
metadata:
  name: web-app-pdb
spec:
  minAvailable: 3  # 3 of 5 always available
  selector:
    matchLabels:
      app: web-app
```

## Unhealthy Pod Eviction Policy

```yaml
# pdb-unhealthy-policy.yaml
apiVersion: policy/v1
kind: PodDisruptionBudget
metadata:
  name: api-pdb
spec:
  minAvailable: 2
  selector:
    matchLabels:
      app: api
  # Kubernetes 1.26+: Allow evicting unhealthy pods
  unhealthyPodEvictionPolicy: AlwaysAllow
  # Options:
  # - IfHealthyBudget: Only evict unhealthy if healthy budget allows (default)
  # - AlwaysAllow: Always allow evicting unhealthy pods
```

## Check PDB Status

```bash
# List all PDBs
kubectl get pdb -A

# Describe specific PDB
kubectl describe pdb web-app-pdb

# Check disruptions allowed
kubectl get pdb web-app-pdb -o yaml

# Output shows:
# status:
#   currentHealthy: 5
#   desiredHealthy: 3
#   disruptionsAllowed: 2
#   expectedPods: 5
```

## Testing PDB During Drain

```bash
# Try to drain a node (respects PDB)
kubectl drain node-1 --ignore-daemonsets --delete-emptydir-data

# Force drain (ignores PDB - use carefully!)
kubectl drain node-1 --ignore-daemonsets --delete-emptydir-data --force

# Uncordon node after maintenance
kubectl uncordon node-1
```

## PDB Blocking Scenarios

```bash
# If drain is blocked, check PDB
kubectl get pdb -A

# Example output showing blocked drain:
# NAME          MIN AVAILABLE   MAX UNAVAILABLE   ALLOWED DISRUPTIONS   AGE
# web-app-pdb   3               N/A               0                     1h

# ALLOWED DISRUPTIONS = 0 means drain will be blocked
```

## Best Practices Configuration

```yaml
# production-pdb.yaml
# For 5-replica deployment, allow 1 disruption
apiVersion: policy/v1
kind: PodDisruptionBudget
metadata:
  name: production-pdb
  labels:
    environment: production
spec:
  maxUnavailable: 1
  selector:
    matchLabels:
      app: critical-service
      environment: production
```

```yaml
# staging-pdb.yaml
# For staging, be more lenient
apiVersion: policy/v1
kind: PodDisruptionBudget
metadata:
  name: staging-pdb
spec:
  maxUnavailable: "50%"
  selector:
    matchLabels:
      environment: staging
```

## PDB Anti-Patterns to Avoid

```yaml
# BAD: minAvailable equals replicas (blocks all drains)
apiVersion: policy/v1
kind: PodDisruptionBudget
metadata:
  name: bad-pdb
spec:
  minAvailable: 3  # Same as replica count!
  selector:
    matchLabels:
      app: myapp
# This blocks ALL voluntary disruptions!

# GOOD: Allow at least 1 disruption
apiVersion: policy/v1
kind: PodDisruptionBudget
metadata:
  name: good-pdb
spec:
  maxUnavailable: 1
  selector:
    matchLabels:
      app: myapp
```

## Monitoring PDB Metrics

```yaml
# PrometheusRule for PDB alerts
apiVersion: monitoring.coreos.com/v1
kind: PrometheusRule
metadata:
  name: pdb-alerts
spec:
  groups:
    - name: pdb
      rules:
        - alert: PDBDisruptionsBlocked
          expr: kube_poddisruptionbudget_status_pod_disruptions_allowed == 0
          for: 15m
          labels:
            severity: warning
          annotations:
            summary: "PDB {{ $labels.poddisruptionbudget }} blocking disruptions"
            description: "PDB has 0 allowed disruptions for 15 minutes"
```

## Summary

Pod Disruption Budgets ensure application availability during voluntary disruptions. Use `minAvailable` for critical services, `maxUnavailable` for flexible deployments. Always allow at least 1 disruption to prevent blocking cluster maintenance. Combine with topology spread for best availability.

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
