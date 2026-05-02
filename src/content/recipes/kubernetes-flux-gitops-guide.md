---
title: "Flux: GitOps Toolkit for Kubernetes"
description: "Deploy Flux GitOps toolkit for Kubernetes continuous delivery. Kustomization, HelmRelease, image automation, and multi-tenant GitOps with source controllers."
publishDate: "2026-05-02"
author: "Luca Berton"
category: "deployments"
difficulty: "intermediate"
timeToComplete: "12 minutes"
kubernetesVersion: "1.28+"
tags:
  - "flux"
  - "gitops"
  - "ci-cd"
  - "deployments"
  - "automation"
relatedRecipes:
  - "kubernetes-argocd-gitops-guide"
  - "kubernetes-kustomize-guide"
  - "kubernetes-tekton-pipelines-guide"
---

> 💡 **Quick Answer:** Flux is the CNCF GitOps toolkit — lighter than ArgoCD, CLI-driven (no UI by default). Install: `flux bootstrap github --owner=myorg --repository=fleet --path=clusters/production`. Flux watches Git repos and syncs to cluster. Uses `Kustomization` for plain YAML/Kustomize, `HelmRelease` for Helm charts. Supports image automation — auto-update image tags in Git when new versions are pushed.

## The Problem

ArgoCD is powerful but may be overkill:

- You prefer CLI-driven workflow over UI
- You want image automation (auto-update tags in Git)
- You need multi-tenant GitOps with RBAC per team
- Lighter footprint is important
- You want the toolkit approach (compose what you need)

## The Solution

### Bootstrap Flux

```bash
# Install CLI
curl -s https://fluxcd.io/install.sh | bash

# Bootstrap with GitHub
flux bootstrap github \
  --owner=myorg \
  --repository=fleet-infra \
  --branch=main \
  --path=clusters/production \
  --personal

# Bootstrap with GitLab
flux bootstrap gitlab \
  --owner=myorg \
  --repository=fleet-infra \
  --branch=main \
  --path=clusters/production

# Verify
flux check
kubectl get pods -n flux-system
# source-controller-xxx      Running
# kustomize-controller-xxx   Running
# helm-controller-xxx        Running
# notification-controller    Running
```

### GitRepository + Kustomization

```yaml
# Source: Git repository
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
    name: git-credentials          # For private repos

---
# Kustomization: sync from Git to cluster
apiVersion: kustomize.toolkit.fluxcd.io/v1
kind: Kustomization
metadata:
  name: my-app
  namespace: flux-system
spec:
  interval: 5m
  sourceRef:
    kind: GitRepository
    name: my-app
  path: ./deploy/production
  prune: true                      # Delete removed resources
  targetNamespace: production
  healthChecks:
  - apiVersion: apps/v1
    kind: Deployment
    name: my-app
    namespace: production
  timeout: 3m
```

### HelmRelease

```yaml
# Helm repository source
apiVersion: source.toolkit.fluxcd.io/v1
kind: HelmRepository
metadata:
  name: bitnami
  namespace: flux-system
spec:
  interval: 1h
  url: https://charts.bitnami.com/bitnami

---
# HelmRelease
apiVersion: helm.toolkit.fluxcd.io/v2
kind: HelmRelease
metadata:
  name: redis
  namespace: production
spec:
  interval: 5m
  chart:
    spec:
      chart: redis
      version: "19.x"
      sourceRef:
        kind: HelmRepository
        name: bitnami
        namespace: flux-system
  values:
    architecture: replication
    replica:
      replicaCount: 3
    auth:
      existingSecret: redis-password
  upgrade:
    remediation:
      retries: 3
```

### Image Automation

```yaml
# Scan container registry for new tags
apiVersion: image.toolkit.fluxcd.io/v1beta2
kind: ImageRepository
metadata:
  name: my-app
  namespace: flux-system
spec:
  image: registry.example.com/my-app
  interval: 5m

---
# Policy: use latest semver
apiVersion: image.toolkit.fluxcd.io/v1beta2
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
# Auto-update Git when new image found
apiVersion: image.toolkit.fluxcd.io/v1beta2
kind: ImageUpdateAutomation
metadata:
  name: my-app
  namespace: flux-system
spec:
  interval: 5m
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
      messageTemplate: "Update {{.AutomationObject.Name}} images"
    push:
      branch: main
  update:
    path: ./clusters/production
    strategy: Setters
```

```yaml
# In deployment manifest, mark the image for automation:
containers:
- name: app
  image: registry.example.com/my-app:1.2.3 # {"$imagepolicy": "flux-system:my-app"}
# Flux updates the tag when ImagePolicy finds a newer version
```

### Multi-Tenant Structure

```
fleet-infra/
├── clusters/
│   ├── production/
│   │   ├── flux-system/        # Flux components
│   │   ├── infrastructure/     # Shared infra (ingress, cert-manager)
│   │   └── tenants/            # Per-team configs
│   │       ├── team-a.yaml     # Kustomization for team-a
│   │       └── team-b.yaml     # Kustomization for team-b
│   └── staging/
│       └── ...
├── infrastructure/
│   ├── cert-manager/
│   ├── ingress-nginx/
│   └── monitoring/
└── tenants/
    ├── team-a/
    │   ├── namespace.yaml
    │   ├── rbac.yaml
    │   └── kustomization.yaml
    └── team-b/
        └── ...
```

### Flux CLI Operations

```bash
# Check status
flux get all

# Reconcile immediately
flux reconcile kustomization my-app
flux reconcile helmrelease redis -n production

# Suspend/resume
flux suspend kustomization my-app
flux resume kustomization my-app

# View logs
flux logs --follow

# Export resources
flux export kustomization my-app > my-app-kustomization.yaml

# Diff (what would change)
flux diff kustomization my-app
```

### Notifications

```yaml
apiVersion: notification.toolkit.fluxcd.io/v1beta3
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
apiVersion: notification.toolkit.fluxcd.io/v1beta3
kind: Alert
metadata:
  name: on-deploy
  namespace: flux-system
spec:
  providerRef:
    name: slack
  eventSeverity: info
  eventSources:
  - kind: Kustomization
    name: '*'
  - kind: HelmRelease
    name: '*'
```

## Common Issues

**Kustomization stuck "Not Ready"**

Source not synced or health check failing. Run: `flux get sources git` and `flux logs`.

**HelmRelease "install retries exhausted"**

Helm values error. Check: `flux logs --kind=HelmRelease --name=redis`. Fix values and reconcile.

**Image automation not updating**

Missing `$imagepolicy` marker in YAML. Must be exact comment format: `# {"$imagepolicy": "namespace:policy-name"}`.

## Best Practices

- **Bootstrap once** — Flux manages itself via Git
- **Separate infra from tenants** — infrastructure/ vs tenants/ directories
- **Image automation for CD** — push image → Flux updates Git → syncs cluster
- **Health checks on Kustomizations** — know if deploy actually worked
- **Notifications to Slack** — team visibility on deployments

## Key Takeaways

- Flux is the CNCF GitOps toolkit — modular, CLI-driven, lighter than ArgoCD
- GitRepository + Kustomization for plain YAML; HelmRelease for Helm charts
- Image automation: scans registries and auto-updates image tags in Git
- Multi-tenant via directory structure and RBAC per team
- Flux vs ArgoCD: Flux is CLI/Git-native; ArgoCD has rich UI
