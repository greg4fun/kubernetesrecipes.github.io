---
title: "How to Manage ConfigMaps and Secrets Effectively"
description: "Master Kubernetes ConfigMaps and Secrets for application configuration. Learn creation methods, mounting strategies, and security best practices."
category: "configuration"
difficulty: "beginner"
timeToComplete: "20 minutes"
kubernetesVersion: "1.28+"
prerequisites:
  - "A running Kubernetes cluster"
  - "kubectl configured to access your cluster"
relatedRecipes:
  - "external-secrets-operator"
  - "sealed-secrets-gitops"
tags:
  - configmap
  - secrets
  - configuration
  - environment-variables
  - volume-mounts
publishDate: "2026-01-21"
author: "Luca Berton"
---

> **💡 Quick Answer:** Create ConfigMap: `kubectl create configmap myconfig --from-file=config.yaml`. Create Secret: `kubectl create secret generic mysecret --from-literal=password=mypass`. Mount as env vars with `envFrom: [{configMapRef: {name: myconfig}}]` or as files with `volumes: [{configMap: {name: myconfig}}]`. Secrets are base64 encoded, not encrypted—use External Secrets Operator for production.

## The Problem

You need to manage application configuration and sensitive data separately from your container images.

## The Solution

Use ConfigMaps for non-sensitive configuration and Secrets for sensitive data like passwords, API keys, and certificates.

## ConfigMaps

### Creating ConfigMaps

**From literal values:**

```bash
kubectl create configmap app-config \
  --from-literal=APP_ENV=production \
  --from-literal=LOG_LEVEL=info \
  --from-literal=MAX_CONNECTIONS=100
```

**From a file:**

```bash
kubectl create configmap nginx-config --from-file=nginx.conf
```

**From YAML manifest:**

```yaml
apiVersion: v1
kind: ConfigMap
metadata:
  name: app-config
data:
  APP_ENV: "production"
  LOG_LEVEL: "info"
  MAX_CONNECTIONS: "100"
  config.yaml: |
    database:
      host: postgres.default.svc
      port: 5432
    cache:
      enabled: true
      ttl: 3600
```

### Using ConfigMaps in Pods

**As environment variables:**

```yaml
apiVersion: v1
kind: Pod
metadata:
  name: myapp
spec:
  containers:
  - name: myapp
    image: myapp:latest
    envFrom:
    - configMapRef:
        name: app-config
```

**Individual keys as environment variables:**

```yaml
env:
- name: DATABASE_HOST
  valueFrom:
    configMapKeyRef:
      name: app-config
      key: DB_HOST
```

**As a volume mount:**

```yaml
apiVersion: v1
kind: Pod
metadata:
  name: myapp
spec:
  containers:
  - name: myapp
    image: myapp:latest
    volumeMounts:
    - name: config-volume
      mountPath: /etc/config
  volumes:
  - name: config-volume
    configMap:
      name: app-config
```

## Secrets

### Creating Secrets

**From literal values:**

```bash
kubectl create secret generic db-credentials \
  --from-literal=username=admin \
  --from-literal=password='S3cur3P@ss!'
```

**From YAML (values must be base64 encoded):**

```yaml
apiVersion: v1
kind: Secret
metadata:
  name: db-credentials
type: Opaque
data:
  username: YWRtaW4=      # base64 encoded
  password: UzNjdXIzUEBzcyE=
```

**Using stringData (auto-encodes):**

```yaml
apiVersion: v1
kind: Secret
metadata:
  name: db-credentials
type: Opaque
stringData:
  username: admin
  password: S3cur3P@ss!
```

### TLS Secrets

```bash
kubectl create secret tls my-tls-secret \
  --cert=path/to/cert.pem \
  --key=path/to/key.pem
```

### Docker Registry Secrets

```bash
kubectl create secret docker-registry regcred \
  --docker-server=https://index.docker.io/v1/ \
  --docker-username=myuser \
  --docker-password=mypassword \
  --docker-email=myemail@example.com
```

### Using Secrets in Pods

**As environment variables:**

```yaml
apiVersion: v1
kind: Pod
metadata:
  name: myapp
spec:
  containers:
  - name: myapp
    image: myapp:latest
    env:
    - name: DB_USERNAME
      valueFrom:
        secretKeyRef:
          name: db-credentials
          key: username
    - name: DB_PASSWORD
      valueFrom:
        secretKeyRef:
          name: db-credentials
          key: password
```

**As a volume mount:**

```yaml
apiVersion: v1
kind: Pod
metadata:
  name: myapp
spec:
  containers:
  - name: myapp
    image: myapp:latest
    volumeMounts:
    - name: secrets-volume
      mountPath: /etc/secrets
      readOnly: true
  volumes:
  - name: secrets-volume
    secret:
      secretName: db-credentials
      defaultMode: 0400
```

## Auto-Reloading Configuration

### Using Reloader

Install Reloader to automatically restart pods when ConfigMaps change:

```bash
helm repo add stakater https://stakater.github.io/stakater-charts
helm install reloader stakater/reloader
```

Annotate your deployment:

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: myapp
  annotations:
    reloader.stakater.com/auto: "true"
spec:
  # ...
```

### Manual Rollout

Trigger a rollout after ConfigMap update:

```bash
kubectl rollout restart deployment/myapp
```

## Best Practices

### 1. Never Store Secrets in Git

Use tools like:
- Sealed Secrets
- External Secrets Operator
- SOPS
- Vault

### 2. Set Proper File Permissions

```yaml
volumes:
- name: secrets-volume
  secret:
    secretName: db-credentials
    defaultMode: 0400  # Read-only for owner
```

### 3. Use Immutable ConfigMaps/Secrets

```yaml
apiVersion: v1
kind: ConfigMap
metadata:
  name: app-config-v1
immutable: true
data:
  APP_ENV: "production"
```

### 4. Namespace Isolation

Secrets are namespace-scoped. Use RBAC to restrict access:

```yaml
apiVersion: rbac.authorization.k8s.io/v1
kind: Role
metadata:
  name: secret-reader
rules:
- apiGroups: [""]
  resources: ["secrets"]
  resourceNames: ["db-credentials"]
  verbs: ["get"]
```

## Viewing ConfigMaps and Secrets

```bash
# List ConfigMaps
kubectl get configmaps

# View ConfigMap content
kubectl describe configmap app-config

# View Secret (base64 encoded)
kubectl get secret db-credentials -o yaml

# Decode Secret value
kubectl get secret db-credentials -o jsonpath='{.data.password}' | base64 -d
```

## Key Takeaways

- Use ConfigMaps for non-sensitive configuration
- Use Secrets for sensitive data (still base64, not encrypted!)
- Mount as volumes for file-based config
- Use envFrom for environment variables
- Consider external secret management for production

---

## 📘 Go Further with Kubernetes Recipes

**Love this recipe? There's so much more!** This is just one of **100+ hands-on recipes** in our comprehensive **[Kubernetes Recipes book](https://amzn.to/3DzC8QA)**.

Inside the book, you'll master:
- ✅ Production-ready deployment strategies
- ✅ Advanced networking and security patterns  
- ✅ Observability, monitoring, and troubleshooting
- ✅ Real-world best practices from industry experts

> *"The practical, recipe-based approach made complex Kubernetes concepts finally click for me."*

**👉 [Get Your Copy Now](https://amzn.to/3DzC8QA)** — Start building production-grade Kubernetes skills today!
