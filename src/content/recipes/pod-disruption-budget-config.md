---
title: "How to Configure Pod Disruption Budgets"
description: "Protect application availability during voluntary disruptions. Configure PDBs to ensure minimum replicas during node drains, upgrades, and maintenance."
category: "deployments"
difficulty: "intermediate"
publishDate: "2026-01-22"
tags: ["pdb", "availability", "disruption", "maintenance", "upgrades"]
---

# How to Configure Pod Disruption Budgets

Pod Disruption Budgets (PDBs) limit voluntary disruptions to ensure application availability during node maintenance, cluster upgrades, and autoscaling events.

## Understanding Disruptions

```yaml
# Voluntary disruptions (PDB applies):
# - Node drain (kubectl drain)
# - Cluster autoscaler scale-down
# - Node upgrades
# - Pod eviction API

# Involuntary disruptions (PDB does NOT apply):
# - Node failure
# - Kernel panic
# - Pod OOM killed
# - Hardware failure
```

## Basic PDB with minAvailable

```yaml
# pdb-min-available.yaml
apiVersion: policy/v1
kind: PodDisruptionBudget
metadata:
  name: web-pdb
spec:
  minAvailable: 2  # At least 2 pods must remain available
  selector:
    matchLabels:
      app: web
```

```bash
kubectl apply -f pdb-min-available.yaml

# Check PDB status
kubectl get pdb web-pdb
# NAME      MIN AVAILABLE   MAX UNAVAILABLE   ALLOWED DISRUPTIONS   AGE
# web-pdb   2               N/A               1                     1m
```

## PDB with maxUnavailable

```yaml
# pdb-max-unavailable.yaml
apiVersion: policy/v1
kind: PodDisruptionBudget
metadata:
  name: api-pdb
spec:
  maxUnavailable: 1  # At most 1 pod can be unavailable
  selector:
    matchLabels:
      app: api
```

## Percentage-Based PDB

```yaml
# pdb-percentage.yaml
apiVersion: policy/v1
kind: PodDisruptionBudget
metadata:
  name: worker-pdb
spec:
  minAvailable: "50%"  # At least 50% of pods must remain
  selector:
    matchLabels:
      app: worker
---
# Or with maxUnavailable
apiVersion: policy/v1
kind: PodDisruptionBudget
metadata:
  name: cache-pdb
spec:
  maxUnavailable: "25%"  # At most 25% can be unavailable
  selector:
    matchLabels:
      app: cache
```

## PDB for StatefulSets

```yaml
# statefulset-pdb.yaml
apiVersion: policy/v1
kind: PodDisruptionBudget
metadata:
  name: database-pdb
spec:
  maxUnavailable: 1
  selector:
    matchLabels:
      app: database
---
apiVersion: apps/v1
kind: StatefulSet
metadata:
  name: database
spec:
  replicas: 3
  selector:
    matchLabels:
      app: database
  template:
    metadata:
      labels:
        app: database
    # ...
```

## PDB for DaemonSets

```yaml
# daemonset-pdb.yaml
apiVersion: policy/v1
kind: PodDisruptionBudget
metadata:
  name: logging-pdb
spec:
  maxUnavailable: "10%"  # Allow 10% of nodes to drain
  selector:
    matchLabels:
      app: fluentd
---
apiVersion: apps/v1
kind: DaemonSet
metadata:
  name: fluentd
spec:
  selector:
    matchLabels:
      app: fluentd
  # ...
```

## Multiple PDBs for Different Components

```yaml
# multi-pdb.yaml
apiVersion: policy/v1
kind: PodDisruptionBudget
metadata:
  name: frontend-pdb
  namespace: production
spec:
  minAvailable: 3
  selector:
    matchLabels:
      app: myapp
      component: frontend
---
apiVersion: policy/v1
kind: PodDisruptionBudget
metadata:
  name: backend-pdb
  namespace: production
spec:
  minAvailable: 2
  selector:
    matchLabels:
      app: myapp
      component: backend
---
apiVersion: policy/v1
kind: PodDisruptionBudget
metadata:
  name: worker-pdb
  namespace: production
spec:
  maxUnavailable: "50%"
  selector:
    matchLabels:
      app: myapp
      component: worker
```

## Unhealthy Pod Eviction Policy

