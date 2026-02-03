---
title: "How to Deploy with Argo CD GitOps"
description: "Implement GitOps continuous deployment with Argo CD. Sync Kubernetes manifests from Git repositories automatically with declarative application management."
category: "deployments"
difficulty: "intermediate"
publishDate: "2026-01-22"
tags: ["argocd", "gitops", "continuous-deployment", "kubernetes", "automation"]
author: "Luca Berton"
---

> 💡 **Quick Answer:** Install Argo CD (`kubectl apply -n argocd -f https://raw.githubusercontent.com/argoproj/argo-cd/stable/manifests/install.yaml`), create an `Application` CRD pointing to your Git repo, and Argo CD automatically syncs manifests to your cluster. Changes in Git trigger deployments.
>
> **Key command:** `argocd app create my-app --repo https://github.com/org/repo --path k8s --dest-server https://kubernetes.default.svc`
>
> **Gotcha:** Enable auto-sync with `syncPolicy.automated` for true GitOps; manual sync is default. Use `selfHeal: true` to revert manual cluster changes.

# How to Deploy with Argo CD GitOps

Argo CD is a declarative GitOps continuous delivery tool. It monitors Git repositories and automatically syncs application state to your Kubernetes cluster.

## Install Argo CD

```bash
# Create namespace
kubectl create namespace argocd

# Install Argo CD
kubectl apply -n argocd -f https://raw.githubusercontent.com/argoproj/argo-cd/stable/manifests/install.yaml

# Wait for pods to be ready
kubectl wait --for=condition=Ready pods --all -n argocd --timeout=300s
```

## Access Argo CD UI

```bash
# Get initial admin password
kubectl -n argocd get secret argocd-initial-admin-secret -o jsonpath="{.data.password}" | base64 -d

# Port-forward to UI
kubectl port-forward svc/argocd-server -n argocd 8080:443

# Login via CLI
argocd login localhost:8080 --username admin --password <password> --insecure
```

## Create Application via YAML

```yaml
# application.yaml
apiVersion: argoproj.io/v1alpha1
kind: Application
metadata:
  name: my-app
  namespace: argocd
spec:
  project: default
  source:
    repoURL: https://github.com/myorg/my-app-manifests
    targetRevision: HEAD
    path: k8s/overlays/production
  destination:
    server: https://kubernetes.default.svc
    namespace: production
  syncPolicy:
    automated:
      prune: true      # Delete resources removed from Git
      selfHeal: true   # Revert manual changes
    syncOptions:
      - CreateNamespace=true
```

## Create Application via CLI

```bash
argocd app create my-app \
  --repo https://github.com/myorg/my-app-manifests \
  --path k8s/overlays/production \
  --dest-server https://kubernetes.default.svc \
  --dest-namespace production \
  --sync-policy automated \
  --auto-prune \
  --self-heal
```

## Application with Helm

```yaml
# helm-application.yaml
apiVersion: argoproj.io/v1alpha1
kind: Application
metadata:
  name: my-helm-app
  namespace: argocd
spec:
  project: default
  source:
    repoURL: https://charts.example.com
    chart: my-chart
    targetRevision: 1.2.3
    helm:
      values: |
        replicaCount: 3
        image:
          tag: v2.0.0
      parameters:
        - name: service.type
          value: LoadBalancer
  destination:
    server: https://kubernetes.default.svc
    namespace: production
```

## Application with Kustomize

```yaml
# kustomize-application.yaml
apiVersion: argoproj.io/v1alpha1
kind: Application
metadata:
  name: my-kustomize-app
  namespace: argocd
spec:
  project: default
  source:
    repoURL: https://github.com/myorg/my-app
    targetRevision: main
    path: k8s/overlays/production
    kustomize:
      images:
        - my-app=my-registry/my-app:v2.0.0
  destination:
    server: https://kubernetes.default.svc
    namespace: production
```

## ApplicationSet for Multiple Environments

```yaml
# applicationset.yaml
apiVersion: argoproj.io/v1alpha1
kind: ApplicationSet
metadata:
  name: my-app
  namespace: argocd
spec:
  generators:
    - list:
        elements:
          - env: dev
            namespace: dev
          - env: staging
            namespace: staging
          - env: production
            namespace: production
  template:
    metadata:
      name: 'my-app-{{env}}'
    spec:
      project: default
      source:
        repoURL: https://github.com/myorg/my-app
        targetRevision: HEAD
        path: 'k8s/overlays/{{env}}'
      destination:
        server: https://kubernetes.default.svc
        namespace: '{{namespace}}'
      syncPolicy:
        automated:
          prune: true
```

## Sync Waves and Hooks

```yaml
# Use annotations to control sync order
apiVersion: v1
kind: Namespace
metadata:
  name: my-app
  annotations:
    argocd.argoproj.io/sync-wave: "-1"  # Create first
---
apiVersion: apps/v1
kind: Deployment
metadata:
  name: my-app
  annotations:
    argocd.argoproj.io/sync-wave: "0"  # Then deployment
---
apiVersion: batch/v1
kind: Job
metadata:
  name: db-migrate
  annotations:
    argocd.argoproj.io/hook: PreSync  # Run before sync
    argocd.argoproj.io/hook-delete-policy: HookSucceeded
```

## CLI Commands

```bash
# List applications
argocd app list

# Get app status
argocd app get my-app

# Sync application
argocd app sync my-app

# View app diff
argocd app diff my-app

# Rollback
argocd app rollback my-app

# Delete app (keeps resources)
argocd app delete my-app --cascade=false
```

## Best Practices

1. **Use separate repos** for app code and manifests
2. **Enable auto-sync** for true GitOps
3. **Use sync waves** for ordered deployments
4. **Implement RBAC** with Argo CD projects
5. **Store secrets** with Sealed Secrets or External Secrets
