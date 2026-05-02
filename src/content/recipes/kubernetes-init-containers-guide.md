---
title: "K8s Init Containers: Setup Before Main"
description: "Use Kubernetes init containers to run setup tasks before main containers start. Database migrations, config fetching, dependency checks, and ordering."
publishDate: "2026-05-02"
author: "Luca Berton"
category: "deployments"
difficulty: "beginner"
timeToComplete: "8 minutes"
kubernetesVersion: "1.28+"
tags:
  - "init-containers"
  - "pods"
  - "deployments"
  - "cka"
relatedRecipes:
  - "kubernetes-deployment-rolling-update"
  - "kubernetes-configmap-guide"
  - "kubernetes-graceful-shutdown-guide"
  - "kubernetes-sidecar-containers-guide"
---

> 💡 **Quick Answer:** Init containers run to completion before main containers start. Define in `spec.initContainers[]` — they execute sequentially. Use cases: wait for a database to be ready (`nslookup db-service`), run database migrations, download config files, or set filesystem permissions. If any init container fails, the pod restarts.

## The Problem

Applications often need setup before they can start:

- Database must be reachable before the app connects
- Config files must be downloaded from external sources
- Filesystem permissions must be set
- Schema migrations must run before the new version starts

## The Solution

### Basic Init Container

```yaml
apiVersion: v1
kind: Pod
metadata:
  name: web-app
spec:
  initContainers:
  # Init 1: Wait for database
  - name: wait-for-db
    image: busybox:1.36
    command: ['sh', '-c', 'until nslookup db-service.default.svc.cluster.local; do echo waiting for db; sleep 2; done']
  
  # Init 2: Run migrations (runs after init 1 completes)
  - name: run-migrations
    image: myapp:v2
    command: ['./migrate', '--target', 'latest']
    env:
    - name: DATABASE_URL
      valueFrom:
        secretKeyRef:
          name: db-creds
          key: url
  
  containers:
  - name: web
    image: myapp:v2
    ports:
    - containerPort: 8080
```

### Common Patterns

```yaml
# Download config from external source
initContainers:
- name: fetch-config
  image: curlimages/curl
  command: ['curl', '-o', '/config/app.yaml', 'https://config.example.com/app.yaml']
  volumeMounts:
  - name: config
    mountPath: /config

# Set file permissions
- name: fix-permissions
  image: busybox:1.36
  command: ['sh', '-c', 'chown -R 1000:1000 /data']
  volumeMounts:
  - name: data
    mountPath: /data

# Wait for another service
- name: wait-for-cache
  image: busybox:1.36
  command: ['sh', '-c', 'until nc -z redis-service 6379; do sleep 1; done']

# Clone git repo
- name: clone-repo
  image: alpine/git
  command: ['git', 'clone', 'https://github.com/example/configs.git', '/repo']
  volumeMounts:
  - name: repo
    mountPath: /repo
```

### Init vs Sidecar vs Main

| Feature | Init Container | Sidecar (K8s 1.28+) | Main Container |
|---------|---------------|---------------------|----------------|
| Runs before main | ✅ Sequential | ✅ Starts before | N/A |
| Runs continuously | ❌ Exits on completion | ✅ | ✅ |
| Shares volumes | ✅ | ✅ | ✅ |
| Restarts pod on failure | ✅ | ❌ (restarts itself) | Depends on policy |
| Resource requests | Separate (max of inits) | Added to pod total | Added to pod total |

### Resource Handling

```yaml
# Pod effective resources = max(sum(containers), max(initContainers))
initContainers:
- name: heavy-init
  resources:
    requests:
      cpu: "2"         # Needs 2 CPU during init
      memory: 2Gi
containers:
- name: app
  resources:
    requests:
      cpu: 500m        # Only 500m during runtime
      memory: 256Mi

# Effective: 2 CPU during init, 500m during runtime
# Scheduler reserves max(2, 0.5) = 2 CPU for scheduling
```

## Common Issues

**Init container stuck — pod shows Init:0/2**

Init container failing or waiting forever. Check logs: `kubectl logs <pod> -c <init-container-name>`.

**Init containers re-run on pod restart**

By design — init containers always re-run from scratch. Make them idempotent (safe to run multiple times).

**DNS not resolving in init container**

CoreDNS may not be ready yet. Add a retry loop with sleep instead of a one-shot nslookup.

## Best Practices

- **Make init containers idempotent** — they may run multiple times
- **Set timeouts on wait loops** — don't wait forever for dependencies
- **Use minimal images** — busybox/curl for simple tasks, not the full app image
- **Share data via emptyDir volumes** — init containers write, main containers read
- **Use native sidecar containers** (K8s 1.28+) for continuous helper processes

## Key Takeaways

- Init containers run sequentially before main containers start
- If any init container fails, the entire pod restarts
- Common uses: dependency checks, migrations, config download, permission fixes
- Resource requests are calculated as max(inits) vs sum(containers)
- Init containers must be idempotent — pod restarts re-run all inits
