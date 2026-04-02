---
title: "MCP Drain Blocked by PDB: Workaround"
description: "Resolve OpenShift MachineConfigPool drain failures caused by PodDisruptionBudget violations. Scale down and restore after update."
publishDate: "2026-03-19"
author: "Luca Berton"
category: "troubleshooting"
difficulty: "advanced"
timeToComplete: "15 minutes"
kubernetesVersion: "1.28+"
tags:
  - openshift
  - pdb
  - drain
  - machineconfig
  - mcp
  - troubleshooting
relatedRecipes:
  - "mcp-blocked-stale-update"
  - "node-drain-hostnetwork-ports"
  - "mcp-update-automation-script"
  - "openshift-mcp-itms-rollout"
  - "pod-disruption-budget"
---

> 💡 **Quick Answer:** When MCP drain hangs on "Cannot evict pod — violates PodDisruptionBudget", scale the blocking deployment to 0 replicas (`oc scale deploy/<name> --replicas=0`), let the drain complete, wait for the node to reboot and rejoin, then restore the original replica count.

## The Problem

The MachineConfig Operator drains nodes before applying config changes. When a pod's PodDisruptionBudget doesn't allow eviction (e.g., `minAvailable` equals current count), the drain hangs indefinitely. The MCD retries every 5 seconds, the MCP stays stuck at `UPDATING=True`, and no further nodes get updated.

## The Solution

### Step 1: Identify the Blocking Pod

```bash
# Simulate drain to find blockers (dry-run — no actual eviction)
NODE="worker-3"
oc adm drain "$NODE" --ignore-daemonsets --delete-emptydir-data --force --dry-run=client
```

Output reveals the blocker:

```
evicting pod my-namespace/my-app-7f8b9c6d4-x2kp9 (dry run)
error: Cannot evict pod as it would violate the pod's disruption budget.
```

### Step 2: Check the PDB

```bash
# Find PDBs across all namespaces
oc get pdb -A

# Look for ALLOWED DISRUPTIONS: 0
# NAMESPACE        NAME           MIN AVAILABLE   MAX UNAVAILABLE   ALLOWED DISRUPTIONS   AGE
# my-namespace     my-app-pdb     2               N/A               0                     30d
# openshift-ingress router-pdb    1               N/A               0                     30d
```

### Step 3: Understand Why Eviction Fails

The PDB says `minAvailable: 2` but only 2 replicas exist → 0 disruptions allowed. Common scenarios:
- **Custom ingress routers** with hostNetwork — replacement pods can't schedule because ports are already in use
- **Stateful services** with `minAvailable` equal to replica count
- **Single-replica deployments** with any PDB

### Step 4: Scale Down the Blocker

```bash
# Record current replicas
DEPLOY="my-app"
NAMESPACE="my-namespace"
ORIGINAL_REPLICAS=$(oc -n "$NAMESPACE" get deploy "$DEPLOY" -o jsonpath='{.spec.replicas}')
echo "Original replicas: $ORIGINAL_REPLICAS"

# Scale to 0
oc -n "$NAMESPACE" scale deploy/"$DEPLOY" --replicas=0

# Verify pod is gone
oc -n "$NAMESPACE" get pods -l app="$DEPLOY"
```

### Step 5: Drain Completes Automatically

If MCD was already trying to drain, it will now succeed. Otherwise:

```bash
# Manual drain if needed
oc adm drain "$NODE" --ignore-daemonsets --delete-emptydir-data --force --timeout=30m
```

### Step 6: Wait for Node Update

```bash
# Monitor node status
watch "oc get node $NODE -o wide"

# Node will go through:
# 1. SchedulingDisabled (cordoned)
# 2. NotReady (rebooting)
# 3. Ready (config applied)

# Verify config applied
oc get node "$NODE" -o jsonpath='{.metadata.annotations.machineconfiguration\.openshift\.io/state}'
# Should show: Done
```

### Step 7: Uncordon and Restore

```bash
# Uncordon the node
oc adm uncordon "$NODE"

# Restore the deployment to original replicas
oc -n "$NAMESPACE" scale deploy/"$DEPLOY" --replicas="$ORIGINAL_REPLICAS"

# Verify pods are running
oc -n "$NAMESPACE" get pods -l app="$DEPLOY" -o wide
```

### Step 8: Repeat for Next Node

MCO will automatically begin draining the next worker. Check if it's also blocked:

```bash
oc get mcp worker
# If UPDATING=True and UPDATEDMACHINECOUNT hasn't increased,
# repeat from Step 1 for the next node
```

## Common Issues

### Scaled Down But Drain Still Fails

Multiple pods may be blocking. Run dry-run again after scaling one deployment:

```bash
oc adm drain "$NODE" --ignore-daemonsets --delete-emptydir-data --force --dry-run=client
# May reveal a SECOND blocking pod/deployment
```

### Forgot to Restore Replicas

```bash
# Find deployments at 0 replicas that shouldn't be
oc get deploy -A --field-selector spec.replicas=0 | grep -v "^NAMESPACE"
```

### PDB with maxUnavailable Instead of minAvailable

```yaml
# This PDB allows 1 disruption — usually won't block MCP
apiVersion: policy/v1
kind: PodDisruptionBudget
spec:
  maxUnavailable: 1
  selector:
    matchLabels:
      app: my-app
```

## Best Practices

- **Always record original replica count** before scaling down
- **Scale down only the specific blocking deployment** — not all replicas in the namespace
- **Restore replicas immediately after the node rejoins** — don't leave at 0
- **Consider relaxing PDBs during maintenance windows** — `maxUnavailable: 1` is safer than `minAvailable: N`
- **Use the automation script** for clusters with many blocking workloads

## Key Takeaways

- `oc adm drain --dry-run=client` reveals exactly which pods block eviction
- PDB with `ALLOWED DISRUPTIONS: 0` is the root cause
- Temporarily scale the blocking deployment to 0, drain, then restore
- MCO processes nodes sequentially — fix one blocker at a time
- Always restore replicas after the node returns to Ready
