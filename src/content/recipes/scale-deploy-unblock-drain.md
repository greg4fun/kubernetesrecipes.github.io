---
title: "Scale Deployments to Unblock Node Drains"
description: "Safely scale down deployments that block node drains due to PDB violations. Record original replicas, scale to zero, drain, then restore after the node returns."
publishDate: "2026-03-19"
author: "Luca Berton"
category: "configuration"
difficulty: "intermediate"
timeToComplete: "15 minutes"
kubernetesVersion: "1.28+"
tags:
  - scaling
  - drain
  - pdb
  - maintenance
  - deployments
relatedRecipes:
  - "mcp-drain-pdb-workaround"
  - "mcp-update-automation-script"
  - "openshift-node-cordon-uncordon"
---
> 💡 **Quick Answer:** `oc scale deploy/<name> --replicas=0 -n <ns>` removes pods blocking a drain. Record original replica count first, complete the drain and node maintenance, then `oc scale deploy/<name> --replicas=<original>` to restore.

## The Problem

A node drain hangs because one or more Deployments have PDBs preventing pod eviction. The replacement pods can't schedule (hostNetwork port conflicts, resource constraints, or anti-affinity rules). You need to temporarily remove these pods to let the drain proceed.

## The Solution

### Step 1: Identify the Blocking Deployment

```bash
# Dry-run to find blockers
NODE="worker-3"
oc adm drain "$NODE" --dry-run=client --ignore-daemonsets --delete-emptydir-data --force 2>&1 | \
  grep "Cannot evict"
# Cannot evict pod ingress/router-custom-7f8b9c6d4-abc12
```

### Step 2: Record and Scale Down

```bash
# Save current state
NAMESPACE="openshift-ingress"
DEPLOY="router-custom"
ORIGINAL=$(oc get deploy "$DEPLOY" -n "$NAMESPACE" -o jsonpath='{.spec.replicas}')
echo "$NAMESPACE/$DEPLOY=$ORIGINAL" >> /tmp/drain-restore.txt
echo "Recorded: $DEPLOY at $ORIGINAL replicas"

# Scale to zero
oc scale deploy "$DEPLOY" -n "$NAMESPACE" --replicas=0
echo "Scaled $DEPLOY to 0"
```

### Step 3: Drain the Node

```bash
oc adm drain "$NODE" --ignore-daemonsets --delete-emptydir-data --force --timeout=30m
```

### Step 4: Wait for Node to Return

```bash
# Monitor node status (for MCP updates, node will reboot)
watch "oc get node $NODE"
# Wait for: Ready, SchedulingDisabled

# Uncordon
oc adm uncordon "$NODE"
```

### Step 5: Restore All Scaled Deployments

```bash
# Restore from saved state
while IFS='=' read -r ns_deploy replicas; do
  ns=$(echo "$ns_deploy" | cut -d/ -f1)
  deploy=$(echo "$ns_deploy" | cut -d/ -f2)
  echo "Restoring $ns/$deploy to $replicas replicas"
  oc scale deploy "$deploy" -n "$ns" --replicas="$replicas"
done < /tmp/drain-restore.txt

# Verify
cat /tmp/drain-restore.txt | while IFS='=' read -r ns_deploy _; do
  ns=$(echo "$ns_deploy" | cut -d/ -f1)
  deploy=$(echo "$ns_deploy" | cut -d/ -f2)
  oc get deploy "$deploy" -n "$ns"
done
```

### Quick One-Liner

```bash
# For a single known deployment:
R=$(oc get deploy router-custom -n openshift-ingress -o jsonpath='{.spec.replicas}') && \
oc scale deploy router-custom -n openshift-ingress --replicas=0 && \
oc adm drain worker-3 --ignore-daemonsets --delete-emptydir-data --force && \
echo "Waiting for node..." && sleep 300 && \
oc adm uncordon worker-3 && \
oc scale deploy router-custom -n openshift-ingress --replicas=$R
```

## Common Issues

### Multiple Deployments Blocking

Run dry-run after each scale-down — there may be multiple blockers:
```bash
oc scale deploy blocker-1 -n ns1 --replicas=0
# Re-run dry-run
oc adm drain "$NODE" --dry-run=client --ignore-daemonsets --delete-emptydir-data --force 2>&1
# May reveal blocker-2
```

### Forgot to Record Original Replicas

Check the Deployment's history:
```bash
oc rollout history deploy router-custom -n openshift-ingress
# Or check the ReplicaSet annotations for the previous desired count
```

## Best Practices

- **Always record original replicas** to a file — don't trust memory
- **Restore immediately** after the node returns — don't leave services at 0
- **Use the automation script** for clusters with recurring blockers
- **Consider adjusting PDBs** long-term instead of repeated scale-downs
- **Test drain impact in staging** before production maintenance

## Key Takeaways

- Scale-down is a safe temporary measure to unblock drains
- Always record original replica counts before scaling
- Restore replicas as soon as the node returns to Ready
- Multiple deployments may block a single drain — check iteratively
- For recurring issues, fix the PDB or use the MCP automation script
