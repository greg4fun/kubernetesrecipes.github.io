---
title: "Kubernetes Multi-Container Pod Patterns"
description: "Implement multi-container pod patterns in Kubernetes: sidecar for logging and proxying, ambassador for outbound connections, adapter for format"
tags:
  - "sidecar"
  - "ambassador"
  - "adapter"
  - "design-patterns"
  - "multi-container"
category: "deployments"
publishDate: "2026-06-01"
author: "Luca Berton"
difficulty: "intermediate"
relatedRecipes:
  - "kubernetes-init-containers-patterns-examples"
  - "linkerd-service-mesh-mtls-kubernetes"
---

> 💡 **Quick Answer:** Multi-container pods share network (localhost) and storage (volumes). Three patterns: **Sidecar** — extends/enhances main container (log shipper, proxy, config reloader). **Ambassador** — proxies outbound connections (connection pooling, service discovery). **Adapter** — transforms output format (metrics exporter, log formatter). Containers in a pod always co-schedule and co-locate.

## The Problem

- Need to add logging/monitoring to apps without changing application code
- Want to proxy connections to external services with retry/circuit-breaking
- Need to transform metrics format from application-specific to Prometheus
- Config files need live reloading without application restart
- Want separation of concerns between application logic and infrastructure

## The Solution

### Sidecar Pattern: Log Shipper

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: web-app
spec:
  template:
    spec:
      containers:
        # Main application
        - name: app
          image: registry.example.com/web-app:v2
          ports:
            - containerPort: 8080
          volumeMounts:
            - name: logs
              mountPath: /var/log/app

        # Sidecar: ships logs to central system
        - name: log-shipper
          image: fluent/fluent-bit:3.0
          volumeMounts:
            - name: logs
              mountPath: /var/log/app
              readOnly: true
            - name: fluent-config
              mountPath: /fluent-bit/etc/
          resources:
            requests:
              cpu: "50m"
              memory: "64Mi"

      volumes:
        - name: logs
          emptyDir: {}
        - name: fluent-config
          configMap:
            name: fluent-bit-config
```

### Sidecar Pattern: Config Reloader

```yaml
spec:
  containers:
    - name: nginx
      image: nginx:1.25
      volumeMounts:
        - name: config
          mountPath: /etc/nginx/conf.d

    # Sidecar: watches ConfigMap and reloads nginx
    - name: config-reloader
      image: jimmidyson/configmap-reload:v0.12.0
      args:
        - --volume-dir=/config
        - --webhook-url=http://localhost:80/-/reload
      volumeMounts:
        - name: config
          mountPath: /config
          readOnly: true

  volumes:
    - name: config
      configMap:
        name: nginx-config
```

### Sidecar Pattern: TLS Proxy (Native Sidecar K8s 1.29+)

```yaml
spec:
  # Native sidecar container (K8s 1.29+) — starts before, stops after main
  initContainers:
    - name: tls-proxy
      image: envoyproxy/envoy:v1.30
      restartPolicy: Always    # Makes it a native sidecar (stays running)
      ports:
        - containerPort: 8443
      volumeMounts:
        - name: certs
          mountPath: /etc/certs
          readOnly: true

  containers:
    - name: app
      image: registry.example.com/app:v2
      # App listens on localhost:8080 (plain HTTP)
      # Envoy sidecar terminates TLS and forwards to app
      env:
        - name: PORT
          value: "8080"
```

### Ambassador Pattern: Connection Pooling

```yaml
spec:
  containers:
    - name: app
      image: registry.example.com/app:v2
      env:
        # App connects to localhost — ambassador handles real connection
        - name: DATABASE_HOST
          value: "localhost"
        - name: DATABASE_PORT
          value: "5432"

    # Ambassador: connection pooler for database
    - name: pgbouncer
      image: bitnami/pgbouncer:1.22
      ports:
        - containerPort: 5432
      env:
        - name: POSTGRESQL_HOST
          value: "postgres.production.svc"
        - name: POSTGRESQL_PORT
          value: "5432"
        - name: PGBOUNCER_POOL_MODE
          value: "transaction"
        - name: PGBOUNCER_MAX_CLIENT_CONN
          value: "100"
        - name: PGBOUNCER_DEFAULT_POOL_SIZE
          value: "20"
      resources:
        requests:
          cpu: "50m"
          memory: "64Mi"
```

### Ambassador Pattern: Rate-Limited API Client

```yaml
spec:
  containers:
    - name: app
      image: registry.example.com/app:v2
      env:
        - name: API_ENDPOINT
          value: "http://localhost:9090/api"    # Via ambassador

    # Ambassador: rate limiter + retry for external API
    - name: api-proxy
      image: envoyproxy/envoy:v1.30
      ports:
        - containerPort: 9090
      volumeMounts:
        - name: envoy-config
          mountPath: /etc/envoy
      # Envoy config: rate limit + circuit breaker + retry to external API
