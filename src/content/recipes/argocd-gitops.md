---
title: "How to Deploy with Argo CD GitOps"
description: "Implement GitOps continuous deployment with Argo CD. Sync Kubernetes manifests from Git repositories automatically with declarative application management."
category: "deployments"
difficulty: "intermediate"
publishDate: "2026-01-22"
relatedRecipes:
  - "kubernetes-readiness-probe-guide"
  - "ab-testing-kubernetes"
  - "kubernetes-graceful-shutdown-guide"
  - "kubernetes-leases"
  - "kubernetes-readiness-liveness-startup"
  - "kubernetes-multi-container-pod-patterns"
  - "pod-disruption-budget-config"
  - "pod-lifecycle-hooks"
  - "pod-readiness-gates"
  - "pod-topology-constraints"
tags: ["argocd", "gitops", "continuous-deployment", "kubernetes", "automation"]
author: "Luca Berton"
---

> 💡 **Quick Answer:** Install Argo CD (`kubectl apply -n argocd -f https://raw.githubusercontent.com/argoproj/argo-cd/stable/manifests/install.yaml`), create an `Application` CRD pointing to your Git repo, and Argo CD automatically syncs manifests to your cluster. Changes in Git trigger deployments.
>
> **Key command:** `argocd app create my-app --repo https://github.com/org/repo --path k8s --dest-server https://kubernetes.default.svc`
>
> **Gotcha:** Enable auto-sync with `syncPolicy.automated` for true GitOps; manual sync is default. Use `selfHeal: true` to revert manual cluster changes.


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
---
apiVersion: batch/v1
kind: Job
metadata:
  name: smoke-test
  annotations:
    argocd.argoproj.io/hook: PostSync  # Run after sync succeeds
    argocd.argoproj.io/hook-delete-policy: HookSucceeded
spec:
  template:
    spec:
      containers:
        - name: test
          image: my-app:latest
          command: ["./smoke-test.sh"]
      restartPolicy: Never
```

Additional useful sync options beyond `CreateNamespace=true`:

```yaml
spec:
  syncPolicy:
    syncOptions:
      - PrunePropagationPolicy=foreground
      - PruneLast=true
      - RespectIgnoreDifferences=true
      - ApplyOutOfSyncOnly=true
      - ServerSideApply=true
```

## App of Apps Pattern

Manage a fleet of Applications by having a root Application point at a directory of other Application manifests:

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
    repoURL: https://github.com/myorg/my-app-manifests
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

```yaml
# apps/my-app.yaml (child Application managed by root-app)
apiVersion: argoproj.io/v1alpha1
kind: Application
metadata:
  name: my-app
  namespace: argocd
  finalizers:
    - resources-finalizer.argocd.argoproj.io
spec:
  project: default
  source:
    repoURL: https://github.com/myorg/my-app-manifests
    targetRevision: main
    path: manifests/my-app
  destination:
    server: https://kubernetes.default.svc
    namespace: production
  syncPolicy:
    automated:
      prune: true
      selfHeal: true
```

## Multi-Cluster Management

Register an external cluster so Argo CD can deploy to it:

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

Fan an Application out to every registered cluster with the `clusters` generator:

```yaml
apiVersion: argoproj.io/v1alpha1
kind: ApplicationSet
metadata:
  name: multi-cluster-app
  namespace: argocd
spec:
  generators:
    - clusters: {}  # All registered clusters
  template:
    metadata:
      name: 'my-app-{{name}}'
    spec:
      project: default
      source:
        repoURL: https://github.com/myorg/my-app-manifests
        path: k8s/overlays/production
        targetRevision: main
      destination:
        server: '{{server}}'
        namespace: production
```

## Projects and RBAC

Scope which repos, clusters, and resource kinds an Application can use with an `AppProject`, and control who can sync it:

```yaml
apiVersion: argoproj.io/v1alpha1
kind: AppProject
metadata:
  name: production
  namespace: argocd
spec:
  description: Production applications
  sourceRepos:
    - https://github.com/myorg/my-app-manifests
  destinations:
    - namespace: production
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

```yaml
apiVersion: v1
kind: ConfigMap
metadata:
  name: argocd-rbac-cm
  namespace: argocd
data:
  policy.default: role:readonly
  policy.csv: |
    p, role:admin, applications, *, */*, allow
    p, role:developer, applications, sync, */*, allow
    g, admins, role:admin
    g, developers, role:developer
```

## Monitoring and Notifications

Send Slack alerts on sync status changes with the Argo CD notifications controller:

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
  trigger.on-health-degraded: |
    - when: app.status.health.status == 'Degraded'
      send: [app-sync-status]
```

```yaml
apiVersion: argoproj.io/v1alpha1
kind: Application
metadata:
  name: my-app
  annotations:
    notifications.argoproj.io/subscribe.on-sync-succeeded.slack: deployments
    notifications.argoproj.io/subscribe.on-sync-failed.slack: deployments
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
