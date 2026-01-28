---
title: "How to Configure Pod Lifecycle Hooks"
description: "Execute custom actions during pod startup and shutdown with lifecycle hooks. Implement graceful shutdown, initialization tasks, and cleanup operations."
category: "deployments"
difficulty: "intermediate"
publishDate: "2026-01-22"
tags: ["lifecycle", "hooks", "preStop", "postStart", "graceful-shutdown"]
---

# How to Configure Pod Lifecycle Hooks

Pod lifecycle hooks execute custom actions at specific points in a container's lifecycle. Use postStart for initialization and preStop for graceful shutdown.

## Lifecycle Hook Types

```yaml
# Two hook types:
# postStart - Runs immediately after container starts
#           - Runs in parallel with container's ENTRYPOINT
#           - Container won't reach Ready until hook completes

# preStop   - Runs before container terminates
#           - Blocks until complete or terminationGracePeriodSeconds expires
#           - SIGTERM sent after preStop completes
```

## Basic Lifecycle Hooks

```yaml
# lifecycle-hooks.yaml
apiVersion: v1
kind: Pod
metadata:
  name: lifecycle-demo
spec:
  containers:
    - name: app
      image: nginx:latest
      lifecycle:
        postStart:
          exec:
            command:
              - /bin/sh
              - -c
              - echo "Container started" >> /var/log/lifecycle.log
        preStop:
          exec:
            command:
              - /bin/sh
              - -c
              - |
                echo "Container stopping" >> /var/log/lifecycle.log
                nginx -s quit
                sleep 5
```

## HTTP Lifecycle Hooks

```yaml
# http-hooks.yaml
apiVersion: v1
kind: Pod
metadata:
  name: http-lifecycle
spec:
  containers:
    - name: app
      image: myapp:v1
      ports:
        - containerPort: 8080
      lifecycle:
        postStart:
          httpGet:
            path: /lifecycle/started
            port: 8080
        preStop:
          httpGet:
            path: /lifecycle/stopping
            port: 8080
```

## Graceful Shutdown Pattern

```yaml
# graceful-shutdown.yaml
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
      terminationGracePeriodSeconds: 60
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
                  - |
                    # Signal app to stop accepting new requests
                    curl -X POST localhost:8080/admin/drain
                    
                    # Wait for in-flight requests to complete
                    sleep 15
                    
                    # App will receive SIGTERM after this
          readinessProbe:
            httpGet:
              path: /health/ready
              port: 8080
            initialDelaySeconds: 5
            periodSeconds: 5
```

## Sleep Before SIGTERM

```yaml
# sleep-prestop.yaml
# Allows load balancers to remove pod from rotation
apiVersion: apps/v1
kind: Deployment
metadata:
  name: web-server
spec:
  template:
    spec:
      terminationGracePeriodSeconds: 30
      containers:
        - name: web
          image: nginx:latest
          lifecycle:
            preStop:
              exec:
                command:
                  - /bin/sh
                  - -c
                  - sleep 10
          # Pod removed from Service endpoints immediately
          # But external LBs may take time to update
          # Sleep allows graceful drain
```

## Registration/Deregistration Pattern

```yaml
# service-registry.yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: microservice
spec:
  template:
    spec:
      terminationGracePeriodSeconds: 45
      containers:
        - name: app
          image: myservice:v1
          lifecycle:
            postStart:
              exec:
                command:
                  - /bin/sh
                  - -c
                  - |
                    # Wait for app to be ready
                    until curl -s localhost:8080/health; do
                      sleep 1
                    done
                    # Register with service discovery
                    curl -X POST http://consul:8500/v1/agent/service/register \
                      -d '{"name": "myservice", "port": 8080}'
            preStop:
              exec:
                command:
                  - /bin/sh
                  - -c
                  - |
                    # Deregister from service discovery
                    curl -X PUT http://consul:8500/v1/agent/service/deregister/myservice
                    # Wait for traffic to drain
                    sleep 10
```

## Cache Warm-up on Start

