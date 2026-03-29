---
title: "Configure MCP maxUnavailable for Rollouts"
description: "Control how many nodes the MachineConfig Operator updates simultaneously. Set maxUnavailable for faster rollouts or safer one-at-a-time updates in production."
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
  - maxunavailable
  - rollout
relatedRecipes:
  - "mcp-blocked-stale-update"
  - "openshift-mcp-itms-rollout"
  - "rhcos-openshift-node-management"
---
> 💡 **Quick Answer:** Set `spec.maxUnavailable` on your MachineConfigPool to control parallel updates. Default is `1` (sequential). Use `1` for production safety, `2-3` for faster dev/staging rollouts, or `"33%"` for percentage-based scaling.

## The Problem

MCP updates are too slow (6 workers × 15 min each = 90 minutes for a simple chrony change) or too risky (updating multiple nodes simultaneously reduces cluster capacity).

## The Solution

### Check Current Setting

```bash
oc get mcp worker -o jsonpath='{.spec.maxUnavailable}'
# 1   ← Default: one node at a time
```

### Change maxUnavailable

```bash
# Update 2 nodes at a time
oc patch mcp worker --type merge -p '{"spec":{"maxUnavailable":2}}'

# Or use percentage
oc patch mcp worker --type merge -p '{"spec":{"maxUnavailable":"33%"}}'
# With 6 workers: 33% = 2 nodes simultaneously
```

### YAML Definition

```yaml
apiVersion: machineconfiguration.openshift.io/v1
kind: MachineConfigPool
metadata:
  name: worker
spec:
  maxUnavailable: 1          # Integer: exact count
  # maxUnavailable: "25%"    # Percentage: rounded up
  machineConfigSelector:
    matchLabels:
      machineconfiguration.openshift.io/role: worker
  nodeSelector:
    matchLabels:
      node-role.kubernetes.io/worker: ""
```

### Recommendations by Environment

| Environment | maxUnavailable | Reasoning |
|------------|---------------|-----------|
| Production | `1` | Maximum safety — one failure doesn't cascade |
| Staging | `2` or `"33%"` | Faster rollouts, acceptable risk |
| Dev/Lab | `"50%"` or `3` | Speed over safety |
| GPU workers | `1` | GPU workloads are expensive to reschedule |

## Common Issues

### Setting Too High Reduces Cluster Capacity

With `maxUnavailable: 3` on a 6-worker cluster, half the cluster is unavailable during updates. Workloads may not have enough capacity.

### Percentage Rounds Up

`"25%"` on 6 nodes = ceil(1.5) = 2 nodes. Always calculate the actual number.

## Best Practices

- **Use `1` for production** — predictable, safe, easy to troubleshoot
- **Increase temporarily** for urgent patches, then reset to 1
- **Create separate MCPs** for different node types (GPU, infra, general) with different maxUnavailable
- **Monitor during rollout** — `oc get mcp -w` shows real-time progress
- **Never set to total node count** — leaves zero capacity during updates

## Key Takeaways

- `maxUnavailable` controls parallelism of MCP updates
- Default `1` is safest — nodes update one-by-one
- Higher values speed up rollouts but reduce cluster capacity during updates
- Use separate MCPs for different risk profiles
