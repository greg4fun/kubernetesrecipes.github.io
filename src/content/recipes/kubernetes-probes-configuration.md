---
title: "How to Configure Kubernetes Probes"
description: "Implement liveness, readiness, and startup probes for reliable applications. Configure HTTP, TCP, and exec probes with proper thresholds."
category: "deployments"
difficulty: "beginner"
publishDate: "2026-01-22"
tags: ["probes", "health-checks", "liveness", "readiness", "startup"]
---

# How to Configure Kubernetes Probes

Probes help Kubernetes manage container lifecycle by checking health status. Liveness probes restart unhealthy containers, readiness probes control traffic routing, and startup probes handle slow-starting apps.

## Probe Types

```yaml
# Three probe types:

# 1. Liveness Probe
#    - Is the container running correctly?
#    - Failed: Container is restarted
#    - Use for: Detecting deadlocks, hangs

# 2. Readiness Probe
#    - Is the container ready to serve traffic?
#    - Failed: Removed from Service endpoints
#    - Use for: Warming up, loading data

# 3. Startup Probe
#    - Has the container started successfully?
#    - Failed after threshold: Container is killed
#    - Use for: Slow-starting applications
#    - Disables liveness/readiness until success
```

## HTTP Probe

```yaml
# http-probes.yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: web-app
spec:
  replicas: 3
  selector:
    matchLabels:
      app: web-app
  template:
    metadata:
      labels:
        app: web-app
    spec:
      containers:
        - name: app
          image: myapp:v1
          ports:
            - containerPort: 8080
          livenessProbe:
            httpGet:
              path: /health/live
              port: 8080
            initialDelaySeconds: 10
            periodSeconds: 10
            timeoutSeconds: 5
            failureThreshold: 3
          readinessProbe:
            httpGet:
              path: /health/ready
              port: 8080
            initialDelaySeconds: 5
            periodSeconds: 5
            timeoutSeconds: 3
            failureThreshold: 3
            successThreshold: 1
```

## TCP Probe

```yaml
# tcp-probes.yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: database
spec:
  selector:
    matchLabels:
      app: database
  template:
    metadata:
      labels:
        app: database
    spec:
      containers:
        - name: postgres
          image: postgres:15
          ports:
            - containerPort: 5432
          livenessProbe:
            tcpSocket:
              port: 5432
            initialDelaySeconds: 30
            periodSeconds: 10
          readinessProbe:
            tcpSocket:
              port: 5432
            initialDelaySeconds: 5
            periodSeconds: 5
```

## Exec Probe

```yaml
# exec-probes.yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: worker
spec:
  selector:
    matchLabels:
      app: worker
  template:
    metadata:
      labels:
        app: worker
    spec:
      containers:
        - name: worker
          image: worker:v1
          livenessProbe:
            exec:
              command:
                - /bin/sh
                - -c
                - |
                  # Check if process is healthy
                  pgrep -f worker-process || exit 1
            initialDelaySeconds: 10
            periodSeconds: 15
          readinessProbe:
            exec:
              command:
                - cat
                - /tmp/ready
            initialDelaySeconds: 5
            periodSeconds: 5
```

## gRPC Probe

```yaml
# grpc-probes.yaml (Kubernetes 1.24+)
apiVersion: apps/v1
kind: Deployment
metadata:
  name: grpc-service
spec:
  selector:
    matchLabels:
      app: grpc-service
  template:
    metadata:
      labels:
        app: grpc-service
    spec:
      containers:
        - name: server
          image: grpc-server:v1
          ports:
            - containerPort: 50051
          livenessProbe:
            grpc:
              port: 50051
            initialDelaySeconds: 10
            periodSeconds: 10
          readinessProbe:
            grpc:
              port: 50051
              service: "health"  # Optional: specific service
            initialDelaySeconds: 5
            periodSeconds: 5
```

## Startup Probe for Slow Apps

```yaml
# startup-probe.yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: legacy-app
spec:
  selector:
    matchLabels:
      app: legacy-app
  template:
    metadata:
      labels:
        app: legacy-app
    spec:
      containers:
        - name: app
          image: legacy-app:v1
          ports:
            - containerPort: 8080
          # Startup probe runs first
          startupProbe:
            httpGet:
              path: /health
              port: 8080
            initialDelaySeconds: 10
            periodSeconds: 10
            failureThreshold: 30  # 30 * 10 = 300s to start
          # Liveness only runs after startup succeeds
          livenessProbe:
            httpGet:
              path: /health
              port: 8080
            periodSeconds: 10
            failureThreshold: 3
          readinessProbe:
            httpGet:
              path: /ready
              port: 8080
            periodSeconds: 5
```

## Probe Parameters

