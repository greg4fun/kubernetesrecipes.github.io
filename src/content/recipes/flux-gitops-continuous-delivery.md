---
title: "GitOps with Flux CD for Continuous Delivery"
description: "Implement GitOps workflows using Flux CD to automate Kubernetes deployments, manage infrastructure as code, and maintain desired cluster state from Git repositories"
category: "deployments"
difficulty: "intermediate"
timeToComplete: "45 minutes"
kubernetesVersion: "1.28+"
prerequisites:
  - "Understanding of Git and version control"
  - "Knowledge of Kubernetes manifests"
  - "Familiarity with CI/CD concepts"
relatedRecipes:
  - "argocd-gitops"
  - "helm-chart-creation"
  - "kustomize-configuration"
tags:
  - gitops
  - flux
  - continuous-delivery
  - automation
  - infrastructure-as-code
publishDate: "2026-01-28"
author: "kubernetes-recipes"
---

## Problem

Manual kubectl apply commands and ad-hoc deployments lead to configuration drift, lack of auditability, and make it difficult to track what's running in your cluster. You need declarative, version-controlled infrastructure management.

## Solution

Implement GitOps using Flux CD to automatically sync Kubernetes cluster state with Git repositories. Flux continuously monitors Git repos and applies changes automatically, ensuring your cluster matches the desired state defined in Git.

### Architecture

```
┌─────────────────────────────────────────────────────┐
│              Git Repository (Source of Truth)        │
│  ┌────────────┐  ┌────────────┐  ┌────────────┐   │
│  │ Manifests  │  │ Helm Charts│  │ Kustomize  │   │
│  └────────────┘  └────────────┘  └────────────┘   │
└──────────────────────┬──────────────────────────────┘
                       │
                       │ Git Pull (every 1m)
                       ▼
┌─────────────────────────────────────────────────────┐
│          Flux CD Controllers                         │
│  ┌────────────┐  ┌────────────┐  ┌────────────┐   │
│  │   Source   │  │ Kustomize  │  │   Helm     │   │
│  │ Controller │  │ Controller │  │ Controller │   │
│  └────────────┘  └────────────┘  └────────────┘   │
└──────────────────────┬──────────────────────────────┘
                       │ Apply/Reconcile
                       ▼
┌─────────────────────────────────────────────────────┐
│          Kubernetes Cluster                          │
│  ┌────────────┐  ┌────────────┐  ┌────────────┐   │
│  │ Workloads  │  │  Services  │  │   Config   │   │
│  └────────────┘  └────────────┘  └────────────┘   │
└─────────────────────────────────────────────────────┘
                       │
                       │ Status Updates
                       ▼
┌─────────────────────────────────────────────────────┐
│          Notifications (Slack, Teams, etc.)         │
└─────────────────────────────────────────────────────┘
```

### Step 1: Install Flux CLI

Install the Flux CLI tool:

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

### Step 2: Bootstrap Flux in Cluster

Bootstrap Flux with GitHub:

```bash
# Export GitHub token
export GITHUB_TOKEN=<your-token>
export GITHUB_USER=<your-username>

# Bootstrap Flux with GitHub
flux bootstrap github \
  --owner=$GITHUB_USER \
  --repository=fleet-infra \
  --branch=main \
  --path=./clusters/production \
  --personal

# For GitLab
flux bootstrap gitlab \
  --owner=$GITLAB_USER \
  --repository=fleet-infra \
  --branch=main \
  --path=./clusters/production \
  --personal

# Verify Flux components
kubectl get pods -n flux-system
flux check
```

