---
title: "K8s Graceful Shutdown & terminationGracePeriod"
description: "Kubernetes graceful shutdown: terminationGracePeriodSeconds (default 30s), preStop sleep, SIGTERM handlers, and fixing the endpoint-removal race for zero 502s."
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
  - "sigkill"
  - "preStop"
  - "termination"
  - "terminationGracePeriodSeconds"
  - "pod-lifecycle"
  - "zero-downtime"
relatedRecipes:
  - "kubernetes-pod-lifecycle-guide"
  - "pod-lifecycle-hooks"
  - "kubernetes-liveness-readiness-startup-probes"
  - "kubernetes-rolling-update-strategies"
  - "kubernetes-pod-disruption-budget-guide"
  - "kubernetes-sidecar-containers-guide"
  - "fix-502-bad-gateway-kubernetes"
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
5. Wait until terminationGracePeriodSeconds expires (default: 30s)
6. SIGKILL sent (forced kill, cannot be caught)
```

The critical issue: steps 2 and 3-4 happen **in parallel**. Traffic can still arrive after SIGTERM.

The grace-period countdown starts the moment the pod enters `Terminating` — **preStop time is included**. With the default 30s and a 10s preStop, your app only gets 20s after SIGTERM.

### Complete Graceful Shutdown Config

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: web-app
spec:
  replicas: 3
  selector:
    matchLabels:
      app: web-app
  strategy:
    rollingUpdate:
      maxUnavailable: 0      # Never reduce below desired count
      maxSurge: 1            # One extra pod during rollout
  template:
    metadata:
      labels:
        app: web-app
    spec:
      terminationGracePeriodSeconds: 60  # Pod-level total budget (default 30)
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
              # Wait for endpoint removal to propagate; kubelet sends SIGTERM afterwards
              command: ["/bin/sh", "-c", "sleep 5"]
```

`terminationGracePeriodSeconds` lives in the **pod spec** (`spec.template.spec` in a Deployment), not per container. Omitting it is the same as setting `30`.

### preStop Hook Variants

```yaml
# Native sleep action — no shell needed (distroless images).
# Beta and enabled by default since Kubernetes 1.30 (PodLifecycleSleepAction).
lifecycle:
  preStop:
    sleep:
      seconds: 5
```

```yaml
# HTTP preStop: app starts draining when the endpoint is called
lifecycle:
  preStop:
    httpGet:
      path: /shutdown
      port: 8080
```

```yaml
# NGINX: graceful quit, wait for workers to finish
lifecycle:
  preStop:
    exec:
      command: ["/bin/sh", "-c", "sleep 5 && nginx -s quit && while pgrep -x nginx; do sleep 1; done"]
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

**Python (raw signal handling, outside a WSGI server):**
```python
import signal, sys

def sigterm_handler(signum, frame):
    server.stop(grace=20)   # stop accepting, finish in-flight requests
    db.close()              # close pools, flush buffers
    sys.exit(0)

signal.signal(signal.SIGTERM, sigterm_handler)
```

Tip: have the handler also flip your readiness endpoint to failing — it removes the pod from endpoints faster on ingress controllers that watch readiness.

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

5s covers kube-proxy in most clusters. Use 10–15s with cloud load balancers, large clusters, or ingress controllers that sync endpoints slowly.

### Choosing terminationGracePeriodSeconds

| Workload | Recommended | Reason |
|----------|-------------|--------|
| Stateless web server / NGINX | 10–30s | Fast connection drain |
| API gateway | 30–60s | Wait for in-flight requests |
| Database | 60–120s | WAL flush, connection close |
| Message queue consumer | 60–300s | Finish processing current batch |
| WebSocket / gRPC streaming | 90–300s | Clients reconnect slowly |
| Long batch task | 600s+ | Checkpoint or finish work |

Rule: `terminationGracePeriodSeconds` ≥ preStop + max drain time + ~5–10s buffer. Don't overshoot — rollouts and node drains wait up to this long per pod.

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

### Draining Patterns Beyond HTTP

Not every workload is a simple HTTP server — these need their own drain signal instead of (or in addition to) SIGTERM:

```yaml
# Queue worker: stop pulling new jobs, wait for in-flight jobs to finish
lifecycle:
  preStop:
    exec:
      command:
        - /bin/sh
        - -c
        - |
          curl -X POST localhost:8080/admin/drain
          while curl -s localhost:8080/admin/jobs | grep -q '"active":true'; do
            sleep 5
          done
