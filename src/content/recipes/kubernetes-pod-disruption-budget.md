---
title: "K8s PodDisruptionBudget PDB Guide"
description: "Configure Kubernetes PodDisruptionBudgets to protect application availability during node drains. minAvailable, maxUnavailable, and drain safety patterns."
publishDate: "2026-05-02"
author: "Luca Berton"
category: "deployments"
difficulty: "intermediate"
timeToComplete: "8 minutes"
kubernetesVersion: "1.28+"
tags:
  - "pdb"
  - "availability"
  - "node-drain"
  - "scheduling"
  - "cka"
relatedRecipes:
  - "kubernetes-deployment-rolling-update"
  - "kubernetes-graceful-shutdown-guide"
  - "cluster-autoscaler"
  - "kubernetes-node-affinity-guide"
  - "kubernetes-priority-preemption-guide"
---

> 💡 **Quick Answer:** `PodDisruptionBudget` prevents too many pods from being evicted simultaneously during voluntary disruptions (node drain, cluster upgrades). Set `minAvailable: 2` (at least 2 pods must stay running) or `maxUnavailable: 1` (at most 1 pod down at a time). Without a PDB, `kubectl drain` can evict all pods at once.

## The Problem

Voluntary disruptions can kill your application:

- `kubectl drain node` evicts all pods on a node
- Cluster autoscaler scales down nodes with pods
- Kubernetes upgrades drain nodes one by one
- Without PDB, all replicas of a service could be evicted simultaneously

## The Solution

### Basic PDB

```yaml
# At least 2 pods must always be running
apiVersion: policy/v1
kind: PodDisruptionBudget
metadata:
  name: web-pdb
spec:
  minAvailable: 2
  selector:
    matchLabels:
      app: web-frontend

---
# At most 1 pod can be unavailable
apiVersion: policy/v1
kind: PodDisruptionBudget
metadata:
  name: api-pdb
spec:
  maxUnavailable: 1
  selector:
    matchLabels:
      app: api-service

---
# Percentage-based
apiVersion: policy/v1
kind: PodDisruptionBudget
metadata:
  name: worker-pdb
spec:
  maxUnavailable: "25%"
  selector:
    matchLabels:
      app: worker
```

### How PDB Works

```bash
# Without PDB:
kubectl drain node-1
# All 3 replicas on node-1 evicted simultaneously → downtime!

# With PDB (maxUnavailable: 1):
kubectl drain node-1
# Pod 1 evicted → rescheduled on node-2 → becomes Ready
# Pod 2 evicted → rescheduled on node-3 → becomes Ready
# Pod 3 evicted → rescheduled → done
# At most 1 pod unavailable at any time → no downtime!
```

### Check PDB Status

```bash
kubectl get pdb
# NAME      MIN AVAILABLE   MAX UNAVAILABLE   ALLOWED DISRUPTIONS   AGE
# web-pdb   2               N/A               1                     5m
# api-pdb   N/A             1                 1                     5m

kubectl describe pdb web-pdb
# Status:
#   Current Healthy:   3
#   Desired Healthy:   2
#   Disruptions Allowed: 1
```

### PDB + Node Drain

```bash
# Drain respects PDBs
kubectl drain node-1 --ignore-daemonsets --delete-emptydir-data

# If PDB blocks drain:
# error when evicting pods: Cannot evict pod as it would violate the pod's disruption budget.

# Force drain (ignores PDB — use with caution!)
kubectl drain node-1 --ignore-daemonsets --force

# Timeout drain
kubectl drain node-1 --ignore-daemonsets --timeout=300s
```

### minAvailable vs maxUnavailable

| Setting | 3 replicas | 5 replicas | Best for |
|---------|-----------|-----------|----------|
| `minAvailable: 1` | 2 can be down | 4 can be down | Minimum viable |
| `minAvailable: 2` | 1 can be down | 3 can be down | High availability |
| `maxUnavailable: 1` | 2 must stay | 4 must stay | Most common |
| `maxUnavailable: "50%"` | 1 can be down | 2 can be down | Large deployments |

### Common Patterns

```yaml
# Stateless web app — allow 1 down at a time
apiVersion: policy/v1
kind: PodDisruptionBudget
metadata:
  name: web-pdb
spec:
  maxUnavailable: 1
  selector:
    matchLabels:
      app: web

---
# Database — never disrupt the primary
apiVersion: policy/v1
kind: PodDisruptionBudget
metadata:
  name: db-pdb
spec:
  minAvailable: 1        # Primary must always be up
  selector:
    matchLabels:
      app: postgres
      role: primary

---
# Batch workers — allow more disruption
apiVersion: policy/v1
kind: PodDisruptionBudget
metadata:
  name: worker-pdb
spec:
  maxUnavailable: "50%"
  selector:
    matchLabels:
      app: batch-worker
```

## Common Issues

**Drain blocked indefinitely by PDB**

Only 1 replica and `minAvailable: 1` — can never evict. Use `maxUnavailable: 1` instead, or increase replicas.

**PDB not protecting pods**

Selector doesn't match pod labels. Check: `kubectl get pdb -o yaml` and compare with `kubectl get pods --show-labels`.

**PDB blocks cluster autoscaler scale-down**

By design — autoscaler respects PDBs. Ensure enough replicas spread across nodes so at least one node can always be drained.

## Best Practices

- **Every production Deployment should have a PDB** — protect against drain
- **Use `maxUnavailable: 1`** as the default — simple and safe
- **Never set `minAvailable` equal to `replicas`** — blocks all disruptions
- **Spread replicas across nodes** with pod anti-affinity — PDB + spread = safe drains
- **Test with `kubectl drain --dry-run=server`** — preview what would be evicted

## Key Takeaways

- PDBs protect pods during voluntary disruptions (drain, autoscaler, upgrades)
- `maxUnavailable: 1` is the most common and safest default
- Without PDB, `kubectl drain` can evict all replicas simultaneously
- PDBs don't protect against involuntary disruptions (node crash, OOM)
- Combine with pod anti-affinity for full high-availability protection
