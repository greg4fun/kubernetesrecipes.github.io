---
title: "What's New in Flux v2.10.0: GitOps Toolkit Upgrade Guide"
description: "Flux v2.10.0 adds object identity GA, SPIFFE mTLS, notification v1 APIs, OCIRepository charts. Covers breaking changes and upgrade steps."
publishDate: "2026-10-27"
author: "Luca Berton"
category: "deployments"
difficulty: "intermediate"
timeToComplete: "20 minutes"
kubernetesVersion: "1.35+"
tags:
  - "flux"
  - "fluxcd"
  - "gitops"
  - "kubernetes"
  - "upgrade"
  - "helm"
  - "security"
---
> 💡 **Quick Answer:** Flux v2.10.0 makes object identity generally available (retiring the `ObjectLevelWorkloadIdentity` feature gate), adds SPIFFE mTLS between controllers, promotes notification `Event`/`Alert`/`Provider` to `v1`, and supports `OCIRepository` as a `HelmRelease` chart source — but it ships RBAC and API breaking changes that require action before upgrading.

## The Problem

Teams running Flux need to know whether v2.10.0 is a safe upgrade, what breaks, and what new capabilities (identity, SOPS, image automation) are worth adopting. The release notes mix several controller bumps and multiple breaking changes that are easy to miss in a routine `flux bootstrap` run.

## The Solution

Review the breaking changes below, patch RBAC for object identity, convert any `v1beta3` `Alert`/`Provider` manifests to `v1`, and then upgrade the Flux CLI and in-cluster components together following the official v2.7+ upgrade procedure.

## What's New

