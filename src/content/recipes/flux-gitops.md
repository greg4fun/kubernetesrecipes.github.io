---
title: "How to Deploy with Flux GitOps"
description: "Implement GitOps continuous deployment with Flux CD. Automatically sync Kubernetes manifests and Helm releases from Git repositories."
category: "deployments"
difficulty: "intermediate"
publishDate: "2026-01-22"
tags: ["flux", "gitops", "continuous-deployment", "helm", "kustomize"]
author: "Luca Berton"
---

> 💡 **Quick Answer:** Bootstrap Flux with `flux bootstrap github --owner=myorg --repository=fleet-infra --path=clusters/production`. Create `GitRepository` + `Kustomization` CRDs to sync manifests, or `HelmRepository` + `HelmRelease` for Helm charts. Flux watches Git and auto-applies changes.
>
> **Key concept:** Flux uses source controllers (GitRepository, HelmRepository) + reconciliation controllers (Kustomization, HelmRelease).
>
> **Gotcha:** Flux is pull-based—no webhooks needed but changes take up to `interval` time. Set `interval: 1m` for faster sync.

# How to Deploy with Flux GitOps

Flux is a set of continuous delivery solutions for Kubernetes. It automatically reconciles cluster state with Git repositories.

## Install Flux CLI

```bash
# macOS
brew install fluxcd/tap/flux

# Linux
curl -s https://fluxcd.io/install.sh | sudo bash

# Verify
flux --version
flux check --pre
```

## Bootstrap Flux

```bash
# Bootstrap with GitHub
export GITHUB_TOKEN=<your-token>

flux bootstrap github \
  --owner=myorg \
  --repository=fleet-infra \
  --branch=main \
  --path=clusters/production \
  --personal

# Bootstrap with GitLab
export GITLAB_TOKEN=<your-token>

flux bootstrap gitlab \
  --owner=myorg \
  --repository=fleet-infra \
  --branch=main \
  --path=clusters/production
```

## GitRepository Source

```yaml
# git-repository.yaml
apiVersion: source.toolkit.fluxcd.io/v1
kind: GitRepository
metadata:
  name: my-app
  namespace: flux-system
spec:
  interval: 1m
  url: https://github.com/myorg/my-app
  ref:
    branch: main
  secretRef:
    name: github-token  # For private repos
```

## Kustomization (Sync Manifests)

```yaml
# kustomization.yaml
apiVersion: kustomize.toolkit.fluxcd.io/v1
kind: Kustomization
metadata:
  name: my-app
  namespace: flux-system
spec:
  interval: 5m
  path: ./k8s/overlays/production
  prune: true  # Delete removed resources
  sourceRef:
    kind: GitRepository
    name: my-app
  targetNamespace: production
  healthChecks:
    - apiVersion: apps/v1
      kind: Deployment
      name: my-app
      namespace: production
```

## HelmRepository Source

```yaml
# helm-repository.yaml
apiVersion: source.toolkit.fluxcd.io/v1beta2
kind: HelmRepository
metadata:
  name: bitnami
  namespace: flux-system
spec:
  interval: 1h
  url: https://charts.bitnami.com/bitnami
```

## HelmRelease

```yaml
# helm-release.yaml
apiVersion: helm.toolkit.fluxcd.io/v2beta1
kind: HelmRelease
metadata:
  name: redis
  namespace: production
spec:
  interval: 5m
  chart:
    spec:
      chart: redis
      version: "17.x"
      sourceRef:
        kind: HelmRepository
        name: bitnami
        namespace: flux-system
  values:
    architecture: standalone
    auth:
      enabled: true
    master:
      persistence:
        size: 10Gi
  valuesFrom:
    - kind: ConfigMap
      name: redis-values
      optional: true
```

## Image Automation

```yaml
# image-repository.yaml
apiVersion: image.toolkit.fluxcd.io/v1beta1
kind: ImageRepository
metadata:
  name: my-app
  namespace: flux-system
spec:
  image: ghcr.io/myorg/my-app
  interval: 1m
---
# image-policy.yaml
apiVersion: image.toolkit.fluxcd.io/v1beta1
kind: ImagePolicy
metadata:
  name: my-app
  namespace: flux-system
spec:
  imageRepositoryRef:
    name: my-app
  policy:
    semver:
      range: ">=1.0.0"
---
# image-update-automation.yaml
apiVersion: image.toolkit.fluxcd.io/v1beta1
kind: ImageUpdateAutomation
metadata:
  name: my-app
  namespace: flux-system
spec:
  interval: 1m
  sourceRef:
    kind: GitRepository
    name: fleet-infra
  git:
    checkout:
      ref:
        branch: main
    commit:
      author:
        name: fluxbot
        email: flux@example.com
      messageTemplate: "Update image to {{.NewImage}}"
    push:
      branch: main
  update:
    path: ./clusters/production
    strategy: Setters
```

## Multi-Cluster Setup

```yaml
# clusters/production/kustomization.yaml
apiVersion: kustomize.config.k8s.io/v1beta1
kind: Kustomization
resources:
  - ../../base/apps
  - ../../base/infrastructure
patches:
  - path: patches/replicas.yaml
```

## Flux CLI Commands

```bash
# Check Flux status
flux check

# Get all Flux resources
flux get all

# Reconcile immediately
flux reconcile source git my-app
flux reconcile kustomization my-app

# Suspend/resume
flux suspend kustomization my-app
flux resume kustomization my-app

# View logs
flux logs --follow

# Export resources
flux export source git my-app > git-repository.yaml
```

## Notifications

```yaml
# notification-provider.yaml
apiVersion: notification.toolkit.fluxcd.io/v1beta2
kind: Provider
metadata:
  name: slack
  namespace: flux-system
spec:
  type: slack
  channel: deployments
  secretRef:
    name: slack-webhook
---
# alert.yaml
apiVersion: notification.toolkit.fluxcd.io/v1beta2
kind: Alert
metadata:
  name: on-call
  namespace: flux-system
spec:
  providerRef:
    name: slack
  eventSeverity: error
  eventSources:
    - kind: Kustomization
      name: "*"
    - kind: HelmRelease
      name: "*"
```

## Troubleshooting

```bash
# Check source status
flux get sources git

# Check kustomization status  
flux get kustomizations

# Check helm releases
flux get helmreleases -A

# Describe for errors
kubectl describe kustomization my-app -n flux-system

# Force reconciliation
flux reconcile kustomization my-app --with-source
```
