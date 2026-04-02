---
title: "Manage hostNetwork Pod Port Allocation"
description: "Plan and manage host port usage for hostNetwork pods. Prevent port conflicts, track allocations, and handle port exhaustion."
publishDate: "2026-03-19"
author: "Luca Berton"
category: "networking"
difficulty: "intermediate"
timeToComplete: "15 minutes"
kubernetesVersion: "1.28+"
tags:
  - hostnetwork
  - ports
  - scheduling
  - networking
  - planning
relatedRecipes:
  - "node-drain-hostnetwork-ports"
  - "openshift-ingress-router-troubleshooting"
  - "mcp-drain-pdb-workaround"
---
> 💡 **Quick Answer:** Each node can only have ONE pod per host port. Map your hostNetwork deployments and their port usage: `oc get pods -A -o json | jq '[.items[] | select(.spec.hostNetwork==true)] | group_by(.spec.nodeName)'`. Set replicas ≤ (nodes - 1) for maintenance headroom.

## The Problem

Multiple Deployments using `hostNetwork: true` compete for the same ports across your cluster. When all nodes are occupied, new pods stay Pending. During maintenance, replacements can't schedule because every other node's ports are in use.

## The Solution

### Step 1: Audit Current hostNetwork Usage

```bash
# Map all hostNetwork pods, their nodes, and ports
oc get pods -A -o json | jq -r '
  .items[] |
  select(.spec.hostNetwork == true) |
  "\(.metadata.namespace)/\(.metadata.name)\t\(.spec.nodeName)\t\([.spec.containers[].ports[]? | "\(.hostPort // .containerPort)/\(.protocol // "TCP")"] | join(","))"
' | column -t -s$'\t'

# Count hostNetwork pods per node
oc get pods -A -o json | jq -r '
  [.items[] | select(.spec.hostNetwork == true) | .spec.nodeName] | group_by(.) | .[] | "\(length)\t\(.[0])"
' | sort -rn
```

### Step 2: Create a Port Allocation Map

```
Port 80   — router-default (all 6 workers)
Port 443  — router-default (all 6 workers)
Port 8080 — router-custom-a (workers 1-5)
Port 8443 — router-custom-a (workers 1-5)
Port 9090 — monitoring-proxy (workers 1-3)

Available slots for port 80/443: 0 (FULL!)
Available slots for port 8080/8443: 1 (worker-6)
Available slots for port 9090: 3 (workers 4-6)
```

### Step 3: Set Replicas for Maintenance Headroom

```bash
WORKER_COUNT=$(oc get nodes -l node-role.kubernetes.io/worker= --no-headers | wc -l)
MAX_REPLICAS=$((WORKER_COUNT - 1))
echo "Set hostNetwork deployments to max $MAX_REPLICAS replicas (${WORKER_COUNT} workers)"

# Apply
oc patch ingresscontroller default -n openshift-ingress-operator \
  --type merge -p "{\"spec\":{\"replicas\":$MAX_REPLICAS}}"
```

### Step 4: Use Different Ports to Avoid Conflicts

```yaml
# Router A: standard ports
spec:
  endpointPublishingStrategy:
    type: HostNetwork
    hostNetwork:
      httpPort: 80
      httpsPort: 443

# Router B: non-standard ports
spec:
  endpointPublishingStrategy:
    type: HostNetwork
    hostNetwork:
      httpPort: 8080
      httpsPort: 8443
```

### Alternative: Use hostPort Instead of hostNetwork

```yaml
# hostPort binds only specific ports, not the entire network namespace
spec:
  containers:
    - name: nginx
      ports:
        - containerPort: 8080
          hostPort: 80
          protocol: TCP
        - containerPort: 8443
          hostPort: 443
          protocol: TCP
      # Pod still uses pod networking for everything else
```

## Common Issues

### Port Conflict Error Message

```
Events:
  Warning  FailedScheduling  0/6 nodes available:
    6 nodes didn't have free ports for the requested host ports [80 443]
```

### Monitoring Script

```bash
#!/bin/bash
# Alert when hostNetwork port headroom is low
WORKERS=$(oc get nodes -l node-role.kubernetes.io/worker= --no-headers | wc -l)
ROUTER_PODS=$(oc get pods -n openshift-ingress -l ingresscontroller.operator.openshift.io/deployment-ingresscontroller --no-headers | wc -l)
HEADROOM=$((WORKERS - ROUTER_PODS))

if [ "$HEADROOM" -lt 1 ]; then
  echo "⚠️ WARNING: Zero headroom for hostNetwork port 80/443 — drains will fail!"
elif [ "$HEADROOM" -lt 2 ]; then
  echo "⚡ Low headroom: only $HEADROOM node(s) available for rescheduling"
else
  echo "✅ Headroom: $HEADROOM nodes available"
fi
```

## Best Practices

- **Maintain a port allocation document** — track which ports are used by which deployments
- **Replicas ≤ nodes - 1** for any hostNetwork deployment
- **Use hostPort over hostNetwork** when you only need specific ports
- **Separate port ranges** for different IngressControllers
- **Monitor headroom** and alert when it drops below 2

## Key Takeaways

- Each host port can only be used by one pod per node
- hostNetwork claims ALL ports on the node's network namespace
- Set replicas to node_count - 1 for maintenance headroom
- Use different ports for different IngressControllers to allow co-location
- hostPort is more surgical than hostNetwork — prefer it when possible