```

### Adapter Pattern: Prometheus Metrics Exporter

```yaml
spec:
  containers:
    - name: app
      image: registry.example.com/legacy-app:v1
      # App exposes custom /stats endpoint (not Prometheus format)

    # Adapter: converts app metrics to Prometheus format
    - name: metrics-adapter
      image: registry.example.com/stats-exporter:v1
      ports:
        - containerPort: 9090
          name: metrics
      args:
        - --source=http://localhost:8080/stats
        - --format=prometheus
        - --listen=:9090
      resources:
        requests:
          cpu: "25m"
          memory: "32Mi"
```

### Adapter Pattern: Log Format Transformer

```yaml
spec:
  containers:
    - name: app
      image: registry.example.com/legacy-app:v1
      # App writes logs in custom format to shared volume
      volumeMounts:
        - name: logs
          mountPath: /var/log/app

    # Adapter: transforms log format and writes to stdout (for K8s log collection)
    - name: log-adapter
      image: busybox:1.36
      command:
        - sh
        - -c
        - |
          tail -F /var/log/app/app.log | while read line; do
            echo "{\"timestamp\":\"$(date -Iseconds)\",\"message\":\"$line\",\"app\":\"legacy-app\"}"
          done
      volumeMounts:
        - name: logs
          mountPath: /var/log/app
          readOnly: true

  volumes:
    - name: logs
      emptyDir: {}
```

### Pattern Comparison

```text
Pattern     │ Direction    │ Purpose                     │ Example
────────────┼──────────────┼─────────────────────────────┼─────────────────
Sidecar     │ Alongside    │ Enhance main container      │ Log shipper, proxy
Ambassador  │ Outbound     │ Proxy external connections  │ Connection pool
Adapter     │ Transform    │ Convert output format       │ Metrics exporter
────────────┴──────────────┴─────────────────────────────┴─────────────────

All patterns share:
- Same network namespace (localhost communication)
- Same volumes (shared filesystem)
- Same lifecycle (co-scheduled, co-located)
- Independent images and resource limits
```

### Shared Volume and localhost Communication

Every pattern above relies on the same two primitives — a shared `emptyDir` for file-based handoff, and `localhost` for network calls between containers in the pod:

```yaml
spec:
  containers:
    - name: producer
      image: busybox:1.36
      command: ["sh", "-c", "while true; do date >> /shared/data.txt; sleep 10; done"]
      volumeMounts: [{name: shared-data, mountPath: /shared}]
    - name: consumer
      image: busybox:1.36
      command: ["sh", "-c", "tail -F /shared/data.txt"]
      volumeMounts: [{name: shared-data, mountPath: /shared, readOnly: true}]
  volumes:
    - name: shared-data
      emptyDir: {}
```

```bash
# Verify all containers are running, and inspect a specific one
kubectl get pod app-with-log-sidecar -o jsonpath='{.status.containerStatuses[*].name}'
kubectl logs app-with-log-sidecar -c log-shipper
kubectl exec app-with-log-sidecar -c main-app -- cat /var/log/app/access.log
```

## Common Issues

### Sidecar starting after main container (race condition)
- **Cause**: Standard containers start simultaneously — no ordering guarantee
- **Fix**: Use native sidecar (K8s 1.29+, `restartPolicy: Always` in initContainers); or add readiness check

### Main container exiting but sidecar keeps pod alive
- **Cause**: Pod only terminates when ALL containers exit
- **Fix**: Native sidecars (1.29+) shut down after main; or add lifecycle hook to signal sidecar

### Resource limits not accounting for sidecars
- **Cause**: Total pod resources = sum of all containers; quotas apply to pod total
- **Fix**: Account for sidecar resources in capacity planning; set appropriate limits on sidecars

## Best Practices

1. **Keep sidecars lightweight** — they run on every pod instance; minimize CPU/memory
2. **Use native sidecars (1.29+)** — guaranteed startup order and proper shutdown
3. **Share data via emptyDir** — fast, no persistence needed for temp data
4. **Communicate via localhost** — same network namespace, no service discovery needed
5. **Separate resource limits** — sidecar shouldn't compete with main container
6. **One responsibility per container** — separation of concerns
7. **Consider service mesh instead** — Istio/Linkerd automate sidecar proxy injection

## Key Takeaways

- Multi-container pods share: network (localhost), storage (volumes), lifecycle
- Sidecar: enhances/extends (logging, proxying, config reload)
- Ambassador: proxies outbound connections (pooling, rate limiting, circuit breaking)
- Adapter: transforms output (metrics format, log structure, data conversion)
- Native sidecars (K8s 1.29+): `restartPolicy: Always` in initContainers — proper ordering
- Containers communicate via localhost — no networking overhead
- Service meshes (Istio, Linkerd) are automated sidecar implementations
