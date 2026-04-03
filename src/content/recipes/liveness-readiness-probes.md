---
title: "Kubernetes Readiness Probe and Liveness Probe"
description: "Configure Kubernetes readiness probes and liveness probes for pod health checks. HTTP, TCP, exec, and gRPC probe examples with best practices."
category: "deployments"
difficulty: "beginner"
timeToComplete: "15 minutes"
kubernetesVersion: "1.25+"
prerequisites:
  - "Basic understanding of Kubernetes Deployments"
  - "kubectl configured to access your cluster"
relatedRecipes:
  - "kubernetes-cluster-upgrade"
  - "rolling-update-strategies"
  - "pod-disruption-budget"
tags:
  - probes
  - health-checks
  - liveness
  - readiness
  - startup
  - kubernetes-probes
  - http-probe
  - tcp-probe
  - high-availability
publishDate: "2026-01-20"
author: "Luca Berton"
---

> **💡 Quick Answer:** Use **readinessProbe** to control when a pod receives traffic (fails = removed from Service). Use **livenessProbe** to restart unhealthy containers (fails = container restart). Use **startupProbe** for slow-starting apps. Always set `initialDelaySeconds` to give your app time to start, and don't make livenessProbe depend on external services.

## The Problem

Kubernetes needs to know if your application is healthy and ready to receive traffic. Without proper health checks, Kubernetes might send traffic to broken pods or fail to restart crashed applications.

## The Solution

Configure three types of probes:

1. **Liveness Probe** - Is the container alive? (Restart if not)
2. **Readiness Probe** - Is the container ready for traffic? (Remove from service if not)
3. **Startup Probe** - Has the container started? (Protect slow-starting containers)

## Understanding the Difference

| Probe | Purpose | Failure Action |
|-------|---------|----------------|
| Liveness | Detect deadlocks/hangs | Restart container |
| Readiness | Detect temporary unavailability | Remove from Service endpoints |
| Startup | Wait for slow startup | Prevent liveness checks during startup |

## Basic HTTP Probe Example

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: my-app
spec:
  replicas: 3
  selector:
    matchLabels:
      app: my-app
  template:
    metadata:
      labels:
        app: my-app
    spec:
      containers:
        - name: my-app
          image: my-app:1.0
          ports:
            - containerPort: 8080
          
          # Liveness: Restart if this fails
          livenessProbe:
            httpGet:
              path: /healthz
              port: 8080
            initialDelaySeconds: 10
            periodSeconds: 10
            timeoutSeconds: 5
            failureThreshold: 3
          
          # Readiness: Remove from service if this fails
          readinessProbe:
            httpGet:
              path: /ready
              port: 8080
            initialDelaySeconds: 5
            periodSeconds: 5
            timeoutSeconds: 3
            failureThreshold: 3
```

## Probe Types

### HTTP Probe (Most Common)

```yaml
livenessProbe:
  httpGet:
    path: /healthz
    port: 8080
    httpHeaders:
      - name: Authorization
        value: Bearer token
```

### TCP Probe (For non-HTTP services)

```yaml
livenessProbe:
  tcpSocket:
    port: 3306
```

### Command Probe (For custom checks)

```yaml
livenessProbe:
  exec:
    command:
      - cat
      - /tmp/healthy
```

### gRPC Probe (Kubernetes 1.24+)

```yaml
livenessProbe:
  grpc:
    port: 50051
    service: my.health.Service
```

## Probe Parameters Explained

| Parameter | Default | Description |
|-----------|---------|-------------|
| `initialDelaySeconds` | 0 | Wait before first probe |
| `periodSeconds` | 10 | How often to probe |
| `timeoutSeconds` | 1 | Probe timeout |
| `successThreshold` | 1 | Consecutive successes to be healthy |
| `failureThreshold` | 3 | Consecutive failures to be unhealthy |

## Startup Probe for Slow Applications

For applications that take a long time to start (Java apps, ML models):

```yaml
startupProbe:
  httpGet:
    path: /healthz
    port: 8080
  # Allow up to 5 minutes for startup (30 * 10 seconds)
  failureThreshold: 30
  periodSeconds: 10

livenessProbe:
  httpGet:
    path: /healthz
    port: 8080
  # Once startup succeeds, use tighter liveness checks
  periodSeconds: 10
  failureThreshold: 3
```

## Best Practices

### ✅ DO

```yaml
# Separate endpoints for liveness and readiness
livenessProbe:
  httpGet:
    path: /healthz  # Only checks if app is alive
    
readinessProbe:
  httpGet:
    path: /ready    # Checks dependencies (DB, cache, etc.)
```

### ❌ DON'T

```yaml
# Don't check external dependencies in liveness probe!
livenessProbe:
  httpGet:
    path: /ready  # This checks DB connection
    # If DB is slow, ALL pods restart = cascading failure!
