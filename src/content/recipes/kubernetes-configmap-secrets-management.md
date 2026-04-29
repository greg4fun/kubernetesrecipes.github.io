---
title: "Kubernetes ConfigMap Secrets Management"
description: "Manage ConfigMaps and Secrets in Kubernetes. Create, mount, update, and secure application configuration and sensitive data effectively."
publishDate: "2026-04-29"
author: "Luca Berton"
category: "configuration"
difficulty: "beginner"
timeToComplete: "15 minutes"
kubernetesVersion: "1.28+"
tags:
  - "configmap"
  - "secrets"
  - "configuration"
  - "security"
  - "best-practices"
relatedRecipes:
  - "kubernetes-secret-rotation-automation"
  - "sealed-secrets-bitnami-kubernetes"
  - "external-secrets-operator-kubernetes"
  - "kubernetes-admission-controllers-guide"
---

> 💡 **Quick Answer:** ConfigMaps store non-sensitive configuration (env vars, config files), Secrets store sensitive data (passwords, TLS certs, tokens) — both base64-encoded but Secrets get additional RBAC, audit logging, and optional encryption at rest. Mount as volumes for config files or inject as environment variables.

## The Problem

Applications need configuration that varies between environments. Hardcoding config in container images means rebuilding for every change. Kubernetes needs:

- External configuration injection without image rebuilds
- Separation of sensitive and non-sensitive data
- Automatic pod restarts when config changes
- Size limits and update propagation
- Encryption for sensitive data

## The Solution

### ConfigMap

```bash
# From literal values
kubectl create configmap app-config \
  --from-literal=DATABASE_HOST=postgres.svc \
  --from-literal=LOG_LEVEL=info

# From file
kubectl create configmap nginx-config \
  --from-file=nginx.conf

# From directory
kubectl create configmap app-configs \
  --from-file=config/

# From env file
kubectl create configmap env-config \
  --from-env-file=app.env
```

```yaml
apiVersion: v1
kind: ConfigMap
metadata:
  name: app-config
data:
  DATABASE_HOST: postgres.svc
  LOG_LEVEL: info
  app.properties: |
    server.port=8080
    cache.ttl=300
    feature.flags=enable-v2,dark-mode
```

### Secrets

```bash
# Generic secret
kubectl create secret generic db-creds \
  --from-literal=username=admin \
  --from-literal=password='S3cur3P@ss!'

# TLS secret
kubectl create secret tls my-tls \
  --cert=tls.crt \
  --key=tls.key

# Docker registry secret
kubectl create secret docker-registry quay-pull \
  --docker-server=quay.example.com \
  --docker-username=robot \
  --docker-password=token
```

### Mount as Volume

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: app
spec:
  template:
    spec:
      containers:
      - name: app
        image: myapp:v1
        volumeMounts:
        - name: config-vol
          mountPath: /etc/app/config
          readOnly: true
        - name: secret-vol
          mountPath: /etc/app/secrets
          readOnly: true
      volumes:
      - name: config-vol
        configMap:
          name: app-config
      - name: secret-vol
        secret:
          secretName: db-creds
          defaultMode: 0400    # Restrictive permissions
```

### Inject as Environment Variables

```yaml
containers:
- name: app
  env:
  # Single key from ConfigMap
  - name: LOG_LEVEL
    valueFrom:
      configMapKeyRef:
        name: app-config
        key: LOG_LEVEL
  
  # Single key from Secret
  - name: DB_PASSWORD
    valueFrom:
      secretKeyRef:
        name: db-creds
        key: password
  
  # All keys from ConfigMap as env vars
  envFrom:
  - configMapRef:
      name: app-config
  - secretRef:
      name: db-creds
```

### Immutable ConfigMaps and Secrets

```yaml
apiVersion: v1
kind: ConfigMap
metadata:
  name: app-config-v2
immutable: true    # Cannot be modified after creation
data:
  LOG_LEVEL: debug
```

Benefits of immutable:
- Protects against accidental updates
- Significantly reduces API server load (no watches)
- Forces versioned config (create new, update pod reference)

### Auto-Reload on Config Change

Volume-mounted ConfigMaps update automatically (~60s). Environment variables do NOT update without pod restart. Use a sidecar or tool like Reloader:

```yaml
# Using stakater/Reloader annotations
metadata:
  annotations:
    configmap.reloader.stakater.com/reload: "app-config"
    secret.reloader.stakater.com/reload: "db-creds"
```

### Encryption at Rest

```yaml
# /etc/kubernetes/encryption-config.yaml
apiVersion: apiserver.config.k8s.io/v1
kind: EncryptionConfiguration
resources:
- resources:
  - secrets
  providers:
  - aescbc:
      keys:
      - name: key1
        secret: <base64-encoded-32-byte-key>
  - identity: {}    # Fallback for reading unencrypted
```

## Common Issues

**ConfigMap size limit exceeded**

ConfigMaps and Secrets are limited to 1 MiB. For larger configs, use a PersistentVolume or init container.

**Environment variables not updating**

Env vars are set at pod creation and never update. Use volume mounts for dynamic config, or restart pods after ConfigMap changes.

**"secret not found" in pod events**

Secret must exist in the same namespace as the pod. Check namespace and spelling.

## Best Practices

- **Secrets for sensitive data, ConfigMaps for everything else** — even though both are base64
- **Enable encryption at rest** for Secrets — base64 is encoding, not encryption
- **Use immutable for production** — version your configs (app-config-v1, v2, etc.)
- **Mount as volumes for files, env vars for simple values**
- **Never log Secret values** — mask in application logging
- **Use external secrets managers** (Vault, AWS SM) for production — Kubernetes Secrets are cluster-scoped

## Key Takeaways

- ConfigMaps and Secrets decouple configuration from container images
- Volume mounts auto-update (~60s), environment variables require pod restart
- Immutable ConfigMaps/Secrets reduce API server load and prevent accidental changes
- Secrets need encryption at rest — base64 is NOT encryption
- 1 MiB size limit per ConfigMap/Secret
- Use Reloader or similar tools for automatic pod restarts on config changes
