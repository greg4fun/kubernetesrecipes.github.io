---
title: "How to Use Init Containers for Dependencies"
description: "Master Kubernetes init containers to handle dependencies, setup tasks, and pre-flight checks before your main application starts."
category: "deployments"
difficulty: "beginner"
timeToComplete: "15 minutes"
kubernetesVersion: "1.28+"
prerequisites:
  - "A running Kubernetes cluster"
  - "kubectl configured to access your cluster"
relatedRecipes:
  - "liveness-readiness-probes"
  - "configmap-secrets-management"
tags:
  - init-containers
  - dependencies
  - startup
  - pods
  - configuration
publishDate: "2026-01-21"
author: "Luca Berton"
---

## The Problem

Your application needs certain conditions to be met before starting: databases must be ready, configuration files need to be generated, or data must be downloaded.

## The Solution

Use init containers to run setup tasks sequentially before the main application container starts.

## How Init Containers Work

1. Init containers run **sequentially** (one after another)
2. Each must complete **successfully** before the next starts
3. Main containers start only after **all** init containers succeed
4. If an init container fails, the pod is **restarted** (respecting RestartPolicy)

## Basic Example

```yaml
apiVersion: v1
kind: Pod
metadata:
  name: myapp
spec:
  initContainers:
  - name: init-db-ready
    image: busybox:1.36
    command: ['sh', '-c', 'until nc -z postgres 5432; do echo waiting for db; sleep 2; done']
  containers:
  - name: myapp
    image: myapp:latest
    ports:
    - containerPort: 8080
```

## Common Use Cases

### 1. Wait for a Service

```yaml
initContainers:
- name: wait-for-postgres
  image: busybox:1.36
  command:
  - sh
  - -c
  - |
    until nc -z postgres.default.svc.cluster.local 5432
    do
      echo "Waiting for PostgreSQL..."
      sleep 2
    done
    echo "PostgreSQL is ready!"
```

### 2. Wait for Multiple Services

```yaml
initContainers:
- name: wait-for-dependencies
  image: busybox:1.36
  command:
  - sh
  - -c
  - |
    echo "Waiting for PostgreSQL..."
    until nc -z postgres 5432; do sleep 2; done
    
    echo "Waiting for Redis..."
    until nc -z redis 6379; do sleep 2; done
    
    echo "Waiting for Kafka..."
    until nc -z kafka 9092; do sleep 2; done
    
    echo "All dependencies are ready!"
```

### 3. Download Configuration

```yaml
initContainers:
- name: download-config
  image: curlimages/curl:8.4.0
  command:
  - sh
  - -c
  - |
    curl -o /config/app.yaml https://config-server/myapp/config.yaml
  volumeMounts:
  - name: config
    mountPath: /config
containers:
- name: myapp
  image: myapp:latest
  volumeMounts:
  - name: config
    mountPath: /etc/myapp
volumes:
- name: config
  emptyDir: {}
```

### 4. Clone Git Repository

```yaml
initContainers:
- name: git-clone
  image: alpine/git:2.40.1
  command:
  - git
  - clone
  - --depth=1
  - https://github.com/myorg/myrepo.git
  - /data
  volumeMounts:
  - name: repo
    mountPath: /data
containers:
- name: myapp
  image: myapp:latest
  volumeMounts:
  - name: repo
    mountPath: /app
volumes:
- name: repo
  emptyDir: {}
```

### 5. Run Database Migrations

```yaml
initContainers:
- name: migrate
  image: myapp:latest
  command: ['./migrate.sh']
  env:
  - name: DATABASE_URL
    valueFrom:
      secretKeyRef:
        name: db-credentials
        key: url
containers:
- name: myapp
  image: myapp:latest
```

### 6. Set Permissions

```yaml
initContainers:
- name: fix-permissions
  image: busybox:1.36
  command: ['sh', '-c', 'chown -R 1000:1000 /data']
  securityContext:
    runAsUser: 0
  volumeMounts:
  - name: data
    mountPath: /data
containers:
- name: myapp
  image: myapp:latest
  securityContext:
    runAsUser: 1000
  volumeMounts:
  - name: data
    mountPath: /data
volumes:
- name: data
  persistentVolumeClaim:
    claimName: myapp-data
```