```yaml
# All probe parameters explained
livenessProbe:
  httpGet:
    path: /health
    port: 8080
    httpHeaders:           # Optional custom headers
      - name: X-Custom-Header
        value: probe
    scheme: HTTP           # HTTP or HTTPS
  
  # Timing parameters
  initialDelaySeconds: 10  # Wait before first probe
  periodSeconds: 10        # Time between probes
  timeoutSeconds: 5        # Probe timeout
  
  # Threshold parameters
  failureThreshold: 3      # Failures before action
  successThreshold: 1      # Successes to be healthy (readiness only)
```

## HTTP Response Codes

```yaml
# HTTP probes consider 200-399 as success
# 400+ responses are failures

# Custom endpoint returning status
livenessProbe:
  httpGet:
    path: /health/live
    port: 8080
# App should return:
# 200 OK - healthy
# 500/503 - unhealthy (will restart)
```

## Implement Health Endpoints

```python
# Python Flask example
from flask import Flask, jsonify

app = Flask(__name__)
ready = False
healthy = True

@app.route('/health/live')
def liveness():
    if healthy:
        return jsonify(status='ok'), 200
    return jsonify(status='unhealthy'), 500

@app.route('/health/ready')
def readiness():
    if ready:
        return jsonify(status='ready'), 200
    return jsonify(status='not ready'), 503

@app.route('/health/startup')
def startup():
    # Check if app has initialized
    if app_initialized:
        return jsonify(status='started'), 200
    return jsonify(status='starting'), 503
```

```go
// Go example
package main

import (
    "net/http"
    "sync/atomic"
)

var ready int32 = 0

func livenessHandler(w http.ResponseWriter, r *http.Request) {
    w.WriteHeader(http.StatusOK)
    w.Write([]byte("ok"))
}

func readinessHandler(w http.ResponseWriter, r *http.Request) {
    if atomic.LoadInt32(&ready) == 1 {
        w.WriteHeader(http.StatusOK)
        w.Write([]byte("ready"))
    } else {
        w.WriteHeader(http.StatusServiceUnavailable)
        w.Write([]byte("not ready"))
    }
}

func main() {
    http.HandleFunc("/health/live", livenessHandler)
    http.HandleFunc("/health/ready", readinessHandler)
    
    // Set ready after initialization
    go func() {
        initializeApp()
        atomic.StoreInt32(&ready, 1)
    }()
    
    http.ListenAndServe(":8080", nil)
}
```

## Common Patterns

```yaml
# Database connection check
readinessProbe:
  exec:
    command:
      - pg_isready
      - -U
      - postgres

# Redis ping
livenessProbe:
  exec:
    command:
      - redis-cli
      - ping

# File-based readiness
readinessProbe:
  exec:
    command:
      - test
      - -f
      - /tmp/ready
```

## Debugging Probes

```bash
# Check probe status
kubectl describe pod <pod> | grep -A 10 "Liveness\|Readiness"

# View probe failures in events
kubectl get events --field-selector involvedObject.name=<pod>

# Common messages:
# "Liveness probe failed: HTTP probe failed with statuscode: 500"
# "Readiness probe failed: connection refused"

# Test probe endpoint manually
kubectl exec <pod> -- curl -s localhost:8080/health/live
kubectl exec <pod> -- wget -qO- localhost:8080/health/ready
```

## Best Practices

```yaml
# 1. Separate liveness and readiness endpoints
livenessProbe:
  httpGet:
    path: /health/live    # Basic health
readinessProbe:
  httpGet:
    path: /health/ready   # Dependencies ready

# 2. Keep liveness probes simple
# Don't check external dependencies in liveness
# Only check if the process is running correctly

# 3. Use startup probes for slow apps
# Prevents premature liveness failures

# 4. Set appropriate timeouts
# timeoutSeconds should be less than periodSeconds

# 5. Don't set thresholds too low
# Allow for transient failures
failureThreshold: 3  # Not 1
```

## Summary

Kubernetes probes ensure reliable application operation. Liveness probes restart unhealthy containers - keep them simple and avoid external dependency checks. Readiness probes control traffic routing - check if the app can serve requests. Startup probes handle slow-starting applications by delaying liveness checks. Use HTTP probes for web services, TCP for databases, exec for custom checks, and gRPC for gRPC services. Set appropriate delays and thresholds to avoid false positives. Debug with `kubectl describe pod` and test endpoints manually.

---

## 📘 Go Further with Kubernetes Recipes

**Love this recipe? There's so much more!** This is just one of **100+ hands-on recipes** in our comprehensive **[Kubernetes Recipes book](/book)**.

Inside the book, you'll master:
- ✅ Production-ready deployment strategies
- ✅ Advanced networking and security patterns  
- ✅ Observability, monitoring, and troubleshooting
- ✅ Real-world best practices from industry experts

> *"The practical, recipe-based approach made complex Kubernetes concepts finally click for me."*

**👉 [Get Your Copy Now](/book)** — Start building production-grade Kubernetes skills today!
