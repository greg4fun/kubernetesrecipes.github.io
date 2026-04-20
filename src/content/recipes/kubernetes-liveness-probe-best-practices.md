---
title: "Kubernetes Liveness Probe Best Practices"
description: "Configure Kubernetes liveness probes correctly. Best practices for httpGet, exec, and tcpSocket probes. Avoid database checks, thundering herd, and common anti-patterns."
category: "configuration"
publishDate: "2026-04-20"
author: "Luca Berton"
difficulty: "intermediate"
timeToComplete: "10 minutes"
kubernetesVersion: "1.21+"
tags: ["liveness", "probes", "health-check", "best-practices", "reliability"]
relatedRecipes:
  - kubernetes-readiness-probes
  - kubernetes-health-probes
  - fix-502-bad-gateway-kubernetes
---

> 💡 **Quick Answer:** Liveness probes should check ONLY if the process is alive and responsive — never external dependencies (databases, APIs). Use `/healthz` with minimal logic. If the liveness probe fails, kubelet kills the container — cascading failures happen when probes check shared dependencies.

## The Problem

Bad liveness probes cause:
- **Thundering herd**: All pods restart when a shared database hiccups
- **Cascading failures**: Pods kill themselves when they should just stop serving traffic
- **CrashLoopBackOff**: Aggressive probe settings kill slow-starting apps
- **False restarts**: External dependency flakiness triggers unnecessary kills

## The Solution

### Correct: Simple Process Health Check

```yaml
apiVersion: apps/v1
kind: Deployment
spec:
  template:
    spec:
      containers:
        - name: app
          livenessProbe:
            httpGet:
              path: /healthz
              port: 8080
            initialDelaySeconds: 15
            periodSeconds: 20
            timeoutSeconds: 5
            failureThreshold: 3
            # Total time before kill: 15 + (20 × 3) = 75 seconds
```

```go
// /healthz endpoint — checks ONLY process health
func healthz(w http.ResponseWriter, r *http.Request) {
    // ✓ Check if the process can handle requests
    // ✓ Check if critical goroutines are alive
    // ✓ Check memory isn't corrupted
    
    // ✗ DON'T check database connectivity
    // ✗ DON'T check downstream services
    // ✗ DON'T check disk space
    // ✗ DON'T check cache connectivity
    
    w.WriteHeader(http.StatusOK)
    w.Write([]byte("ok"))
}
```

### ❌ Anti-Pattern: Checking Database

```yaml
# DON'T DO THIS — if database is slow, ALL pods restart simultaneously
livenessProbe:
  httpGet:
    path: /health  # Endpoint that queries database
    port: 8080
  timeoutSeconds: 3
  failureThreshold: 2
  # Database latency spike → probe timeout → all pods killed → thundering herd on recovery
```

### Liveness vs Readiness vs Startup

```yaml
spec:
  containers:
    - name: app
      # Startup: "Are you finished starting up?"
      # Only checked during startup, prevents premature liveness kills
      startupProbe:
        httpGet:
          path: /healthz
          port: 8080
        periodSeconds: 5
        failureThreshold: 30  # 30 × 5s = 150s to start
        # Liveness/readiness don't run until startup succeeds

      # Liveness: "Are you deadlocked or crashed?"
      # Failure → container RESTART (kill + recreate)
      livenessProbe:
        httpGet:
          path: /healthz
          port: 8080
        periodSeconds: 20
        failureThreshold: 3

      # Readiness: "Can you handle traffic right now?"
      # Failure → removed from Service endpoints (no traffic, no restart)
      readinessProbe:
        httpGet:
          path: /ready
          port: 8080
        periodSeconds: 5
        failureThreshold: 2
```

### Decision Matrix

```mermaid
graph TD
    A[Health Check Needed] --> B{What to check?}
    
    B -->|Process alive?| C[Liveness Probe]
    C --> D[Simple /healthz - no dependencies]
    
    B -->|Can serve traffic?| E[Readiness Probe]
    E --> F[/ready - check DB, cache, connections]
    
    B -->|Startup complete?| G[Startup Probe]
    G --> H[Same as liveness, generous timeout]
    
    style D fill:#e8f5e9
    style F fill:#e3f2fd
    style H fill:#fff3e0
```

### Probe Types

```yaml
# HTTP GET (most common for web services)
livenessProbe:
  httpGet:
    path: /healthz
    port: 8080
    httpHeaders:
      - name: X-Health-Check
        value: "liveness"

# TCP Socket (for non-HTTP services like databases, Redis)
livenessProbe:
  tcpSocket:
    port: 5432

# Exec (for custom checks, sidecar processes)
livenessProbe:
  exec:
    command:
      - /bin/sh
      - -c
      - "pidof myprocess"

# gRPC (native in K8s 1.27+)
livenessProbe:
  grpc:
    port: 50051
    service: ""  # Empty = overall health
```

### Recommended Settings by Workload

| Workload | initialDelay | period | timeout | failureThreshold |
|----------|-------------|--------|---------|-----------------|
| Fast web app | 5s | 10s | 3s | 3 |
| Java/Spring | 30s | 20s | 5s | 3 |
| ML inference | 60s | 30s | 10s | 3 |
| Database | 30s | 20s | 5s | 5 |
| Worker/queue | 10s | 30s | 5s | 3 |

### Use startupProbe for Slow-Starting Apps

```yaml
# Instead of increasing initialDelaySeconds (which is a guess):
startupProbe:
  httpGet:
    path: /healthz
    port: 8080
  periodSeconds: 5
  failureThreshold: 60  # Up to 5 minutes to start
  # After startup succeeds, liveness probe takes over with normal settings
```

## Common Issues

| Issue | Cause | Fix |
|-------|-------|-----|
| Constant restarts on startup | No startupProbe, initialDelay too short | Add startupProbe with generous timeout |
| All pods restart at once | Liveness checks database | Remove dependency checks from liveness |
| Probe timeout but app is fine | timeoutSeconds too low for GC pauses | Increase to 5-10s |
| CrashLoopBackOff | failureThreshold=1, tight timing | Use failureThreshold ≥ 3 |
| Unnecessary restarts under load | Probe timeout during CPU pressure | Increase timeout, lower CPU limits |

## Best Practices

1. **Liveness = process health ONLY** — never check external dependencies
2. **Readiness = dependency health** — check DB, cache, downstream APIs here
3. **Use startupProbe for slow starts** — better than guessing initialDelaySeconds
4. **Set failureThreshold ≥ 3** — tolerates transient issues
5. **timeoutSeconds ≥ 5s** — GC pauses can exceed 1-2s
6. **periodSeconds ≥ 10s for liveness** — you don't need to check every second

## Key Takeaways

- Liveness probe failure = container kill → use sparingly and check only process health
- Readiness probe failure = remove from traffic → safe to check dependencies
- **Never check databases in liveness probes** — causes thundering herd cascades
- startupProbe decouples slow startup from normal operation monitoring
- Conservative settings (period=20s, failure=3, timeout=5s) prevent false positives
