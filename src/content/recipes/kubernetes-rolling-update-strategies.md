---
title: "K8s Rolling Update: Deployment Strategies"
description: "Configure Kubernetes rolling update strategies with maxSurge, maxUnavailable, and recreate strategy. Blue-green, canary patterns, and rollback procedures."
publishDate: "2026-05-02"
author: "Luca Berton"
category: "deployments"
difficulty: "intermediate"
timeToComplete: "10 minutes"
kubernetesVersion: "1.28+"
tags:
  - "rolling-update"
  - "deployment-strategy"
  - "deployments"
  - "zero-downtime"
  - "cka"
relatedRecipes:
  - "kubernetes-deployment-rolling-update"
  - "kubernetes-probes-liveness-readiness"
  - "kubernetes-pod-disruption-budget"
  - "kubernetes-topology-spread-constraints"
---

> 💡 **Quick Answer:** Default rolling update: `maxSurge: 25%`, `maxUnavailable: 25%` — updates 25% of pods at a time. For zero-downtime: set `maxSurge: 1, maxUnavailable: 0` (always have full capacity). For fast updates: `maxSurge: 50%, maxUnavailable: 50%`. Rollback: `kubectl rollout undo deployment/my-app`. Always use readiness probes — rolling updates wait for readiness before proceeding.

## The Problem

Deploying new versions needs to be:

