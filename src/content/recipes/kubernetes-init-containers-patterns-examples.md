---
title: "Kubernetes Init Containers Patterns and Examples"
description: "Use Kubernetes init containers for pod initialization. Wait for dependencies, clone Git repos, setup configuration, database migrations, certificate"
tags:
  - "init-containers"
  - "pod-lifecycle"
  - "patterns"
  - "dependencies"
  - "configuration"
category: "deployments"
publishDate: "2026-06-01"
author: "Luca Berton"
difficulty: "beginner"
relatedRecipes:
  - "kubernetes-probes-liveness-readiness"
  - "kubernetes-graceful-shutdown-pod-termination"
---

> 💡 **Quick Answer:** Init containers run before app containers, executing sequentially to completion. Use them to: wait for dependencies (`nslookup` until service resolves), run database migrations, clone code, fetch secrets, or fix file permissions. They share volumes with app containers but have separate images and resource limits.

## The Problem

- Application crashes on startup because the database isn't ready yet
- Need to run migrations before the app starts
- Need to clone a Git repo or fetch config before the main container uses it
- File permissions on mounted volumes are wrong for the app user
- Want to separate initialization concerns from the application image

## The Solution

### Wait for Dependency

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: api-server
spec:
  template:
    spec:
      initContainers:
        # Wait until database service is resolvable
        - name: wait-for-db
          image: busybox:1.36
          command:
            - sh
            - -c
            - |
              until nslookup postgres.production.svc.cluster.local; do
                echo "Waiting for database..."
                sleep 2
              done
              echo "Database is ready!"

        # Wait until database accepts connections
        - name: wait-for-db-ready
          image: postgres:16-alpine
          command:
            - sh
            - -c
            - |
              until pg_isready -h postgres.production -p 5432; do
                echo "Database not accepting connections..."
                sleep 2
              done

      containers:
        - name: api
          image: registry.example.com/api:v2
```

### Database Migration

```yaml
spec:
  initContainers:
    - name: migrate
      image: registry.example.com/api:v2    # Same image as app
      command: ["./migrate", "--up"]
      env:
        - name: DATABASE_URL
          valueFrom:
            secretKeyRef:
              name: db-credentials
              key: url
      resources:
        requests:
          cpu: "100m"
          memory: "128Mi"
        limits:
          cpu: "500m"
          memory: "256Mi"
  containers:
    - name: api
      image: registry.example.com/api:v2
```

### Clone Git Repository

```yaml
spec:
  initContainers:
    - name: git-clone
      image: alpine/git:2.43
      command:
        - git
        - clone
        - --single-branch
        - --branch=main
        - --depth=1
        - https://github.com/example/config-repo.git
        - /config
      volumeMounts:
        - name: config-volume
          mountPath: /config
  containers:
    - name: app
      image: registry.example.com/app:v1
      volumeMounts:
        - name: config-volume
          mountPath: /app/config
          readOnly: true
  volumes:
    - name: config-volume
      emptyDir: {}
```

### Fix Volume Permissions

```yaml
spec:
  initContainers:
    - name: fix-permissions
      image: busybox:1.36
      command: ["sh", "-c", "chown -R 1000:1000 /data && chmod 750 /data"]
      securityContext:
        runAsUser: 0    # Root needed to chown
      volumeMounts:
        - name: data-volume
          mountPath: /data
  containers:
    - name: app
      image: registry.example.com/app:v1
      securityContext:
        runAsUser: 1000
      volumeMounts:
        - name: data-volume
          mountPath: /data
  volumes:
    - name: data-volume
      persistentVolumeClaim:
        claimName: app-data
```

### Fetch Certificates/Secrets

```yaml
spec:
  initContainers:
    - name: fetch-certs
      image: bitnami/kubectl:1.31
      command:
        - sh
        - -c
        - |
          kubectl get secret tls-cert -n production \
            -o jsonpath='{.data.tls\.crt}' | base64 -d > /certs/tls.crt
          kubectl get secret tls-cert -n production \
            -o jsonpath='{.data.tls\.key}' | base64 -d > /certs/tls.key
          chmod 400 /certs/tls.key
      volumeMounts:
        - name: certs
          mountPath: /certs
  containers:
    - name: nginx
      image: nginx:1.25
      volumeMounts:
        - name: certs
          mountPath: /etc/nginx/ssl
          readOnly: true
  volumes:
    - name: certs
      emptyDir:
        medium: Memory    # tmpfs — never written to disk
```

### Multiple Init Containers (Sequential)

```yaml
spec:
  initContainers:
    # Runs first
    - name: wait-for-cache
      image: busybox:1.36
      command: ["sh", "-c", "until nc -z redis.production 6379; do sleep 1; done"]

    # Runs second (after first completes)
    - name: wait-for-db
      image: busybox:1.36
      command: ["sh", "-c", "until nc -z postgres.production 5432; do sleep 1; done"]

    # Runs third
    - name: migrate
      image: registry.example.com/api:v2
      command: ["./migrate", "--up"]

    # Runs fourth
    - name: seed-cache
      image: registry.example.com/api:v2
      command: ["./seed-cache"]

  # Only starts after ALL init containers succeed
  containers:
    - name: api
      image: registry.example.com/api:v2
```

### Download and Extract

```yaml
spec:
  initContainers:
    - name: download-model
      image: curlimages/curl:8.5.0
      command:
        - sh
        - -c
        - |
          curl -L -o /models/model.bin \
            "https://models.example.com/llm/v1/model.bin"
          echo "Model downloaded: $(ls -lh /models/model.bin)"
      volumeMounts:
        - name: model-volume
          mountPath: /models
  containers:
    - name: inference
      image: registry.example.com/inference:v1
      volumeMounts:
        - name: model-volume
          mountPath: /models
          readOnly: true
  volumes:
    - name: model-volume
      emptyDir:
        sizeLimit: 10Gi
```

## Common Issues

### Init container keeps restarting (CrashLoopBackOff)
- **Cause**: Command failing (dependency not available yet); exit code != 0
- **Fix**: Add retry loop with `until`; check init container logs: `kubectl logs <pod> -c <init-container>`

### Pod stuck in "Init:0/3" forever
- **Cause**: First init container never completes (infinite wait, wrong hostname)
- **Fix**: Check: `kubectl describe pod`; verify service DNS resolves; add timeout to wait loops

### Init container can't access volume
- **Cause**: Volume not mounted in init container spec
- **Fix**: Add `volumeMounts` to init container (same as app container)

### Init containers consume too many resources
- **Cause**: No resource limits set; init container doing heavy computation
- **Fix**: Set `resources.limits`; init container resources are separate from app container

## Best Practices

1. **Keep init containers fast** — long init = long pod startup time
2. **Add timeouts to wait loops** — don't wait forever (exit non-zero to trigger restart)
3. **Use lightweight images** — `busybox`, `alpine` for simple tasks
4. **Share data via emptyDir** — init writes, app reads (same volume)
5. **Set resource limits** — init containers have separate resource accounting
6. **Log progress** — `echo` statements help debugging stuck init containers
7. **Use readiness probes instead** — for runtime dependencies that may flap

## Key Takeaways

- Init containers run sequentially before app containers, must complete successfully
- Pod stays in `Init:X/Y` status until all init containers finish
- Common patterns: wait for deps, migrate DB, clone repos, fix permissions, fetch config
- Share data between init and app containers via shared volumes (emptyDir)
- Init containers have their own images, commands, and resource limits
- Sequential execution: second init waits for first to exit 0
- `kubectl logs <pod> -c <init-name>` — debug specific init container
