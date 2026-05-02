---
title: "K8s Pod Lifecycle and Graceful Shutdown"
description: "Understand Kubernetes pod lifecycle phases, termination sequence, preStop hooks, SIGTERM handling, and terminationGracePeriodSeconds for zero-downtime shutdowns."
publishDate: "2026-05-02"
author: "Luca Berton"
category: "deployments"
difficulty: "intermediate"
timeToComplete: "10 minutes"
kubernetesVersion: "1.28+"
tags:
  - "pod-lifecycle"
  - "termination"
  - "graceful-shutdown"
  - "deployments"
  - "cka"
relatedRecipes:
  - "kubernetes-graceful-shutdown-guide"
  - "kubernetes-probes-liveness-readiness"
  - "kubernetes-rolling-update-strategies"
  - "kubernetes-sidecar-containers-guide"
---

> 💡 **Quick Answer:** Pod termination: 1) Pod set to Terminating, 2) preStop hook runs, 3) SIGTERM sent to PID 1, 4) `terminationGracePeriodSeconds` countdown (default 30s), 5) SIGKILL if still running. For graceful shutdown: handle SIGTERM in your app, use preStop hooks for cleanup, set `terminationGracePeriodSeconds` high enough for drain. Endpoints are removed in parallel — add a preStop sleep to avoid in-flight request drops.

## The Problem

Pods get terminated during:

- Rolling updates (new version deployment)
- Node drain (maintenance, upgrades)
- Scaling down (HPA, manual)
- Eviction (resource pressure)
- Manual deletion

Without proper shutdown handling: dropped connections, lost data, incomplete transactions.

## The Solution

### Pod Lifecycle Phases

```
Pending → Running → Succeeded/Failed

Pending:
  - Scheduled to a node
  - Init containers running (sequentially)
  - Image pulling
  
Running:
  - At least one container is running
  - Startup/liveness/readiness probes active
  
Succeeded:
  - All containers exited with code 0
  - (Pods with restartPolicy: Never)
  
Failed:
  - At least one container exited non-zero
  - Or was killed by the system

Unknown:
  - Node communication lost
```

### Termination Sequence (Detailed)

```
DELETE pod request received:

1. Pod status → Terminating
   (Pod removed from Service endpoints — IN PARALLEL with step 2)

2. preStop hook executes (if defined)
   - Runs BEFORE SIGTERM
   - Must complete within terminationGracePeriodSeconds

3. SIGTERM sent to PID 1 in each container
   - After preStop completes (or immediately if no preStop)
   - App should start graceful shutdown

4. Grace period countdown (default: 30 seconds)
   - Starts when pod enters Terminating
   - Includes preStop execution time

5. SIGKILL sent if containers still running after grace period
   - Forceful kill, no cleanup possible

Timeline:
├─ t=0: Pod marked Terminating, endpoints removal starts
├─ t=0: preStop hook starts
├─ t=X: preStop completes, SIGTERM sent
├─ t=30: Grace period expires → SIGKILL
└─ Pod removed from API
```

### preStop Hook

```yaml
apiVersion: v1
kind: Pod
metadata:
  name: web
spec:
  terminationGracePeriodSeconds: 60    # Allow 60s total
  containers:
  - name: web
    image: nginx:1.27
    lifecycle:
      preStop:
        exec:
          command:
          - sh
          - -c
          - |
            # Wait for endpoints to be removed from all kube-proxies
            sleep 5
            # Trigger graceful shutdown
            nginx -s quit
            # Wait for connections to drain
            while [ -f /var/run/nginx.pid ]; do sleep 1; done
    
    # Or HTTP preStop
    lifecycle:
      preStop:
        httpGet:
          path: /shutdown
          port: 8080
```

### The Endpoints Race Condition

```
Problem:
  DELETE pod → endpoints removal AND SIGTERM happen in PARALLEL
  Some kube-proxy/ingress controllers still route to the pod
  after it starts shutting down → connection errors!

Solution: preStop sleep

lifecycle:
  preStop:
    exec:
      command: ["sleep", "5"]   # Wait for endpoints to propagate

# Timeline with fix:
# t=0:  Pod Terminating, endpoints removal starts
# t=0:  preStop: sleep 5 (pod still accepting traffic)
# t=5:  Endpoints fully removed from all proxies
# t=5:  SIGTERM sent, app starts graceful shutdown
# t=5+: No new traffic arrives, existing requests drain
```