### 7. Generate SSL Certificates

```yaml
initContainers:
- name: generate-certs
  image: alpine:3.19
  command:
  - sh
  - -c
  - |
    apk add --no-cache openssl
    openssl req -x509 -nodes -days 365 \
      -newkey rsa:2048 \
      -keyout /certs/tls.key \
      -out /certs/tls.crt \
      -subj "/CN=myapp.default.svc"
  volumeMounts:
  - name: certs
    mountPath: /certs
containers:
- name: myapp
  image: myapp:latest
  volumeMounts:
  - name: certs
    mountPath: /etc/certs
volumes:
- name: certs
  emptyDir: {}
```

## Production Example

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: myapp
spec:
  replicas: 3
  selector:
    matchLabels:
      app: myapp
  template:
    metadata:
      labels:
        app: myapp
    spec:
      initContainers:
      # 1. Wait for database
      - name: wait-for-db
        image: busybox:1.36
        command: ['sh', '-c', 'until nc -z postgres 5432; do sleep 2; done']
        resources:
          requests:
            cpu: 10m
            memory: 16Mi
          limits:
            cpu: 100m
            memory: 64Mi
      
      # 2. Run migrations
      - name: migrations
        image: myapp:latest
        command: ['./migrate.sh', '--non-interactive']
        env:
        - name: DATABASE_URL
          valueFrom:
            secretKeyRef:
              name: db-credentials
              key: url
        resources:
          requests:
            cpu: 100m
            memory: 128Mi
          limits:
            cpu: 500m
            memory: 256Mi
      
      # 3. Download static assets
      - name: download-assets
        image: curlimages/curl:8.4.0
        command:
        - sh
        - -c
        - curl -o /assets/bundle.js https://cdn.example.com/bundle.js
        volumeMounts:
        - name: assets
          mountPath: /assets
        resources:
          requests:
            cpu: 10m
            memory: 32Mi
          limits:
            cpu: 100m
            memory: 64Mi
      
      containers:
      - name: myapp
        image: myapp:latest
        ports:
        - containerPort: 8080
        env:
        - name: DATABASE_URL
          valueFrom:
            secretKeyRef:
              name: db-credentials
              key: url
        volumeMounts:
        - name: assets
          mountPath: /app/static
        resources:
          requests:
            cpu: 100m
            memory: 256Mi
          limits:
            cpu: 1
            memory: 512Mi
      
      volumes:
      - name: assets
        emptyDir: {}
```

## Debugging Init Containers

### Check Init Container Status

```bash
kubectl get pod myapp -o jsonpath='{.status.initContainerStatuses}'
```

### View Init Container Logs

```bash
# Get logs from specific init container
kubectl logs myapp -c init-db-ready

# Get previous logs if crashed
kubectl logs myapp -c init-db-ready --previous
```

### Describe Pod

```bash
kubectl describe pod myapp
# Look for "Init Containers" section
```

## Best Practices

### 1. Set Resource Limits

```yaml
initContainers:
- name: init
  resources:
    requests:
      cpu: 10m
      memory: 16Mi
    limits:
      cpu: 100m
      memory: 64Mi
```

### 2. Use Minimal Images

```yaml
# Good
image: busybox:1.36

# Not recommended
image: ubuntu:22.04
```

### 3. Set Timeouts

```yaml
command:
- sh
- -c
- |
  timeout 60 sh -c 'until nc -z postgres 5432; do sleep 2; done'
```

### 4. Handle Failures Gracefully

```yaml
command:
- sh
- -c
- |
  set -e  # Exit on error
  echo "Starting initialization..."
  # Your commands here
  echo "Initialization complete"
```

## Key Takeaways

- Init containers run sequentially before main containers
- Use them for dependencies, setup tasks, and pre-flight checks
- They share volumes with main containers
- Always set resource limits
- Debug with `kubectl logs -c <init-container-name>`
