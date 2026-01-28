---
title: "How to Implement GitOps with ArgoCD"
description: "Deploy ArgoCD for GitOps-based continuous delivery. Learn to sync Kubernetes manifests from Git repositories with automated reconciliation."
category: "configuration"
difficulty: "intermediate"
publishDate: "2026-01-22"
tags: ["argocd", "gitops", "cicd", "deployment", "automation"]
---

# How to Implement GitOps with ArgoCD

ArgoCD implements GitOps for Kubernetes, automatically syncing cluster state with Git repositories. Learn to deploy ArgoCD and configure applications for continuous delivery.

## Install ArgoCD

```bash
# Create namespace
kubectl create namespace argocd

# Install ArgoCD
kubectl apply -n argocd -f https://raw.githubusercontent.com/argoproj/argo-cd/stable/manifests/install.yaml

# Wait for pods
kubectl wait --for=condition=Ready pods --all -n argocd --timeout=300s
```

## Access ArgoCD UI

```bash
# Get initial admin password
kubectl -n argocd get secret argocd-initial-admin-secret \
  -o jsonpath="{.data.password}" | base64 -d

# Port forward to UI
kubectl port-forward svc/argocd-server -n argocd 8080:443

# Or expose via Ingress
```

```yaml
# argocd-ingress.yaml
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: argocd-server
  namespace: argocd
  annotations:
    nginx.ingress.kubernetes.io/ssl-passthrough: "true"
    nginx.ingress.kubernetes.io/backend-protocol: "HTTPS"
spec:
  ingressClassName: nginx
  rules:
    - host: argocd.example.com
      http:
        paths:
          - path: /
            pathType: Prefix
            backend:
              service:
                name: argocd-server
                port:
                  number: 443
```

## Install ArgoCD CLI

```bash
# macOS
brew install argocd

# Linux
curl -sSL -o argocd https://github.com/argoproj/argo-cd/releases/latest/download/argocd-linux-amd64
chmod +x argocd && sudo mv argocd /usr/local/bin/

# Login
argocd login argocd.example.com
```

## Create Application (Declarative)

```yaml
# application.yaml
apiVersion: argoproj.io/v1alpha1
kind: Application
metadata:
  name: myapp
  namespace: argocd
spec:
  project: default
  source:
    repoURL: https://github.com/myorg/myapp-manifests.git
    targetRevision: main
    path: kubernetes/overlays/production
  destination:
    server: https://kubernetes.default.svc
    namespace: production
  syncPolicy:
    automated:
      prune: true       # Delete resources not in Git
      selfHeal: true    # Revert manual changes
    syncOptions:
      - CreateNamespace=true
    retry:
      limit: 5
      backoff:
        duration: 5s
        factor: 2
        maxDuration: 3m
```

## Application with Helm

```yaml
# helm-application.yaml
apiVersion: argoproj.io/v1alpha1
kind: Application
metadata:
  name: prometheus
  namespace: argocd
spec:
  project: default
  source:
    repoURL: https://prometheus-community.github.io/helm-charts
    chart: prometheus
    targetRevision: 25.8.0
    helm:
      releaseName: prometheus
      values: |
        server:
          persistentVolume:
            size: 50Gi
          resources:
            limits:
              cpu: 500m
              memory: 512Mi
        alertmanager:
          enabled: true
  destination:
    server: https://kubernetes.default.svc
    namespace: monitoring
  syncPolicy:
    automated:
      selfHeal: true
    syncOptions:
      - CreateNamespace=true
```

## Application with Kustomize

```yaml
# kustomize-application.yaml
apiVersion: argoproj.io/v1alpha1
kind: Application
metadata:
  name: myapp-staging
  namespace: argocd
spec:
  project: default
  source:
    repoURL: https://github.com/myorg/myapp.git
    targetRevision: main
    path: kustomize/overlays/staging
    kustomize:
      images:
        - myapp=myregistry/myapp:v1.2.3
      commonLabels:
        environment: staging
  destination:
    server: https://kubernetes.default.svc
    namespace: staging
```

## ApplicationSet for Multiple Environments