### SIGTERM Handling in Apps

```python
# Python example
import signal
import sys

def graceful_shutdown(signum, frame):
    print("SIGTERM received, shutting down...")
    # Stop accepting new requests
    server.stop()
    # Wait for in-flight requests (max 25s)
    server.wait_for_drain(timeout=25)
    # Close database connections
    db.close()
    # Flush logs
    logging.shutdown()
    sys.exit(0)

signal.signal(signal.SIGTERM, graceful_shutdown)
```

```go
// Go example
ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGTERM)
defer stop()

go func() {
    <-ctx.Done()
    log.Println("Shutting down...")
    shutdownCtx, cancel := context.WithTimeout(context.Background(), 25*time.Second)
    defer cancel()
    server.Shutdown(shutdownCtx)
}()
```

### Container States

```bash
# Check container state
kubectl get pod my-pod -o jsonpath='{.status.containerStatuses[0].state}'

# Possible states:
# Waiting:    Container not yet running
#   - ContainerCreating (pulling image, setting up)
#   - CrashLoopBackOff (restarting after crash)
#   - ImagePullBackOff (can't pull image)
#
# Running:    Container executing
#   - startedAt: timestamp
#
# Terminated: Container exited
#   - exitCode: 0 (success) or non-zero (failure)
#   - reason: Completed, Error, OOMKilled, Evicted
#   - signal: 15 (SIGTERM), 9 (SIGKILL)

# Check last termination reason
kubectl get pod my-pod -o jsonpath='{.status.containerStatuses[0].lastState.terminated.reason}'
```

### Pod Deletion Patterns

```bash
# Normal delete (respects grace period)
kubectl delete pod my-pod
# Waits terminationGracePeriodSeconds (default 30s)

# Custom grace period
kubectl delete pod my-pod --grace-period=60

# Force delete (immediate, no grace period)
kubectl delete pod my-pod --grace-period=0 --force
# ⚠️ SIGKILL immediately, no cleanup

# Delete with shorter grace
kubectl delete pod my-pod --grace-period=5
```

### Production Configuration

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: api-server
spec:
  template:
    spec:
      terminationGracePeriodSeconds: 60
      containers:
      - name: api
        image: api:v2
        ports:
        - containerPort: 8080
        
        readinessProbe:
          httpGet:
            path: /ready
            port: 8080
        
        lifecycle:
          preStop:
            exec:
              command: ["sleep", "5"]   # Endpoints propagation
        
        # App handles SIGTERM:
        # 1. Stop accepting new connections
        # 2. Drain existing requests (up to 50s)
        # 3. Close DB connections
        # 4. Exit 0
```

## Common Issues

**Requests dropped during rolling update**

Endpoints race condition. Add `preStop: sleep 5` to allow kube-proxy to remove endpoints before app shuts down.

**Pod killed before shutdown completes**

`terminationGracePeriodSeconds` too short. Increase it — remember it includes preStop time.

**Container receives SIGKILL not SIGTERM**

PID 1 issue. Shell scripts (`#!/bin/sh`) don't forward signals. Use `exec` to replace shell: `exec ./myapp` or use `tini` as init.

**Sidecar exits before main container**

Use native sidecars (K8s 1.28+) — `initContainers` with `restartPolicy: Always`. They exit after main containers.

## Best Practices

- **Handle SIGTERM in your app** — don't rely on SIGKILL
- **Use preStop sleep(5)** — prevents dropped connections during updates
- **Set terminationGracePeriodSeconds** to actual drain time + 10s buffer
- **Use `exec` form in Dockerfile** — ensures PID 1 receives signals
- **Test shutdown behavior** — `kubectl delete pod` and monitor logs

## Key Takeaways

- Pod termination: preStop → SIGTERM → grace period → SIGKILL
- Endpoints removal happens in parallel — add preStop sleep to prevent drops
- terminationGracePeriodSeconds includes preStop time (default 30s)
- PID 1 receives SIGTERM — ensure your process is PID 1 (use exec or tini)
- Force delete skips graceful shutdown — use only for stuck pods
