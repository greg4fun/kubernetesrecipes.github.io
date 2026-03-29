---
title: "Pause and Unpause MCP Rollouts"
description: "Temporarily pause MachineConfigPool rollouts to batch multiple MachineConfig changes or coordinate with maintenance windows. Unpause to resume node updates."
publishDate: "2026-03-19"
author: "Luca Berton"
category: "configuration"
difficulty: "intermediate"
timeToComplete: "15 minutes"
kubernetesVersion: "1.28+"
tags:
  - openshift
  - machineconfig
  - mcp
  - pause
  - maintenance
relatedRecipes:
  - "mcp-blocked-stale-update"
  - "mcp-maxunavailable-configuration"
  - "openshift-mcp-itms-rollout"
---
> 💡 **Quick Answer:** `oc patch mcp worker --type merge -p '{"spec":{"paused":true}}'` stops the MCO from draining/rebooting nodes. Apply multiple MachineConfigs while paused, then unpause to roll out all changes in a single reboot per node.

## The Problem

Each MachineConfig change triggers a rolling reboot across all nodes in the MCP. If you need to apply 3 changes (chrony, sysctl, registries), that's 3 separate rounds of drain-reboot-uncordon per node. You want to batch them into one round.

## The Solution

### Pause the MCP

```bash
oc patch mcp worker --type merge -p '{"spec":{"paused":true}}'

# Verify
oc get mcp worker -o jsonpath='{.spec.paused}'
# true
```

### Apply Multiple Changes While Paused

```bash
# Change 1: NTP servers
oc apply -f 99-worker-chrony.yaml

# Change 2: Kernel parameters
oc apply -f 99-worker-sysctl.yaml

# Change 3: Registry mirrors
oc apply -f 99-worker-registries.yaml

# MCO renders a new config but does NOT start rolling it out
oc get mcp worker
# UPDATED=False, UPDATING=False (paused!)
```

### Unpause to Start Rollout

```bash
# All 3 changes will be applied in ONE reboot per node
oc patch mcp worker --type merge -p '{"spec":{"paused":false}}'

# Monitor
watch oc get mcp worker
```

### Verify All Changes Applied

```bash
# After rollout completes
oc debug node/worker-1 -- chroot /host bash -c '
  echo "=== Chrony ==="
  chronyc sources | head -5
  echo ""
  echo "=== Sysctl ==="
  sysctl net.core.somaxconn vm.max_map_count
  echo ""
  echo "=== Registries ==="
  head -20 /etc/containers/registries.conf
'
```

## Common Issues

### Paused Too Long — Forgot to Unpause

Nodes accumulate config drift. The longer you wait, the bigger the change set:
```bash
# Check if any MCP is paused
oc get mcp -o custom-columns='NAME:.metadata.name,PAUSED:.spec.paused'
```

### Pausing Doesn't Stop In-Progress Updates

If a node is already being drained when you pause, that node finishes. Pause only prevents the NEXT node from starting.

### Security Patches Delayed

Paused MCPs don't receive security-related MachineConfig changes until unpaused. Don't leave MCPs paused for extended periods.

## Best Practices

- **Pause before batching changes** — one reboot instead of many
- **Unpause within the same maintenance window** — don't leave paused overnight
- **Monitor for drift** — paused MCPs show `UPDATED=False` which may trigger alerts
- **Coordinate with ITMS changes** — pause, sync mirrors, apply ITMS, unpause
- **Document when and why you paused** — helps the next operator

## Key Takeaways

- Pausing batches multiple MachineConfig changes into one rollout
- MCO renders the combined config but waits to roll out until unpaused
- One reboot per node applies ALL queued changes — much faster than sequential
- Don't leave MCPs paused indefinitely — security patches won't apply
- Useful before ITMS changes: pause → sync mirrors → apply ITMS → verify → unpause
