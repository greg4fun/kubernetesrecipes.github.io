---
title: "Kubernetes ConfigMap: Create, Mount, Update"
description: "Create Kubernetes ConfigMaps from files, literals and directories, mount them as volumes or env vars, update them safely, and apply ConfigMap best practices."
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
  - "best-practices"
  - "immutable"
relatedRecipes:
  - "configmap-secrets-management"
  - "kubernetes-configmap-from-file"
  - "kubernetes-envfrom-configmap-environment-variables"
  - "kubernetes-configmap-hot-reload"
  - "kubernetes-configmap-subpath-updates"
  - "configmap-too-large-error"
  - "environment-variables-configmaps"
  - "kubernetes-downward-api-guide"
  - "secrets-management-best-practices"
  - "kustomize-vs-helm-comparison"
  - "kubernetes-resource-quota-limitrange"
  - "kubernetes-projected-volumes"
  - "kubernetes-kubelet-configuration"
  - "kubernetes-qos-classes-guide"
  - "kubernetes-container-runtime-guide"
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

### Binary Data

```yaml
apiVersion: v1
kind: ConfigMap
metadata:
  name: certs-bundle
binaryData:
  keystore.jks: <base64>      # kubectl --from-file puts non-UTF-8 files here automatically
```

`data` values are plain UTF-8 strings (quote numbers and booleans: `"5432"`, `"true"`); only `binaryData` is base64.

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
      prefix: APP_            # optional: DB_HOST -> APP_DB_HOST
    
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

# Watch for config changes in app (kubelet swaps a ..data symlink, so watch the dir)
inotifywait -m /etc/config -e create -e moved_to
```

| Method | Auto-updates? | Use when |
|--------|---------------|----------|
| `env` / `envFrom` | No (restart) | Simple key-value settings |
| Volume mount | Yes (~60s) | Config files (nginx, properties) |
| `subPath` mount | No (restart) | One file into an existing directory |

To roll pods automatically on change, add a checksum of the ConfigMap to the pod template (Helm: `checksum/config: {{ include (print $.Template.BasePath "/configmap.yaml") . | sha256sum }}`), use Kustomize `configMapGenerator` hashed names, or run Stakater Reloader. Full patterns: [ConfigMap hot reload](/recipes/configuration/kubernetes-configmap-hot-reload/).

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

**ConfigMap too large (>1 MiB)**

ConfigMaps are limited to 1 MiB. For larger configs, use a PersistentVolume or an init container that fetches config. See [ConfigMap too large](/recipes/troubleshooting/configmap-too-large-error/).

**`envFrom` silently skips keys**

Keys that aren't valid env var names (`nginx.conf`, `my-key` on older versions) are skipped with an `InvalidVariableNames` event. Mount those as files.

**Pod stuck in `ContainerCreating` with `configmap not found`**

The ConfigMap must exist in the pod's namespace before the pod starts, unless the reference sets `optional: true`.

## Best Practices

- **Separate config from secrets** — ConfigMap for non-sensitive, Secret for sensitive
- **Use immutable for production** — prevents accidental changes
- **Version ConfigMaps** — `app-config-v2` instead of editing in-place
- **Prefer volume mounts** over env vars — supports hot reload
- **Avoid `subPath`** if you need auto-updates
- **One ConfigMap per app/concern**, not a shared mega-ConfigMap that restarts everything on edit
- **Label them** (`app.kubernetes.io/name`, `app.kubernetes.io/part-of`) so they're cleaned up with the app
- **Keep secrets out** — anything sensitive goes in a Secret ([ConfigMaps and Secrets](/recipes/configuration/configmap-secrets-management/))

## Frequently Asked Questions

### How do I create a ConfigMap from a file?

`kubectl create configmap nginx-config --from-file=nginx.conf` — the filename becomes the key. Use `--from-file=custom-key=path` to rename it, `--from-file=dir/` for one key per file, and add `--dry-run=client -o yaml` to generate a manifest for Git.

### How do I mount a ConfigMap as a file?

Add a `configMap` volume and a `volumeMount`; each key becomes a file under `mountPath`. Use `items` to select keys, or `subPath` to place one file into an existing directory (at the cost of losing auto-updates).

### ConfigMap vs Secret?

ConfigMaps hold non-sensitive config in plain text. Secrets hold passwords, tokens and certificates, are base64-encoded, can be encrypted at rest, and are usually RBAC-restricted separately.

### What is the ConfigMap size limit?

1 MiB per ConfigMap. For larger data use a volume or an external config store.

## Key Takeaways

- ConfigMaps decouple configuration from container images
- Create from files, literals, directories, or env files
- Volume mounts auto-update (~60s); environment variables don't
- Immutable ConfigMaps prevent changes and reduce API server load
- 1 MiB size limit — use external storage for larger configurations