This creates:
- Git repository (if it doesn't exist)
- Flux components in cluster
- Deploy keys for Git access
- Flux manifests in repo

### Step 3: Create GitRepository Source

Define a Git repository as source:

```yaml
apiVersion: source.toolkit.fluxcd.io/v1
kind: GitRepository
metadata:
  name: applications
  namespace: flux-system
spec:
  interval: 1m0s
  url: https://github.com/myorg/applications
  ref:
    branch: main
  secretRef:
    name: github-credentials
  ignore: |
    # Exclude CI/CD files
    .github/
    .gitlab/
    # Exclude documentation
    docs/
```

Create credentials secret:

```bash
# Using HTTPS with token
kubectl create secret generic github-credentials \
  --namespace flux-system \
  --from-literal=username=git \
  --from-literal=password=$GITHUB_TOKEN

# Or using SSH
flux create secret git github-ssh \
  --url=ssh://git@github.com/myorg/applications \
  --namespace=flux-system
```

### Step 4: Create Kustomization for Plain Manifests

Deploy plain Kubernetes YAML files:

```yaml
apiVersion: kustomize.toolkit.fluxcd.io/v1
kind: Kustomization
metadata:
  name: infrastructure
  namespace: flux-system
spec:
  interval: 10m0s
  path: ./infrastructure
  prune: true
  sourceRef:
    kind: GitRepository
    name: applications
  healthChecks:
  - apiVersion: apps/v1
    kind: Deployment
    name: nginx
    namespace: default
  timeout: 2m0s
  wait: true
```

Repository structure:

```
applications/
├── infrastructure/
│   ├── namespace.yaml
│   ├── configmap.yaml
│   └── deployment.yaml
└── apps/
    ├── frontend/
    └── backend/
```

### Step 5: Deploy Helm Charts with Flux

Create HelmRepository source:

```yaml
apiVersion: source.toolkit.fluxcd.io/v1beta2
kind: HelmRepository
metadata:
  name: bitnami
  namespace: flux-system
spec:
  interval: 1h0s
  url: https://charts.bitnami.com/bitnami
---
apiVersion: helm.toolkit.fluxcd.io/v2beta1
kind: HelmRelease
metadata:
  name: postgresql
  namespace: database
spec:
  interval: 10m0s
  chart:
    spec:
      chart: postgresql
      version: '12.x'
      sourceRef:
        kind: HelmRepository
        name: bitnami
        namespace: flux-system
  values:
    auth:
      postgresPassword: changeme
    primary:
      persistence:
        enabled: true
        size: 20Gi
  install:
    remediation:
      retries: 3
  upgrade:
    remediation:
      retries: 3
```

Using HelmChart from Git:

```yaml
apiVersion: source.toolkit.fluxcd.io/v1
kind: GitRepository
metadata:
  name: helm-charts
  namespace: flux-system
spec:
  interval: 1m0s
  url: https://github.com/myorg/helm-charts
  ref:
    branch: main
---
apiVersion: helm.toolkit.fluxcd.io/v2beta1
kind: HelmRelease
metadata:
  name: myapp
  namespace: production
spec:
  interval: 5m0s
  chart:
    spec:
      chart: ./charts/myapp
      sourceRef:
        kind: GitRepository
        name: helm-charts
        namespace: flux-system
  values:
    replicas: 3
    image:
      repository: myapp
      tag: v1.2.3
```

### Step 6: Implement Multi-Environment Strategy

Structure repositories for multiple environments:

```
fleet-infra/
├── clusters/
│   ├── production/
│   │   ├── flux-system/
│   │   └── apps.yaml
│   ├── staging/
│   │   ├── flux-system/
│   │   └── apps.yaml
│   └── development/
│       ├── flux-system/
│       └── apps.yaml
└── apps/
    ├── base/
    │   └── app/
    │       ├── deployment.yaml
    │       ├── service.yaml
    │       └── kustomization.yaml
    ├── staging/
    │   └── kustomization.yaml
    └── production/
        └── kustomization.yaml
```

Production kustomization:

```yaml
# clusters/production/apps.yaml
apiVersion: kustomize.toolkit.fluxcd.io/v1
kind: Kustomization
metadata:
  name: apps
  namespace: flux-system
spec:
  interval: 10m0s
  path: ./apps/production
  prune: true
  sourceRef:
    kind: GitRepository
    name: flux-system
```

### Step 7: Configure Image Automation

Automate image updates from container registry:

```yaml
# Image repository to scan
apiVersion: image.toolkit.fluxcd.io/v1beta2
kind: ImageRepository
metadata:
  name: myapp
  namespace: flux-system
spec:
  image: ghcr.io/myorg/myapp
  interval: 1m0s
  secretRef:
    name: ghcr-credentials
---
# Image policy for semantic versioning
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
      range: '>=1.0.0 <2.0.0'
---
# Image update automation
apiVersion: image.toolkit.fluxcd.io/v1beta1
kind: ImageUpdateAutomation
metadata:
  name: flux-system
  namespace: flux-system
spec:
  interval: 1m0s
  sourceRef:
    kind: GitRepository
    name: flux-system
  git:
    checkout:
      ref:
        branch: main
    commit:
      author:
        email: fluxcdbot@users.noreply.github.com
        name: fluxcdbot
      messageTemplate: |
        Automated image update
        
        Files updated:
        {{ range $filename, $_ := .Changed.FileChanges -}}
        - {{ $filename }}
        {{ end -}}
    push:
      branch: main
  update:
    path: ./apps/production
    strategy: Setters
```

Mark images for automation in manifests:

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: myapp
spec:
  template:
    spec:
      containers:
      - name: myapp
        image: ghcr.io/myorg/myapp:v1.0.0 # {"$imagepolicy": "flux-system:myapp"}
```

### Step 8: Configure Notifications

Set up alerts for deployment events:

```yaml
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
apiVersion: notification.toolkit.fluxcd.io/v1beta2
kind: Alert
metadata:
  name: deployment-alerts
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
  - kind: ImageUpdateAutomation
    name: '*'
```

Create webhook secret:

```bash
kubectl create secret generic slack-webhook \
  --namespace flux-system \
  --from-literal=address=https://hooks.slack.com/services/YOUR/WEBHOOK/URL
```

### Step 9: Implement Progressive Delivery with Flagger

Install Flagger for canary deployments:

```bash
flux create source helm flagger \
  --url=https://flagger.app \
  --namespace=flux-system

flux create helmrelease flagger \
  --source=HelmRepository/flagger \
  --chart=flagger \
  --namespace=flux-system
```

Create canary deployment:

```yaml
apiVersion: flagger.app/v1beta1
kind: Canary
metadata:
  name: myapp
  namespace: production
spec:
  targetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: myapp
  service:
    port: 8080
  analysis:
    interval: 1m
    threshold: 5
    maxWeight: 50
    stepWeight: 10
    metrics:
    - name: request-success-rate
      thresholdRange:
        min: 99
      interval: 1m
    - name: request-duration
      thresholdRange:
        max: 500
      interval: 1m
```

## Verification

Check Flux components:

```bash
# Check all Flux components
flux check

# List all sources
flux get sources all

# List all kustomizations
flux get kustomizations

# List all helm releases
flux get helmreleases
```

Monitor reconciliation:

```bash
# Watch reconciliation
flux get kustomizations --watch

# View reconciliation logs
flux logs --kind=Kustomization --name=apps

# Force reconciliation
flux reconcile kustomization apps --with-source

# Suspend reconciliation
flux suspend kustomization apps
flux resume kustomization apps
```

Check image automation:

```bash
# List image repositories
flux get image repository

# List image policies
flux get image policy

# View latest scanned images
kubectl describe imagerepository myapp -n flux-system
```

Debug issues:

```bash
# Export current state
flux export source git --all > sources.yaml
flux export kustomization --all > kustomizations.yaml

# View events
kubectl get events -n flux-system --sort-by='.lastTimestamp'

# Check controller logs
kubectl logs -n flux-system deployment/source-controller
kubectl logs -n flux-system deployment/kustomize-controller
kubectl logs -n flux-system deployment/helm-controller
```

## Best Practices

1. **Use separate repos** for infrastructure and applications
2. **Implement branch protection** on main branch
3. **Enable notifications** for deployment visibility
4. **Use semantic versioning** for image automation
5. **Structure repos** for multi-environment management
6. **Set appropriate intervals** for reconciliation
7. **Use health checks** to verify deployments
8. **Implement progressive delivery** for critical apps
9. **Encrypt secrets** with SOPS or Sealed Secrets
10. **Monitor Flux metrics** and logs regularly

## Common Issues

**Flux not reconciling:**
- Check Git credentials are valid
- Verify branch and path are correct
- Check controller logs for errors

**HelmRelease failing:**
- Verify chart version exists
- Check values syntax
- Review Helm controller logs

**Image automation not working:**
- Verify registry credentials
- Check image policy range
- Ensure image markers are correct

## Related Resources

- [Flux Documentation](https://fluxcd.io/docs/)
- [GitOps Toolkit](https://toolkit.fluxcd.io/)
- [Flux Best Practices](https://fluxcd.io/flux/guides/)
- [Flagger Progressive Delivery](https://docs.flagger.app/)

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
