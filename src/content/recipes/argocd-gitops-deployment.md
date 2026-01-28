---
title: "How to Implement GitOps with Argo CD"
description: "Deploy and manage Kubernetes applications declaratively with Argo CD GitOps. Learn application deployment, sync strategies, multi-cluster management, and best practices."
category: "deployments"
difficulty: "intermediate"
timeToComplete: "35 minutes"
kubernetesVersion: "1.28+"
prerequisites:
  - "A running Kubernetes cluster"
  - "kubectl configured with appropriate permissions"
  - "A Git repository for application manifests"
  - "Helm 3 installed (optional)"
relatedRecipes:
  - "flux-gitops"
  - "sealed-secrets-gitops"
  - "canary-deployments"
tags:
  - argocd
  - gitops
  - continuous-deployment
  - declarative
  - kubernetes
  - automation
publishDate: "2026-01-28"
author: "Luca Berton"
---

## The Problem

Manual kubectl applies are error-prone, hard to track, and don't scale. You need automated, auditable, and reversible deployments with Git as the single source of truth.

## The Solution

Implement GitOps with Argo CD to automatically sync Kubernetes cluster state with Git repositories, providing declarative, version-controlled deployments with automatic drift detection and remediation.

## GitOps Principles

```
GitOps Workflow with Argo CD:

┌─────────────────────────────────────────────────────────────────┐
│                      GIT REPOSITORY                              │
│                   (Single Source of Truth)                       │
│                                                                  │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │  apps/                                                   │    │
│  │  ├── production/                                        │    │
│  │  │   ├── deployment.yaml                                │    │
│  │  │   ├── service.yaml                                   │    │
│  │  │   └── kustomization.yaml                             │    │
│  │  └── staging/                                           │    │
│  │      └── ...                                            │    │
│  └─────────────────────────────────────────────────────────┘    │
│                              │                                   │
│              1. Git push     │  4. Git commit (auto-sync)       │
│                              ▼                                   │
└──────────────────────────────┬───────────────────────────────────┘
                               │
                               │ 2. Detect changes
                               ▼
┌─────────────────────────────────────────────────────────────────┐
│                        ARGO CD                                   │
│                                                                  │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │  Application Controller                                  │    │
│  │                                                          │    │
│  │  • Watches Git repositories                             │    │
│  │  • Compares desired vs actual state                     │    │
│  │  • Syncs automatically or on-demand                     │    │
│  │  • Detects and reports drift                            │    │
│  └─────────────────────────────────────────────────────────┘    │
│                              │                                   │
│              3. Apply changes│                                   │
│                              ▼                                   │
└──────────────────────────────┬───────────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────────┐
│                   KUBERNETES CLUSTER                             │
│                                                                  │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │  Deployed Resources                                      │    │
│  │  (Always matches Git state)                             │    │
│  └─────────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────────┘
```

## Step 1: Install Argo CD

### Using kubectl

```bash
# Create namespace
kubectl create namespace argocd

# Install Argo CD
kubectl apply -n argocd -f https://raw.githubusercontent.com/argoproj/argo-cd/stable/manifests/install.yaml

# Wait for pods to be ready
kubectl wait --for=condition=Ready pods --all -n argocd --timeout=300s
```

### Using Helm

```bash
helm repo add argo https://argoproj.github.io/argo-helm
helm repo update

helm install argocd argo/argo-cd \
  --namespace argocd \
  --create-namespace \
  --set server.service.type=LoadBalancer
```

### Access Argo CD UI

```bash
# Port forward
kubectl port-forward svc/argocd-server -n argocd 8080:443

# Get initial admin password
kubectl -n argocd get secret argocd-initial-admin-secret -o jsonpath="{.data.password}" | base64 -d

# Login via CLI
argocd login localhost:8080 --username admin --password <password> --insecure

# Change password
argocd account update-password
```

## Step 2: Connect Git Repository

### Via CLI

```bash
# Add repository with HTTPS
argocd repo add https://github.com/myorg/k8s-configs.git \
  --username <username> \
  --password <token>

# Add repository with SSH
argocd repo add git@github.com:myorg/k8s-configs.git \
  --ssh-private-key-path ~/.ssh/id_rsa
```

