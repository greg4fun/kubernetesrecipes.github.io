---
title: "Fix Deploy Rollout Stuck at Partial Progress"
description: "Debug deployments stuck with unavailable replicas during rollout. Covers readiness probes, resource constraints, and rollback."
category: "deployments"
difficulty: "intermediate"
publishDate: "2026-04-02"
tags: ["deployment", "rollout", "stuck", "rollback", "troubleshooting"]
author: "Luca Berton"
relatedRecipes:
  - "imagepullbackoff-troubleshooting"
  - "crashloopbackoff-troubleshooting"
---

> 💡 **Quick Answer:** Debug deployments stuck with unavailable replicas during rollout. Covers resource constraints, failing readiness probes, ImagePullBackOff during rollout, and rollback.

## The Problem

This is a common issue in Kubernetes deployments that catches both beginners and experienced operators.

## The Solution

### Step 1: Check Rollout Status

```bash
kubectl rollout status deployment myapp
# Waiting for deployment "myapp" to finish: 1 out of 3 new replicas have been updated...

# Check which pods are failing
kubectl get pods -l app=myapp
# Old pods: Running, New pods: Pending/CrashLoopBackOff/ImagePullBackOff
```

### Step 2: Identify the Blocker

```bash
# Check the new ReplicaSet
kubectl describe deployment myapp | grep -A5 "NewReplicaSet"
NEW_RS=$(kubectl describe deployment myapp | grep "NewReplicaSet" | awk '{print $2}')

# Check events on the new ReplicaSet
kubectl describe rs $NEW_RS | grep -A10 Events

# Check failing new pods
kubectl describe pod -l app=myapp,pod-template-hash=<new-hash>
```

### Step 3: Fix or Rollback

**Fix the issue and let rollout continue:**
```bash
# Fix the image tag
kubectl set image deployment/myapp myapp=myapp:v2.1-fixed

# Fix resource requests
kubectl set resources deployment/myapp -c myapp --requests=cpu=100m,memory=128Mi
```

**Rollback to previous version:**
```bash
# Rollback to previous revision
kubectl rollout undo deployment myapp

# Rollback to specific revision
kubectl rollout history deployment myapp
kubectl rollout undo deployment myapp --to-revision=3
```

**Prevent stuck rollouts:**
```yaml
spec:
  progressDeadlineSeconds: 600  # Fail rollout after 10 min
  strategy:
    type: RollingUpdate
    rollingUpdate:
      maxUnavailable: 0    # Never kill old pods before new ones ready
      maxSurge: 1           # Add 1 at a time
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
