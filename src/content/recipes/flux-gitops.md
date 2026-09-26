---
title: "Flux GitOps on Kubernetes: Bootstrap to HelmRelease"
description: "Flux CD GitOps: bootstrap on GitHub/GitLab, GitRepository + Kustomization, HelmRelease, image automation, multi-tenant repo layout, alerts and debugging."
category: "deployments"
difficulty: "intermediate"
publishDate: "2026-01-22"
timeToComplete: "20 minutes"
kubernetesVersion: "1.28+"
tags: ["flux", "gitops", "continuous-deployment", "helm", "kustomize", "ci-cd", "image-automation"]
author: "Luca Berton"
relatedRecipes:
  - "flux-gitops-continuous-delivery"
  - "argocd-gitops"
  - "kubernetes-kustomize-guide"
  - "kubernetes-tekton-pipelines-guide"
  - "kubernetes-blue-green-deployment"
  - "openshift-mcp-itms-rollout"
  - "openclaw-whatsapp-kubernetes"
---

> 💡 **Quick Answer:** Bootstrap Flux with `flux bootstrap github --owner=myorg --repository=fleet-infra --branch=main --path=clusters/production`. Flux commits its own manifests to that repo and then syncs everything under the path. Use a `GitRepository` (source) + `Kustomization` (apply) for plain YAML/Kustomize, and a `HelmRepository` + `HelmRelease` for charts. Force a sync with `flux reconcile kustomization <name> --with-source`.
>
> **Key concept:** Source controllers fetch artifacts (Git, OCI, Helm repos, buckets); reconcilers (`Kustomization`, `HelmRelease`) apply them and prune what was removed from Git.
>
> **Gotcha:** Flux polls on `spec.interval`. For push-triggered syncs add a `Receiver` webhook instead of dropping every interval to `1m`.

Flux is a CNCF-graduated set of GitOps controllers. It is CLI/CRD-driven with no UI by default, lighter than Argo CD, and composable — run only the controllers you need.

## Install the Flux CLI

```bash
brew install fluxcd/tap/flux                      # macOS
curl -s https://fluxcd.io/install.sh | sudo bash  # Linux

flux --version
flux check --pre     # validates cluster version/permissions before install
```

## Bootstrap Flux

```bash
# GitHub (token needs repo admin to create the repo/deploy key)
export GITHUB_TOKEN=<token>
flux bootstrap github \
  --owner=myorg \
  --repository=fleet-infra \
  --branch=main \
  --path=clusters/production \
  --personal            # omit for an organisation repo

# GitLab
export GITLAB_TOKEN=<token>
flux bootstrap gitlab \
  --owner=myorg \
  --repository=fleet-infra \
  --branch=main \
  --path=clusters/production

flux check
kubectl get pods -n flux-system
# source-controller, kustomize-controller, helm-controller, notification-controller
```

Bootstrap is idempotent — re-run it to upgrade Flux. Add `--components-extra=image-reflector-controller,image-automation-controller` to enable image automation. For any other Git server use `flux bootstrap git --url=ssh://...`.

## GitRepository + Kustomization

```yaml
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
    name: git-credentials   # private repos: flux create secret git ...
---
apiVersion: kustomize.toolkit.fluxcd.io/v1
kind: Kustomization          # Flux CRD — not the kustomize.config.k8s.io file
metadata:
  name: my-app
  namespace: flux-system
spec:
  interval: 5m
  sourceRef:
    kind: GitRepository
    name: my-app
  path: ./k8s/overlays/production
  prune: true                # delete resources removed from Git
  wait: true                 # health-check everything it applied
  timeout: 3m
  targetNamespace: production
  dependsOn:
    - name: infrastructure   # e.g. CRDs / cert-manager first
```

## HelmRepository + HelmRelease

```yaml
apiVersion: source.toolkit.fluxcd.io/v1
kind: HelmRepository
metadata:
  name: podinfo
  namespace: flux-system
spec:
  type: oci
  interval: 1h
  url: oci://ghcr.io/stefanprodan/charts
---
apiVersion: helm.toolkit.fluxcd.io/v2
kind: HelmRelease
metadata:
  name: podinfo
  namespace: production
spec:
  interval: 10m
  chart:
    spec:
      chart: podinfo
      version: "6.x"
      sourceRef:
        kind: HelmRepository
        name: podinfo
        namespace: flux-system
  install:
    remediation:
      retries: 3
  upgrade:
    remediation:
      retries: 3
      remediateLastFailure: true   # roll back if the last retry fails
  values:
    replicaCount: 3
  valuesFrom:
    - kind: ConfigMap
      name: podinfo-values
      optional: true
```

`helm.toolkit.fluxcd.io/v2beta1`/`v2beta2` are removed in current Flux; migrate to `v2` (same spec for most fields).

## Image Automation

Scan a registry, pick the newest tag by policy, and commit it back to Git:

