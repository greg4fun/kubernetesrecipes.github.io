---
title: "K8s ConfigMap: Create and Mount Guide"
description: "Create Kubernetes ConfigMaps from files, literals, and directories. Mount as volumes or environment variables with hot-reload and immutable ConfigMap patterns."
publishDate: "2026-05-02"
author: "Luca Berton"
category: "configuration"
difficulty: "beginner"
timeToComplete: "10 minutes"
kubernetesVersion: "1.28+"
tags:
  - "configmap"
  - "configuration"
  - "volumes"
  - "environment-variables"
  - "cka"
relatedRecipes:
  - "environment-variables-configmaps"
  - "downward-api-metadata"
  - "kubernetes-secrets-management-guide"
  - "kustomize-vs-helm-comparison"
  - "kubernetes-resource-quota-limitrange"
---

> 💡 **Quick Answer:** `kubectl create configmap myconfig --from-file=config.yaml` creates a ConfigMap from a file. Mount it as a volume: `volumes: [{name: config, configMap: {name: myconfig}}]` with `volumeMounts: [{name: config, mountPath: /etc/config}]`. Or inject as env vars: `envFrom: [{configMapRef: {name: myconfig}}]`. ConfigMaps mounted as volumes auto-update (with ~60s delay); env vars don't.

## The Problem

Hardcoding configuration in container images means:

- Rebuilding images for config changes
- Different images per environment (dev/staging/prod)
- Secrets mixed with application config
- No centralized config management

## The Solution

### Create ConfigMaps

```bash
# From literal values
kubectl create configmap app-config \
  --from-literal=DB_HOST=postgres \
  --from-literal=DB_PORT=5432 \
  --from-literal=LOG_LEVEL=info

# From file
kubectl create configmap nginx-config \
  --from-file=nginx.conf

# From directory (each file becomes a key)
kubectl create configmap app-configs \
  --from-file=configs/

# From env file
kubectl create configmap env-config \
  --from-env-file=.env

# Generate YAML
kubectl create configmap app-config \
  --from-literal=DB_HOST=postgres \
  --dry-run=client -o yaml
```

### YAML Definition

```yaml
apiVersion: v1
kind: ConfigMap
metadata:
  name: app-config
data:
  # Simple key-value
  DB_HOST: "postgres"
  DB_PORT: "5432"
  LOG_LEVEL: "info"
  
  # Multi-line config file
  nginx.conf: |
    server {
      listen 80;
      server_name example.com;
      location / {
        proxy_pass http://backend:8080;
      }
    }
  
  # Properties file
  application.properties: |
    spring.datasource.url=jdbc:postgresql://postgres:5432/mydb
    spring.jpa.hibernate.ddl-auto=update
    logging.level.root=INFO
```

### Mount as Environment Variables

```yaml
apiVersion: v1
kind: Pod
metadata:
  name: app
spec:
  containers:
  - name: app
    image: myapp:v1
    # All keys as env vars
    envFrom:
    - configMapRef:
        name: app-config
    
    # Or select specific keys
    env:
    - name: DATABASE_HOST     # env var name
      valueFrom:
        configMapKeyRef:
          name: app-config
          key: DB_HOST         # ConfigMap key
    - name: DATABASE_PORT
      valueFrom:
        configMapKeyRef:
          name: app-config
          key: DB_PORT
```

### Mount as Volume

```yaml
apiVersion: v1
kind: Pod
metadata:
  name: nginx
spec:
  containers:
  - name: nginx
    image: nginx:1.27
    volumeMounts:
    - name: config-volume
      mountPath: /etc/nginx/conf.d    # Directory mount
    - name: single-file
      mountPath: /etc/nginx/nginx.conf
      subPath: nginx.conf             # Single file (no directory replace)
  volumes:
  - name: config-volume
    configMap:
      name: nginx-config
  - name: single-file
    configMap:
      name: nginx-config
      items:
      - key: nginx.conf
        path: nginx.conf
```

### Hot Reload (Volume Mounts)

```bash
# Update ConfigMap
kubectl edit configmap app-config
# or
kubectl create configmap app-config --from-file=new-config.yaml \
  --dry-run=client -o yaml | kubectl apply -f -

# Volume mounts update automatically (~60-120 seconds)
# env vars do NOT update — pod restart required

# Watch for config changes in app
inotifywait -m /etc/config -e modify
```

### Immutable ConfigMaps

```yaml
apiVersion: v1
kind: ConfigMap
metadata:
  name: app-config-v2
immutable: true    # Cannot be modified after creation
data:
  DB_HOST: "postgres"
```

```bash
# Benefits of immutable:
# - Prevents accidental changes
# - Reduces API server watch load
# - Forces explicit versioning (app-config-v1, v2, v3)
```

## Common Issues

**ConfigMap changes not reflected in pods**

Env vars don't auto-update. Restart pods: `kubectl rollout restart deployment/app`. Volume mounts update with delay.

**"subPath" mount doesn't auto-update**

Known limitation — `subPath` volume mounts don't get ConfigMap updates. Use full directory mount or restart pods.

**ConfigMap too large (>1MB)**

ConfigMaps are limited to 1MB. For larger configs, use a PersistentVolume or init container to fetch config.

## Best Practices

- **Separate config from secrets** — ConfigMap for non-sensitive, Secret for sensitive
- **Use immutable for production** — prevents accidental changes
- **Version ConfigMaps** — `app-config-v2` instead of editing in-place
- **Prefer volume mounts** over env vars — supports hot reload
- **Avoid `subPath`** if you need auto-updates

## Key Takeaways

- ConfigMaps decouple configuration from container images
- Create from files, literals, directories, or env files
- Volume mounts auto-update (~60s); environment variables don't
- Immutable ConfigMaps prevent changes and reduce API server load
- 1MB size limit — use external storage for larger configurations
