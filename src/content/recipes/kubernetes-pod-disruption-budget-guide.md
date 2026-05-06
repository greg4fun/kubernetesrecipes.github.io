---
title: "Pod Disruption Budget (PDB) Production Guide"
description: "Configure Pod Disruption Budgets to protect application availability during voluntary disruptions: node drains, cluster upgrades, and autoscaler scale-downs."
tags:
  - "pdb"
  - "availability"
  - "disruption"
  - "upgrades"
  - "production"
category: "deployments"
publishDate: "2026-05-06"
author: "Luca Berton"
difficulty: "intermediate"
relatedRecipes:
  - "kubernetes-pod-disruption-budgets"
---

> 💡 **Quick Answer:** A PDB tells Kubernetes "never disrupt more than N Pods at once" during voluntary operations (node drain, upgrade, autoscaler scale-down). Use `minAvailable` or `maxUnavailable` to guarantee minimum replicas stay running.

## The Problem

Without PDBs, voluntary disruptions can cause outages:

- `kubectl drain` evicts all Pods from a node simultaneously
- Cluster autoscaler removes nodes with running Pods
- Kubernetes upgrades drain nodes one by one (but too fast)
- Multiple Pods of same Deployment on same node all evicted at once

## The Solution

### Basic PDB (minAvailable)

```yaml
apiVersion: policy/v1
kind: PodDisruptionBudget
metadata:
  name: api-server-pdb
  namespace: production
spec:
  minAvailable: 2    # At least 2 Pods must always be running
  selector:
    matchLabels:
      app: api-server
```

### Percentage-Based PDB

```yaml
apiVersion: policy/v1
kind: PodDisruptionBudget
metadata:
  name: workers-pdb
spec:
  maxUnavailable: "25%"    # At most 25% of Pods can be down
  selector:
    matchLabels:
      app: worker
```

### PDB for StatefulSets

```yaml
apiVersion: policy/v1
kind: PodDisruptionBudget
metadata:
  name: database-pdb
spec:
  minAvailable: 2    # Quorum protection (3-replica cluster)
  selector:
    matchLabels:
      app: postgresql
      role: replica
---
# Separate PDB for primary (never disrupt without manual approval)
apiVersion: policy/v1
kind: PodDisruptionBudget
metadata:
  name: database-primary-pdb
spec:
  minAvailable: 1
  selector:
    matchLabels:
      app: postgresql
      role: primary
```

### PDB Decision Matrix

```text
Replicas    Goal                          Config
──────────────────────────────────────────────────────────────
2           Always 1 available            minAvailable: 1
3           Quorum (2/3)                  minAvailable: 2
3           Allow 1 disruption            maxUnavailable: 1
5+          Rolling (max 25% down)        maxUnavailable: "25%"
1           Block all voluntary drain     minAvailable: 1 ⚠️
N           Allow upgrades to proceed     maxUnavailable: 1
```

### PDB + Node Drain Behavior

```bash
# Without PDB:
kubectl drain node-1 --ignore-daemonsets
# → ALL Pods evicted immediately (potential outage)

# With PDB (minAvailable: 2, replicas: 3):
kubectl drain node-1 --ignore-daemonsets
# → Evicts 1 Pod at a time
# → Waits for replacement to be Ready
# → Then evicts next Pod
# → If only 2 Pods left, drain blocks until new Pod is Ready elsewhere

# Drain with timeout (for stuck PDBs):
kubectl drain node-1 --ignore-daemonsets --timeout=300s
```

### Unhealthy Pod Eviction Policy (K8s 1.27+)

```yaml
apiVersion: policy/v1
kind: PodDisruptionBudget
metadata:
  name: api-pdb
spec:
  minAvailable: 2
  selector:
    matchLabels:
      app: api-server
  unhealthyPodEvictionPolicy: AlwaysAllow
  # Allows evicting unhealthy Pods even if PDB would be violated
  # Prevents stuck drains due to crashlooping Pods counting toward budget
```

### Verify PDB Status

```bash
# Check PDB status
kubectl get pdb -A

# Output:
# NAME              MIN AVAILABLE   MAX UNAVAILABLE   ALLOWED DISRUPTIONS   AGE
# api-server-pdb    2               N/A               1                     5d
# workers-pdb       N/A             25%               3                     5d

# Detailed status
kubectl describe pdb api-server-pdb
# Status:
#   Current Healthy: 3
#   Desired Healthy: 2
#   Disruptions Allowed: 1
#   Expected Pods: 3
```

## Common Issues

### Drain stuck forever (0 disruptions allowed)
- **Cause**: PDB minAvailable equals replica count (e.g., min=3, replicas=3)
- **Fix**: Scale up first; or use `maxUnavailable: 1` instead

### PDB blocks cluster autoscaler
- **Cause**: Can't remove node because PDB won't allow disruption
- **Fix**: Ensure `maxUnavailable >= 1` or replicas > minAvailable

### Single-replica PDB blocks all drains
- **Cause**: `minAvailable: 1` with 1 replica = can never evict
- **Fix**: Don't use PDB with single-replica workloads; or scale to 2+

## Best Practices

1. **Every production Deployment needs a PDB** — no exceptions
2. **`maxUnavailable: 1`** is the safest default for most workloads
3. **Never set minAvailable = replicas** — blocks all drains permanently
4. **Use `unhealthyPodEvictionPolicy: AlwaysAllow`** on K8s 1.27+
5. **Test PDBs** — `kubectl drain --dry-run=server` shows what would happen
6. **StatefulSet quorum** — minAvailable = ceil(replicas/2) for consensus

## Key Takeaways

- PDBs protect against voluntary disruptions (drain, upgrade, autoscaler)
- `minAvailable` = minimum Pods that must stay running
- `maxUnavailable` = maximum Pods that can be down simultaneously
- PDB doesn't protect against involuntary disruptions (node crash, OOM)
- `unhealthyPodEvictionPolicy: AlwaysAllow` prevents stuck drains
- Every production workload with 2+ replicas should have a PDB
- Cluster upgrades rely on PDBs to safely drain nodes one at a time
