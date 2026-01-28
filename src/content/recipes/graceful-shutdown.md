---
title: "How to Implement Graceful Shutdown"
description: "Ensure zero-downtime deployments with proper graceful shutdown. Handle SIGTERM signals, drain connections, and configure termination settings."
category: "deployments"
difficulty: "intermediate"
publishDate: "2026-01-22"
tags: ["graceful-shutdown", "zero-downtime", "SIGTERM", "termination", "connections"]
---

# How to Implement Graceful Shutdown

Graceful shutdown ensures applications handle termination properly, completing in-flight requests and cleaning up resources before exiting. Essential for zero-downtime deployments.

## Termination Sequence

```bash
# When a pod is terminated:
# 1. Pod set to "Terminating" state
# 2. Pod removed from Service endpoints
# 3. preStop hook executes (if defined)
# 4. SIGTERM sent to container
# 5. Wait for gracePeriod (default 30s)
# 6. SIGKILL sent if still running
# 7. Pod removed from API server
```

## Basic Graceful Shutdown

```yaml
# graceful-deployment.yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: api-server
spec:
  replicas: 3
  selector:
    matchLabels:
      app: api-server
  template:
    metadata:
      labels:
        app: api-server
    spec:
      terminationGracePeriodSeconds: 60  # Time for graceful shutdown
      containers:
        - name: api
          image: api:v1
          ports:
            - containerPort: 8080
          lifecycle:
            preStop:
              exec:
                command:
                  - /bin/sh
                  - -c
                  - sleep 10  # Allow LB to remove pod
```

## Application Signal Handling

```go
// Go application handling SIGTERM
package main

import (
    "context"
    "net/http"
    "os"
    "os/signal"
    "syscall"
    "time"
)

func main() {
    server := &http.Server{Addr: ":8080"}
    
    // Handle requests
    http.HandleFunc("/", handler)
    
    // Start server in goroutine
    go func() {
        server.ListenAndServe()
    }()
    
    // Wait for SIGTERM
    quit := make(chan os.Signal, 1)
    signal.Notify(quit, syscall.SIGTERM, syscall.SIGINT)
    <-quit
    
    // Graceful shutdown with timeout
    ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
    defer cancel()
    
    server.Shutdown(ctx)
}
```

```python
# Python application handling SIGTERM
import signal
import sys
from flask import Flask

app = Flask(__name__)
shutdown_flag = False

def sigterm_handler(signum, frame):
    global shutdown_flag
    print("Received SIGTERM, shutting down gracefully...")
    shutdown_flag = True
    # Complete in-flight requests, cleanup, then exit
    sys.exit(0)

signal.signal(signal.SIGTERM, sigterm_handler)

@app.route('/health')
def health():
    if shutdown_flag:
        return "Shutting down", 503
    return "OK", 200
```

```javascript
// Node.js application handling SIGTERM
const express = require('express');
const app = express();

let shuttingDown = false;
const server = app.listen(8080);

process.on('SIGTERM', () => {
  console.log('SIGTERM received, shutting down gracefully');
  shuttingDown = true;
  
  server.close(() => {
    console.log('HTTP server closed');
    process.exit(0);
  });
  
  // Force close after timeout
  setTimeout(() => {
    console.error('Forced shutdown after timeout');
    process.exit(1);
  }, 30000);
});

// Health check reflects shutdown state
app.get('/health', (req, res) => {
  if (shuttingDown) {
    res.status(503).send('Shutting down');
  } else {
    res.status(200).send('OK');
  }
});
```

## PreStop Hook for Connection Draining

```yaml
# connection-draining.yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: web-server
spec:
  template:
    spec:
      terminationGracePeriodSeconds: 45
      containers:
        - name: web
          image: nginx:latest
          lifecycle:
            preStop:
              exec:
                command:
                  - /bin/sh
                  - -c
                  - |
                    # Stop accepting new connections
                    nginx -s quit
                    # Wait for existing connections to complete
                    while pgrep -x nginx > /dev/null; do
                      sleep 1
                    done
```

## Load Balancer Deregistration

```yaml
# lb-deregistration.yaml
# Allow time for external LBs to detect pod removal
apiVersion: apps/v1
kind: Deployment
metadata:
  name: web-app
spec:
  template:
    spec:
      terminationGracePeriodSeconds: 60
      containers:
        - name: app
          image: myapp:v1
          readinessProbe:
            httpGet:
              path: /health/ready
              port: 8080
            periodSeconds: 5
          lifecycle:
            preStop:
              exec:
                command:
                  - /bin/sh
                  - -c
                  - |
                    # Sleep to allow LB health checks to fail
                    # and remove pod from rotation
                    sleep 15
```