```yaml
# applicationset.yaml
apiVersion: argoproj.io/v1alpha1
kind: ApplicationSet
metadata:
  name: myapp-envs
  namespace: argocd
spec:
  generators:
    - list:
        elements:
          - env: development
            namespace: dev
            cluster: https://kubernetes.default.svc
          - env: staging
            namespace: staging
            cluster: https://kubernetes.default.svc
          - env: production
            namespace: production
            cluster: https://prod-cluster.example.com
  template:
    metadata:
      name: 'myapp-{{env}}'
    spec:
      project: default
      source:
        repoURL: https://github.com/myorg/myapp.git
        targetRevision: main
        path: 'kubernetes/overlays/{{env}}'
      destination:
        server: '{{cluster}}'
        namespace: '{{namespace}}'
      syncPolicy:
        automated:
          prune: true
          selfHeal: true
```

## Private Git Repository

```yaml
# Create secret for private repo
apiVersion: v1
kind: Secret
metadata:
  name: private-repo
  namespace: argocd
  labels:
    argocd.argoproj.io/secret-type: repository
stringData:
  type: git
  url: https://github.com/myorg/private-repo.git
  username: myuser
  password: ghp_xxxxxxxxxxxxxxxxxxxx
```

```bash
# Or via CLI
argocd repo add https://github.com/myorg/private-repo.git \
  --username myuser --password ghp_xxxx
```

## Sync Waves and Hooks

```yaml
# Namespace created first (wave -1)
apiVersion: v1
kind: Namespace
metadata:
  name: myapp
  annotations:
    argocd.argoproj.io/sync-wave: "-1"
---
# ConfigMap second (wave 0)
apiVersion: v1
kind: ConfigMap
metadata:
  name: myapp-config
  annotations:
    argocd.argoproj.io/sync-wave: "0"
---
# Deployment last (wave 1)
apiVersion: apps/v1
kind: Deployment
metadata:
  name: myapp
  annotations:
    argocd.argoproj.io/sync-wave: "1"
```

## Pre/Post Sync Hooks

```yaml
# pre-sync-job.yaml
apiVersion: batch/v1
kind: Job
metadata:
  name: db-migrate
  annotations:
    argocd.argoproj.io/hook: PreSync
    argocd.argoproj.io/hook-delete-policy: HookSucceeded
spec:
  template:
    spec:
      containers:
        - name: migrate
          image: myapp:latest
          command: ["./migrate.sh"]
      restartPolicy: Never
```

## ArgoCD Projects

```yaml
# project.yaml
apiVersion: argoproj.io/v1alpha1
kind: AppProject
metadata:
  name: team-a
  namespace: argocd
spec:
  description: Team A applications
  sourceRepos:
    - 'https://github.com/myorg/team-a-*'
  destinations:
    - namespace: 'team-a-*'
      server: https://kubernetes.default.svc
  clusterResourceWhitelist:
    - group: ''
      kind: Namespace
  namespaceResourceBlacklist:
    - group: ''
      kind: ResourceQuota
  roles:
    - name: developer
      policies:
        - p, proj:team-a:developer, applications, get, team-a/*, allow
        - p, proj:team-a:developer, applications, sync, team-a/*, allow
```

## CLI Commands

```bash
# List applications
argocd app list

# Get app status
argocd app get myapp

# Sync application
argocd app sync myapp

# View diff
argocd app diff myapp

# Rollback
argocd app rollback myapp

# Delete application
argocd app delete myapp
```

## Summary

ArgoCD automates Kubernetes deployments using GitOps principles. Define applications declaratively, enable automated sync with self-healing, and use ApplicationSets for multi-environment deployments. Git becomes your single source of truth for cluster state.

---

## 📘 Go Further with Kubernetes Recipes

**Love this recipe? There's so much more!** This is just one of **100+ hands-on recipes** in our comprehensive **[Kubernetes Recipes book](https://amzn.to/3DzC8QA)**.

Inside the book, you'll master:
- ✅ Production-ready deployment strategies
- ✅ Advanced networking and security patterns  
- ✅ Observability, monitoring, and troubleshooting
- ✅ Real-world best practices from industry experts

> *"The practical, recipe-based approach made complex Kubernetes concepts finally click for me."*

**👉 [Get Your Copy Now](https://amzn.to/3DzC8QA)** — Start building production-grade Kubernetes skills today!
