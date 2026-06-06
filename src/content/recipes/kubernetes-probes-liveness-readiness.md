---
title: "Kubernetes Liveness and Readiness Probes Guide"
description: "Configure Kubernetes liveness, readiness, and startup probes for health checks. HTTP, TCP, exec probes, timing parameters, and failure threshold tuning."
publishDate: "2026-05-02"
author: "Luca Berton"
category: "deployments"
difficulty: "beginner"
timeToComplete: "10 minutes"
kubernetesVersion: "1.28+"
tags:
  - "probes"
  - "health-checks"
  - "liveness"
  - "readiness"
  - "cka"
relatedRecipes:
  - "kubernetes-deployment-rolling-update"
  - "kubernetes-endpoint-slices-discovery"
  - "debug-crashloopbackoff"
  - "kubernetes-graceful-shutdown-guide"
---

> 💡 **Quick Answer:** Three probe types: **Liveness** (is the container alive? restart if not), **Readiness** (can it serve traffic? remove from Service if not), **Startup** (has it started? disable other probes until it passes). Use `httpGet` for web apps, `tcpSocket` for databases, `exec` for custom checks. Always set `initialDelaySeconds` to avoid premature restarts.

## The Problem

Without health probes:

- Dead containers keep running (liveness)
- Traffic sent to pods that aren't ready (readiness)
- Slow-starting apps get killed before they're up (startup)
- Rolling updates proceed before new pods can serve
- No automatic recovery from application deadlocks

## The Solution

### All Three Probes

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: web-app
spec:
  replicas: 3
  selector:
    matchLabels:
      app: web
  template:
    metadata:
      labels:
        app: web
    spec:
      containers:
      - name: app
        image: myapp:v2
        ports:
        - containerPort: 8080
        
        # Startup probe — runs first, disables other probes until success
        startupProbe:
          httpGet:
            path: /healthz
            port: 8080
          failureThreshold: 30      # 30 × 10s = 5 min to start
          periodSeconds: 10
        
        # Liveness probe — restart container if this fails
        livenessProbe:
          httpGet:
            path: /healthz
            port: 8080
          initialDelaySeconds: 0    # Startup probe handles delay
          periodSeconds: 15
          timeoutSeconds: 3
          failureThreshold: 3       # 3 failures → restart
        
        # Readiness probe — remove from Service if this fails
        readinessProbe:
          httpGet:
            path: /ready
            port: 8080
          initialDelaySeconds: 0
          periodSeconds: 5
          timeoutSeconds: 3
          failureThreshold: 3
          successThreshold: 1
```

### Probe Types

```yaml
# HTTP GET — most common for web apps
livenessProbe:
  httpGet:
    path: /healthz
    port: 8080
    httpHeaders:
    - name: Accept
      value: application/json
  # Success: 200-399 status code

# TCP Socket — for databases, caches, non-HTTP services
livenessProbe:
  tcpSocket:
    port: 5432
  # Success: TCP connection established

# Exec — run a command inside the container
livenessProbe:
  exec:
    command:
    - sh
    - -c
    - pg_isready -U postgres
  # Success: exit code 0

# gRPC (K8s 1.27+) — for gRPC services
livenessProbe:
  grpc:
    port: 50051
    service: health
  # Success: SERVING status
```

### Timing Parameters

```yaml
livenessProbe:
  httpGet:
    path: /healthz
    port: 8080
  initialDelaySeconds: 15    # Wait before first probe (default: 0)
  periodSeconds: 10          # How often to probe (default: 10)
  timeoutSeconds: 3          # Timeout per probe (default: 1)
  failureThreshold: 3        # Failures before action (default: 3)
  successThreshold: 1        # Successes to be considered healthy (default: 1)
  # For readiness: successThreshold can be >1

# Total time to failure = initialDelay + (period × failureThreshold)
# Example: 15 + (10 × 3) = 45 seconds before container restart
```

### When to Use Each Probe

```
STARTUP PROBE:
  Purpose: Protect slow-starting containers
  On fail: Keep trying (up to failureThreshold)
  Use for: Java apps, apps loading large models, database migrations
  
LIVENESS PROBE:
  Purpose: Detect deadlocked/broken containers
  On fail: Container RESTARTED
  Use for: Detecting deadlocks, infinite loops, unrecoverable errors
  Danger: Too aggressive = restart loops
  
READINESS PROBE:
  Purpose: Control traffic routing
  On fail: Pod removed from Service endpoints
  On pass: Pod added back to Service endpoints
  Use for: Warmup periods, dependency checks, graceful degradation
```

### Common Patterns

```yaml
# Pattern 1: Slow Java app (60s startup)
startupProbe:
  httpGet:
    path: /actuator/health
    port: 8080
  failureThreshold: 60     # 60 × 2s = 2 min max startup
  periodSeconds: 2
livenessProbe:
  httpGet:
    path: /actuator/health
    port: 8080
  periodSeconds: 30
  failureThreshold: 3

---
# Pattern 2: Database dependency check
readinessProbe:
  exec:
    command:
    - sh
    - -c
    - |
      curl -sf http://localhost:8080/healthz && \
      pg_isready -h $DB_HOST -p 5432
  periodSeconds: 10

---
# Pattern 3: File-based health (sidecar pattern)
livenessProbe:
  exec:
    command: ["cat", "/tmp/healthy"]
  # App creates /tmp/healthy when alive
  # Sidecar or app removes it on fatal error
```

### Liveness vs Readiness Endpoints

```go
// Separate endpoints for liveness and readiness
// /healthz — am I alive? (simple, fast check)
func healthz(w http.ResponseWriter, r *http.Request) {
    w.WriteHeader(http.StatusOK)  // Always 200 unless deadlocked
}

// /ready — can I serve traffic? (check dependencies)
func ready(w http.ResponseWriter, r *http.Request) {
    if !dbConnected || !cacheWarmed {
        w.WriteHeader(http.StatusServiceUnavailable) // 503
        return
    }
    w.WriteHeader(http.StatusOK)
}
```

## Common Issues

**Container restart loop (CrashLoopBackOff)**

Liveness probe too aggressive — fails before app starts. Add `startupProbe` or increase `initialDelaySeconds`.

**Traffic sent to unready pods during deployment**

No readiness probe configured. Add one — rolling updates wait for readiness before proceeding.

**Liveness probe passes but app is broken**

Health endpoint doesn't check enough. Test actual functionality (DB connection, cache availability), not just "process is running."

**Readiness probe never passes**

Dependency (DB, external service) is down. Pod stays not-ready. Check: `kubectl describe pod` → Events.

## Best Practices

- **Always use readiness probes** — prevents traffic to unready pods
- **Use startup probes for slow apps** — don't abuse initialDelaySeconds
- **Liveness ≠ readiness** — different endpoints, different checks
- **Keep liveness probes simple** — check if process is alive, not dependencies
- **Readiness probes check dependencies** — database, cache, external services
- **Don't make liveness probes too aggressive** — causes unnecessary restarts
- **timeoutSeconds > 1** for network probes — avoid flapping on slow responses

## Key Takeaways

- Liveness: restart dead containers | Readiness: route traffic | Startup: protect slow starts
- HTTP probes succeed on 200-399 status codes
- Startup probe disables liveness/readiness until it passes
- Keep liveness simple (is it alive?), readiness thorough (can it serve?)
- Configure timing to match your application's behavior
