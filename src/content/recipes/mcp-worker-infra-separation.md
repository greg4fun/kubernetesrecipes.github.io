---
title: "Separate Worker and Infra MachineConfigPools"
description: "Create dedicated MachineConfigPools for infrastructure and GPU nodes. Isolate MCP rollout blast radius and control update order for different node types."
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
  - infra
  - node-management
relatedRecipes:
  - "mcp-maxunavailable-configuration"
  - "mcp-pause-unpause-rollout"
  - "mcp-blocked-stale-update"
---
> 💡 **Quick Answer:** Create separate MCPs by labeling nodes with custom roles and creating MachineConfigPool resources that select those labels. This lets you update infra nodes independently from GPU workers, with different `maxUnavailable` settings and pause controls.

## The Problem

All worker nodes share a single MCP. When you apply a MachineConfig, ALL workers update — including GPU nodes running expensive training jobs, ingress nodes handling production traffic, and storage nodes. You need to isolate these groups to control blast radius and update order.

## The Solution

### Step 1: Label Nodes

```bash
# Label infrastructure nodes
oc label node infra-1 node-role.kubernetes.io/infra=""
oc label node infra-2 node-role.kubernetes.io/infra=""

# Label GPU nodes
oc label node gpu-worker-1 node-role.kubernetes.io/gpu=""
oc label node gpu-worker-2 node-role.kubernetes.io/gpu=""
```

### Step 2: Create Custom MCPs

```yaml
---
apiVersion: machineconfiguration.openshift.io/v1
kind: MachineConfigPool
metadata:
  name: infra
spec:
  machineConfigSelector:
    matchExpressions:
      - key: machineconfiguration.openshift.io/role
        operator: In
        values: [worker, infra]
  nodeSelector:
    matchLabels:
      node-role.kubernetes.io/infra: ""
  maxUnavailable: 1
---
apiVersion: machineconfiguration.openshift.io/v1
kind: MachineConfigPool
metadata:
  name: gpu
spec:
  machineConfigSelector:
    matchExpressions:
      - key: machineconfiguration.openshift.io/role
        operator: In
        values: [worker, gpu]
  nodeSelector:
    matchLabels:
      node-role.kubernetes.io/gpu: ""
  maxUnavailable: 1
  paused: true   # GPU nodes update manually only
```

### Step 3: Apply Role-Specific MachineConfigs

```yaml
# Config for GPU nodes only
apiVersion: machineconfiguration.openshift.io/v1
kind: MachineConfig
metadata:
  name: 99-gpu-nvidia-settings
  labels:
    machineconfiguration.openshift.io/role: gpu  # Only targets GPU MCP
spec:
  config:
    ignition:
      version: 3.2.0
    # GPU-specific kernel params, NVIDIA driver settings, etc.
```

### Step 4: Controlled Update Order

```bash
# 1. Update general workers first
oc get mcp worker -w
# Wait for UPDATED=True

# 2. Update infra nodes
oc get mcp infra -w
# Wait for UPDATED=True

# 3. Update GPU nodes last (unpause)
oc patch mcp gpu --type merge -p '{"spec":{"paused":false}}'
oc get mcp gpu -w
```

### Verify MCP Membership

```bash
oc get mcp -o custom-columns='NAME:.metadata.name,COUNT:.status.machineCount,UPDATED:.status.updatedMachineCount,NODES:.status.conditions[?(@.type=="Updated")].status'
# NAME     COUNT   UPDATED   NODES
# master   3       3         True
# worker   4       4         True
# infra    2       2         True
# gpu      2       2         True
```

## Common Issues

### Node in Two MCPs

A node can only belong to one MCP. If labels match multiple MCPs, the node shows Degraded. Ensure nodeSelectors are mutually exclusive.

### Worker MachineConfigs Not Applied to Custom MCP

The `machineConfigSelector` must include `worker` role to inherit base worker configs:
```yaml
machineConfigSelector:
  matchExpressions:
    - key: machineconfiguration.openshift.io/role
      operator: In
      values: [worker, gpu]   # Inherits worker configs + gpu-specific ones
```

## Best Practices

- **Always include `worker` in machineConfigSelector** — inherit base OS configs
- **Use nodeSelector for mutual exclusivity** — each node in exactly one custom MCP
- **Pause GPU MCP by default** — unpause only during planned maintenance windows
- **Update in order**: general workers → infra → GPU → masters
- **Set different maxUnavailable per MCP** — aggressive for dev workers, conservative for GPU

## Key Takeaways

- Custom MCPs isolate rollout blast radius by node type
- Nodes must belong to exactly one MCP — use exclusive nodeSelectors
- Include `worker` in machineConfigSelector to inherit base configs
- Pause sensitive MCPs (GPU) and update them on your schedule
- Controlled update order prevents cluster-wide disruption