### Via Kubernetes Secret

```yaml
apiVersion: v1
kind: Secret
metadata:
  name: private-repo
  namespace: argocd
  labels:
    argocd.argoproj.io/secret-type: repository
stringData:
  type: git
  url: https://github.com/myorg/k8s-configs.git
  username: git
  password: <github-token>
```

## Step 3: Create Applications

### Simple Application

```yaml
apiVersion: argoproj.io/v1alpha1
kind: Application
metadata:
  name: myapp
  namespace: argocd
spec:
  project: default
  source:
    repoURL: https://github.com/myorg/k8s-configs.git
    targetRevision: main
    path: apps/myapp/production
  destination:
    server: https://kubernetes.default.svc
    namespace: production
  syncPolicy:
    automated:
      prune: true
      selfHeal: true
    syncOptions:
      - CreateNamespace=true
```

### Application with Helm

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
    targetRevision: 55.5.0
    helm:
      releaseName: prometheus
      values: |
        grafana:
          enabled: true
          adminPassword: admin123
        prometheus:
          prometheusSpec:
            retention: 7d
            storageSpec:
              volumeClaimTemplate:
                spec:
                  storageClassName: standard
                  resources:
                    requests:
                      storage: 50Gi
  destination:
    server: https://kubernetes.default.svc
    namespace: monitoring
  syncPolicy:
    automated:
      prune: true
      selfHeal: true
    syncOptions:
      - CreateNamespace=true
```

### Application with Kustomize

```yaml
apiVersion: argoproj.io/v1alpha1
kind: Application
metadata:
  name: myapp-production
  namespace: argocd
spec:
  project: default
  source:
    repoURL: https://github.com/myorg/k8s-configs.git
    targetRevision: main
    path: apps/myapp/overlays/production
    kustomize:
      images:
        - myapp=myregistry/myapp:v1.2.3
  destination:
    server: https://kubernetes.default.svc
    namespace: production
```

## Step 4: App of Apps Pattern

### Root Application

```yaml
# apps/root-app.yaml
apiVersion: argoproj.io/v1alpha1
kind: Application
metadata:
  name: root-app
  namespace: argocd
  finalizers:
    - resources-finalizer.argocd.argoproj.io
spec:
  project: default
  source:
    repoURL: https://github.com/myorg/k8s-configs.git
    targetRevision: main
    path: apps
  destination:
    server: https://kubernetes.default.svc
    namespace: argocd
  syncPolicy:
    automated:
      prune: true
      selfHeal: true
```

### Child Applications

```yaml
# apps/myapp.yaml
apiVersion: argoproj.io/v1alpha1
kind: Application
metadata:
  name: myapp
  namespace: argocd
  finalizers:
    - resources-finalizer.argocd.argoproj.io
spec:
  project: default
  source:
    repoURL: https://github.com/myorg/k8s-configs.git
    targetRevision: main
    path: manifests/myapp
  destination:
    server: https://kubernetes.default.svc
    namespace: production
  syncPolicy:
    automated:
      prune: true
      selfHeal: true
---
# apps/monitoring.yaml
apiVersion: argoproj.io/v1alpha1
kind: Application
metadata:
  name: monitoring
  namespace: argocd
spec:
  project: default
  source:
    repoURL: https://prometheus-community.github.io/helm-charts
    chart: kube-prometheus-stack
    targetRevision: 55.5.0
  destination:
    server: https://kubernetes.default.svc
    namespace: monitoring
```

## Step 5: ApplicationSet for Multi-Environment

### Generator: List

```yaml
apiVersion: argoproj.io/v1alpha1
kind: ApplicationSet
metadata:
  name: myapp-environments
  namespace: argocd
spec:
  generators:
    - list:
        elements:
          - env: staging
            namespace: staging
            replicas: "1"
          - env: production
            namespace: production
            replicas: "3"
  template:
    metadata:
      name: myapp-{{env}}
    spec:
      project: default
      source:
        repoURL: https://github.com/myorg/k8s-configs.git
        targetRevision: main
        path: apps/myapp/overlays/{{env}}
        kustomize:
          commonAnnotations:
            environment: "{{env}}"
      destination:
        server: https://kubernetes.default.svc
        namespace: "{{namespace}}"
      syncPolicy:
        automated:
          prune: true
          selfHeal: true
