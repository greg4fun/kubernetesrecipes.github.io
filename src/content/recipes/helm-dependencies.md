---
title: "How to Manage Helm Chart Dependencies"
description: "Learn to manage Helm chart dependencies effectively. Configure subcharts, override values, and build complex applications with reusable components."
category: "helm"
difficulty: "intermediate"
publishDate: "2026-01-22"
tags: ["helm", "dependencies", "subcharts", "packaging", "charts"]
---

> 💡 **Quick Answer:** Declare dependencies in `Chart.yaml` under `dependencies:` with name, version, and repository. Run `helm dependency update` to download charts to `charts/` folder. Override subchart values using `<dependency-name>:` prefix in parent `values.yaml`.
>
> **Key command:** `helm dependency build ./myapp` downloads and locks dependencies; `helm dependency list ./myapp` shows status.
>
> **Gotcha:** Use `condition: postgresql.enabled` to make dependencies optional; version ranges (`^12.0.0`) auto-update within semver constraints.

# How to Manage Helm Chart Dependencies

Helm dependencies let you compose complex applications from reusable charts. Learn to declare, configure, and manage chart dependencies effectively.

## Declaring Dependencies

```yaml
# Chart.yaml
apiVersion: v2
name: myapp
version: 1.0.0
appVersion: "2.0.0"

dependencies:
  - name: postgresql
    version: "12.x.x"
    repository: "https://charts.bitnami.com/bitnami"
  - name: redis
    version: "17.x.x"
    repository: "https://charts.bitnami.com/bitnami"
  - name: common
    version: "2.x.x"
    repository: "https://charts.bitnami.com/bitnami"
    tags:
      - backend
```

## Building Dependencies

```bash
# Download dependencies to charts/ directory
helm dependency build

# Update dependencies (also downloads)
helm dependency update

# List dependencies
helm dependency list
```

## Conditional Dependencies

```yaml
# Chart.yaml
dependencies:
  - name: postgresql
    version: "12.x.x"
    repository: "https://charts.bitnami.com/bitnami"
    condition: postgresql.enabled
  - name: mysql
    version: "9.x.x"
    repository: "https://charts.bitnami.com/bitnami"
    condition: mysql.enabled
```

```yaml
# values.yaml
postgresql:
  enabled: true

mysql:
  enabled: false
```

## Using Tags for Groups

```yaml
# Chart.yaml
dependencies:
  - name: backend-api
    version: "1.0.0"
    repository: "file://../backend-api"
    tags:
      - backend
  - name: worker
    version: "1.0.0"
    repository: "file://../worker"
    tags:
      - backend
  - name: frontend
    version: "1.0.0"
    repository: "file://../frontend"
    tags:
      - frontend
```

```yaml
# values.yaml
publishDate: "2026-01-22"
tags:
  backend: true
  frontend: true
```

```bash
# Install only backend components
helm install myapp . --set tags.frontend=false
```

## Overriding Subchart Values

```yaml
# values.yaml - Override postgresql subchart values
postgresql:
  enabled: true
  auth:
    postgresPassword: "secretpassword"
    database: "myapp"
  primary:
    persistence:
      size: 20Gi
    resources:
      requests:
        memory: 256Mi
        cpu: 100m
      limits:
        memory: 512Mi
        cpu: 500m

redis:
  enabled: true
  architecture: standalone
  auth:
    enabled: true
    password: "redispassword"
  master:
    persistence:
      size: 5Gi
```

## Importing Values from Subcharts

```yaml
# Chart.yaml
dependencies:
  - name: postgresql
    version: "12.x.x"
    repository: "https://charts.bitnami.com/bitnami"
    import-values:
      - child: primary.service
        parent: database
```

```yaml
# Now in templates, use .Values.database.port instead of
# .Values.postgresql.primary.service.port
```

## Alias for Multiple Instances

```yaml
# Chart.yaml
dependencies:
  - name: redis
    version: "17.x.x"
    repository: "https://charts.bitnami.com/bitnami"
    alias: redis-cache
  - name: redis
    version: "17.x.x"
    repository: "https://charts.bitnami.com/bitnami"
    alias: redis-session
```

```yaml
# values.yaml
redis-cache:
  architecture: standalone
  master:
    persistence:
      size: 2Gi

redis-session:
  architecture: standalone
  master:
    persistence:
      size: 1Gi
```

## Local Chart Dependencies

```yaml
# Chart.yaml - Reference local charts
dependencies:
  - name: shared-lib
    version: "1.0.0"
    repository: "file://../shared-lib"
  - name: auth-service
    version: "2.0.0"
    repository: "file://./charts/auth-service"
```

## OCI Registry Dependencies

```yaml
# Chart.yaml - Using OCI registries
dependencies:
  - name: mylib
    version: "1.0.0"
    repository: "oci://registry.example.com/charts"
```

```bash
# Login to OCI registry first
helm registry login registry.example.com
```

## Global Values

```yaml
# values.yaml - Global values available to all subcharts
global:
  imageRegistry: "registry.example.com"
  imagePullSecrets:
    - name: registry-secret
  storageClass: "fast-ssd"

# Subcharts can access via .Values.global.imageRegistry
```

## Template Usage with Dependencies

```yaml
# templates/configmap.yaml
apiVersion: v1
kind: ConfigMap
metadata:
  name: {{ .Release.Name }}-config
data:
  # Reference subchart service names
  DATABASE_HOST: {{ .Release.Name }}-postgresql
  DATABASE_PORT: "5432"
  DATABASE_NAME: {{ .Values.postgresql.auth.database }}
  REDIS_HOST: {{ .Release.Name }}-redis-master
  REDIS_PORT: "6379"
```

```yaml
# templates/deployment.yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: {{ .Release.Name }}-app
spec:
  template:
    spec:
      containers:
        - name: app
          env:
            - name: DATABASE_URL
              value: "postgres://{{ .Values.postgresql.auth.database }}:$(DB_PASSWORD)@{{ .Release.Name }}-postgresql:5432/{{ .Values.postgresql.auth.database }}"
            - name: DB_PASSWORD
              valueFrom:
                secretKeyRef:
                  name: {{ .Release.Name }}-postgresql
                  key: postgres-password
```

## Wait for Dependencies

```yaml
# templates/deployment.yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: {{ .Release.Name }}-app
spec:
  template:
    spec:
      initContainers:
        - name: wait-for-db
          image: busybox:latest
          command:
            - /bin/sh
            - -c
            - |
              until nc -z {{ .Release.Name }}-postgresql 5432; do
                echo "Waiting for PostgreSQL..."
                sleep 2
              done
              echo "PostgreSQL is ready!"
        - name: wait-for-redis
          image: busybox:latest
          command:
            - /bin/sh
            - -c
            - |
              until nc -z {{ .Release.Name }}-redis-master 6379; do
                echo "Waiting for Redis..."
                sleep 2
              done
              echo "Redis is ready!"
      containers:
        - name: app
          image: {{ .Values.image.repository }}:{{ .Values.image.tag }}
```

## Dependency Lock File

```yaml
# Chart.lock - Auto-generated, commit to version control
dependencies:
- name: postgresql
  repository: https://charts.bitnami.com/bitnami
  version: 12.5.6
- name: redis
  repository: https://charts.bitnami.com/bitnami
  version: 17.11.3
digest: sha256:abc123...
generated: "2024-01-15T10:30:00Z"
```

```bash
# Rebuild from lock file (reproducible builds)
helm dependency build
```

## Summary

Helm dependencies enable modular, reusable chart composition. Use conditions and tags for flexibility, override values for customization, and leverage global values for consistency across subcharts.

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
