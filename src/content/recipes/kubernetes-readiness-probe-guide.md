---
title: "Readiness Probe Kubernetes Guide"
description: "Configure readiness probes correctly on Kubernetes. HTTP, TCP, exec probes, failure threshold tuning, and why readiness probes should never check databases."
publishDate: "2026-04-25"
author: "Luca Berton"
category: "deployments"
difficulty: "beginner"
timeToComplete: "10 minutes"
kubernetesVersion: "1.28+"
tags:
  - "readiness-probe"
  - "health-check"
  - "http-get"
  - "tcp-socket"
relatedRecipes:
  - "kubernetes-readiness-liveness-startup"
  - "kubernetes-pod-security-standards"
  - "canary-deployment-gateway-api-traffic-splitting"
---

> 💡 **Quick Answer:** Configure readiness probes correctly on Kubernetes. HTTP, TCP, exec probes, failure threshold tuning, and why readiness probes should never check databases.

## The Problem

Without a readiness probe, Kubernetes considers a pod ready to serve traffic the moment its container starts — before it's actually loaded config, warmed a cache, or connected to a database. Traffic arrives at a pod that can't yet handle it, producing errors during every rollout and every cold start.

## The Solution

### HTTP, TCP, and Exec Readiness Probes

```yaml
readinessProbe:
  httpGet:
    path: /ready
    port: 8080
  initialDelaySeconds: 5
  periodSeconds: 5
  timeoutSeconds: 3
  failureThreshold: 3
```

```yaml
# TCP — for non-HTTP services
readinessProbe:
  tcpSocket: {port: 3306}
```

```yaml
# Exec — for custom readiness logic
readinessProbe:
  exec: {command: ["cat", "/tmp/ready"]}
```

### Probe Parameters

| Parameter | Default | Description |
|-----------|---------|-------------|
| `initialDelaySeconds` | 0 | Wait before the first probe |
| `periodSeconds` | 10 | How often to probe |
| `timeoutSeconds` | 1 | Probe timeout |
| `successThreshold` | 1 | Consecutive successes to mark ready |
| `failureThreshold` | 3 | Consecutive failures to mark not-ready |

### What Belongs in a Readiness Endpoint

```javascript
// /ready — checks dependencies, unlike liveness
app.get('/ready', async (req, res) => {
  try {
    await db.ping();
    await redis.ping();
    res.status(200).json({ status: 'ready' });
  } catch (error) {
    res.status(503).json({ status: 'not ready', error: error.message });
  }
});
```

## Common Issues

| Issue | Cause | Fix |
|-------|-------|-----|
| Errors during every rollout | No readiness probe — traffic arrives before the app can serve it | Add a readiness probe that checks real serving capacity (DB/cache connections) |
| Pod flaps in and out of the Service | `failureThreshold: 1` — a single transient blip removes it from rotation | Use `failureThreshold: 3` or higher to tolerate brief hiccups |
| Readiness never passes | Endpoint checks a condition that's never true in normal operation | Verify the readiness condition is actually reachable during steady-state, not just at one lifecycle moment |
| Readiness probe times out under load | `timeoutSeconds` too low, or the endpoint itself does expensive work | Keep the readiness check itself cheap — a dependency ping, not a full query; raise `timeoutSeconds` if needed |

## Best Practices

- **Never check a database directly in a *liveness* probe** — that's what readiness is for. A liveness probe that queries the DB restarts every pod the moment the DB blips, turning a transient outage into a thundering-herd restart storm
- **Return 503, not 200, when not ready** — during startup, shutdown, or a lost dependency, an explicit 503 is what removes the pod from Service endpoints
- **Set `failureThreshold` ≥ 3** — tolerate a couple of missed checks before pulling a pod out of rotation
- **Use readiness for graceful shutdown too** — fail readiness as soon as SIGTERM arrives so no new traffic routes to a terminating pod, even before it stops accepting connections
- **Keep the readiness check itself fast and cheap** — a connection ping, not a full query against every dependency

## Key Takeaways

- A missing readiness probe means Kubernetes routes traffic to a pod the instant its container starts, not when it's actually able to serve
- Readiness failure removes a pod from Service endpoints without restarting it — the opposite of a liveness failure
- Readiness endpoints should check real dependencies (DB, cache); liveness endpoints should not
- `failureThreshold` and `periodSeconds` together set your tolerance for transient blips before a pod is pulled from rotation
- Pairing readiness with graceful shutdown (fail readiness on SIGTERM) closes the gap where traffic still arrives during termination
