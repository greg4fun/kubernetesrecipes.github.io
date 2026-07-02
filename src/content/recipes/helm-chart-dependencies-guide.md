---
title: "Helm Chart Dependencies: Complete Guide"
description: "Manage Helm chart dependencies and subcharts. Condition flags, tags, import-values, alias patterns, and dependency update workflow for K8s."
publishDate: "2026-04-25"
author: "Luca Berton"
category: "helm"
difficulty: "intermediate"
timeToComplete: "15 minutes"
kubernetesVersion: "1.28+"
tags:
  - "helm"
  - "dependencies"
  - "subcharts"
  - "import-values"
relatedRecipes:
  - "kubernetes-pod-security-standards"
  - "kubernetes-rbac-least-privilege"
---

> 💡 **Quick Answer:** Manage Helm chart dependencies and subcharts. Condition, tags, import-values, and dependency update workflow.

## The Problem

Real applications aren't a single chart — they need a database, a cache, maybe a message queue, each with their own configuration. Copy-pasting those as separate manifests (or separate `helm install` calls) loses the ability to version, template, and release them as one unit.

## The Solution

### Declaring Dependencies

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
```

```bash
# Download dependencies into charts/
helm dependency update
# or, to rebuild strictly from Chart.lock (reproducible)
helm dependency build

helm dependency list
```

### Making Dependencies Optional

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

Group related dependencies with `tags` instead of one condition each:

```yaml
dependencies:
  - name: backend-api
    repository: "file://../backend-api"
    version: "1.0.0"
    tags: [backend]
  - name: worker
    repository: "file://../worker"
    version: "1.0.0"
    tags: [backend]
```

```bash
# Disable an entire tag group at install time
helm install myapp . --set tags.backend=false
```

### Overriding Subchart Values

Values for a subchart go under a top-level key matching its name (or `alias`):

```yaml
# values.yaml
postgresql:
  enabled: true
  auth:
    postgresPassword: "secretpassword"
    database: "myapp"
  primary:
    persistence:
      size: 20Gi
    resources:
      requests: {memory: 256Mi, cpu: 100m}
      limits: {memory: 512Mi, cpu: 500m}
```

### Importing Values Between Charts

Expose a subchart's nested value at the parent's top level instead of reaching through the full path every time:

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
# templates now use .Values.database.port instead of
# .Values.postgresql.primary.service.port
```

### Multiple Instances of the Same Chart

Use `alias` to install the same dependency twice with different config — e.g. separate Redis instances for caching and sessions:

```yaml
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
# values.yaml — each alias gets its own values block
redis-cache:
  master: {persistence: {size: 2Gi}}
redis-session:
  master: {persistence: {size: 1Gi}}
```

### Local and OCI Dependencies

```yaml
dependencies:
  # Local chart, useful for monorepo microservices
  - name: shared-lib
    version: "1.0.0"
    repository: "file://../shared-lib"
  # OCI registry
  - name: mylib
    version: "1.0.0"
    repository: "oci://registry.example.com/charts"
```

```bash
helm registry login registry.example.com   # before pulling OCI dependencies
```

### Waiting for a Dependency to Be Ready

Helm doesn't sequence subchart startup — a Deployment can start before its database is reachable. Use an initContainer to block until it is:

```yaml
initContainers:
  - name: wait-for-db
    image: busybox:latest
    command:
      - sh
      - -c
      - |
        until nc -z {{ .Release.Name }}-postgresql 5432; do
          echo "Waiting for PostgreSQL..."; sleep 2
        done
```

### Chart.lock

`helm dependency update` generates a `Chart.lock` pinning exact resolved versions — commit it so `helm dependency build` reproduces the same dependency tree on every machine and in CI:

```yaml
# Chart.lock — auto-generated, commit to version control
dependencies:
  - name: postgresql
    repository: https://charts.bitnami.com/bitnami
    version: 12.5.6
digest: sha256:abc123...
```

## Common Issues

| Issue | Cause | Fix |
|-------|-------|-----|
| `helm install` fails with "chart requires..." | Dependencies weren't downloaded | Run `helm dependency update` before install/package |
| Subchart values not applying | Wrong key name in parent `values.yaml` | Key must match the dependency's `name` (or `alias` if set) |
| Two instances of the same chart conflict | No `alias` set | Add `alias:` to each dependency entry and namespace values under the alias |
| CI produces different versions than local | `Chart.lock` not committed | Commit `Chart.lock`; use `helm dependency build` (not `update`) in CI for reproducibility |

## Best Practices

- **Commit `Chart.lock`** and use `helm dependency build` in CI — `helm dependency update` can silently resolve to a newer version within your semver range
- **Use `condition` for anything a deployment might not need** — an in-cluster Redis vs. an external managed one, for example
- **Use `alias` for multiple instances**, not copy-pasted charts — one dependency declaration, values scoped per alias
- **Add a wait-for-dependency initContainer** for anything with a real startup order requirement — Helm installs subcharts, it doesn't sequence their readiness
- **Keep global values (`global:`) for things every subchart needs** — image registry, image pull secrets, storage class — instead of repeating them per subchart

## Key Takeaways

- Dependencies are declared in `Chart.yaml`, downloaded to `charts/` with `helm dependency update`, and locked in `Chart.lock`
- Values for a subchart go under a top-level key matching its `name` or `alias`
- `condition` makes a dependency optional; `tags` toggle groups of dependencies together
- `alias` lets you install the same chart multiple times with independent configuration
- Helm doesn't sequence subchart startup order — use an initContainer to wait for a dependency to actually be ready