- **Object identity is GA** — the `ObjectLevelWorkloadIdentity` feature gate is retired; identity-based auth to cloud providers/registries is always on.
- **SPIFFE mTLS** for inter-controller communication (controller-to-controller traffic is now mutually authenticated).
- **Notification APIs promoted to v1** — `Event`, `Alert`, and `Provider` move from `v1beta3` to `v1`.
- **`OCIRepository` as a `HelmRelease` chart source** — charts can be sourced directly from OCI artifacts, not just `HelmRepository`/`GitRepository`.
- **SOPS improvements** — decryption of files encrypted with comment regexes, plus `--override-manager-before-dry-run` on `Kustomization`.
- **Image automation** — `ImageUpdateAutomation` gets `.spec.policyChangeDelay` for batching, retry on rejected pushes, and `.Changed.Summary`; `--add-ignore-paths` flag added to artifact commands (PR #5885).
- **`ImageRepository` tag storage** — the Flux artifact storage backend is now the default (replacing BadgerDB).
- **`ArtifactGenerator`** gains cross-namespace artifacts, tenant namespace provisioning, and path-pattern discovery.
- New notification providers: **Zoom, incident.io, Mastodon**.
- Built with **Kubernetes 1.37** and **Go 1.27**.
- Component versions: source-controller v1.10.1, kustomize-controller v1.10.1, notification-controller v1.10.0, helm-controller v1.7.1, image-reflector-controller v1.3.0, image-automation-controller v1.3.0, source-watcher v2.3.1.

### Kubernetes compatibility

| Kubernetes version | Minimum required |
|---|---|
| v1.35 | >= 1.35.2 |
| v1.36 | >= 1.36.1 |
| v1.37 | >= 1.37.0 |

Flux supports only the latest three Kubernetes minor versions; older clusters need vendor support (e.g., ControlPlane).

## Breaking Changes (read before upgrading)

1. **Default RBAC no longer grants `create` on `serviceaccounts/token`.** Object identity is always enabled now, so installations relying on default RBAC must bind an additional ClusterRole/ClusterRoleBinding to controller ServiceAccounts *before* upgrading. See the required manifests in [fluxcd/flux2#6139](https://github.com/fluxcd/flux2/pull/6139).
2. **Notification `Alert`/`Provider` are now `v1`.** Converting from `v1beta3` drops `Alert.spec.summary`, `Provider.spec.interval`, the static JWT token for Azure Event Hub, and TLS/proxy config in `Provider.spec.secretRef`. Migrate to `eventMetadata.summary`, `proxySecretRef`, and `certSecretRef`.
3. **`ImageRepository` tag DB default change.** The Flux artifact storage backend replaces BadgerDB by default; the local tag database is wiped, forcing a full rescan of every `ImageRepository` on first reconcile. To keep the old behavior, set `--feature-gates=FluxStorage=false` on image-reflector-controller.
4. **Remote cluster auth via `.spec.kubeConfig.configMapRef`** now uses object identity. Replace the legacy `audiences` key with `credential.auth.fluxcd.io/audiences`.

## Upgrade Steps

```bash
# 1. Check current Flux version and components
flux check
flux version

# 2. Apply the ClusterRole/ClusterRoleBinding required for object identity
# (manifest from fluxcd/flux2#6139 — adjust namespace/service accounts as needed)
kubectl apply -f https://raw.githubusercontent.com/fluxcd/flux2/main/manifests/rbac/object-identity-clusterrole.yaml

# 3. Upgrade the Flux CLI
curl -s https://fluxcd.io/install.sh | sudo bash
flux version --client

# 4. (Optional) opt out of the new ImageRepository storage backend
# if you need to preserve the existing BadgerDB tag database
flux create source helm --help # sanity check CLI is updated

# 5. Upgrade in-cluster components via bootstrap (Git-based install)
flux bootstrap github \
  --owner=<github-org> \
  --repository=<repo> \
  --branch=main \
  --path=clusters/<cluster-name> \
  --components-extra=image-reflector-controller,image-automation-controller

# Or, if not using bootstrap, upgrade manifests directly:
flux install --version=v2.10.0 --export > flux-system.yaml
kubectl apply -f flux-system.yaml
```

If you set the `FluxStorage=false` feature gate, add it to the image-reflector-controller deployment args before applying:

```bash
kubectl -n flux-system set args deployment/image-reflector-controller \
  --containers=manager \
  -- --feature-gates=FluxStorage=false
```

## Verify

```bash
# Confirm controller versions match the release
flux check

# Confirm all Flux pods are healthy after the upgrade
kubectl -n flux-system get pods

# Confirm GitOps reconciliation is still working
flux get sources git
flux get kustomizations

# Confirm notification Alert/Provider CRDs report v1 as the storage version
kubectl get crd alerts.notification.toolkit.fluxcd.io -o jsonpath='{.status.storedVersions}'
kubectl get crd providers.notification.toolkit.fluxcd.io -o jsonpath='{.status.storedVersions}'
```

## Common Issues

- **`Forbidden: cannot create serviceaccounts/token`** errors after upgrade: the ClusterRoleBinding for object identity wasn't applied before the upgrade — apply it from PR #6139 and restart the affected controller.
- **`Alert`/`Provider` reconciliation errors mentioning unknown fields**: manifests still use deprecated `v1beta3` fields (`spec.summary`, `spec.interval`, TLS/proxy in `secretRef`); migrate to the `v1` field names listed above.
- **`ImageRepository` shows stale or missing tags right after upgrade**: expected — the tag database was reset by the storage backend switch; wait for the next reconciliation interval or trigger one manually with `flux reconcile image repository <name>`.
- **Remote cluster `Kustomization`/`HelmRelease` fails auth**: `audiences` key under `kubeConfig.configMapRef` is no longer honored; rename it to `credential.auth.fluxcd.io/audiences`.

## Best Practices

- Apply the object-identity RBAC patch in a maintenance window *before* rolling out v2.10.0, not after.
- Audit all `Alert` and `Provider` manifests for deprecated `v1beta3`-only fields prior to upgrading, using `kubectl get alerts.notification.toolkit.fluxcd.io -A -o yaml` to search for `summary:` and `secretRef.tls`.
- Pin the Flux CLI and bootstrap manifests to the same version (`v2.10.0`) to avoid CLI/controller API mismatches.
- Follow the official [Upgrade Procedure for Flux v2.7+](https://github.com/fluxcd/flux2/discussions/5572) discussion for the canonical step-by-step sequence, since it's updated as new breaking changes land.
- Review the full [v2.10.0 release notes](https://github.com/fluxcd/flux2/releases/tag/v2.10.0) and individual controller changelogs (source-controller, helm-controller, etc.) before upgrading production clusters.
