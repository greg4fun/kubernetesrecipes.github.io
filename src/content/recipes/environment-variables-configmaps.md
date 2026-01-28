---
title: "How to Configure Environment Variables and ConfigMaps"
description: "Manage application configuration with environment variables and ConfigMaps. Learn injection methods, mounting as files, and dynamic configuration updates."
category: "configuration"
difficulty: "beginner"
publishDate: "2026-01-22"
tags: ["configmap", "environment-variables", "configuration", "settings", "twelve-factor"]
---

# How to Configure Environment Variables and ConfigMaps

Environment variables and ConfigMaps externalize application configuration from container images, following twelve-factor app principles. They enable the same image to run across different environments.

## Direct Environment Variables

```yaml
# pod-with-env.yaml
apiVersion: v1
kind: Pod
metadata:
  name: app
spec:
  containers:
    - name: app
      image: myapp:v1
      env:
        - name: DATABASE_HOST
          value: "postgres.default.svc.cluster.local"
        - name: DATABASE_PORT
          value: "5432"
        - name: LOG_LEVEL
          value: "info"
        - name: ENABLE_CACHE
          value: "true"
```

## Environment Variables from Pod Fields

```yaml
# env-from-field.yaml
apiVersion: v1
kind: Pod
metadata:
  name: app
spec:
  containers:
    - name: app
      image: myapp:v1
      env:
        - name: POD_NAME
          valueFrom:
            fieldRef:
              fieldPath: metadata.name
        - name: POD_NAMESPACE
          valueFrom:
            fieldRef:
              fieldPath: metadata.namespace
        - name: POD_IP
          valueFrom:
            fieldRef:
              fieldPath: status.podIP
        - name: NODE_NAME
          valueFrom:
            fieldRef:
              fieldPath: spec.nodeName
```

## Environment Variables from Container Resources

```yaml
# env-from-resources.yaml
apiVersion: v1
kind: Pod
metadata:
  name: app
spec:
  containers:
    - name: app
      image: myapp:v1
      resources:
        requests:
          memory: "256Mi"
          cpu: "500m"
        limits:
          memory: "512Mi"
          cpu: "1000m"
      env:
        - name: MEMORY_LIMIT
          valueFrom:
            resourceFieldRef:
              containerName: app
              resource: limits.memory
        - name: CPU_REQUEST
          valueFrom:
            resourceFieldRef:
              containerName: app
              resource: requests.cpu
```

## Create ConfigMap

```bash
# From literal values
kubectl create configmap app-config \
  --from-literal=DATABASE_HOST=postgres \
  --from-literal=LOG_LEVEL=info

# From file
kubectl create configmap app-config --from-file=config.properties

# From directory
kubectl create configmap app-config --from-file=./config/

# From env file
kubectl create configmap app-config --from-env-file=app.env
```

## ConfigMap YAML

```yaml
# configmap.yaml
apiVersion: v1
kind: ConfigMap
metadata:
  name: app-config
data:
  # Simple key-value pairs
  DATABASE_HOST: "postgres.default.svc.cluster.local"
  DATABASE_PORT: "5432"
  LOG_LEVEL: "info"
  
  # Multi-line configuration file
  config.yaml: |
    server:
      port: 8080
      host: 0.0.0.0
    database:
      pool_size: 10
      timeout: 30s
    
  # JSON configuration
  settings.json: |
    {
      "feature_flags": {
        "new_ui": true,
        "beta_features": false
      }
    }
```

## Environment Variables from ConfigMap

```yaml
# Single key
apiVersion: v1
kind: Pod
metadata:
  name: app
spec:
  containers:
    - name: app
      image: myapp:v1
      env:
        - name: DATABASE_HOST
          valueFrom:
            configMapKeyRef:
              name: app-config
              key: DATABASE_HOST
        - name: LOG_LEVEL
          valueFrom:
            configMapKeyRef:
              name: app-config
              key: LOG_LEVEL
              optional: true  # Pod starts even if key doesn't exist
```

## All ConfigMap Keys as Environment Variables

```yaml
# all-from-configmap.yaml
apiVersion: v1
kind: Pod
metadata:
  name: app
spec:
  containers:
    - name: app
      image: myapp:v1
      envFrom:
        - configMapRef:
            name: app-config
        - configMapRef:
            name: feature-flags
            optional: true
```

## Mount ConfigMap as Volume

```yaml
# configmap-volume.yaml
apiVersion: v1
kind: Pod
metadata:
  name: app
spec:
  containers:
    - name: app
      image: myapp:v1
      volumeMounts:
        - name: config
          mountPath: /etc/config
          readOnly: true
  volumes:
    - name: config
      configMap:
        name: app-config
```

```bash
# Result in container:
# /etc/config/DATABASE_HOST
# /etc/config/DATABASE_PORT
# /etc/config/config.yaml
# /etc/config/settings.json
```

## Mount Specific Keys

```yaml
# specific-keys.yaml
apiVersion: v1
kind: Pod
metadata:
  name: app
spec:
  containers:
    - name: app
      image: myapp:v1
      volumeMounts:
        - name: config
          mountPath: /etc/app
  volumes:
    - name: config
      configMap:
        name: app-config
        items:
          - key: config.yaml
            path: application.yaml  # Rename the file
          - key: settings.json
            path: settings.json
            mode: 0644  # Set file permissions
```

## Mount to Specific File (SubPath)

