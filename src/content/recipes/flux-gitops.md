---
title: "How to Set Up GitOps with Flux CD"
description: "Implement GitOps workflows with Flux CD. Automate deployments, manage Helm releases, and synchronize Kubernetes state with Git repositories."
category: "deployments"
difficulty: "intermediate"
publishDate: "2026-01-22"
tags: ["flux", "gitops", "continuous-deployment", "automation", "helm"]
---

# How to Set Up GitOps with Flux CD

Flux CD is a GitOps toolkit for Kubernetes that keeps clusters in sync with configuration stored in Git repositories. It supports Kustomize, Helm, and plain manifests.

## Install Flux CLI

```bash
# macOS
brew install fluxcd/tap/flux

# Linux
curl -s https://fluxcd.io/install.sh | sudo bash

# Verify installation
flux --version

# Check cluster prerequisites
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
  --owner=mygroup \
  --repository=fleet-infra \
  --branch=main \
  --path=clusters/production
```

## Repository Structure

```bash
fleet-infra/
├── clusters/
│   └── production/
│       ├── flux-system/          # Flux components (auto-generated)
│       ├── infrastructure.yaml   # Kustomization for infra
│       └── apps.yaml            # Kustomization for apps
├── infrastructure/
│   ├── base/
│   │   ├── ingress-nginx/
│   │   └── cert-manager/
│   └── production/
│       └── kustomization.yaml
└── apps/
    ├── base/
    │   └── myapp/
    └── production/
        └── kustomization.yaml
```

## GitRepository Source

```yaml
# git-source.yaml
apiVersion: source.toolkit.fluxcd.io/v1
kind: GitRepository
metadata:
  name: myapp-repo
  namespace: flux-system
spec:
  interval: 1m
  url: https://github.com/myorg/myapp-manifests
  ref:
    branch: main
  secretRef:
    name: github-credentials  # For private repos
```

## Kustomization (Deploy from Git)

```yaml
# kustomization-deploy.yaml
apiVersion: kustomize.toolkit.fluxcd.io/v1
kind: Kustomization
metadata:
  name: myapp
  namespace: flux-system
spec:
  interval: 10m
  targetNamespace: production
  sourceRef:
    kind: GitRepository
    name: myapp-repo
  path: ./manifests/production
  prune: true          # Delete resources removed from Git
  healthChecks:
    - apiVersion: apps/v1
      kind: Deployment
      name: myapp
      namespace: production
  timeout: 2m
```

## HelmRepository Source

```yaml
# helm-source.yaml
apiVersion: source.toolkit.fluxcd.io/v1beta2
kind: HelmRepository
metadata:
  name: bitnami
  namespace: flux-system
spec:
  interval: 30m
  url: https://charts.bitnami.com/bitnami
---
apiVersion: source.toolkit.fluxcd.io/v1beta2
kind: HelmRepository
metadata:
  name: ingress-nginx
  namespace: flux-system
spec:
  interval: 1h
  url: https://kubernetes.github.io/ingress-nginx
```

## HelmRelease

```yaml
# helm-release.yaml
apiVersion: helm.toolkit.fluxcd.io/v2beta2
kind: HelmRelease
metadata:
  name: nginx-ingress
  namespace: ingress-nginx
spec:
  interval: 30m
  chart:
    spec:
      chart: ingress-nginx
      version: "4.x"
      sourceRef:
        kind: HelmRepository
        name: ingress-nginx
        namespace: flux-system
  values:
    controller:
      replicaCount: 2
      resources:
        requests:
          cpu: 100m
          memory: 128Mi
  install:
    crds: CreateReplace
  upgrade:
    crds: CreateReplace
    remediation:
      retries: 3
```

## HelmRelease with Values from ConfigMap/Secret

```yaml
# helm-release-values.yaml
apiVersion: helm.toolkit.fluxcd.io/v2beta2
kind: HelmRelease
metadata:
  name: myapp
  namespace: production
spec:
  interval: 10m
  chart:
    spec:
      chart: myapp
      version: "1.2.x"
      sourceRef:
        kind: HelmRepository
        name: myrepo
        namespace: flux-system
  valuesFrom:
    - kind: ConfigMap
      name: myapp-values
      valuesKey: values.yaml
    - kind: Secret
      name: myapp-secrets
      valuesKey: secrets.yaml
  values:
    # Inline values (lowest priority)
    replicas: 3
```

