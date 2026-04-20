---
title: "Debug Pod Eviction Reasons"
description: "Investigate why pods were evicted from Kubernetes nodes. Check node pressure conditions, resource limits, priority classes, and preemption events. Identify DiskPressure, MemoryPressure, and ..."
publishDate: "2026-03-19"
author: "Luca Berton"
category: "troubleshooting"
difficulty: "intermediate"
timeToComplete: "15 minutes"
kubernetesVersion: "1.28+"
tags:
  - eviction
  - node-pressure
  - resources
  - troubleshooting
  - oom
relatedRecipes:
  - "fix-oomkilled-pod"
  - "pod-disruption-budget"
  - "pdb-allowed-disruptions-zero"
---
> 💡 **Quick Answer:** Check `kubectl describe pod <evicted-pod>` for the eviction reason — usually `The node was low on resource: memory` or `The node had condition: [DiskPressure]`. Then check `kubectl describe node <node>` for pressure conditions and resource allocation.

## The Problem

Pods are being evicted from nodes unexpectedly. They restart on other nodes but the instability disrupts services. You need to understand why evictions happen and prevent recurrence.

## The Solution

### Step 1: Find Evicted Pods

```bash
# List all evicted pods
kubectl get pods -A --field-selector status.phase=Failed | grep Evicted

# Get details on a specific eviction
kubectl describe pod <evicted-pod> -n <namespace>
# Look for:
# Status: Failed
# Reason: Evicted
# Message: The node was low on resource: memory.
```

### Step 2: Check Node Pressure Conditions

```bash
# Check current node conditions
kubectl describe node worker-2 | grep -A5 Conditions
# MemoryPressure   False  ...
# DiskPressure     False  ...
# PIDPressure      False  ...

# Check allocated vs allocatable
kubectl describe node worker-2 | grep -A10 "Allocated resources"
```

### Step 3: Understand Eviction Types

| Type | Trigger | Behavior |
|------|---------|----------|
| **Node pressure** | Memory/disk/PID below threshold | kubelet evicts lowest-priority pods |
| **Preemption** | Higher-priority pod needs resources | Scheduler evicts lower-priority pods |
| **API-initiated** | `kubectl drain` or HPA scale-down | Respects PDBs |
| **OOM Kill** | Container exceeds memory limit | Not technically eviction — kernel kills the process |

### Step 4: Set Proper Resource Requests and Limits

```yaml
resources:
  requests:
    memory: "256Mi"    # Scheduling guarantee
    cpu: "250m"
  limits:
    memory: "512Mi"    # Hard ceiling — OOMKilled if exceeded
    cpu: "1"
```

### Step 5: Configure Eviction Thresholds (if needed)

```bash
# Check kubelet eviction thresholds
kubectl get node worker-2 -o json | jq '.status.allocatable'

# Default soft thresholds:
# memory.available < 100Mi
# nodefs.available < 10%
# imagefs.available < 15%
```

### Step 6: Use Priority Classes

```yaml
apiVersion: scheduling.k8s.io/v1
kind: PriorityClass
metadata:
  name: high-priority
value: 1000000
globalDefault: false
description: "Critical workloads — evicted last"
---
apiVersion: apps/v1
kind: Deployment
spec:
  template:
    spec:
      priorityClassName: high-priority
```

## Common Issues

### Memory Pressure Eviction Loop

Pods evicted for memory → rescheduled → same node → evicted again. Fix: set proper `requests.memory` so the scheduler doesn't overcommit.

### Disk Pressure from Container Logs

```bash
# Check log sizes on a node
oc debug node/worker-2 -- chroot /host du -sh /var/log/containers/* | sort -rh | head -10
```

### Evicted Pods Accumulating

```bash
# Clean up evicted pods
kubectl delete pods -A --field-selector status.phase=Failed
```

## Best Practices

- **Always set memory requests** — prevents overcommitment that leads to memory pressure
- **Use PriorityClasses** for critical workloads — they're evicted last
- **Monitor node resource usage** — alert before pressure thresholds are hit
- **Set resource limits** — prevents a single pod from consuming all node resources
- **Clean up evicted pods** periodically — they don't auto-delete

## Key Takeaways

- Pod eviction is kubelet's response to node resource pressure
- Check `kubectl describe pod` for the eviction reason, `kubectl describe node` for current pressure
- Proper resource requests prevent overcommitment
- PriorityClasses control eviction order — highest priority evicted last
- OOMKill (kernel) and eviction (kubelet) are different mechanisms