- Zero-downtime (no dropped requests)
- Rollback-capable (revert broken deployments)
- Resource-aware (don't exceed cluster capacity)
- Controllable (pause, resume, abort)

## The Solution

### RollingUpdate Strategy

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: web
spec:
  replicas: 10
  strategy:
    type: RollingUpdate
    rollingUpdate:
      maxSurge: 2            # Max extra pods during update
      maxUnavailable: 1      # Max pods unavailable during update
  
  # With 10 replicas, maxSurge=2, maxUnavailable=1:
  # - Up to 12 pods exist simultaneously (10 + 2 surge)
  # - At least 9 pods always available (10 - 1 unavailable)
  # - Updates ~2-3 pods at a time
  
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
        readinessProbe:        # CRITICAL for rolling updates
          httpGet:
            path: /ready
            port: 8080
          periodSeconds: 5
```

### Strategy Presets

```yaml
# Zero-downtime (safest, slowest)
strategy:
  type: RollingUpdate
  rollingUpdate:
    maxSurge: 1
    maxUnavailable: 0
# Always full capacity. New pod ready → old pod removed.
# Best for: production services with strict SLAs

# Fast update (aggressive)
strategy:
  type: RollingUpdate
  rollingUpdate:
    maxSurge: "50%"
    maxUnavailable: "50%"
# Half pods update at once. Fast but 50% capacity dip.
# Best for: dev/staging, stateless batch workers

# One-at-a-time (conservative)
strategy:
  type: RollingUpdate
  rollingUpdate:
    maxSurge: 1
    maxUnavailable: 0
# Minimum resource overhead, maximum safety.
# Best for: resource-constrained clusters

# Recreate (kill all, then create all)
strategy:
  type: Recreate
# ALL old pods terminated before new pods created.
# Downtime guaranteed. Use only when:
# - App can't run two versions simultaneously
# - Persistent volume with RWO access mode
# - Database migrations requiring exclusive access
```

### Rollout Management

```bash
# Check rollout status
kubectl rollout status deployment/web
# Waiting for deployment "web" rollout to finish: 3 of 10 updated...
# deployment "web" successfully rolled out

# View rollout history
kubectl rollout history deployment/web
# REVISION  CHANGE-CAUSE
# 1         Initial deployment
# 2         kubectl set image deployment/web web=myapp:v2
# 3         kubectl set image deployment/web web=myapp:v3

# View specific revision
kubectl rollout history deployment/web --revision=2

# Rollback to previous
kubectl rollout undo deployment/web

# Rollback to specific revision
kubectl rollout undo deployment/web --to-revision=1

# Pause rollout (partial update)
kubectl rollout pause deployment/web

# Resume rollout
kubectl rollout resume deployment/web

# Restart all pods (same image, new pods)
kubectl rollout restart deployment/web
```

### Blue-Green with Services

```yaml
# Blue deployment (current)
apiVersion: apps/v1
kind: Deployment
metadata:
  name: web-blue
spec:
  replicas: 3
  selector:
    matchLabels:
      app: web
      version: blue
  template:
    metadata:
      labels:
        app: web
        version: blue
    spec:
      containers:
      - name: web
        image: myapp:v1

---
# Green deployment (new version)
apiVersion: apps/v1
kind: Deployment
metadata:
  name: web-green
spec:
  replicas: 3
  selector:
    matchLabels:
      app: web
      version: green
  template:
    metadata:
      labels:
        app: web
        version: green
    spec:
      containers:
      - name: web
        image: myapp:v2

---
# Service points to blue
apiVersion: v1
kind: Service
metadata:
  name: web
spec:
  selector:
    app: web
    version: blue    # ← Switch to "green" to cutover
  ports:
  - port: 80
    targetPort: 8080
```

```bash
# Switch traffic: blue → green
kubectl patch svc web -p '{"spec":{"selector":{"version":"green"}}}'

# Rollback: green → blue
kubectl patch svc web -p '{"spec":{"selector":{"version":"blue"}}}'

# Cleanup old version
kubectl delete deployment web-blue
```

### Canary Pattern

```yaml
# Stable: 9 replicas
apiVersion: apps/v1
kind: Deployment
metadata:
  name: web-stable
spec:
  replicas: 9
  selector:
    matchLabels:
      app: web
      track: stable
  template:
    metadata:
      labels:
        app: web
        track: stable
    spec:
      containers:
      - name: web
        image: myapp:v1

---
# Canary: 1 replica (10% traffic)
apiVersion: apps/v1
kind: Deployment
metadata:
  name: web-canary
spec:
  replicas: 1
  selector:
    matchLabels:
      app: web
      track: canary
  template:
    metadata:
      labels:
        app: web
        track: canary
    spec:
      containers:
      - name: web
        image: myapp:v2

---
# Service selects both (by app label only)
apiVersion: v1
kind: Service
metadata:
  name: web
spec:
  selector:
    app: web    # Matches both stable and canary
  ports:
  - port: 80
```

### Record Change Cause

```bash
# Record why deployment changed
kubectl set image deployment/web web=myapp:v3 --record

# Or annotate
kubectl annotate deployment/web kubernetes.io/change-cause="Upgrade to v3 for feature X"

# Shows in history
kubectl rollout history deployment/web
# REVISION  CHANGE-CAUSE
# 3         Upgrade to v3 for feature X
```

## Common Issues

**Rollout stuck: "waiting for deployment to finish"**

New pods failing readiness probe. Check: `kubectl get pods` — look for pods not becoming Ready. Fix the readiness probe or the application.

**All pods killed during Recreate strategy**

By design — Recreate kills all before creating. Use RollingUpdate for zero-downtime.

**Rollback didn't work**

Check `revisionHistoryLimit` — default is 10. Old ReplicaSets are garbage collected beyond this limit.

## Best Practices

- **Always use readiness probes** — rolling updates depend on them
- **`maxUnavailable: 0` for production** — never reduce capacity
- **Set `revisionHistoryLimit`** — keep enough history for rollback
- **Use `--record` or annotations** — track why deployments changed
- **`minReadySeconds`** — wait N seconds after readiness before proceeding

## Key Takeaways

- RollingUpdate: gradual replacement with `maxSurge` and `maxUnavailable` controls
- Recreate: full downtime, use only when required (RWO volumes, incompatible versions)
- Readiness probes are mandatory for safe rolling updates
- `kubectl rollout undo` for instant rollback to any revision
- Blue-green and canary patterns use multiple Deployments + Service selector switching
