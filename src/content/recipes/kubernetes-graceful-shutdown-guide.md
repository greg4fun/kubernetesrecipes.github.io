---
title: "Kubernetes Graceful Shutdown Guide"
description: "Implement graceful shutdown in Kubernetes pods. Configure terminationGracePeriodSeconds, preStop hooks, SIGTERM handling, and drain connections properly."
publishDate: "2026-05-02"
author: "Luca Berton"
category: "deployments"
difficulty: "intermediate"
timeToComplete: "15 minutes"
kubernetesVersion: "1.28+"
tags:
  - "graceful-shutdown"
  - "deployments"
  - "lifecycle"
  - "sigterm"
  - "preStop"
relatedRecipes:
  - "graceful-shutdown"
  - "kubernetes-pod-lifecycle-guide"
  - "kubernetes-liveness-readiness-startup-probes"
---

> 💡 **Quick Answer:** Kubernetes sends SIGTERM to your container, waits `terminationGracePeriodSeconds` (default 30s), then sends SIGKILL. For graceful shutdown: (1) handle SIGTERM in your app to stop accepting new requests and drain existing ones, (2) add a `preStop` hook with `sleep 5` to allow endpoint removal to propagate, (3) increase `terminationGracePeriodSeconds` if your app needs more time. The `preStop` sleep is critical — without it, traffic arrives at pods that are already shutting down.

## The Problem

Pods receiving traffic during shutdown cause:

- HTTP 502/503 errors during deployments
- Dropped WebSocket connections
- Lost in-flight requests
- Database transaction rollbacks
- Message queue messages processed twice

## The Solution

### Pod Termination Sequence

```
1. Pod marked for deletion (kubectl delete / rollout)
2. Pod removed from Service endpoints (async!)
3. preStop hook runs (if configured)
4. SIGTERM sent to PID 1 in container
5. Wait terminationGracePeriodSeconds (default: 30s)
6. SIGKILL sent (forced kill)
```

The critical issue: steps 2 and 3-4 happen **in parallel**. Traffic can still arrive after SIGTERM.

### Complete Graceful Shutdown Config

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: web-app
spec:
  replicas: 3
  strategy:
    rollingUpdate:
      maxUnavailable: 0      # Never reduce below desired count
      maxSurge: 1            # One extra pod during rollout
  template:
    spec:
      terminationGracePeriodSeconds: 60  # Total budget
      containers:
      - name: app
        image: myapp:v2
        ports:
        - containerPort: 8080
        readinessProbe:
          httpGet:
            path: /healthz
            port: 8080
          periodSeconds: 5
        lifecycle:
          preStop:
            exec:
              command:
              - /bin/sh
              - -c
              - |
                # Wait for endpoint removal to propagate
                sleep 5
                # Signal app to drain (optional — app can use SIGTERM)
                kill -SIGTERM 1
                # Wait for drain to complete
                sleep 25
```

### Handle SIGTERM in Your Application

**Node.js:**
```javascript
const server = app.listen(8080);

process.on('SIGTERM', () => {
  console.log('SIGTERM received, draining connections...');
  server.close(() => {
    console.log('All connections drained, exiting');
    process.exit(0);
  });
  // Force exit after 25s if connections don't drain
  setTimeout(() => process.exit(1), 25000);
});
```

**Go:**
```go
srv := &http.Server{Addr: ":8080"}
go srv.ListenAndServe()

sigCh := make(chan os.Signal, 1)
signal.Notify(sigCh, syscall.SIGTERM)
<-sigCh

ctx, cancel := context.WithTimeout(context.Background(), 25*time.Second)
defer cancel()
srv.Shutdown(ctx) // Drains existing connections
```

**Python (Flask/Gunicorn):**
```bash
# Gunicorn handles SIGTERM gracefully by default
gunicorn --graceful-timeout 30 --timeout 60 app:app
```

### Why preStop sleep Is Essential

```
Without preStop sleep:
  t=0: SIGTERM sent + endpoint removal starts
  t=0: App starts draining
  t=1: kube-proxy still has old endpoints → traffic to dying pod → 502!
  t=3: Endpoints finally removed

With preStop sleep 5:
  t=0: preStop starts → sleep 5
  t=3: Endpoints removed from all kube-proxies
  t=5: preStop ends, SIGTERM sent
  t=5: App starts draining (no more new traffic) ✅
```

### Long-Running Request Handling

```yaml
# For apps with long requests (file uploads, reports, etc.)
spec:
  terminationGracePeriodSeconds: 300  # 5 minutes
  containers:
  - name: app
    lifecycle:
      preStop:
        exec:
          command: ["sleep", "5"]
    # App must handle SIGTERM and drain within 295s
```

### Verify Graceful Shutdown

```bash
# Watch pod termination in real-time
kubectl delete pod my-app-abc123 &
kubectl get events -w --field-selector involvedObject.name=my-app-abc123

# Test with traffic during rollout
kubectl rollout restart deployment/web-app &
# In another terminal, send requests:
while true; do curl -s -o /dev/null -w "%{http_code}\n" http://web-app:8080/; sleep 0.1; done
# Should see 0 non-200 responses with proper graceful shutdown
```

## Common Issues

**SIGTERM not reaching the app**

Shell scripts as entrypoint (`/bin/sh -c "my-app"`) don't forward signals. Use `exec` form: `CMD ["my-app"]` or `exec my-app` in shell scripts.

**502s during deployment despite preStop**

`maxUnavailable: 1` (default) removes pods before new ones are ready. Set `maxUnavailable: 0` and `maxSurge: 1`.

**Pod killed before drain completes**

`terminationGracePeriodSeconds` is the TOTAL budget including preStop. If preStop sleeps 30s and app needs 30s to drain, you need ≥60s total.

## Best Practices

- **Always add `preStop: sleep 5`** — allows endpoint removal propagation
- **Set `maxUnavailable: 0`** for zero-downtime deployments
- **Handle SIGTERM in your app** — don't rely on SIGKILL
- **`terminationGracePeriodSeconds` = preStop + drain time + buffer**
- **Use `exec` form in Dockerfile CMD** — ensures PID 1 receives signals
- **Test with traffic during rollout** — verify zero 5xx errors

## Key Takeaways

- SIGTERM and endpoint removal happen in parallel — `preStop: sleep 5` bridges the gap
- `terminationGracePeriodSeconds` is the total budget (preStop + app drain + buffer)
- Always use `maxUnavailable: 0` for zero-downtime deployments
- Handle SIGTERM in your app to drain connections gracefully
- Shell entrypoints (`sh -c`) swallow signals — use exec form