```yaml
# cache-warmup.yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: cached-api
spec:
  template:
    spec:
      containers:
        - name: api
          image: api:v1
          lifecycle:
            postStart:
              exec:
                command:
                  - /bin/sh
                  - -c
                  - |
                    # Wait for app to start
                    sleep 5
                    # Warm up cache
                    curl localhost:8080/api/cache/warm
          readinessProbe:
            httpGet:
              path: /health/ready
              port: 8080
            initialDelaySeconds: 30  # Allow time for warm-up
```

## File Cleanup on Stop

```yaml
# cleanup-on-stop.yaml
apiVersion: v1
kind: Pod
metadata:
  name: worker
spec:
  terminationGracePeriodSeconds: 30
  containers:
    - name: worker
      image: worker:v1
      volumeMounts:
        - name: work-dir
          mountPath: /work
      lifecycle:
        preStop:
          exec:
            command:
              - /bin/sh
              - -c
              - |
                # Save work state
                cp /work/current-state.json /work/saved-state.json
                # Clean up temp files
                rm -rf /work/tmp/*
                # Signal worker to finish current job
                kill -SIGUSR1 1
                # Wait for graceful completion
                sleep 10
  volumes:
    - name: work-dir
      persistentVolumeClaim:
        claimName: work-pvc
```

## Connection Draining

```yaml
# connection-drain.yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: websocket-server
spec:
  template:
    spec:
      terminationGracePeriodSeconds: 120  # Long for WebSocket connections
      containers:
        - name: ws-server
          image: ws-server:v1
          lifecycle:
            preStop:
              exec:
                command:
                  - /bin/sh
                  - -c
                  - |
                    # Stop accepting new connections
                    curl -X POST localhost:8080/admin/stop-accepting
                    
                    # Notify connected clients
                    curl -X POST localhost:8080/admin/notify-shutdown
                    
                    # Wait for connections to close gracefully
                    # Check every 5 seconds if connections are drained
                    for i in $(seq 1 20); do
                      CONNS=$(curl -s localhost:8080/admin/connections | jq '.count')
                      if [ "$CONNS" -eq 0 ]; then
                        echo "All connections closed"
                        exit 0
                      fi
                      echo "Waiting for $CONNS connections..."
                      sleep 5
                    done
                    echo "Timeout reached, proceeding with termination"
```

## Debug Lifecycle Hooks

```bash
# Check if hooks completed
kubectl describe pod <pod-name> | grep -A 5 "State:"

# View events for hook failures
kubectl get events --field-selector involvedObject.name=<pod-name>

# Hook failures:
# - postStart failure: Container is killed and restarted
# - preStop failure: SIGTERM sent anyway after timeout

# View container logs during hooks
kubectl logs <pod-name> -f

# Check termination message
kubectl get pod <pod-name> -o jsonpath='{.status.containerStatuses[0].lastState.terminated}'
```

## Termination Sequence

```
1. Pod receives delete request
2. Pod marked as "Terminating"
3. Pod removed from Service endpoints
4. preStop hook executes
5. preStop completes (or timeout)
6. SIGTERM sent to container
7. Container handles SIGTERM
8. terminationGracePeriodSeconds countdown
9. SIGKILL if still running
10. Pod removed from API server
```

## Best Practices

```yaml
# 1. Always set terminationGracePeriodSeconds appropriately
spec:
  terminationGracePeriodSeconds: 30  # Default is 30

# 2. Keep hooks simple and fast
lifecycle:
  preStop:
    exec:
      command: ["sh", "-c", "sleep 5"]  # Simple is better

# 3. Don't duplicate work done by SIGTERM handler
# preStop is for cluster integration (LB drain, deregister)
# SIGTERM handler is for application cleanup

# 4. Use sleep to allow LB updates
lifecycle:
  preStop:
    exec:
      command: ["sleep", "10"]

# 5. Ensure hooks are idempotent
# They may be called multiple times in edge cases
```

## Summary

Lifecycle hooks enable custom actions during container startup (postStart) and shutdown (preStop). Use preStop for graceful shutdown: draining connections, deregistering from service discovery, and allowing load balancer updates. Hooks can execute commands or make HTTP requests. Always set appropriate terminationGracePeriodSeconds and keep hooks fast and reliable to ensure consistent pod behavior.

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
