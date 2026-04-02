---
title: "Fix Unexpected Pod Evictions in Kubernetes"
description: "Debug pods being evicted due to node pressure, preemption, or taint-based eviction. Understand eviction priorities, QoS classes, and PodDisruptionBudgets."
category: "troubleshooting"
difficulty: "intermediate"
publishDate: "2026-04-02"
tags: ["eviction", "preemption", "pdb", "node-pressure", "troubleshooting"]
author: "Luca Berton"
relatedRecipes:
  - "pdb-allowed-disruptions-zero"
  - "taint-toleration-scheduling-issues"
  - "oom-killed-troubleshooting"
---

> 💡 **Quick Answer:** Debug pods being evicted due to node pressure, preemption, or taint-based eviction. Understand eviction priorities, QoS classes, and PodDisruptionBudgets.

## The Problem

This is a common issue in Kubernetes troubleshooting that catches both beginners and experienced operators.

## The Solution

### Step 1: Find Why the Pod Was Evicted

```bash
# Check pod events
kubectl describe pod evicted-pod-abc123 | grep -A5 "Status\|Reason\|Message"
# Reason: Evicted
# Message: "The node was low on resource: memory"

# Check node conditions at time of eviction
kubectl describe node worker-1 | grep -A10 Conditions
```

### Step 2: Fix by Eviction Type

**Node pressure eviction (memory/disk/PID):**
```yaml
# Set resource requests to get correct QoS class
# Guaranteed (highest priority — evicted last)
resources:
  requests:
    memory: "256Mi"
    cpu: "250m"
  limits:
    memory: "256Mi"    # Same as request
    cpu: "250m"        # Same as request
```

QoS eviction order:
1. `BestEffort` — evicted first (no requests/limits)
2. `Burstable` — evicted second (requests ≠ limits)
3. `Guaranteed` — evicted last (requests = limits)

**Preemption (higher priority pod needs space):**
```bash
# Check PriorityClass
kubectl get priorityclasses
# Higher priority pods preempt lower priority ones
```

**Taint-based eviction:**
```bash
# Node got a NoExecute taint
kubectl describe node worker-1 | grep Taints
# Add toleration with tolerationSeconds for graceful handling
```

### Step 3: Protect Critical Pods

```yaml
apiVersion: policy/v1
kind: PodDisruptionBudget
metadata:
  name: myapp-pdb
spec:
  minAvailable: 2    # Always keep at least 2 running
  selector:
    matchLabels:
      app: myapp
```

## Best Practices

- **Monitor proactively** with Prometheus alerts before issues become incidents
- **Document runbooks** for your team's most common failure scenarios
- **Use `kubectl describe` and events** as your first debugging tool
- **Automate recovery** where possible with operators or scripts

## Key Takeaways

- Always check events and logs first — Kubernetes tells you what's wrong
- Most issues have clear error messages pointing to the root cause
- Prevention through monitoring and proper configuration beats reactive debugging
- Keep this recipe bookmarked for quick reference during incidents
