---
title: "Kubernetes Graceful Shutdown and Pod Termination"
description: "Implement graceful shutdown for Kubernetes pods. Configure terminationGracePeriodSeconds, preStop hooks, SIGTERM handling, connection"
tags:
  - "graceful-shutdown"
  - "pod-lifecycle"
  - "termination"
  - "rolling-updates"
  - "zero-downtime"
category: "deployments"
publishDate: "2026-06-01"
author: "Luca Berton"
difficulty: "intermediate"
relatedRecipes:
  - "kubernetes-rolling-update-strategies"
  - "kubernetes-probes-liveness-readiness"
  - "kubernetes-pod-disruption-budget"
  - "kubernetes-pod-disruption-budget-pdb"
---

> 💡 **Quick Answer:** When Kubernetes terminates a pod, it sends SIGTERM to PID 1, waits up to `terminationGracePeriodSeconds` (default 30s), then sends SIGKILL. For zero-downtime: 1) Handle SIGTERM in your app (stop accepting, drain connections), 2) Add a `preStop` hook with a short sleep (5-10s) to allow endpoint removal propagation, 3) Set grace period longer than your drain time.

## The Problem

- Pods receive in-flight requests during shutdown → 502/504 errors for clients
- SIGTERM not handled — app killed abruptly losing work in progress
- Endpoint removal races with pod termination — traffic sent to dying pods
- Rolling updates cause brief connection resets
- Long-running requests (WebSocket, streaming) cut off prematurely

## The Solution

### Pod Termination Sequence

```text
Time │ Event
─────┼────────────────────────────────────────────────────────
 0s  │ Pod marked for termination
     │ ├── Pod removed from Service endpoints (async)
     │ ├── preStop hook executed (blocking)
     │ └── SIGTERM sent to PID 1 (parallel with preStop)
     │
 5s  │ preStop hook completes (e.g., sleep 5)
     │ App receives SIGTERM (if preStop blocked it)
     │ App starts graceful shutdown:
     │   ├── Stop accepting new connections
     │   ├── Drain in-flight requests
     │   └── Close database connections, flush buffers
     │
25s  │ App finishes graceful shutdown, exits 0
     │
30s  │ terminationGracePeriodSeconds expires
     │ SIGKILL sent (force kill if still running)
─────┴────────────────────────────────────────────────────────

Key insight: Endpoint removal is ASYNC — traffic may still
arrive for a few seconds after SIGTERM. The preStop sleep
gives time for kube-proxy/ingress to update routing tables.
```

### Recommended Configuration

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: api-server
spec:
  template:
    spec:
      terminationGracePeriodSeconds: 60    # Total time before SIGKILL
      containers:
        - name: app
          image: registry.example.com/api:v2
          ports:
            - containerPort: 8080
          lifecycle:
            preStop:
              exec:
                command: ["/bin/sh", "-c", "sleep 10"]
                # Sleep gives time for endpoint removal to propagate
                # Then SIGTERM triggers app's graceful shutdown
          readinessProbe:
            httpGet:
              path: /healthz
              port: 8080
            periodSeconds: 5
            # Failing readiness removes pod from endpoints faster
```

### Application SIGTERM Handling

```python
# Python (Flask/FastAPI)
import signal
import sys

def graceful_shutdown(signum, frame):
    print("SIGTERM received, shutting down gracefully...")
    # Stop accepting new requests
    server.should_exit = True
    # Wait for in-flight requests (max 20s)
    server.shutdown(timeout=20)
    sys.exit(0)

signal.signal(signal.SIGTERM, graceful_shutdown)
```

```go
// Go
func main() {
    ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGTERM, syscall.SIGINT)
    defer stop()

    server := &http.Server{Addr: ":8080"}
    go server.ListenAndServe()

    <-ctx.Done()
    log.Println("SIGTERM received, draining connections...")

    shutdownCtx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
    defer cancel()
    server.Shutdown(shutdownCtx)
}
```

```javascript
// Node.js
process.on('SIGTERM', () => {
  console.log('SIGTERM received, graceful shutdown...');
  server.close(() => {
    console.log('All connections drained');
    process.exit(0);
  });
  // Force exit after 20s if connections don't drain
  setTimeout(() => process.exit(1), 20000);
});
```

### Zero-Downtime Rolling Update

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: api-server
spec:
  replicas: 4
  strategy:
    type: RollingUpdate
    rollingUpdate:
      maxUnavailable: 0     # Never reduce below desired replicas
      maxSurge: 1           # Add 1 extra pod during update
  template:
    spec:
      terminationGracePeriodSeconds: 60
      containers:
        - name: app
          lifecycle:
            preStop:
              exec:
                command: ["/bin/sh", "-c", "sleep 10"]
          readinessProbe:
            httpGet:
              path: /ready
              port: 8080
            initialDelaySeconds: 5
            periodSeconds: 5
---
apiVersion: policy/v1
kind: PodDisruptionBudget
metadata:
  name: api-server-pdb
spec:
  minAvailable: 3    # Always keep at least 3 pods running
  selector:
    matchLabels:
      app: api-server
```

### Long-Running Connections (WebSocket/gRPC Streaming)

```yaml
spec:
  terminationGracePeriodSeconds: 300    # 5 minutes for long connections
  containers:
    - name: websocket-server
      lifecycle:
        preStop:
          exec:
            command:
              - /bin/sh
              - -c
              - |
                # Signal app to stop accepting new connections
                curl -X POST localhost:8080/admin/drain
                # Wait for existing connections to close naturally
                sleep 30
```

## Common Issues

### 502 errors during rolling update
- **Cause**: Traffic sent to pod after SIGTERM but before endpoint removal propagates
- **Fix**: Add `preStop: sleep 5-10` to delay shutdown; set `maxUnavailable: 0`

### Pod killed before finishing graceful shutdown
- **Cause**: `terminationGracePeriodSeconds` too short for drain time
- **Fix**: Increase grace period; grace period must be > preStop + drain time

### SIGTERM not received by application
- **Cause**: PID 1 is shell script that doesn't forward signals; or using `CMD` with shell form
- **Fix**: Use `exec` form in Dockerfile (`CMD ["./app"]` not `CMD ./app`); or use `exec` in entrypoint

### App exits immediately on SIGTERM without draining
- **Cause**: Application doesn't handle SIGTERM (default behavior = exit)
- **Fix**: Add signal handler to drain connections before exiting

## Best Practices

1. **Always add `preStop: sleep 5-10`** — allows endpoint removal to propagate
2. **Handle SIGTERM in your application** — drain connections, flush buffers
3. **Set `terminationGracePeriodSeconds` > preStop + drain time** — prevent SIGKILL
4. **Use `maxUnavailable: 0`** — never remove capacity during updates
5. **Fail readiness probe during shutdown** — accelerates endpoint removal
6. **Use `exec` form in Dockerfile CMD** — ensures PID 1 receives signals
7. **PodDisruptionBudget** — protects against voluntary disruptions

## Key Takeaways

- Pod termination: mark terminating → remove endpoints (async) → preStop → SIGTERM → wait → SIGKILL
- `preStop: sleep 5-10` bridges the gap between SIGTERM and endpoint removal
- Application must handle SIGTERM: stop accepting, drain in-flight, exit cleanly
- `terminationGracePeriodSeconds` (default 30s) is the hard deadline before SIGKILL
- Zero-downtime: preStop hook + SIGTERM handler + `maxUnavailable: 0` + readiness probe
- Shell form Dockerfile CMD (`CMD ./app`) doesn't forward signals — use exec form
