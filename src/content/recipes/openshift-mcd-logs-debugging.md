---
title: "Debug MachineConfigDaemon Logs"
description: "Read and interpret OpenShift MachineConfigDaemon logs to diagnose node update failures. Common error patterns, drain issues, and config application problems."
publishDate: "2026-03-19"
author: "Luca Berton"
category: "troubleshooting"
difficulty: "intermediate"
timeToComplete: "15 minutes"
kubernetesVersion: "1.28+"
tags:
  - openshift
  - machineconfig
  - mcd
  - debugging
  - mco
relatedRecipes:
  - "mcp-blocked-stale-update"
  - "mcp-drain-pdb-workaround"
  - "rhcos-openshift-node-management"
---

> 💡 **Quick Answer:** Check MCD logs with `oc -n openshift-machine-config-operator logs <mcd-pod> -c machine-config-daemon --since=10m`. Look for patterns: "Cannot drain node" (PDB blocker), "unexpected on-disk state" (config drift), "failed to run: exit status 1" (script failure).

## The Problem

A MachineConfigPool update is stuck or a node shows `DEGRADED`. The MCP conditions give a high-level view, but the real diagnostics are in the MachineConfigDaemon logs running on each node. You need to find the right pod and interpret the log patterns.

## The Solution

### Find the MCD Pod for a Specific Node

```bash
# List all MCD pods with their nodes
oc -n openshift-machine-config-operator get pods -l k8s-app=machine-config-daemon -o wide

# Get the MCD pod for a specific node
NODE="worker-3"
MCD_POD=$(oc -n openshift-machine-config-operator get pods -o wide | \
  grep machine-config-daemon | grep "$NODE" | awk '{print $1}')
echo "MCD pod for $NODE: $MCD_POD"
```

### Check Recent Logs

```bash
# Last 10 minutes of MCD logs
oc -n openshift-machine-config-operator logs "$MCD_POD" -c machine-config-daemon --since=10m

# Follow live (useful during active updates)
oc -n openshift-machine-config-operator logs "$MCD_POD" -c machine-config-daemon -f

# Search for errors specifically
oc -n openshift-machine-config-operator logs "$MCD_POD" -c machine-config-daemon | grep -iE "error|fail|cannot|block"
```

### Common Log Patterns and Meanings

**Pattern 1: Drain blocked by PDB**
```
I0319 08:30:14 daemon.go:1234] draining node worker-3
E0319 08:30:19 daemon.go:1240] Cannot drain node worker-3: eviction blocked by pod my-namespace/my-app-xxxxx because of PodDisruptionBudget
```
**Fix:** Scale down the blocking deployment or adjust the PDB.

**Pattern 2: Unexpected on-disk state**
```
E0319 08:30:14 daemon.go:890] Node worker-3 is reporting: "unexpected on-disk state validating against rendered-worker-abc123"
```
**Fix:** Someone manually edited files on the RHCOS node. Force re-render:
```bash
oc debug node/worker-3 -- chroot /host touch /run/machine-config-daemon-force
```

**Pattern 3: Config application script failure**
```
E0319 08:30:14 daemon.go:567] failed to run: exit status 1: error writing file /etc/chrony.conf: permission denied
```
**Fix:** Check MachineConfig content for syntax errors or invalid file paths.

**Pattern 4: Reboot pending**
```
I0319 08:30:14 daemon.go:1456] Changes require reboot. Initiating node reboot.
```
**Status:** Normal — MCD is rebooting the node to apply kernel-level changes.

**Pattern 5: Drain timeout**
```
E0319 09:00:14 daemon.go:1245] Drain timed out after 3600s for node worker-3
```
**Fix:** Identify blocking pods, scale down, or increase drain timeout in MCO config.

### Check All MCD Pods for Active Work

```bash
# Quick scan: which MCD is actively working?
for pod in $(oc -n openshift-machine-config-operator get pods -l k8s-app=machine-config-daemon -o name); do
  echo "=== $pod ==="
  oc -n openshift-machine-config-operator logs "$pod" -c machine-config-daemon --since=5m 2>/dev/null | \
    grep -E "Working|drain|reboot|error|Degraded" | tail -3
done
```

### Check Node Annotations for MCD State

```bash
# State machine: Done → Working → Done (or Degraded)
for node in $(oc get nodes -l node-role.kubernetes.io/worker= -o name); do
  state=$(oc get "$node" -o jsonpath='{.metadata.annotations.machineconfiguration\.openshift\.io/state}')
  echo "$node: $state"
done
```

## Common Issues

### MCD Pod Itself Is CrashLooping

```bash
oc -n openshift-machine-config-operator get pods | grep machine-config-daemon
# If a MCD pod shows CrashLoopBackOff, check previous logs:
oc -n openshift-machine-config-operator logs "$MCD_POD" -c machine-config-daemon --previous
```

### MCD Not Picking Up New Config

The MCO triggers MCD updates by setting the `desiredConfig` annotation on nodes. If MCD isn't acting:

```bash
# Check if the node's desiredConfig was updated
oc get node worker-3 -o jsonpath='{.metadata.annotations.machineconfiguration\.openshift\.io/desiredConfig}'
# Compare with current
oc get node worker-3 -o jsonpath='{.metadata.annotations.machineconfiguration\.openshift\.io/currentConfig}'
```

## Best Practices

- **Always check MCD logs before escalating** — 90% of MCP issues are explained in the daemon logs
- **Use `--since=10m`** to limit log volume — MCD can be chatty
- **Grep for "drain" and "error"** first — these reveal the root cause fastest
- **Monitor node state annotations** — `Working`, `Done`, `Degraded` tell the story
- **Check the MCD on the specific stuck node** — don't scan all nodes unless needed

## Key Takeaways

- MCD runs as a DaemonSet on every node — one pod per node
- Logs reveal drain blockers, config errors, reboot status, and degraded reasons
- Key patterns: "Cannot drain" (PDB), "unexpected on-disk" (drift), "exit status 1" (script)
- Node annotations show MCD state: Done → Working → Done or Degraded
- Always start troubleshooting with `oc logs <mcd-pod> -c machine-config-daemon --since=10m`
