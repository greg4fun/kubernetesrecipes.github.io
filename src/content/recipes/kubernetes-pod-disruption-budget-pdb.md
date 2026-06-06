---
title: "Kubernetes Pod Disruption Budget PDB Guide"
description: "Protect application availability with Kubernetes PodDisruptionBudgets. Configure minAvailable and maxUnavailable for voluntary disruptions like node"
tags:
  - "pdb"
  - "high-availability"
  - "disruption"
  - "maintenance"
  - "availability"
category: "deployments"
publishDate: "2026-06-01"
author: "Luca Berton"
difficulty: "intermediate"
relatedRecipes:
  - "kubernetes-pod-priority-preemption-scheduling"
  - "kubernetes-graceful-shutdown-pod-termination"
  - "kubernetes-rolling-update-strategies"
---

> 💡 **Quick Answer:** A PodDisruptionBudget (PDB) limits how many pods can be simultaneously unavailable during voluntary disruptions (node drain, cluster upgrade, autoscaler). Set `minAvailable: 2` (always keep at least 2 running) or `maxUnavailable: 1` (remove at most 1 at a time). PDBs protect against `kubectl drain` and voluntary evictions but NOT against crashes or resource limits.

## The Problem

- Node drain during maintenance evicts all pods on that node simultaneously
- Cluster autoscaler removing nodes can kill critical services
- Kubernetes upgrades rolling nodes leave services with zero replicas briefly
- Need to guarantee minimum available replicas during planned disruptions
- Rolling updates + node drains can combine to take down all replicas

## The Solution

### Basic PDB (minAvailable)

```yaml
apiVersion: policy/v1
kind: PodDisruptionBudget
metadata:
  name: api-server-pdb
  namespace: production
spec:
  minAvailable: 2    # Always keep at least 2 pods running
  selector:
    matchLabels:
      app: api-server
```

### PDB with maxUnavailable

```yaml
apiVersion: policy/v1
kind: PodDisruptionBudget
metadata:
  name: api-server-pdb
  namespace: production
spec:
  maxUnavailable: 1    # At most 1 pod can be disrupted at a time
  selector:
    matchLabels:
      app: api-server
```

### Percentage-Based PDB

```yaml
apiVersion: policy/v1
kind: PodDisruptionBudget
metadata:
  name: worker-pdb
spec:
  maxUnavailable: "25%"    # Allow 25% of pods to be unavailable
  selector:
    matchLabels:
      app: worker
# With 10 replicas: at most 2 can be disrupted simultaneously (ceil 25% of 10 = 2.5 → 2)
```

### When PDB Blocks Drain

```bash
# Attempt to drain a node
kubectl drain node-1 --ignore-daemonsets

# If PDB would be violated:
# error when evicting pods/api-server-xyz: Cannot evict pod as it would violate
# the pod's disruption budget. The disruption budget api-server-pdb needs 2 healthy
# pods and has 2, but we can only tolerate 0 disruptions.

# Force drain (bypasses PDB — use with extreme caution)
kubectl drain node-1 --ignore-daemonsets --force --delete-emptydir-data
```

### Check PDB Status

```bash
kubectl get pdb -n production
# NAME             MIN AVAILABLE   MAX UNAVAILABLE   ALLOWED DISRUPTIONS   AGE
# api-server-pdb   2               N/A               1                     5d
# worker-pdb       N/A             25%               3                     5d

kubectl describe pdb api-server-pdb -n production
# Status:
#   Current Healthy:   3
#   Desired Healthy:   2
#   Disruptions Allowed: 1
#   Expected Pods:     3
```

### PDB for StatefulSets

```yaml
apiVersion: policy/v1
kind: PodDisruptionBudget
metadata:
  name: database-pdb
spec:
  maxUnavailable: 1    # Only 1 replica down at a time (safe for quorum)
  selector:
    matchLabels:
      app: database
# For a 3-node database cluster: ensures quorum (2/3) is maintained
```

### Common PDB Patterns

```text
Workload Type        │ Replicas │ Recommended PDB
─────────────────────┼──────────┼──────────────────────────
Stateless API        │ 3        │ maxUnavailable: 1
Stateless API        │ 10       │ maxUnavailable: 25%
Database (quorum)    │ 3        │ minAvailable: 2
Database (quorum)    │ 5        │ minAvailable: 3
Message queue        │ 3        │ maxUnavailable: 1
Singleton (1 replica)│ 1        │ minAvailable: 1 (blocks all drains!)
Worker pool          │ 20       │ maxUnavailable: 5
─────────────────────┴──────────┴──────────────────────────
```

### Unhealthy Pod Eviction (K8s 1.27+)

```yaml
apiVersion: policy/v1
kind: PodDisruptionBudget
metadata:
  name: api-server-pdb
spec:
  maxUnavailable: 1
  selector:
    matchLabels:
      app: api-server
  unhealthyPodEvictionPolicy: AlwaysAllow
  # AlwaysAllow: unhealthy pods can always be evicted (don't count toward budget)
  # IfHealthyBudget: only evict unhealthy pods if budget allows (default)
```

## Common Issues

### PDB blocking node drain indefinitely
- **Cause**: Deployment has fewer ready pods than PDB requires; or single-replica with minAvailable: 1
- **Fix**: Scale up first; fix unhealthy pods; or use `maxUnavailable: 1` instead of `minAvailable` for single-replica

### PDB not protecting during rolling update
- **Cause**: Rolling updates are managed by the Deployment controller, which respects `maxUnavailable` in strategy, not PDB
- **Fix**: PDB protects against external disruptions (drain); Deployment strategy protects during updates. Configure both.

### Cluster autoscaler can't scale down
- **Cause**: PDB blocking eviction of pods on underutilized nodes
- **Fix**: Ensure `ALLOWED DISRUPTIONS > 0`; scale up replicas; or reduce `minAvailable`

### "Cannot evict" for pods without controller
- **Cause**: Bare pods (no Deployment/ReplicaSet owner) won't be recreated after eviction
- **Fix**: Use `kubectl drain --force` or (better) always use Deployments

## Best Practices

1. **Every production Deployment should have a PDB** — protect against unexpected drains
2. **Use `maxUnavailable` over `minAvailable`** — scales better with replica count
3. **Don't set `minAvailable` = replicas** — blocks ALL voluntary disruptions (drains stuck forever)
4. **Ensure disruptions allowed > 0** — or node maintenance becomes impossible
5. **Pair with anti-affinity** — spread pods across nodes so drain only hits 1 pod
6. **Use `unhealthyPodEvictionPolicy: AlwaysAllow`** — don't let stuck pods block drains
7. **Single-replica services** — `maxUnavailable: 1` (allows drain); `minAvailable: 1` (blocks drain)

## Key Takeaways

- PDB limits voluntary disruptions: node drains, cluster upgrades, autoscaler scale-down
- Does NOT protect against: crashes, OOMKilled, node failures (involuntary)
- `minAvailable`: minimum pods that must stay running
- `maxUnavailable`: maximum pods that can be simultaneously disrupted
- Percentage values: `maxUnavailable: "25%"` adapts to replica count
- `kubectl get pdb` shows `ALLOWED DISRUPTIONS` — must be > 0 for drains to work
- Combine with pod anti-affinity for true HA across nodes