```yaml
apiVersion: image.toolkit.fluxcd.io/v1beta2
kind: ImageRepository
metadata:
  name: my-app
  namespace: flux-system
spec:
  image: ghcr.io/myorg/my-app
  interval: 5m
---
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
apiVersion: image.toolkit.fluxcd.io/v1beta2
kind: ImageUpdateAutomation
metadata:
  name: my-app
  namespace: flux-system
spec:
  interval: 5m
  sourceRef:
    kind: GitRepository
    name: flux-system
  git:
    checkout:
      ref:
        branch: main
    commit:
      author:
        name: fluxbot
        email: flux@example.com
      messageTemplate: "chore: update {{ .AutomationObject.Name }} images"
    push:
      branch: main
  update:
    path: ./clusters/production
    strategy: Setters
```

Mark the field to update with a setter comment — exact format matters:

```yaml
containers:
  - name: app
    image: ghcr.io/myorg/my-app:1.2.3 # {"$imagepolicy": "flux-system:my-app"}
```

Flux 2.7+ also serves these APIs as `image.toolkit.fluxcd.io/v1`.

## Multi-Tenant Repository Layout

```
fleet-infra/
├── clusters/
│   ├── production/
│   │   ├── flux-system/        # written by bootstrap
│   │   ├── infrastructure.yaml # Kustomization -> ./infrastructure
│   │   └── tenants.yaml        # Kustomization -> ./tenants, dependsOn infrastructure
│   └── staging/
├── infrastructure/             # cert-manager, ingress, monitoring
└── tenants/
    ├── team-a/                 # namespace, RBAC, GitRepository + Kustomization
    └── team-b/
```

Give each tenant Kustomization `serviceAccountName: team-a` so it applies with that team's RBAC only (and start the kustomize-controller with `--default-service-account` to enforce it).

## Notifications and Webhooks

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
---
# Push-based trigger from GitHub instead of waiting for the poll interval
apiVersion: notification.toolkit.fluxcd.io/v1
kind: Receiver
metadata:
  name: github
  namespace: flux-system
spec:
  type: github
  events: ["push"]
  secretRef:
    name: webhook-token
  resources:
    - kind: GitRepository
      name: flux-system
```

## Flux CLI Cheat Sheet

```bash
flux get all -A                                   # everything and its Ready status
flux get sources git
flux get kustomizations
flux get helmreleases -A

flux reconcile source git flux-system             # fetch now
flux reconcile kustomization my-app --with-source # fetch + apply now
flux reconcile helmrelease podinfo -n production

flux diff kustomization my-app --path ./k8s/overlays/production
flux suspend kustomization my-app                 # pause during an incident
flux resume kustomization my-app
flux logs --follow --level=error
flux events --for Kustomization/my-app
flux export source git my-app > git-repository.yaml
```

## Common Issues

**Kustomization `Not Ready`** — source not fetched (auth, branch name) or a health check failing. `flux get sources git`, then `flux events --for Kustomization/<name>`.

**HelmRelease `install retries exhausted`** — bad values or a failing hook. `flux logs --kind=HelmRelease --name=podinfo -n production`, fix values in Git, then `flux reconcile helmrelease podinfo -n production --force`.

**`no matches for kind "HelmRelease" in version "helm.toolkit.fluxcd.io/v2beta1"`** — the API was removed on upgrade; change to `v2`.

**Image automation not committing** — missing/wrong `$imagepolicy` marker, image controllers not installed, or the deploy key is read-only (bootstrap with `--read-write-key`).

**Rollback** — revert the commit in Git; Flux reconciles to it. For a HelmRelease, `upgrade.remediation` rolls back automatically on failure.

## Best Practices

- **Bootstrap once, manage Flux from Git** — upgrades are a re-bootstrap or a PR
- **Separate `infrastructure/` from apps/tenants** and order with `dependsOn`
- **`prune: true` + `wait: true`** on every Kustomization
- **Pin chart versions** (`6.x` in dev, exact in prod)
- **Receivers + alerts** instead of aggressive polling
- **Encrypt secrets** with SOPS (`spec.decryption.provider: sops`) or use External Secrets

## Frequently Asked Questions

### What is Flux in GitOps?

Flux is a set of Kubernetes controllers that continuously pull desired state from Git (or OCI/Helm repositories) and reconcile the cluster to it. Git becomes the source of truth: a merge deploys, a revert rolls back, and manual drift is corrected on the next reconcile.

### Flux vs Argo CD — which should I use?

Both are CNCF-graduated pull-based GitOps tools. Flux is CRD/CLI-native, modular and has first-class image automation and SOPS decryption; Argo CD offers a rich web UI, SSO/RBAC, AppProjects and ApplicationSets. See [Argo CD GitOps](/recipes/deployments/argocd-gitops/) and the [Flux vs Argo CD comparison](/recipes/deployments/flux-vs-argocd-gitops-comparison/).

### Is Flux CI/CD?

Flux is the CD half. CI (build, test, push image) stays in GitHub Actions, GitLab CI, Tekton, etc.; Flux picks up the new manifest commit — or the new image tag via image automation — and deploys it.

### How do I force Flux to sync immediately?

`flux reconcile source git flux-system` fetches the latest commit; `flux reconcile kustomization <name> --with-source` fetches and applies in one step.

### How do I roll back with Flux?

`git revert` the offending commit and push; Flux applies the previous state. HelmReleases can also roll back automatically via `upgrade.remediation`. Use `flux suspend` to freeze reconciliation while you investigate.