```

```yaml
# WebSocket server: stop accepting connections, send close frames,
# wait for clients to actually disconnect before the grace period expires
lifecycle:
  preStop:
    exec:
      command:
        - /bin/sh
        - -c
        - |
          curl -X POST localhost:8080/admin/stop-accept
          curl -X POST localhost:8080/admin/graceful-close
          for i in $(seq 1 18); do
            [ "$(curl -s localhost:8080/admin/connections)" -eq 0 ] && exit 0
            sleep 5
          done
```

WebSocket and queue-worker drains need a much larger `terminationGracePeriodSeconds` (90–120s) than a typical HTTP server (30–60s) — clients take longer to notice a close frame than an HTTP request takes to complete.

### Override the Grace Period with kubectl

```bash
kubectl delete pod my-pod                   # uses the pod's terminationGracePeriodSeconds
kubectl delete pod my-pod --grace-period=60 # custom grace period
kubectl delete pod my-pod --grace-period=0 --force  # immediate SIGKILL — stuck pods only
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

# Did the last run exit cleanly or get SIGKILLed?
kubectl get pod my-app-abc123 -o jsonpath='{.status.containerStatuses[0].lastState.terminated}'
# exitCode 143 = exited on SIGTERM, 137 = SIGKILL (grace period exceeded or OOM)
```

## Common Issues

**SIGTERM not reaching the app**

Shell scripts as entrypoint (`/bin/sh -c "my-app"`, or shell-form `CMD my-app`) don't forward signals. Use `exec` form: `CMD ["my-app"]`, `exec my-app` in shell scripts, or a tiny init like `tini`.

**502s during deployment despite preStop**

`maxUnavailable: 1` (default) removes pods before new ones are ready. Set `maxUnavailable: 0` and `maxSurge: 1`.

**Pod killed before drain completes**

`terminationGracePeriodSeconds` is the TOTAL budget including preStop. If preStop sleeps 30s and app needs 30s to drain, you need ≥60s total.

**Pod hangs for the full 30s on every delete**

The app ignores SIGTERM, so kubelet waits the entire grace period before SIGKILL. Add a SIGTERM handler.

**Sidecar exits before the main container**

Use native sidecars (`initContainers` with `restartPolicy: Always`) — they are terminated after the main containers.

**Rollouts or node drains are slow**

Each terminating pod may wait its full grace period. Right-size it, and pair with a PodDisruptionBudget for voluntary disruptions.

## Frequently Asked Questions

### What is the default terminationGracePeriodSeconds in Kubernetes?

**30 seconds.** If you omit the field, Kubernetes uses 30. After SIGTERM (and any preStop hook), kubelet waits up to 30s, then sends SIGKILL.

### Where do I set terminationGracePeriodSeconds in a Deployment?

At pod level: `spec.template.spec.terminationGracePeriodSeconds`, alongside `containers`. It applies to all containers in the pod. (Probes also accept a `terminationGracePeriodSeconds` that only applies when a liveness/startup probe failure kills the container.)

### How does graceful shutdown work in Kubernetes?

The pod goes `Terminating`, is removed from Service endpoints, runs its `preStop` hook, receives SIGTERM, and has until `terminationGracePeriodSeconds` expires to exit before SIGKILL. Your app must catch SIGTERM, stop accepting new work, and drain.

### Why use a preStop sleep?

Endpoint removal is asynchronous and races with SIGTERM. A `preStop` sleep of 5–10s keeps the pod serving while kube-proxy and ingress controllers drop it, preventing 502s during rollouts. On 1.30+ use `preStop.sleep.seconds` instead of `sh -c "sleep 5"`.

### What happens if my app ignores SIGTERM?

It keeps running until the grace period expires, then gets SIGKILL (exit code 137), which cannot be caught — in-flight requests and unflushed data are lost.

### Does the grace period include the preStop hook?

Yes. The countdown starts when the pod is marked for deletion, so preStop time is subtracted from the time your app has after SIGTERM.

## Best Practices

- **Always add `preStop: sleep 5`** — allows endpoint removal propagation
- **Set `maxUnavailable: 0`** for zero-downtime deployments
- **Handle SIGTERM in your app** — don't rely on SIGKILL
- **`terminationGracePeriodSeconds` = preStop + drain time + buffer**
- **Use `exec` form in Dockerfile CMD** — ensures PID 1 receives signals
- **Test with traffic during rollout** — verify zero 5xx errors
- **Add a PodDisruptionBudget** — protects capacity during node drains

## Key Takeaways

- SIGTERM and endpoint removal happen in parallel — `preStop: sleep 5` bridges the gap
- `terminationGracePeriodSeconds` defaults to 30s and is the total budget (preStop + app drain + buffer)
- Always use `maxUnavailable: 0` for zero-downtime deployments
- Handle SIGTERM in your app to drain connections gracefully
- Shell entrypoints (`sh -c`) swallow signals — use exec form
