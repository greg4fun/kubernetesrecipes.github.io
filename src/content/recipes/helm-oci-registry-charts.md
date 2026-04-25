---
title: "Helm OCI Registry for Charts"
description: "Store and manage Helm charts in OCI-compliant registries like GHCR, ECR, ACR, and Quay. Push, pull, and version charts using standard container registries."
publishDate: "2026-04-20"
author: "Luca Berton"
category: "helm"
difficulty: "intermediate"
timeToComplete: "15 minutes"
kubernetesVersion: "1.28+"
tags:
  - helm
  - oci
  - registry
  - charts
  - ghcr
relatedRecipes:
  - "helm-values-override-patterns"
  - "helm-rollback-history-guide"
---

> 💡 **Quick Answer:** Use `helm push mychart-1.0.0.tgz oci://ghcr.io/myorg/charts` to store charts in OCI registries. Pull with `helm pull oci://ghcr.io/myorg/charts/mychart --version 1.0.0`. Install directly: `helm install myrelease oci://ghcr.io/myorg/charts/mychart --version 1.0.0`. No `helm repo add` needed — OCI registries replace traditional chart repos.

## The Problem

Traditional Helm chart repositories (index.yaml-based) require dedicated infrastructure, don't support fine-grained access control, and lack the mature tooling of container registries. You want to use the same registry for images AND charts.

## The Solution

### Login to OCI Registry

```bash
# GitHub Container Registry
echo $GITHUB_TOKEN | helm registry login ghcr.io -u USERNAME --password-stdin

# AWS ECR
aws ecr get-login-password | helm registry login AWS_ACCOUNT.dkr.ecr.REGION.amazonaws.com --password-stdin

# Azure Container Registry
helm registry login myregistry.azurecr.io -u $SP_ID -p $SP_SECRET

# Quay.io
helm registry login quay.io -u $QUAY_USER -p $QUAY_TOKEN
```

### Package and Push

```bash
# Package chart
helm package ./mychart
# Creates: mychart-1.0.0.tgz

# Push to OCI registry
helm push mychart-1.0.0.tgz oci://ghcr.io/myorg/charts

# Push with specific tag
helm push mychart-1.0.0.tgz oci://ghcr.io/myorg/charts
# Chart stored at: ghcr.io/myorg/charts/mychart:1.0.0
```

### Pull and Install

```bash
# Pull chart archive
helm pull oci://ghcr.io/myorg/charts/mychart --version 1.0.0

# Install directly from OCI
helm install myrelease oci://ghcr.io/myorg/charts/mychart --version 1.0.0

# Install with values
helm install myrelease oci://ghcr.io/myorg/charts/mychart \
  --version 1.0.0 \
  --values production-values.yaml

# Template (dry run)
helm template myrelease oci://ghcr.io/myorg/charts/mychart --version 1.0.0
```

### Show Chart Info

```bash
# View chart metadata
helm show chart oci://ghcr.io/myorg/charts/mychart --version 1.0.0

# View default values
helm show values oci://ghcr.io/myorg/charts/mychart --version 1.0.0

# View README
helm show readme oci://ghcr.io/myorg/charts/mychart --version 1.0.0
```

## CI/CD Pipeline (GitHub Actions)

```yaml
name: Publish Helm Chart
on:
  push:
    tags: ['v*']

jobs:
  publish:
    runs-on: ubuntu-latest
    permissions:
      packages: write
    steps:
      - uses: actions/checkout@v4
      
      - name: Install Helm
        uses: azure/setup-helm@v4
      
      - name: Login to GHCR
        run: echo "${{ secrets.GITHUB_TOKEN }}" | helm registry login ghcr.io -u ${{ github.actor }} --password-stdin
      
      - name: Package chart
        run: helm package ./charts/mychart
      
      - name: Push chart
        run: helm push mychart-*.tgz oci://ghcr.io/${{ github.repository_owner }}/charts
```

## OCI as Helm Dependency

```yaml
# Chart.yaml
dependencies:
  - name: postgresql
    version: "15.5.0"
    repository: "oci://registry-1.docker.io/bitnamicharts"
  - name: redis
    version: "19.0.0"
    repository: "oci://registry-1.docker.io/bitnamicharts"
```

```bash
helm dependency update ./mychart
```

## Common Issues

| Issue | Cause | Fix |
|-------|-------|-----|
| `unauthorized: authentication required` | Not logged in | Run `helm registry login` first |
| `chart metadata name mismatch` | Chart.yaml name ≠ filename | Ensure `name` in Chart.yaml matches |
| `version already exists` | Pushing same version twice | Bump version or use `--force` (if supported) |
| Can't list charts | OCI has no `index.yaml` | Use registry UI or API to browse |
| `helm repo add` doesn't work | OCI doesn't use repo protocol | Use `oci://` prefix directly |

## Best Practices

1. **Use semantic versioning** — OCI tags are the chart version
2. **Sign charts with cosign** — `cosign sign ghcr.io/myorg/charts/mychart:1.0.0`
3. **Use GitHub Packages for open source** — Free for public repos
4. **Mirror public charts** — Pull from upstream OCI and push to your registry
5. **Don't use `latest` tag** — Always pin chart versions in production

## Key Takeaways

- OCI registries replace traditional `index.yaml` Helm repositories
- Same registry hosts both container images and Helm charts
- No `helm repo add/update` needed — reference charts directly with `oci://`
- All major registries support OCI charts: GHCR, ECR, ACR, Quay, Docker Hub
- CI/CD pipelines push charts alongside images for atomic releases