## Coordinated Shutdown

```yaml
# coordinated-shutdown.yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: queue-worker
spec:
  template:
    spec:
      terminationGracePeriodSeconds: 120  # Long for job completion
      containers:
        - name: worker
          image: worker:v1
          env:
            - name: SHUTDOWN_TIMEOUT
              value: "100"  # App knows its shutdown budget
          lifecycle:
            preStop:
              exec:
                command:
                  - /bin/sh
                  - -c
                  - |
                    # Signal app to stop accepting new work
                    curl -X POST localhost:8080/admin/drain
                    # Wait for current jobs to complete
                    while curl -s localhost:8080/admin/jobs | grep -q '"active":true'; do
                      sleep 5
                    done
```

## Database Connection Cleanup

```yaml
# db-cleanup.yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: api-with-db
spec:
  template:
    spec:
      terminationGracePeriodSeconds: 30
      containers:
        - name: api
          image: api:v1
          env:
            - name: DB_POOL_SIZE
              value: "10"
          lifecycle:
            preStop:
              exec:
                command:
                  - /bin/sh
                  - -c
                  - |
                    # Close database connections gracefully
                    curl -X POST localhost:8080/admin/close-db-pool
                    sleep 5
```

## Readiness During Shutdown

```yaml
# readiness-shutdown.yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: graceful-app
spec:
  template:
    spec:
      containers:
        - name: app
          image: myapp:v1
          # Readiness probe should fail during shutdown
          # This removes pod from Service before termination
          readinessProbe:
            httpGet:
              path: /health/ready
              port: 8080
            periodSeconds: 5
            failureThreshold: 1
          # App should return 503 on /health/ready when shutting down
```

## WebSocket Connection Handling

```yaml
# websocket-shutdown.yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: websocket-server
spec:
  template:
    spec:
      terminationGracePeriodSeconds: 120
      containers:
        - name: ws
          image: ws-server:v1
          lifecycle:
            preStop:
              exec:
                command:
                  - /bin/sh
                  - -c
                  - |
                    # Stop accepting new connections
                    curl -X POST localhost:8080/admin/stop-accept
                    
                    # Send close frames to all connected clients
                    curl -X POST localhost:8080/admin/graceful-close
                    
                    # Wait for clients to disconnect (up to 90s)
                    for i in $(seq 1 18); do
                      COUNT=$(curl -s localhost:8080/admin/connections)
                      if [ "$COUNT" -eq 0 ]; then
                        exit 0
                      fi
                      sleep 5
                    done
```

## Verify Graceful Shutdown

```bash
# Watch pod termination
kubectl delete pod <pod-name> & kubectl get pod <pod-name> -w

# Check logs during termination
kubectl logs <pod-name> -f

# Verify preStop executed
kubectl describe pod <pod-name> | grep -A 10 "State:"

# Test with curl during deployment
while true; do curl -s -o /dev/null -w "%{http_code}\n" http://service/; sleep 0.1; done
```

## Common Issues

```yaml
# Issue: Connections dropped during deployment
# Fix: Add preStop sleep to allow LB update
lifecycle:
  preStop:
    exec:
      command: ["sleep", "15"]

# Issue: Shutdown timeout exceeded
# Fix: Increase terminationGracePeriodSeconds
terminationGracePeriodSeconds: 120

# Issue: App not receiving SIGTERM
# Fix: Ensure app runs as PID 1 or handles signal forwarding
# Use exec form in Dockerfile:
# CMD ["./myapp"]  # Not: CMD ./myapp
```

## Summary

Graceful shutdown ensures zero-downtime deployments by properly handling termination. Configure `terminationGracePeriodSeconds` to allow enough time for cleanup. Use preStop hooks to sleep (allowing LB deregistration) and initiate application drain. Applications must handle SIGTERM signals to stop accepting new requests and complete in-flight work. Readiness probes should fail during shutdown to remove pods from Service endpoints before termination. Test shutdown behavior by watching pod logs during rolling updates.

---

## 📘 Go Further with Kubernetes Recipes

**Love this recipe? There's so much more!** This is just one of **100+ hands-on recipes** in our comprehensive **[Kubernetes Recipes book](https://amzn.to/3DzC8QA)**.

Inside the book, you'll master:
- ✅ Production-ready deployment strategies
- ✅ Advanced networking and security patterns  
- ✅ Observability, monitoring, and troubleshooting
- ✅ Real-world best practices from industry experts

> *"The practical, recipe-based approach made complex Kubernetes concepts finally click for me."*

**👉 [Get Your Copy Now](https://amzn.to/3DzC8QA)** — Start building production-grade Kubernetes skills today!
