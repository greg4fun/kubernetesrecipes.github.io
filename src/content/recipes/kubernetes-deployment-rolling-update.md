---
title: "K8s Deployment Rolling Update Strategy"
description: "Configure Kubernetes Deployment rolling updates with maxSurge and maxUnavailable. Rollback, revision history, blue-green, and canary deployment patterns."
publishDate: "2026-05-02"
author: "Luca Berton"
category: "deployments"
difficulty: "intermediate"
timeToComplete: "12 minutes"
kubernetesVersion: "1.28+"
tags:
  - "deployments"
  - "rolling-update"
  - "rollback"
  - "canary"
  - "cka"
relatedRecipes:
  - "kubernetes-graceful-shutdown-guide"
  - "kubernetes-readiness-probe-guide"
  - "kubectl-apply-vs-create"
  - "kubernetes-pod-lifecycle-termination"
---

> 💡 **Quick Answer:** Kubernetes rolling updates replace pods gradually: `maxSurge: 25%` allows 25% extra pods during update, `maxUnavailable: 25%` allows 25% pods to be unavailable. Default strategy creates new pods before killing old ones. Rollback with `kubectl rollout undo deployment/<name>`. Set `revisionHistoryLimit: 10` to keep rollback history.

## The Problem

Updating a deployment without downtime requires careful orchestration:

- All pods updated at once = downtime
- No rollback capability = stuck with broken versions
- Slow rollouts waste time; fast rollouts risk stability
- Need to verify new version before fully committing

## The Solution

### Rolling Update Strategy

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: web-app
spec:
  replicas: 10
  revisionHistoryLimit: 10    # Keep 10 rollback versions
  strategy:
    type: RollingUpdate
    rollingUpdate:
      maxSurge: 25%           # Allow 25% extra pods (3 extra)
      maxUnavailable: 25%     # Allow 25% unavailable (2 down)
  selector:
    matchLabels:
      app: web
  template:
    metadata:
      labels:
        app: web
    spec:
      containers:
      - name: web
        image: myapp:v2
        ports:
        - containerPort: 8080
        readinessProbe:           # Critical for safe rollouts
          httpGet:
            path: /health
            port: 8080
          initialDelaySeconds: 5
          periodSeconds: 5
```

### How Rolling Update Works

```
Initial state (10 replicas, v1):
v1 v1 v1 v1 v1 v1 v1 v1 v1 v1

Step 1: Create 3 new (maxSurge 25%), kill 2 old (maxUnavailable 25%):
v1 v1 v1 v1 v1 v1 v1 v1 v2 v2 v2  (13 total, 2 terminating)

Step 2: As v2 pods become Ready, more v1 are terminated:
v1 v1 v1 v1 v1 v2 v2 v2 v2 v2 v2  (continuing...)

Step 3: Complete:
v2 v2 v2 v2 v2 v2 v2 v2 v2 v2
```

### Trigger and Monitor Rollouts

```bash
# Update image (triggers rolling update)
kubectl set image deployment/web-app web=myapp:v2

# Or edit directly
kubectl edit deployment web-app

# Watch rollout progress
kubectl rollout status deployment/web-app
# Waiting for deployment "web-app" rollout to finish: 5 of 10 updated replicas are available...
# deployment "web-app" successfully rolled out

# Check rollout history
kubectl rollout history deployment/web-app
# REVISION  CHANGE-CAUSE
# 1         kubectl set image deployment/web-app web=myapp:v1
# 2         kubectl set image deployment/web-app web=myapp:v2

# Pause rollout (for manual verification)
kubectl rollout pause deployment/web-app

# Resume rollout
kubectl rollout resume deployment/web-app
```

### Rollback

```bash
# Rollback to previous version
kubectl rollout undo deployment/web-app

# Rollback to specific revision
kubectl rollout undo deployment/web-app --to-revision=1

# Check what's in a specific revision
kubectl rollout history deployment/web-app --revision=2
```

### maxSurge and maxUnavailable Patterns

```yaml
# Zero-downtime (slower): extra pods before killing old
maxSurge: 1
maxUnavailable: 0
# Never below 10 pods, creates 1 extra at a time

# Fast rollout: allow some downtime
maxSurge: 50%
maxUnavailable: 50%
# Quick update, but 5 of 10 pods may be unavailable

# Absolute values
maxSurge: 3
maxUnavailable: 2
# At most 13 pods total, at least 8 available

# Recreate strategy (NOT rolling — full downtime)
strategy:
  type: Recreate
# All old pods killed, then all new pods created
# Use for: databases, stateful apps that can't run two versions
```

### Canary Deployment Pattern

```bash
# Manual canary: scale down main, create canary
kubectl scale deployment web-app --replicas=9
kubectl create deployment web-app-canary --image=myapp:v2 --replicas=1

# Both deployments behind same service (matching labels)
# Monitor canary metrics, then promote:
kubectl set image deployment/web-app web=myapp:v2
kubectl delete deployment web-app-canary
```

## Common Issues

**Rollout stuck — new pods not becoming Ready**

Readiness probe failing on new version. Check: `kubectl describe pod <new-pod>`. Rollback: `kubectl rollout undo deployment/web-app`.

**"deadline exceeded" error**

Set `progressDeadlineSeconds` (default 600s). If rollout takes longer, it's marked failed but continues.

**Old ReplicaSets consuming resources**

Set `revisionHistoryLimit` to limit kept ReplicaSets. Old pods are already scaled to 0 but ReplicaSet objects remain.

## Best Practices

- **Always set readinessProbe** — rolling updates rely on Ready status
- **Start with `maxSurge: 25%, maxUnavailable: 0`** — zero-downtime default
- **Use `Recreate` for databases** — two versions of a DB can corrupt data
- **Set `revisionHistoryLimit: 5-10`** — keep rollback options without clutter
- **Annotate changes** — `kubectl annotate deployment web-app kubernetes.io/change-cause="v2 security patch"`

## Key Takeaways

- Rolling updates replace pods gradually with configurable surge and unavailability
- `maxSurge` controls how many extra pods; `maxUnavailable` controls minimum available
- `kubectl rollout undo` rolls back to previous revision instantly
- Readiness probes are essential — without them, bad pods receive traffic
- Use `Recreate` strategy for stateful apps that can't run two versions simultaneously