```yaml
# subpath-mount.yaml
apiVersion: v1
kind: Pod
metadata:
  name: app
spec:
  containers:
    - name: app
      image: nginx:latest
      volumeMounts:
        - name: config
          mountPath: /etc/nginx/nginx.conf
          subPath: nginx.conf  # Only this file, doesn't hide directory
  volumes:
    - name: config
      configMap:
        name: nginx-config
```

## Environment Variables from Secret

```yaml
# env-from-secret.yaml
apiVersion: v1
kind: Pod
metadata:
  name: app
spec:
  containers:
    - name: app
      image: myapp:v1
      env:
        - name: DATABASE_PASSWORD
          valueFrom:
            secretKeyRef:
              name: db-credentials
              key: password
        - name: API_KEY
          valueFrom:
            secretKeyRef:
              name: api-secrets
              key: api-key
      envFrom:
        - secretRef:
            name: app-secrets
```

## Combined ConfigMap and Secrets

```yaml
# combined-config.yaml
apiVersion: v1
kind: Pod
metadata:
  name: app
spec:
  containers:
    - name: app
      image: myapp:v1
      envFrom:
        # Non-sensitive configuration
        - configMapRef:
            name: app-config
        # Sensitive configuration
        - secretRef:
            name: app-secrets
      env:
        # Override specific values
        - name: LOG_LEVEL
          value: "debug"
```

## Deployment with Configuration

```yaml
# deployment-with-config.yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: api-server
spec:
  replicas: 3
  selector:
    matchLabels:
      app: api-server
  template:
    metadata:
      labels:
        app: api-server
      annotations:
        # Trigger rollout when ConfigMap changes
        checksum/config: {{ include (print $.Template.BasePath "/configmap.yaml") . | sha256sum }}
    spec:
      containers:
        - name: api
          image: myapi:v1
          envFrom:
            - configMapRef:
                name: api-config
          volumeMounts:
            - name: config-volume
              mountPath: /etc/config
      volumes:
        - name: config-volume
          configMap:
            name: api-config
```

## Dynamic Configuration Reload

```yaml
# For apps that watch config files, mounted ConfigMaps update automatically
# (not subPath mounts or env vars)

apiVersion: v1
kind: Pod
metadata:
  name: app-with-reload
spec:
  containers:
    - name: app
      image: myapp:v1
      volumeMounts:
        - name: config
          mountPath: /etc/config
  volumes:
    - name: config
      configMap:
        name: app-config
        # Files update within kubelet sync period (~1 minute)
```

## Immutable ConfigMap

```yaml
# immutable-configmap.yaml
apiVersion: v1
kind: ConfigMap
metadata:
  name: app-config-v1
immutable: true  # Cannot be changed after creation
data:
  config.yaml: |
    version: 1
    settings:
      feature_x: enabled
```

## Environment Variable Expansion

```yaml
# env-expansion.yaml
apiVersion: v1
kind: Pod
metadata:
  name: app
spec:
  containers:
    - name: app
      image: myapp:v1
      env:
        - name: SERVICE_NAME
          value: "myapp"
        - name: SERVICE_PORT
          value: "8080"
        # Use $(VAR) syntax for expansion
        - name: SERVICE_URL
          value: "http://$(SERVICE_NAME):$(SERVICE_PORT)"
        - name: POD_NAME
          valueFrom:
            fieldRef:
              fieldPath: metadata.name
        - name: LOG_FILE
          value: "/var/log/$(POD_NAME).log"
```

## View and Update ConfigMaps

```bash
# View ConfigMap
kubectl get configmap app-config -o yaml
kubectl describe configmap app-config

# Edit ConfigMap
kubectl edit configmap app-config

# Update ConfigMap from file
kubectl create configmap app-config --from-file=config.yaml --dry-run=client -o yaml | kubectl apply -f -

# Delete and recreate
kubectl delete configmap app-config
kubectl create configmap app-config --from-file=config.yaml
```

## Best Practices

```yaml
# 1. Separate sensitive and non-sensitive config
# Use ConfigMaps for non-sensitive, Secrets for sensitive

# 2. Use meaningful names
apiVersion: v1
kind: ConfigMap
metadata:
  name: myapp-config-production
  labels:
    app: myapp
    env: production

# 3. Document configuration
data:
  # DATABASE_HOST: PostgreSQL server hostname
  DATABASE_HOST: "postgres.prod.svc.cluster.local"
  # MAX_CONNECTIONS: Maximum database connection pool size (default: 10)
  MAX_CONNECTIONS: "20"

# 4. Version ConfigMaps for tracking
metadata:
  name: myapp-config-v2
```

## Summary

Environment variables and ConfigMaps decouple configuration from container images. Use environment variables for simple key-value pairs, ConfigMap volumes for configuration files, and Secrets for sensitive data. Mount ConfigMaps as volumes for automatic updates, but note that subPath mounts and environment variables require pod restart. Use immutable ConfigMaps for stable, version-tracked configurations.

---

## 📘 Go Further with Kubernetes Recipes

**Love this recipe? There's so much more!** This is just one of **100+ hands-on recipes** in our comprehensive **[Kubernetes Recipes book](/book)**.

Inside the book, you'll master:
- ✅ Production-ready deployment strategies
- ✅ Advanced networking and security patterns  
- ✅ Observability, monitoring, and troubleshooting
- ✅ Real-world best practices from industry experts

> *"The practical, recipe-based approach made complex Kubernetes concepts finally click for me."*

**👉 [Get Your Copy Now](/book)** — Start building production-grade Kubernetes skills today!
