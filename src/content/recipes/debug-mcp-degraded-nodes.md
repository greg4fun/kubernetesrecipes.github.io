---
title: "Debug MCP Degraded Nodes"
description: "Fix nodes stuck Degraded after MachineConfig updates. Check MCD logs, on-disk validation, and recovery for degraded workers."
publishDate: "2026-03-19"
author: "Luca Berton"
category: "troubleshooting"
difficulty: "advanced"
timeToComplete: "15 minutes"
kubernetesVersion: "1.28+"
tags:
  - openshift
  - machineconfig
  - degraded
  - mcd
  - troubleshooting
relatedRecipes:
  - "mcp-blocked-stale-update"
  - "openshift-mcd-logs-debugging"
  - "rhcos-openshift-node-management"
---
> 💡 **Quick Answer:** A degraded node failed to apply its MachineConfig. Check the reason: `oc get node <name> -o jsonpath='{.metadata.annotations.machineconfiguration\.openshift\.io/reason}'`. Then check MCD logs on that node. Common causes: on-disk file drift, failed scripts, disk full, or corrupted config.

## The Problem

The MCP shows `DEGRADED=True` and `DEGRADEDMACHINECOUNT > 0`. One or more nodes failed to apply the new MachineConfig and are stuck. The MCP won't progress to update other nodes, and the degraded node may have a partially applied configuration.

## The Solution

### Step 1: Find Degraded Nodes

```bash
# Check MCP status
oc get mcp worker
# DEGRADED=True, DEGRADEDMACHINECOUNT=1

# Find which node
for node in $(oc get nodes -l node-role.kubernetes.io/worker= -o name); do
  state=$(oc get $node -o jsonpath='{.metadata.annotations.machineconfiguration\.openshift\.io/state}')
  if [ "$state" = "Degraded" ]; then
    reason=$(oc get $node -o jsonpath='{.metadata.annotations.machineconfiguration\.openshift\.io/reason}')
    echo "${node#node/}: DEGRADED — $reason"
  fi
done
```

### Step 2: Check the Degradation Reason

**Reason: "unexpected on-disk state"**
```bash
# Someone or something modified a managed file directly on the node
oc debug node/worker-3 -- chroot /host bash -c '
  # Force MCD to re-validate and re-apply
  touch /run/machine-config-daemon-force
'
# MCD will re-apply the full config and reboot
```

**Reason: "failed to run ... exit status 1"**
```bash
# A MachineConfig script or file write failed
# Check MCD logs for the specific error
MCD_POD=$(oc get pods -n openshift-machine-config-operator -o wide | grep machine-config-daemon | grep worker-3 | awk '{print $1}')
oc logs -n openshift-machine-config-operator "$MCD_POD" -c machine-config-daemon | grep -B2 -A5 "error\|fail"
```

**Reason: "disk full"**
```bash
oc debug node/worker-3 -- chroot /host df -h /
# If full: clean up old containers, images, and logs
oc debug node/worker-3 -- chroot /host bash -c '
  crictl rmi --prune
  journalctl --vacuum-size=500M
'
```

### Step 3: Force Recovery

```bash
# Option A: Force re-application
oc debug node/worker-3 -- chroot /host touch /run/machine-config-daemon-force

# Option B: If the MachineConfig itself is bad, remove it
oc delete mc 99-worker-bad-config
# MCO renders a new config without the bad one, MCD re-applies

# Option C: Nuclear — reboot the node
oc debug node/worker-3 -- chroot /host systemctl reboot
```

### Step 4: Verify Recovery

```bash
# Watch the node state change from Degraded → Working → Done
watch "oc get node worker-3 -o jsonpath='{.metadata.annotations.machineconfiguration\.openshift\.io/state}'"
# Should eventually show: Done

# Verify MCP is healthy
oc get mcp worker
# DEGRADED=False ✅
```

## Common Issues

### Node Stuck in Degraded After Removing Bad MachineConfig

The node may need a force re-apply:
```bash
oc debug node/worker-3 -- chroot /host touch /run/machine-config-daemon-force
```

### Multiple Nodes Degraded

If several nodes degraded on the same MachineConfig, the config itself is likely bad. Delete it, then force-recover each node.

## Best Practices

- **Test MachineConfigs in dev/staging** before production
- **Use `oc get mcp -w`** during rollouts to catch degraded nodes early
- **Never manually edit files on RHCOS** — it causes "unexpected on-disk state"
- **Keep disk space monitored** — full disks prevent config application
- **Force re-apply** is usually safe — it re-writes all managed files

## Key Takeaways

- Degraded = MCD failed to apply the config on that node
- The `reason` annotation tells you exactly what went wrong
- `touch /run/machine-config-daemon-force` triggers a full re-apply
- If the MachineConfig is bad, delete it — MCO will re-render without it
- Degraded nodes block further MCP progress until recovered