```

### Generator: Git Directory

```yaml
apiVersion: argoproj.io/v1alpha1
kind: ApplicationSet
metadata:
  name: cluster-addons
  namespace: argocd
spec:
  generators:
    - git:
        repoURL: https://github.com/myorg/k8s-configs.git
        revision: main
        directories:
          - path: cluster-addons/*
  template:
    metadata:
      name: "{{path.basename}}"
    spec:
      project: default
      source:
        repoURL: https://github.com/myorg/k8s-configs.git
        targetRevision: main
        path: "{{path}}"
      destination:
        server: https://kubernetes.default.svc
        namespace: "{{path.basename}}"
      syncPolicy:
        automated:
          selfHeal: true
```

### Generator: Cluster

```yaml
apiVersion: argoproj.io/v1alpha1
kind: ApplicationSet
metadata:
  name: myapp-multi-cluster
  namespace: argocd
spec:
  generators:
    - clusters:
        selector:
          matchLabels:
            environment: production
  template:
    metadata:
      name: myapp-{{name}}
    spec:
      project: default
      source:
        repoURL: https://github.com/myorg/k8s-configs.git
        targetRevision: main
        path: apps/myapp
      destination:
        server: "{{server}}"
        namespace: production
```

## Step 6: Sync Strategies

### Manual Sync (Default)

```yaml
spec:
  syncPolicy: {}  # No automated sync
```

### Automated Sync

```yaml
spec:
  syncPolicy:
    automated:
      prune: true      # Delete resources removed from Git
      selfHeal: true   # Revert manual changes
      allowEmpty: false
```

### Sync Options

```yaml
spec:
  syncPolicy:
    syncOptions:
      - CreateNamespace=true
      - PrunePropagationPolicy=foreground
      - PruneLast=true
      - RespectIgnoreDifferences=true
      - ApplyOutOfSyncOnly=true
      - ServerSideApply=true
```

### Sync Waves (Ordering)

```yaml
# Deploy in order: namespace → configmap → deployment → service
apiVersion: v1
kind: Namespace
metadata:
  name: myapp
  annotations:
    argocd.argoproj.io/sync-wave: "-1"
---
apiVersion: v1
kind: ConfigMap
metadata:
  name: myapp-config
  annotations:
    argocd.argoproj.io/sync-wave: "0"
---
apiVersion: apps/v1
kind: Deployment
metadata:
  name: myapp
  annotations:
    argocd.argoproj.io/sync-wave: "1"
---
apiVersion: v1
kind: Service
metadata:
  name: myapp
  annotations:
    argocd.argoproj.io/sync-wave: "2"
```

### Sync Hooks

```yaml
apiVersion: batch/v1
kind: Job
metadata:
  name: db-migration
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
---
apiVersion: batch/v1
kind: Job
metadata:
  name: smoke-test
  annotations:
    argocd.argoproj.io/hook: PostSync
    argocd.argoproj.io/hook-delete-policy: HookSucceeded
spec:
  template:
    spec:
      containers:
        - name: test
          image: myapp:latest
          command: ["./smoke-test.sh"]
      restartPolicy: Never
```

## Step 7: Projects and RBAC

### Create AppProject

```yaml
apiVersion: argoproj.io/v1alpha1
kind: AppProject
metadata:
  name: production
  namespace: argocd
spec:
  description: Production applications
  sourceRepos:
    - https://github.com/myorg/k8s-configs.git
    - https://charts.helm.sh/stable
  destinations:
    - namespace: production
      server: https://kubernetes.default.svc
    - namespace: production-*
      server: https://kubernetes.default.svc
  clusterResourceWhitelist:
    - group: ""
      kind: Namespace
  namespaceResourceWhitelist:
    - group: "*"
      kind: "*"
  roles:
    - name: developer
      description: Developer access
      policies:
        - p, proj:production:developer, applications, get, production/*, allow
        - p, proj:production:developer, applications, sync, production/*, allow
      groups:
        - developers
```

### RBAC Configuration

```yaml
apiVersion: v1
kind: ConfigMap
metadata:
  name: argocd-rbac-cm
  namespace: argocd
data:
  policy.default: role:readonly
  policy.csv: |
    # Admins can do anything
    p, role:admin, applications, *, */*, allow
    p, role:admin, clusters, *, *, allow
    p, role:admin, repositories, *, *, allow
    p, role:admin, projects, *, *, allow
    
    # Developers can sync and view
    p, role:developer, applications, get, */*, allow
    p, role:developer, applications, sync, */*, allow
    p, role:developer, applications, action/*, */*, allow
    p, role:developer, logs, get, */*, allow
    
    # Map groups to roles
    g, admins, role:admin
    g, developers, role:developer
```

## Step 8: Multi-Cluster Management

### Add External Cluster

```bash
# Add cluster via CLI
argocd cluster add <context-name> --name production-cluster

# Or via Secret
kubectl apply -f - <<EOF
apiVersion: v1
kind: Secret
metadata:
  name: production-cluster
  namespace: argocd
  labels:
    argocd.argoproj.io/secret-type: cluster
type: Opaque
stringData:
  name: production-cluster
  server: https://production.k8s.example.com
  config: |
    {
      "bearerToken": "<service-account-token>",
      "tlsClientConfig": {
        "insecure": false,
        "caData": "<base64-ca-cert>"
      }
    }
EOF
```

### Deploy to Multiple Clusters

```yaml
apiVersion: argoproj.io/v1alpha1
kind: ApplicationSet
metadata:
  name: multi-cluster-app
  namespace: argocd
spec:
  generators:
    - clusters: {}  # All clusters
  template:
    metadata:
      name: myapp-{{name}}
    spec:
      project: default
      source:
        repoURL: https://github.com/myorg/k8s-configs.git
        path: apps/myapp
        targetRevision: main
      destination:
        server: "{{server}}"
        namespace: production
```

## Monitoring and Notifications

### Slack Notifications

```yaml
apiVersion: v1
kind: ConfigMap
metadata:
  name: argocd-notifications-cm
  namespace: argocd
data:
  service.slack: |
    token: $slack-token
  template.app-sync-status: |
    message: |
      Application {{.app.metadata.name}} sync status: {{.app.status.sync.status}}
      Health: {{.app.status.health.status}}
  trigger.on-sync-status-unknown: |
    - when: app.status.sync.status == 'Unknown'
      send: [app-sync-status]
  trigger.on-health-degraded: |
    - when: app.status.health.status == 'Degraded'
      send: [app-sync-status]
```

### Application Annotations for Notifications

```yaml
apiVersion: argoproj.io/v1alpha1
kind: Application
metadata:
  name: myapp
  annotations:
    notifications.argoproj.io/subscribe.on-sync-succeeded.slack: deployments
    notifications.argoproj.io/subscribe.on-sync-failed.slack: deployments
```

## Verification Commands

```bash
# List applications
argocd app list

# Get application details
argocd app get myapp

# Sync application
argocd app sync myapp

# View application history
argocd app history myapp

# Rollback to previous version
argocd app rollback myapp <revision>

# Check diff before sync
argocd app diff myapp

# Watch application sync
argocd app wait myapp --sync
```

## Best Practices

### 1. Repository Structure

```
k8s-configs/
├── apps/                    # Application definitions
│   ├── myapp/
│   │   ├── base/
│   │   └── overlays/
│   │       ├── staging/
│   │       └── production/
├── cluster-addons/          # Cluster-wide components
│   ├── cert-manager/
│   ├── ingress-nginx/
│   └── monitoring/
└── argocd/                  # Argo CD configuration
    ├── applications/
    └── projects/
```

### 2. Use Sealed Secrets for Sensitive Data

```bash
# Never commit plain secrets to Git
kubeseal < secret.yaml > sealed-secret.yaml
```

### 3. Implement Progressive Delivery

```yaml
# Use sync waves and hooks for safe deployments
annotations:
  argocd.argoproj.io/sync-wave: "1"
  argocd.argoproj.io/hook: PreSync
```

## Summary

Argo CD enables GitOps workflows by keeping Kubernetes clusters in sync with Git repositories. Use ApplicationSets for multi-environment deployments, sync waves for ordering, and projects for access control. The declarative approach provides auditable, reversible, and automated deployments.

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
