---
title: "K8s Sidecar Containers: Native Support"
description: "Configure Kubernetes native sidecar containers with restartPolicy Always in initContainers. Logging sidecars, service mesh proxies, and lifecycle management."
publishDate: "2026-05-02"
author: "Luca Berton"
category: "deployments"
difficulty: "intermediate"
timeToComplete: "10 minutes"
kubernetesVersion: "1.28+"
tags:
  - "sidecar"
  - "containers"
  - "pods"
  - "service-mesh"
  - "logging"
relatedRecipes:
  - "kubernetes-init-containers-guide"
  - "kubernetes-deployment-rolling-update"
  - "kubernetes-service-mesh-comparison"
---

> 💡 **Quick Answer:** Kubernetes 1.28+ supports native sidecar containers using `initContainers` with `restartPolicy: Always`. They start before main containers, run alongside them, and shut down after main containers exit. This fixes the long-standing issue of sidecar lifecycle management — sidecars no longer prevent Job completion or delay pod termination.

## The Problem

Traditional sidecar pattern (multiple containers in `containers[]`) has issues:

- **Jobs never complete** — sidecar keeps running after main container exits
- **No startup ordering** — sidecar and app start simultaneously
- **Shutdown race conditions** — app might exit before sidecar finishes flushing
- **No guaranteed sidecar availability** — app may start before sidecar is ready

## The Solution

### Native Sidecar (K8s 1.28+)

```yaml
apiVersion: v1
kind: Pod
metadata:
  name: app-with-sidecar
spec:
  initContainers:
  # Native sidecar — starts first, runs alongside main containers
  - name: log-collector
    image: fluent/fluent-bit:3.0
    restartPolicy: Always    # ← This makes it a sidecar
    volumeMounts:
    - name: logs
      mountPath: /var/log/app
    resources:
      requests:
        cpu: 50m
        memory: 64Mi
  
  containers:
  - name: app
    image: myapp:v2
    volumeMounts:
    - name: logs
      mountPath: /var/log/app
  
  volumes:
  - name: logs
    emptyDir: {}
```

### Lifecycle Order

```
Pod Created:
1. Init containers run sequentially (traditional)
2. Sidecar init containers start (restartPolicy: Always)
3. Wait for sidecar readiness probe (if defined)
4. Main containers start
5. All run together...

Pod Terminating:
1. Main containers receive SIGTERM
2. Main containers exit
3. Sidecar containers receive SIGTERM (AFTER main exits)
4. Pod terminates

# Key difference from old pattern:
# Old: sidecars and main containers get SIGTERM simultaneously
# New: sidecars get SIGTERM AFTER main containers exit
```

### Service Mesh Proxy Sidecar

```yaml
apiVersion: v1
kind: Pod
metadata:
  name: app
spec:
  initContainers:
  # Envoy/Istio proxy as native sidecar
  - name: proxy
    image: envoyproxy/envoy:v1.30
    restartPolicy: Always
    ports:
    - containerPort: 15001
    readinessProbe:
      httpGet:
        path: /ready
        port: 15021
      initialDelaySeconds: 1
      periodSeconds: 2
    resources:
      requests:
        cpu: 100m
        memory: 128Mi
  
  containers:
  - name: app
    image: myapp:v2
    ports:
    - containerPort: 8080
    # App starts AFTER proxy is ready
    # App exits BEFORE proxy — proxy can drain connections
```

### Job with Sidecar (Fixed!)

```yaml
# Before native sidecars: Job never completes because sidecar keeps running
# With native sidecars: Sidecar exits after main container completes

apiVersion: batch/v1
kind: Job
metadata:
  name: data-export
spec:
  template:
    spec:
      initContainers:
      - name: cloud-sql-proxy        # Database proxy sidecar
        image: gcr.io/cloud-sql-connectors/cloud-sql-proxy:2.8
        restartPolicy: Always         # Native sidecar
        args: ["--port=5432", "project:region:instance"]
      
      containers:
      - name: exporter
        image: myapp:v2
        command: ["./export-data"]    # Runs and exits
      
      restartPolicy: Never
      
# Lifecycle:
# 1. cloud-sql-proxy starts
# 2. exporter runs, connects to proxy, exports data, exits
# 3. cloud-sql-proxy receives SIGTERM, exits
# 4. Job marked Complete ✅
```

### Old vs New Sidecar Pattern

```yaml
# OLD pattern (pre-1.28) — DON'T use for new deployments
spec:
  containers:
  - name: app
    image: myapp:v2
  - name: sidecar            # Regular container
    image: fluent-bit:3.0
  # Problems: no ordering, Job never completes, shutdown race

# NEW pattern (1.28+) — USE THIS
spec:
  initContainers:
  - name: sidecar
    image: fluent-bit:3.0
    restartPolicy: Always     # Makes it a sidecar
  containers:
  - name: app
    image: myapp:v2
  # Benefits: ordered startup, graceful shutdown, Jobs complete
```

### Multiple Sidecars

```yaml
spec:
  initContainers:
  # Sidecars start in order, all must be ready before main containers
  - name: proxy
    image: envoyproxy/envoy:v1.30
    restartPolicy: Always
    readinessProbe:
      httpGet:
        path: /ready
        port: 15021
  
  - name: log-agent
    image: fluent/fluent-bit:3.0
    restartPolicy: Always
  
  # Traditional init container (runs once, then exits)
  - name: db-migrate
    image: myapp:v2
    command: ["./migrate"]
    # No restartPolicy: Always → runs once before sidecars start app
  
  containers:
  - name: app
    image: myapp:v2
```

## Common Issues

**Sidecar not starting — "initContainers still running"**

Sidecar readiness probe failing. Check logs: `kubectl logs <pod> -c <sidecar-name>`. Remove or fix readiness probe.

**Feature not available on cluster**

Native sidecars require K8s 1.28+ with `SidecarContainers` feature gate enabled (GA in 1.29). Check: `kubectl version`.

**Sidecar consuming too many resources**

Set resource requests/limits on sidecar init containers — they count toward pod total resources.

## Best Practices

- **Use native sidecars (1.28+)** over regular multi-container pods
- **Add readiness probes to sidecars** — main containers wait for sidecar readiness
- **Keep sidecar resources small** — they run on every pod instance
- **Use for: proxies, log collectors, config reloaders, auth agents**
- **Don't use for: batch processing, one-off tasks (use init containers)**

## Key Takeaways

- Native sidecars use `initContainers` with `restartPolicy: Always`
- Start before main containers, stop after — correct lifecycle ordering
- Fixes Job completion issue with traditional sidecar pattern
- Main containers wait for sidecar readiness before starting
- Available in K8s 1.28+ (feature gate), GA in 1.29