```yaml
# unhealthy-eviction.yaml
apiVersion: policy/v1
kind: PodDisruptionBudget
metadata:
  name: app-pdb
spec:
  minAvailable: 2
  selector:
    matchLabels:
      app: myapp
  unhealthyPodEvictionPolicy: AlwaysAllow
  # Options:
  # - IfHealthyBudget (default): Only evict unhealthy pods if budget allows
  # - AlwaysAllow: Always allow evicting unhealthy pods
```

## Check PDB Status

```bash
# List all PDBs
kubectl get pdb -A

# Detailed PDB info
kubectl describe pdb web-pdb

# Check allowed disruptions
kubectl get pdb web-pdb -o jsonpath='{.status.disruptionsAllowed}'

# Watch PDB during drain
kubectl get pdb -w

# PDB blocking drain? Check conditions
kubectl get pdb web-pdb -o yaml | grep -A 10 conditions
```

## Test PDB Behavior

```bash
# Create deployment with 3 replicas
kubectl create deployment web --image=nginx --replicas=3

# Create PDB requiring 2 available
kubectl create pdb web-pdb --selector=app=web --min-available=2

# Try to drain node (will respect PDB)
kubectl drain node1 --ignore-daemonsets --delete-emptydir-data

# If PDB blocks drain, you'll see:
# error when evicting pods: Cannot evict pod as it would violate the pod's disruption budget

# Force drain (ignores PDB - use with caution)
kubectl drain node1 --ignore-daemonsets --delete-emptydir-data --force
```

## Common PDB Patterns

```yaml
# High availability service (always keep majority)
apiVersion: policy/v1
kind: PodDisruptionBudget
metadata:
  name: ha-service-pdb
spec:
  minAvailable: "51%"
  selector:
    matchLabels:
      app: ha-service
---
# Single replica service (prevent all evictions)
apiVersion: policy/v1
kind: PodDisruptionBudget
metadata:
  name: singleton-pdb
spec:
  minAvailable: 1
  selector:
    matchLabels:
      app: singleton
---
# Batch jobs (allow some disruption)
apiVersion: policy/v1
kind: PodDisruptionBudget
metadata:
  name: batch-pdb
spec:
  maxUnavailable: "30%"
  selector:
    matchLabels:
      app: batch-worker
```

## PDB with Cluster Autoscaler

```yaml
# Ensure autoscaler respects availability
apiVersion: policy/v1
kind: PodDisruptionBudget
metadata:
  name: critical-app-pdb
  annotations:
    cluster-autoscaler.kubernetes.io/safe-to-evict: "false"
spec:
  minAvailable: 2
  selector:
    matchLabels:
      app: critical-app
```

## Troubleshooting PDB Issues

```bash
# PDB blocking all evictions?
# Check if minAvailable >= current replicas
kubectl get pdb myapp-pdb
kubectl get pods -l app=myapp

# Common issues:
# 1. minAvailable equals replica count (no room for eviction)
# 2. Unhealthy pods counting against budget
# 3. Multiple PDBs selecting same pods

# Find pods selected by PDB
kubectl get pods -l $(kubectl get pdb myapp-pdb -o jsonpath='{.spec.selector.matchLabels}' | tr -d '{}' | tr ':' '=' | tr ',' ',')

# Check if pod is covered by PDB
kubectl get pdb --selector=app=myapp
```

## Best Practices

```markdown
1. Always create PDBs for production workloads
   - Prevents accidental full eviction
   - Ensures availability during maintenance

2. Set reasonable values
   - Don't set minAvailable = replicas (blocks all drains)
   - Allow at least 1 disruption for upgrades

3. Use percentages for variable replica counts
   - minAvailable: "50%" scales with replicas
   - Easier to maintain

4. Consider unhealthy pods
   - Use AlwaysAllow to evict stuck pods
   - Prevents unhealthy pods blocking drains

5. Test PDBs before production
   - Verify drain behavior
   - Ensure upgrades can proceed
```

## Summary

Pod Disruption Budgets protect application availability during voluntary disruptions like node drains and upgrades. Use `minAvailable` to specify minimum running pods or `maxUnavailable` to limit concurrent disruptions. Percentages work well for variable replica counts. Always create PDBs for production workloads but ensure values allow some disruption for maintenance. Use `unhealthyPodEvictionPolicy: AlwaysAllow` to prevent unhealthy pods from blocking operations. Check PDB status with `kubectl get pdb` to monitor allowed disruptions.
