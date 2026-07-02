---
title: "Readiness Liveness Startup Probes"
description: "Configure Kubernetes health probes correctly. When to use each probe type, common mistakes, and production-ready probe configurations."
publishDate: "2026-04-25"
author: "Luca Berton"
category: "deployments"
difficulty: "beginner"
timeToComplete: "15 minutes"
kubernetesVersion: "1.28+"
tags:
  - "probes"
  - "readiness"
  - "liveness"
  - "startup"
  - "health-check"
relatedRecipes:
  - "kubernetes-readiness-probe-guide"
  - "kubernetes-pod-security-standards"
  - "kubernetes-rbac-least-privilege"
  - "kubernetes-liveness-readiness-startup-probes"
---

> 💡 **Quick Answer:** Configure Kubernetes health probes correctly. When to use each probe type, common mistakes, and production-ready probe configurations.

## The Problem

Kubernetes has three probe types that look similar but do very different things when they fail — mixing them up causes either restart loops (liveness checking something it shouldn't) or pods stuck out of rotation forever (readiness never passing).

## The Solution

### The Three Probe Types

```text
Liveness  — Is the container running correctly?    Fails → container is restarted
Readiness — Is the container ready for traffic?     Fails → removed from Service endpoints
Startup   — Has the container finished starting?    Fails after threshold → container is killed
                                                     Success → liveness/readiness begin checking
```

### HTTP, TCP, Exec, and gRPC Probes

```yaml
livenessProbe:
  httpGet: {path: /health/live, port: 8080}
  initialDelaySeconds: 10
  periodSeconds: 10
  timeoutSeconds: 5
  failureThreshold: 3
readinessProbe:
  httpGet: {path: /health/ready, port: 8080}
  initialDelaySeconds: 5
  periodSeconds: 5
  failureThreshold: 3
```

```yaml
# TCP — for services with no HTTP endpoint (databases, etc.)
livenessProbe:
  tcpSocket: {port: 5432}
  initialDelaySeconds: 30
  periodSeconds: 10
```

```yaml
# Exec — for anything checkable via a local command
readinessProbe:
  exec: {command: ["pg_isready", "-U", "postgres"]}
livenessProbe:
  exec: {command: ["redis-cli", "ping"]}
```

```yaml
# gRPC (Kubernetes 1.24+) — no sidecar/wrapper needed
livenessProbe:
  grpc: {port: 50051}
readinessProbe:
  grpc: {port: 50051, service: "health"}   # optional: specific gRPC health service
```

### Startup Probe for Slow-Starting Apps

Liveness and readiness don't run until the startup probe succeeds — this prevents a slow-booting app from being killed by an impatient liveness probe before it's even finished initializing:

```yaml
startupProbe:
  httpGet: {path: /health, port: 8080}
  periodSeconds: 10
  failureThreshold: 30   # 30 × 10s = up to 300s to start
livenessProbe:
  httpGet: {path: /health, port: 8080}
  periodSeconds: 10
  failureThreshold: 3
readinessProbe:
  httpGet: {path: /ready, port: 8080}
  periodSeconds: 5
```

### Implementing Health Endpoints

```python
# Flask
@app.route('/health/live')
def liveness():
    return (jsonify(status='ok'), 200) if healthy else (jsonify(status='unhealthy'), 500)

@app.route('/health/ready')
def readiness():
    return (jsonify(status='ready'), 200) if ready else (jsonify(status='not ready'), 503)
```

```go
func readinessHandler(w http.ResponseWriter, r *http.Request) {
    if atomic.LoadInt32(&ready) == 1 {
        w.WriteHeader(http.StatusOK)
    } else {
        w.WriteHeader(http.StatusServiceUnavailable)   // 503 removes the pod from Service endpoints
    }
}
```

### Debugging Probe Failures

```bash
kubectl describe pod <pod> | grep -A 10 "Liveness\|Readiness"
kubectl get events --field-selector involvedObject.name=<pod>
# "Liveness probe failed: HTTP probe failed with statuscode: 500"
# "Readiness probe failed: connection refused"

# Test the endpoint manually to rule out a probe-config issue vs. an app issue
kubectl exec <pod> -- curl -s localhost:8080/health/live
```

## Common Issues

| Issue | Cause | Fix |
|-------|-------|-----|
| Restart loop under load | Liveness probe checks a slow dependency (DB, downstream API) | Liveness should only check "is this process alive," never external dependencies — put dependency checks in readiness instead |
| Pod never becomes Ready | Readiness endpoint checks something that's never true (e.g., a cache that only warms on first request) | Ensure the readiness condition is actually reachable during normal operation, not just at a specific lifecycle moment |
| Slow app killed before it finishes starting | No startup probe, and liveness `failureThreshold` × `periodSeconds` is shorter than actual startup time | Add a `startupProbe` with generous `failureThreshold`; liveness/readiness are paused until it succeeds |
| `timeoutSeconds` errors under normal load | `timeoutSeconds` set higher than `periodSeconds`, so probes overlap | Keep `timeoutSeconds` comfortably below `periodSeconds` |

## Best Practices

- **Use separate endpoints for liveness and readiness** (`/health/live` vs `/health/ready`) — they check fundamentally different things
- **Keep liveness checks simple** — verify the process itself is responsive, never call out to a database or downstream service
- **Readiness should reflect real serving capacity** — check dependencies here, and return non-2xx during shutdown/overload so traffic routes elsewhere
- **Use a startup probe for anything slower than a few seconds to boot** — it's the correct tool, not a longer `initialDelaySeconds` on liveness
- **Don't set `failureThreshold: 1`** — allow for at least one transient failure before taking action

## Key Takeaways

- Liveness restarts the container; readiness removes it from Service endpoints; startup gates both until the app has actually finished booting
- HTTP probes treat 200-399 as success, 400+ as failure — return the right status code from your health endpoints, not just 200 always
- A startup probe prevents slow-starting apps from being killed by liveness before initialization completes
- Never put external dependency checks in a liveness probe — that turns a database blip into a full restart storm
- `kubectl describe pod` shows the exact probe failure message; test the endpoint manually with `kubectl exec ... curl` to isolate probe config from app bugs