## Image Automation

```yaml
# image-repository.yaml
apiVersion: image.toolkit.fluxcd.io/v1beta2
kind: ImageRepository
metadata:
  name: myapp
  namespace: flux-system
spec:
  image: myregistry/myapp
  interval: 1m
  secretRef:
    name: registry-credentials
---
# image-policy.yaml
apiVersion: image.toolkit.fluxcd.io/v1beta2
kind: ImagePolicy
metadata:
  name: myapp
  namespace: flux-system
spec:
  imageRepositoryRef:
    name: myapp
  policy:
    semver:
      range: "1.x"  # Latest 1.x version
---
# image-update.yaml
apiVersion: image.toolkit.fluxcd.io/v1beta2
kind: ImageUpdateAutomation
metadata:
  name: myapp
  namespace: flux-system
spec:
  interval: 10m
  sourceRef:
    kind: GitRepository
    name: myapp-repo
  git:
    checkout:
      ref:
        branch: main
    commit:
      author:
        name: fluxcdbot
        email: flux@example.com
      messageTemplate: 'Update {{ .AutomationObject.Name }} images'
    push:
      branch: main
  update:
    path: ./manifests
    strategy: Setters
```

## Mark Images for Auto-Update

```yaml
# deployment.yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: myapp
spec:
  template:
    spec:
      containers:
        - name: app
          image: myregistry/myapp:1.0.0 # {"$imagepolicy": "flux-system:myapp"}
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
  channel: flux-notifications
  secretRef:
    name: slack-webhook
---
# alert.yaml
apiVersion: notification.toolkit.fluxcd.io/v1beta2
kind: Alert
metadata:
  name: deployment-alerts
  namespace: flux-system
spec:
  providerRef:
    name: slack
  eventSeverity: error
  eventSources:
    - kind: Kustomization
      name: '*'
    - kind: HelmRelease
      name: '*'
```

## Multi-Cluster Setup

```yaml
# clusters/production/infrastructure.yaml
apiVersion: kustomize.toolkit.fluxcd.io/v1
kind: Kustomization
metadata:
  name: infrastructure
  namespace: flux-system
spec:
  interval: 10m
  sourceRef:
    kind: GitRepository
    name: flux-system
  path: ./infrastructure/production
  prune: true
  dependsOn: []  # Deploy first
---
# clusters/production/apps.yaml
apiVersion: kustomize.toolkit.fluxcd.io/v1
kind: Kustomization
metadata:
  name: apps
  namespace: flux-system
spec:
  interval: 10m
  sourceRef:
    kind: GitRepository
    name: flux-system
  path: ./apps/production
  prune: true
  dependsOn:
    - name: infrastructure  # Deploy after infrastructure
```

## Suspend/Resume Resources

```bash
# Suspend reconciliation
flux suspend kustomization myapp
flux suspend helmrelease nginx-ingress

# Resume
flux resume kustomization myapp
flux resume helmrelease nginx-ingress

# Force reconciliation
flux reconcile kustomization myapp --with-source
flux reconcile helmrelease nginx-ingress
```

## Monitoring Flux

```bash
# Check Flux status
flux check

# Get all Flux resources
flux get all

# Get specific resources
flux get sources git
flux get kustomizations
flux get helmreleases

# Watch events
flux events --watch

# View logs
flux logs --level=error
kubectl logs -n flux-system deployment/source-controller
```

## Troubleshooting

```bash
# Detailed status
flux get kustomization myapp -o yaml

# Check source
flux get source git myapp-repo

# Reconcile manually
flux reconcile source git myapp-repo
flux reconcile kustomization myapp

# View events
kubectl events -n flux-system --for Kustomization/myapp
```

## Summary

Flux CD implements GitOps by continuously syncing Kubernetes with Git. Bootstrap Flux to create the GitOps repository structure. Use GitRepository sources for manifests and HelmRepository for charts. Kustomization resources deploy plain manifests/Kustomize, while HelmRelease deploys Helm charts. Enable image automation to auto-update container images. Set up notifications for deployment alerts. Flux ensures your cluster state always matches what's defined in Git.

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
