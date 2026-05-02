---
title: "ArgoCD GitOps: Declarative Continuous Delivery"
description: "Deploy applications with ArgoCD GitOps in Kubernetes. Application sync, auto-heal, multi-cluster management, ApplicationSets, and Helm/Kustomize integration."
publishDate: "2026-05-02"
author: "Luca Berton"
category: "deployments"
difficulty: "intermediate"
timeToComplete: "15 minutes"
kubernetesVersion: "1.28+"
tags:
  - "argocd"
  - "gitops"
  - "ci-cd"
  - "deployments"
  - "automation"
relatedRecipes:
  - "kubernetes-kustomize-guide"
  - "kubernetes-rolling-update-strategies"
---

> 💡 **Quick Answer:** ArgoCD syncs Kubernetes manifests from Git to clusters. Install: `kubectl create namespace argocd && kubectl apply -n argocd -f https://raw.githubusercontent.com/argoproj/argo-cd/stable/manifests/install.yaml`. Create an Application pointing to a Git repo + path. ArgoCD auto-detects drift and can self-heal. Supports Helm, Kustomize, plain YAML, and Jsonnet.

## The Problem

Traditional CI/CD pushes changes to clusters:

- No single source of truth for desired state
- Drift between Git and cluster goes undetected
- Rollback requires re-running pipelines
- No visibility into what's deployed where
- Multi-cluster deployments are complex

## The Solution

### Install ArgoCD

```bash
# Install
kubectl create namespace argocd
kubectl apply -n argocd -f https://raw.githubusercontent.com/argoproj/argo-cd/stable/manifests/install.yaml

# Wait for pods
kubectl get pods -n argocd -w

# Get admin password
kubectl -n argocd get secret argocd-initial-admin-secret -o jsonpath='{.data.password}' | base64 -d

# Access UI
kubectl port-forward svc/argocd-server -n argocd 8080:443
# Open https://localhost:8080 → admin / <password>

# Install CLI
curl -sSL -o argocd https://github.com/argoproj/argo-cd/releases/latest/download/argocd-linux-amd64
chmod +x argocd && mv argocd /usr/local/bin/

# Login
argocd login localhost:8080 --username admin --password <password> --insecure
```

### Create an Application

```yaml
apiVersion: argoproj.io/v1alpha1
kind: Application
metadata:
  name: my-app
  namespace: argocd
spec:
  project: default
  
  source:
    repoURL: https://github.com/myorg/k8s-manifests.git
    targetRevision: main
    path: apps/my-app              # Directory with manifests
  
  destination:
    server: https://kubernetes.default.svc
    namespace: production
  
  syncPolicy:
    automated:
      prune: true                  # Delete resources removed from Git
      selfHeal: true               # Revert manual changes
    syncOptions:
    - CreateNamespace=true
    - PruneLast=true
    retry:
      limit: 5
      backoff:
        duration: 5s
        maxDuration: 3m
        factor: 2
```

```bash
# Or via CLI
argocd app create my-app \
  --repo https://github.com/myorg/k8s-manifests.git \
  --path apps/my-app \
  --dest-server https://kubernetes.default.svc \
  --dest-namespace production \
  --sync-policy automated \
  --auto-prune \
  --self-heal
```

### Helm Application

```yaml
apiVersion: argoproj.io/v1alpha1
kind: Application
metadata:
  name: prometheus
  namespace: argocd
spec:
  project: default
  source:
    repoURL: https://prometheus-community.github.io/helm-charts
    chart: kube-prometheus-stack
    targetRevision: 58.0.0
    helm:
      releaseName: prometheus
      values: |
        grafana:
          enabled: true
          adminPassword: admin
        prometheus:
          retention: 30d
          storageSpec:
            volumeClaimTemplate:
              spec:
                resources:
                  requests:
                    storage: 50Gi
  destination:
    server: https://kubernetes.default.svc
    namespace: monitoring
  syncPolicy:
    automated:
      selfHeal: true
    syncOptions:
    - CreateNamespace=true
```

### Kustomize Application

```yaml
apiVersion: argoproj.io/v1alpha1
kind: Application
metadata:
  name: my-app-staging
  namespace: argocd
spec:
  source:
    repoURL: https://github.com/myorg/k8s-manifests.git
    targetRevision: main
    path: overlays/staging          # Kustomize overlay directory
  destination:
    server: https://kubernetes.default.svc
    namespace: staging
```

### ApplicationSet (Multi-Cluster/Multi-Env)

```yaml
apiVersion: argoproj.io/v1alpha1
kind: ApplicationSet
metadata:
  name: my-app
  namespace: argocd
spec:
  generators:
  # Deploy to multiple clusters
  - clusters:
      selector:
        matchLabels:
          env: production
  
  template:
    metadata:
      name: 'my-app-{{name}}'
    spec:
      project: default
      source:
        repoURL: https://github.com/myorg/k8s-manifests.git
        targetRevision: main
        path: 'apps/my-app/overlays/{{metadata.labels.region}}'
      destination:
        server: '{{server}}'
        namespace: production

---
# Git directory generator — one app per directory
apiVersion: argoproj.io/v1alpha1
kind: ApplicationSet
metadata:
  name: all-apps
  namespace: argocd
spec:
  generators:
  - git:
      repoURL: https://github.com/myorg/k8s-manifests.git
      revision: main
      directories:
      - path: apps/*
  template:
    metadata:
      name: '{{path.basename}}'
    spec:
      project: default
      source:
        repoURL: https://github.com/myorg/k8s-manifests.git
        targetRevision: main
        path: '{{path}}'
      destination:
        server: https://kubernetes.default.svc
        namespace: '{{path.basename}}'
```

### App Management

```bash
# List apps
argocd app list

# Sync manually
argocd app sync my-app

# Check diff (what would change)
argocd app diff my-app

# View app details
argocd app get my-app

# Rollback to previous sync
argocd app rollback my-app

# Delete app (and resources)
argocd app delete my-app --cascade

# Refresh (re-read Git)
argocd app get my-app --refresh
```

### Multi-Cluster

```bash
# Add external cluster
argocd cluster add my-other-cluster --kubeconfig ~/.kube/config

# List clusters
argocd cluster list

# Deploy to external cluster
# Set destination.server to the external cluster URL
```

## Common Issues

**App stuck "OutOfSync" after sync**

Resource has fields managed by controllers (e.g., replicas managed by HPA). Add to `ignoreDifferences` in Application spec.

**"permission denied" on namespace**

ArgoCD ServiceAccount needs RBAC in target namespace. Check: `argocd-server` and `argocd-application-controller` ClusterRoles.

**Helm values not applying**

Check `helm.values` is valid YAML. Use `argocd app manifests my-app` to preview rendered output.

## Best Practices

- **One repo for manifests** — separate from application code repos
- **Automated sync + selfHeal + prune** — full GitOps loop
- **ApplicationSets for multi-env** — DRY configuration
- **RBAC with Projects** — limit what apps can deploy where
- **Notifications** — integrate with Slack/Teams for sync events

## Key Takeaways

- ArgoCD syncs Git → Cluster continuously (pull-based GitOps)
- Self-heal reverts manual cluster changes to match Git
- Supports Helm, Kustomize, plain YAML, Jsonnet
- ApplicationSets enable multi-cluster/multi-env from one definition
- UI provides full visibility into deployed state and diff
