---
title: "Argo CD GitOps: Install, Apps and ApplicationSets"
description: "Argo CD GitOps on Kubernetes: install, Application and ApplicationSet YAML, Helm/Kustomize sources, sync waves, App of Apps, multi-cluster, RBAC, alerts."
category: "deployments"
difficulty: "intermediate"
publishDate: "2026-01-22"
relatedRecipes:
  - "kubernetes-readiness-probe-guide"
  - "ab-testing-kubernetes"
  - "kubernetes-graceful-shutdown-guide"
  - "kubernetes-leases"
  - "kubernetes-readiness-liveness-startup"
  - "kubernetes-multi-container-patterns"
  - "pod-disruption-budget-config"
  - "pod-lifecycle-hooks"
  - "pod-readiness-gates"
  - "pod-topology-constraints"
  - "flux-gitops"
  - "kubernetes-kustomize-guide"
  - "kubernetes-rolling-update-strategy"
tags: ["argocd", "gitops", "continuous-deployment", "kubernetes", "automation", "applicationset", "ci-cd"]
author: "Luca Berton"
---

> 💡 **Quick Answer:** Install Argo CD (`kubectl apply -n argocd -f https://raw.githubusercontent.com/argoproj/argo-cd/stable/manifests/install.yaml`), create an `Application` CRD pointing to your Git repo, and Argo CD automatically syncs manifests to your cluster. Changes in Git trigger deployments.
>
> **Key command:** `argocd app create my-app --repo https://github.com/org/repo --path k8s --dest-server https://kubernetes.default.svc`
>
> **Gotcha:** Enable auto-sync with `syncPolicy.automated` for true GitOps; manual sync is default. Use `selfHeal: true` to revert manual cluster changes.


Argo CD is a declarative, pull-based GitOps continuous delivery tool. It continuously compares the manifests in Git (plain YAML, Helm, Kustomize, Jsonnet) with the live cluster, reports drift, and syncs — so Git is the single source of truth, rollback is a `git revert`, and the UI shows what is deployed where.

## Install Argo CD

```bash
# Create namespace
kubectl create namespace argocd

# Install Argo CD
kubectl apply -n argocd -f https://raw.githubusercontent.com/argoproj/argo-cd/stable/manifests/install.yaml

# Wait for pods to be ready
kubectl wait --for=condition=Ready pods --all -n argocd --timeout=300s

# Install the CLI
curl -sSL -o argocd https://github.com/argoproj/argo-cd/releases/latest/download/argocd-linux-amd64
sudo install -m 555 argocd /usr/local/bin/argocd
```

On OpenShift, install the **Red Hat OpenShift GitOps** operator from OperatorHub instead — it deploys and upgrades Argo CD for you.

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
    retry:
      limit: 5
      backoff:
        duration: 5s
        factor: 2
        maxDuration: 3m
```

### Ignore Controller-Managed Fields

If an HPA owns `replicas` (or a webhook injects fields), the app flaps OutOfSync. Tell Argo CD to ignore them:

```yaml
spec:
  ignoreDifferences:
    - group: apps
      kind: Deployment
      jsonPointers:
        - /spec/replicas
  syncPolicy:
    syncOptions:
      - RespectIgnoreDifferences=true   # also don't overwrite them on sync
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

Git directory generator — one Application per directory under `apps/`:

```yaml
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
      syncPolicy:
        syncOptions:
          - CreateNamespace=true
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

# Force a re-read of Git (skip the 3-minute poll)
argocd app get my-app --refresh

# Preview rendered manifests (Helm/Kustomize output)
argocd app manifests my-app

# Rollback (auto-sync must be disabled first)
argocd app rollback my-app

# Delete app but keep its resources
argocd app delete my-app --cascade=false

# Clusters
argocd cluster list
```

## Common Issues

**App OutOfSync right after a successful sync** — a controller mutates the resource (HPA replicas, defaulted fields, injected sidecars). Add `ignoreDifferences` (above), or enable `ServerSideApply=true`.

**`permission denied` / `forbidden` in target namespace** — the `argocd-application-controller` ServiceAccount lacks RBAC there (common with namespace-scoped installs and OpenShift GitOps: label the namespace `argocd.argoproj.io/managed-by=<argocd-namespace>`). Also check the AppProject `destinations` and resource whitelists.

**Helm values not applied** — invalid YAML in `helm.values` or a wrong key; inspect with `argocd app manifests my-app`.

**`argocd app rollback` refused** — rollback is blocked while `syncPolicy.automated` is on; revert in Git instead (the GitOps way) or disable auto-sync.

## Best Practices

1. **Use separate repos** for app code and manifests
2. **Enable auto-sync** for true GitOps
3. **Use sync waves** for ordered deployments
4. **Implement RBAC** with Argo CD projects
5. **Store secrets** with Sealed Secrets or External Secrets
6. **Pin chart versions and Git revisions** for production (`targetRevision: 1.2.3` or a tag, not `HEAD`)
7. **Notifications** to Slack/Teams for sync failures and degraded health

## Frequently Asked Questions

### What is the difference between Argo CD and Flux?

Both are CNCF-graduated pull-based GitOps controllers. Argo CD ships a web UI, SSO/RBAC, AppProjects and ApplicationSets and is Application-centric; Flux is a set of composable controllers (source, kustomize, helm, notification, image automation) driven entirely by CRDs and the CLI, with no built-in UI. See [Flux GitOps](/recipes/deployments/flux-gitops/).

### Does Argo CD auto-sync by default?

No. Applications sync manually unless `spec.syncPolicy.automated` is set. `prune: true` deletes resources removed from Git and `selfHeal: true` reverts manual `kubectl` changes; both are off by default.

### How often does Argo CD check Git?

Every 3 minutes by default (`timeout.reconciliation` in `argocd-cm`). Configure a Git webhook to `https://<argocd>/api/webhook` for near-instant syncs.

### What is the difference between an Application and an ApplicationSet?

An Application maps one source (repo/path or chart) to one destination. An ApplicationSet is a template plus generators (list, cluster, git, matrix, pull request) that stamps out many Applications — one per environment, cluster or directory.

### How do I deploy to multiple clusters?

Register each cluster (`argocd cluster add <context>` or a Secret labelled `argocd.argoproj.io/secret-type: cluster`) and use an ApplicationSet with the `clusters` generator, optionally filtered by cluster labels.
