---
title: "PDB Allowed Disruptions Zero: Debugging"
description: "Debug PodDisruptionBudgets stuck at zero allowed disruptions. Understand minAvailable vs maxUnavailable, fix eviction failures, and plan for maintenance."
publishDate: "2026-03-19"
author: "Luca Berton"
category: "troubleshooting"
difficulty: "intermediate"
timeToComplete: "15 minutes"
kubernetesVersion: "1.28+"
tags:
  - pdb
  - disruption-budget
  - eviction
  - maintenance
  - troubleshooting
relatedRecipes:
  - "mcp-drain-pdb-workaround"
  - "mcp-blocked-stale-update"
  - "node-drain-hostnetwork-ports"
---

> 💡 **Quick Answer:** `ALLOWED DISRUPTIONS: 0` means no pods can be evicted without violating the PDB. Check `oc get pdb -A` — if `minAvailable` equals the current replica count, there's zero headroom. Fix: increase replicas, lower `minAvailable`, or switch to `maxUnavailable: 1`.

## The Problem

You're trying to drain a node, perform cluster maintenance, or run a voluntary disruption, but evictions fail with "Cannot evict pod as it would violate the pod's disruption budget." The PDB shows `ALLOWED DISRUPTIONS: 0`, blocking all maintenance operations.

## The Solution

### Step 1: Identify Problem PDBs

```bash
# List all PDBs with zero allowed disruptions
oc get pdb -A -o custom-columns=\
'NAMESPACE:.metadata.namespace,NAME:.metadata.name,MIN-AVAIL:.spec.minAvailable,MAX-UNAVAIL:.spec.maxUnavailable,CURRENT:.status.currentHealthy,DESIRED:.status.desiredHealthy,ALLOWED:.status.disruptionsAllowed' | \
grep -E "ALLOWED|  0$"
```

### Step 2: Understand Why It's Zero

**Scenario A: minAvailable == replicas**
```yaml
# PDB says: keep at least 3 running
spec:
  minAvailable: 3
# Deployment has exactly 3 replicas
# 3 - 3 = 0 disruptions allowed
```

**Scenario B: Pods not healthy**
```yaml
# PDB says: keep at least 2 running
spec:
  minAvailable: 2
# 3 replicas, but 1 is CrashLooping → only 2 healthy
# 2 - 2 = 0 disruptions allowed
```

**Scenario C: maxUnavailable = 0**
```yaml
# Explicitly no disruptions (misconfiguration)
spec:
  maxUnavailable: 0  # Never do this
```

### Step 3: Fix the PDB

**Option A: Increase replicas (preferred)**
```bash
# If minAvailable: 3, scale to 4 so 1 disruption is allowed
oc scale deploy my-app --replicas=4
```

**Option B: Lower minAvailable**
```yaml
apiVersion: policy/v1
kind: PodDisruptionBudget
metadata:
  name: my-app-pdb
spec:
  minAvailable: 2    # Was 3, now allows 1 disruption with 3 replicas
  selector:
    matchLabels:
      app: my-app
```

**Option C: Switch to maxUnavailable (recommended)**
```yaml
apiVersion: policy/v1
kind: PodDisruptionBudget
metadata:
  name: my-app-pdb
spec:
  maxUnavailable: 1   # Always allows 1 pod to be disrupted
  selector:
    matchLabels:
      app: my-app
```

### minAvailable vs maxUnavailable

| Setting | Replicas=3 | Allowed Disruptions | Drain-Safe? |
|---------|-----------|-------------------|-------------|
| `minAvailable: 3` | 3 | 0 | ❌ Blocks drains |
| `minAvailable: 2` | 3 | 1 | ✅ |
| `minAvailable: 1` | 3 | 2 | ✅ |
| `maxUnavailable: 0` | 3 | 0 | ❌ Blocks drains |
| `maxUnavailable: 1` | 3 | 1 | ✅ |
| `maxUnavailable: "33%"` | 3 | 1 | ✅ |

## Common Issues

### PDB Matches No Pods

```bash
# If selector matches 0 pods, PDB is a no-op (doesn't block anything)
oc get pdb my-pdb -o jsonpath='{.status.currentHealthy}'
# 0 = selector mismatch or no pods
```

### PDB with Both minAvailable and maxUnavailable

Not allowed. The API rejects PDBs with both fields set.

### Temporary Override During Maintenance

```bash
# Delete the PDB, drain, then recreate
oc delete pdb my-app-pdb -n my-namespace
# ... perform maintenance ...
oc apply -f pdb.yaml
```

## Best Practices

- **Use `maxUnavailable: 1`** instead of `minAvailable` — it scales with replica count
- **Always have replicas > minAvailable** — leave headroom for disruptions
- **Use `maxUnavailable: "25%"`** for large deployments — percentage-based is more flexible
- **Never set `maxUnavailable: 0`** — this blocks all voluntary disruptions including upgrades
- **Test PDBs before production** — `oc get pdb` should show `ALLOWED DISRUPTIONS: 1+`

## Key Takeaways

- `ALLOWED DISRUPTIONS: 0` blocks all evictions (drain, scale-down, upgrades)
- Root cause is usually `minAvailable` equal to current healthy count
- `maxUnavailable: 1` is the safest pattern — always allows controlled disruption
- Unhealthy pods reduce the disruption budget — fix CrashLooping pods first
- PDBs only affect voluntary disruptions — involuntary evictions (OOM, preemption) bypass them
