---
title: "OpenShift Ingress Router Troubleshooting"
description: "Debug OpenShift HAProxy router issues: pods stuck Pending, hostPort conflicts, PDB violations during maintenance, and custom router deployment scaling problems."
publishDate: "2026-03-19"
author: "Luca Berton"
category: "troubleshooting"
difficulty: "intermediate"
timeToComplete: "20 minutes"
kubernetesVersion: "1.28+"
tags:
  - openshift
  - ingress
  - haproxy
  - router
  - troubleshooting
relatedRecipes:
  - "debug-crashloopbackoff"
  - "node-drain-hostnetwork-ports"
  - "mcp-drain-pdb-workaround"
  - "pdb-allowed-disruptions-zero"
---

> 💡 **Quick Answer:** Router pods stuck Pending usually means hostPort conflicts — all nodes already have a router bound to ports 80/443. Check `oc describe pod <pending-router>` for "didn't have free ports". Fix: reduce replicas to N-1 (where N is node count), or move some routers to dedicated infra nodes with different ports.

## The Problem

Custom OpenShift IngressControllers (e.g., for different domains or environments) create multiple router deployments, each using `hostNetwork: true` binding ports 80/443. When nodes are drained for maintenance or cluster updates, replacement router pods can't schedule because every other node already has those ports occupied.

## The Solution

### Step 1: Identify Stuck Routers

```bash
# Find Pending router pods
oc get pods -n openshift-ingress | grep -E "Pending|ContainerCreating"

# Check scheduling failures
oc describe pod <pending-router-pod> -n openshift-ingress
# Events:
#   Warning FailedScheduling: 0/6 nodes are available:
#     6 didn't have free ports for the requested host ports
```

### Step 2: Map Router Distribution

```bash
# See which routers are on which nodes
oc get pods -n openshift-ingress -o wide --sort-by='{.spec.nodeName}'

# Count routers per node
oc get pods -n openshift-ingress -o json | \
  jq -r '.items[] | select(.status.phase=="Running") | .spec.nodeName' | sort | uniq -c | sort -rn
```

### Step 3: Check IngressController Configuration

```bash
# List all IngressControllers
oc get ingresscontroller -n openshift-ingress-operator

# Check a specific one
oc get ingresscontroller custom-router -n openshift-ingress-operator -o yaml
```

Key fields:
```yaml
spec:
  replicas: 6                    # Too many? Should be ≤ node count - 1
  endpointPublishingStrategy:
    type: HostNetwork            # Uses host ports 80, 443
  nodePlacement:
    nodeSelector:
      matchLabels:
        node-role.kubernetes.io/worker: ""
```

### Step 4: Fix the Configuration

**Option A: Reduce replicas**
```bash
# Set replicas to worker_count - 1 for maintenance headroom
WORKER_COUNT=$(oc get nodes -l node-role.kubernetes.io/worker= --no-headers | wc -l)
oc patch ingresscontroller custom-router -n openshift-ingress-operator \
  --type merge -p "{\"spec\":{\"replicas\":$((WORKER_COUNT - 1))}}"
```

**Option B: Use different ports per router**
```yaml
spec:
  endpointPublishingStrategy:
    type: HostNetwork
    hostNetwork:
      httpPort: 8080      # Non-standard port
      httpsPort: 8443
      statsPort: 1937
```

**Option C: Use NodePort instead of HostNetwork**
```yaml
spec:
  endpointPublishingStrategy:
    type: NodePortService
    nodePort:
      protocol: TCP
```

### During Maintenance: Temporary Scale-Down

```bash
# Before draining a node, scale down routers that will block
ROUTERS=$(oc get deploy -n openshift-ingress -o name)
for router in $ROUTERS; do
  replicas=$(oc get "$router" -n openshift-ingress -o jsonpath='{.spec.replicas}')
  echo "$router: $replicas replicas"
done

# Scale down the one blocking drain
oc scale deploy/router-custom -n openshift-ingress --replicas=0
# ... drain node ...
# Restore after
oc scale deploy/router-custom -n openshift-ingress --replicas=5
```

## Common Issues

### Default Router Conflicts with Custom Routers

Both the default router and custom routers bind to ports 80/443. Solutions:
- Use different ports for custom routers
- Use nodeSelector to separate them onto different node groups
- Remove the default router if not needed

### Router Pods Evicted During Node Pressure

```bash
# Check for evicted router pods
oc get pods -n openshift-ingress | grep Evicted

# Clean up
oc delete pods -n openshift-ingress --field-selector status.phase=Evicted
```

## Best Practices

- **Set replicas to N-1** where N is eligible nodes — always leave headroom for maintenance
- **Use dedicated infra nodes** for ingress routers with taints and tolerations
- **Separate routers by port** if running multiple IngressControllers on the same nodes
- **Use `maxUnavailable: 1`** PDB — not `minAvailable: N` which blocks drains
- **Monitor router readiness** during MCP rollouts

## Key Takeaways

- hostNetwork routers bind host ports — only one router can use port 80 per node
- Pending routers mean all nodes' ports are occupied — no room for rescheduling
- Set replicas ≤ node_count - 1 for maintenance headroom
- Consider NodePort or different port assignments for multiple IngressControllers
- During maintenance, temporarily scale down blocking routers then restore
