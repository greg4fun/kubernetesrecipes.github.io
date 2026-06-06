---
title: "Kubernetes EnvFrom ConfigMap Environment Variables"
description: "Inject all ConfigMap keys as environment variables using envFrom in Kubernetes pods. Configure configMapRef, secretRef, prefix options, and selective key"
tags:
  - "configmap"
  - "environment-variables"
  - "envfrom"
  - "configuration"
  - "pods"
category: "configuration"
publishDate: "2026-06-01"
author: "Luca Berton"
difficulty: "beginner"
relatedRecipes:
  - "kubernetes-configmap-secrets-management"
  - "kubernetes-secrets-management-guide"
---

> 💡 **Quick Answer:** `envFrom` injects ALL keys from a ConfigMap (or Secret) as environment variables in one declaration. Use `envFrom[].configMapRef.name` to inject an entire ConfigMap, or `env[].valueFrom.configMapKeyRef` for individual keys. Keys become env var names; values become env var values.

## The Problem

- Listing every config key individually in `env[]` is verbose and error-prone
- Adding a new config key requires updating the Deployment spec
- Need to inject dozens of environment variables from a ConfigMap without boilerplate
- Want to separate configuration data from pod definition
- Need to combine variables from multiple ConfigMaps and Secrets

## The Solution

### envFrom — Inject All Keys

```yaml
apiVersion: v1
kind: ConfigMap
metadata:
  name: app-config
  namespace: production
data:
  DATABASE_HOST: "postgres.db.svc"
  DATABASE_PORT: "5432"
  DATABASE_NAME: "myapp"
  LOG_LEVEL: "info"
  CACHE_TTL: "300"
---
apiVersion: apps/v1
kind: Deployment
metadata:
  name: my-app
spec:
  template:
    spec:
      containers:
        - name: app
          image: registry.example.com/app:v1
          # Inject ALL keys from ConfigMap as env vars
          envFrom:
            - configMapRef:
                name: app-config
          # Result: DATABASE_HOST=postgres.db.svc, DATABASE_PORT=5432, etc.
```

### envFrom with Prefix

```yaml
containers:
  - name: app
    envFrom:
      - configMapRef:
          name: app-config
        prefix: "APP_"    # All keys prefixed with APP_
    # Result: APP_DATABASE_HOST, APP_DATABASE_PORT, APP_LOG_LEVEL, etc.
```

### Combine Multiple Sources

```yaml
containers:
  - name: app
    envFrom:
      # All keys from ConfigMap
      - configMapRef:
          name: app-config
      # All keys from Secret
      - secretRef:
          name: app-secrets
      # Another ConfigMap with prefix
      - configMapRef:
          name: feature-flags
        prefix: "FF_"
    # Individual overrides (higher priority)
    env:
      - name: DATABASE_HOST
        value: "override-host.example.com"    # Overrides ConfigMap value
```

### Individual Keys (configMapKeyRef)

```yaml
containers:
  - name: app
    env:
      # Single key from ConfigMap
      - name: DB_HOST
        valueFrom:
          configMapKeyRef:
            name: app-config
            key: DATABASE_HOST

      # Single key from Secret
      - name: DB_PASSWORD
        valueFrom:
          secretKeyRef:
            name: db-credentials
            key: password

      # Downward API (pod metadata)
      - name: POD_NAME
        valueFrom:
          fieldRef:
            fieldPath: metadata.name

      # Resource field
      - name: MEMORY_LIMIT
        valueFrom:
          resourceFieldRef:
            containerName: app
            resource: limits.memory
```

### Optional ConfigMaps

```yaml
containers:
  - name: app
    envFrom:
      - configMapRef:
          name: app-config
          optional: true    # Don't fail if ConfigMap doesn't exist
      - secretRef:
          name: app-secrets
          optional: false   # Fail if Secret missing (default)
```

### Verify Injected Variables

```bash
# Check what env vars a pod has
kubectl exec my-app-xxx -- env | sort

# Or check the resolved pod spec
kubectl get pod my-app-xxx -o jsonpath='{.spec.containers[0].envFrom}'

# Debug: print env in container
kubectl exec my-app-xxx -- printenv DATABASE_HOST
# postgres.db.svc
```

## Common Issues

### ConfigMap key with invalid env var characters
- **Cause**: Key contains `-` or `.` (e.g., `app.config.host`) — invalid for env vars
- **Fix**: Use underscores in ConfigMap keys; or use `configMapKeyRef` with explicit `name` mapping

### envFrom not picking up ConfigMap changes
- **Cause**: Environment variables are set at pod creation — not updated live
- **Fix**: Restart pods after ConfigMap update; or use volume mount for live reload

### Priority: env overrides envFrom
- **Cause**: If same key exists in both `env[]` and `envFrom[]`, `env[]` wins
- **Fix**: Intentional — use `env[]` for overrides. Check for unintended conflicts

### Secret values visible in `kubectl describe pod`
- **Cause**: `env` values from Secrets shown in pod spec
- **Fix**: Use volume-mounted Secrets for sensitive values; or rely on RBAC to restrict `describe`

## Best Practices

1. **Use `envFrom` for groups** — inject related config as a unit
2. **Use `env` for individual overrides** — fine-grained control
3. **Prefix when combining ConfigMaps** — avoid key collisions
4. **Keep keys as valid env var names** — uppercase, underscores only (A-Z, 0-9, _)
5. **Mark optional ConfigMaps** — prevent startup failures in dev environments
6. **Use Secrets for sensitive values** — never put passwords in ConfigMaps
7. **Restart after changes** — env vars don't hot-reload (use volumes for that)

## Key Takeaways

- `envFrom.configMapRef` injects ALL ConfigMap keys as environment variables at once
- `envFrom.secretRef` does the same for Secrets
- `prefix` option adds a string prefix to all injected variable names
- `env[].valueFrom.configMapKeyRef` injects a single specific key
- `env[]` takes priority over `envFrom[]` for the same key name
- Changes to ConfigMap require pod restart — env vars are set at creation time
- Use `optional: true` when ConfigMap might not exist yet
