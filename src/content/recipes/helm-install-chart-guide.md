---
title: "Helm Install: Deploy Charts Guide"
description: "Install Helm charts on Kubernetes with helm install, upgrade, rollback, and values customization. Repository management, OCI registries, and release lifecycle."
publishDate: "2026-05-02"
author: "Luca Berton"
category: "helm"
difficulty: "beginner"
timeToComplete: "10 minutes"
kubernetesVersion: "1.28+"
tags:
  - "helm"
  - "charts"
  - "deployment"
  - "package-management"
  - "cka"
relatedRecipes:
  - "helm-templating-sprig"
  - "helm-hooks-lifecycle-guide"
  - "kustomize-vs-helm-comparison"
---

> 💡 **Quick Answer:** `helm install my-release chart-name` deploys a Helm chart. Add `-f values.yaml` for custom config, `--set key=value` for inline overrides, `--namespace` for target namespace, `--create-namespace` to auto-create it. Upgrade: `helm upgrade my-release chart-name`. Rollback: `helm rollback my-release 1`. Uninstall: `helm uninstall my-release`.

## The Problem

Deploying complex applications requires many Kubernetes resources:

- Deployment + Service + Ingress + ConfigMap + Secret + ServiceAccount + RBAC...
- Different config per environment (dev/staging/prod)
- Version management and rollback capability
- Dependency management (app needs Redis, PostgreSQL)

## The Solution

### Install Helm

```bash
# macOS
brew install helm

# Linux
curl https://raw.githubusercontent.com/helm/helm/main/scripts/get-helm-3 | bash

# Verify
helm version
```

### Add Chart Repositories

```bash
# Add popular repos
helm repo add bitnami https://charts.bitnami.com/bitnami
helm repo add ingress-nginx https://kubernetes.github.io/ingress-nginx
helm repo add prometheus-community https://prometheus-community.github.io/helm-charts
helm repo add grafana https://grafana.github.io/helm-charts
helm repo add jetstack https://charts.jetstack.io

# Update repo index
helm repo update

# Search for charts
helm search repo nginx
helm search repo prometheus
helm search hub wordpress    # Search Artifact Hub
```

### Install a Chart

```bash
# Basic install
helm install my-nginx ingress-nginx/ingress-nginx

# With namespace
helm install my-nginx ingress-nginx/ingress-nginx \
  -n ingress-nginx --create-namespace

# With custom values file
helm install my-app bitnami/postgresql \
  -f my-values.yaml \
  -n databases --create-namespace

# With inline overrides
helm install my-app bitnami/postgresql \
  --set auth.postgresPassword=secretpass \
  --set primary.persistence.size=50Gi

# Specific chart version
helm install my-app bitnami/postgresql --version 15.2.0

# Dry run (preview without installing)
helm install my-app bitnami/postgresql --dry-run

# Template only (render YAML)
helm template my-app bitnami/postgresql -f values.yaml
```

### Values Customization

```bash
# View default values
helm show values bitnami/postgresql > default-values.yaml

# Custom values file
cat <<EOF > my-values.yaml
auth:
  postgresPassword: "secretpass"
  database: "mydb"
primary:
  persistence:
    size: 50Gi
    storageClass: fast-ssd
  resources:
    requests:
      cpu: 500m
      memory: 512Mi
    limits:
      cpu: "2"
      memory: 2Gi
metrics:
  enabled: true
EOF

helm install postgres bitnami/postgresql -f my-values.yaml -n databases
```

### Upgrade and Rollback

```bash
# Upgrade release (new values or chart version)
helm upgrade my-app bitnami/postgresql \
  -f updated-values.yaml \
  -n databases

# Upgrade with install fallback (idempotent)
helm upgrade --install my-app bitnami/postgresql \
  -f values.yaml -n databases --create-namespace

# List revision history
helm history my-app -n databases
# REVISION  STATUS      DESCRIPTION
# 1         deployed    Install complete
# 2         deployed    Upgrade complete

# Rollback to revision 1
helm rollback my-app 1 -n databases

# Rollback to previous revision
helm rollback my-app -n databases
```

### Manage Releases

```bash
# List all releases
helm list -A

# List in specific namespace
helm list -n databases

# Get release info
helm get values my-app -n databases        # Current values
helm get manifest my-app -n databases      # Rendered YAML
helm get notes my-app -n databases         # Post-install notes
helm get all my-app -n databases           # Everything

# Release status
helm status my-app -n databases

# Uninstall
helm uninstall my-app -n databases

# Uninstall but keep history
helm uninstall my-app -n databases --keep-history
```

### OCI Registry Charts

```bash
# Pull from OCI registry (Helm 3.8+)
helm pull oci://registry.example.com/charts/myapp --version 1.0.0

# Install from OCI
helm install my-app oci://registry.example.com/charts/myapp --version 1.0.0

# Push to OCI
helm push myapp-1.0.0.tgz oci://registry.example.com/charts/

# Login to OCI registry
helm registry login registry.example.com -u user -p pass
```

### Wait and Timeout

```bash
# Wait for resources to be ready
helm install my-app bitnami/postgresql \
  --wait \
  --timeout 10m

# Atomic: auto-rollback on failure
helm upgrade --install my-app bitnami/postgresql \
  --atomic \
  --timeout 5m
```

## Common Issues

**"release already exists"**

Use `helm upgrade --install` for idempotent deploys. Or `helm uninstall` first.

**"no matches for kind" after helm install**

CRDs not installed. Some charts require `--set installCRDs=true` or separate CRD installation step.

**Values not applying**

YAML indentation error in values file. Validate: `helm template my-app chart -f values.yaml` to see rendered output.

## Best Practices

- **Use `upgrade --install`** for CI/CD — idempotent, works for new and existing releases
- **Use `--atomic`** in production — auto-rollback on failure
- **Pin chart versions** — `--version 15.2.0`, not latest
- **Store values in git** — version-control your customizations
- **`helm diff` plugin** — preview changes before upgrade: `helm diff upgrade my-app chart -f values.yaml`

## Key Takeaways

- `helm install` deploys charts; `helm upgrade` updates them
- Customize with `-f values.yaml` or `--set key=value`
- `helm rollback` reverts to any previous revision
- Use `--atomic` for safe production deployments with auto-rollback
- `helm upgrade --install` is the idempotent pattern for CI/CD