```

### Recommended Health Check Implementations

**Liveness endpoint** (`/healthz`):
- Return 200 if the process is running
- Don't check external dependencies
- Fast response (< 100ms)

**Readiness endpoint** (`/ready`):
- Check database connections
- Check cache availability
- Check required external services
- Return 503 if not ready

## Complete Example: Node.js Application

```javascript
// healthz - for liveness (simple)
app.get('/healthz', (req, res) => {
  res.status(200).json({ status: 'alive' });
});

// ready - for readiness (checks dependencies)
app.get('/ready', async (req, res) => {
  try {
    // Check database
    await db.ping();
    
    // Check Redis
    await redis.ping();
    
    res.status(200).json({ status: 'ready' });
  } catch (error) {
    res.status(503).json({ 
      status: 'not ready',
      error: error.message 
    });
  }
});
```

## Common Mistakes

### 1. Liveness checks external dependencies

```yaml
# BAD: If DB is slow, all pods restart
livenessProbe:
  httpGet:
    path: /api/users  # Queries database
```

### 2. Timeout too short

```yaml
# BAD: Probe times out during GC pauses
livenessProbe:
  httpGet:
    path: /healthz
  timeoutSeconds: 1  # Too short for Java apps
```

### 3. No startup probe for slow apps

```yaml
# BAD: App takes 60s to start, but liveness starts at 10s
livenessProbe:
  initialDelaySeconds: 10  # App not ready yet = restart loop
```

### 4. ReadinessProbe too aggressive

```yaml
# BAD: Single failure removes from service
readinessProbe:
  failureThreshold: 1  # Flaky during deployments
```

## Debugging Probes

Check probe status:

```bash
kubectl describe pod my-app-xxx
# Look for "Liveness" and "Readiness" in Conditions
```

Check events for probe failures:

```bash
kubectl get events --field-selector reason=Unhealthy
```

Test the endpoint manually:

```bash
kubectl exec -it my-app-xxx -- curl localhost:8080/healthz
```

## Summary

You've learned how to:

1. Configure liveness, readiness, and startup probes
2. Choose the right probe type for your use case
3. Implement health check endpoints correctly
4. Avoid common pitfalls that cause cascading failures

**Key takeaway:** Keep liveness probes simple, use readiness probes for dependency checks.

## References

- [Kubernetes Probe Documentation](https://kubernetes.io/docs/tasks/configure-pod-container/configure-liveness-readiness-startup-probes/)
- [Health Check Best Practices](https://kubernetes.io/docs/concepts/workloads/pods/pod-lifecycle/#container-probes)

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

## Frequently Asked Questions

### What is a readiness probe in Kubernetes?
A readiness probe tells Kubernetes when a pod is ready to accept traffic. If the readiness probe fails, the pod is removed from Service endpoints (no traffic routed to it) but NOT restarted. Use readiness probes for applications that need warm-up time, dependency checks, or graceful degradation.

### What's the difference between liveness and readiness probes?
**Liveness probes** detect if a container is deadlocked or hung — a failing liveness probe causes Kubernetes to restart the container. **Readiness probes** detect if a container can handle requests — a failing readiness probe removes the pod from load balancing but doesn't restart it. Use both together for robust health checking.

### How do I configure a readiness probe?
```yaml
readinessProbe:
  httpGet:
    path: /healthz
    port: 8080
  initialDelaySeconds: 5
  periodSeconds: 10
  failureThreshold: 3
```
This checks `/healthz` every 10 seconds. After 3 consecutive failures, the pod is marked unready and removed from Service endpoints.

## Frequently Asked Questions

### What is a readiness probe in Kubernetes?

A readiness probe tells Kubernetes whether a pod is ready to receive traffic. If the readiness probe fails, the pod is removed from Service endpoints — no traffic is routed to it. Unlike liveness probes, a failed readiness probe does NOT restart the pod.

### What is the difference between liveness and readiness probes?

**Liveness probe**: Is the container alive? On failure → restart the container. Use to detect deadlocks and hangs. **Readiness probe**: Is the container ready for traffic? On failure → remove from Service endpoints. Use for slow startup and dependency checks.

### Should I use liveness probes?

Be careful with liveness probes. Never check external dependencies (database, cache) in liveness probes — if the DB is down, restarting your app won't fix it and creates a thundering herd. Set `initialDelaySeconds` high enough and use `failureThreshold: 3` minimum.

### What is a startup probe?

Startup probes (Kubernetes 1.20+) run only during container startup. Once the startup probe succeeds, liveness and readiness probes take over. Use startup probes for slow-starting applications (Java, ML models).

### What probe types are available?

HTTP GET (success = 200-399), TCP socket (success = port open), exec command (success = exit code 0), and gRPC health check (Kubernetes 1.27+).

See also: [CrashLoopBackOff Troubleshooting](/recipes/troubleshooting/debug-crashloopbackoff/), [HPA Guide](/recipes/autoscaling/horizontal-pod-autoscaler/)
