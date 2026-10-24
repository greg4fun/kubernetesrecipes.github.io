---
title: "External Secrets Operator helm-chart-2.14.0: What's New and Upgrade Guide"
description: "Release notes for External Secrets Operator helm-chart-2.14.0 are thin; here's how to safely check changes and upgrade via Helm."
publishDate: "2026-10-24"
author: "Luca Berton"
category: "security"
difficulty: "intermediate"
timeToComplete: "15 minutes"
kubernetesVersion: "1.27+"
tags:
  - "external-secrets"
  - "helm"
  - "secrets-management"
  - "security"
  - "upgrade"
  - "operators"
---
> 💡 **Quick Answer:** The `helm-chart-2.14.0` release notes for External Secrets Operator contain no actual changelog (just the generic project description), so operators should check the GitHub diff manually before upgrading; the upgrade itself follows the standard Helm chart bump procedure from `2.13.0`.

## The Problem

A new chart version (`helm-chart-2.14.0`) was published for External Secrets Operator (ESO), but the release notes field on GitHub is effectively empty — it just repeats "External secrets management for Kubernetes" instead of listing actual changes, fixes, or breaking changes.

## The Solution

Since the shipped release notes don't give operators anything concrete to act on, don't guess at features. Instead:

1. Treat this as a routine chart/version bump until proven otherwise.
2. Diff the chart and CRDs between `2.13.0` and `2.14.0` before rolling out to production.
3. Follow the standard ESO upgrade checklist (CRDs, webhook certs, controller version) since ESO upgrades can touch CRDs that require `--force` or manual `kubectl apply` in some chart versions.

## What's New

No verifiable feature list is available from the release notes for `helm-chart-2.14.0`. Do not assume new features, deprecations, or breaking changes exist — check the actual diff and release page directly:

👉 https://github.com/external-secrets/external-secrets/releases/tag/helm-chart-2.14.0

If you need the real changelog, compare the two tags directly:

```bash
# Compare chart source between the two tags
git clone https://github.com/external-secrets/external-secrets.git
cd external-secrets
git diff helm-chart-2.13.0 helm-chart-2.14.0 -- deploy/charts/external-secrets
```

## Upgrade Steps

Standard Helm-based upgrade for ESO. Always upgrade CRDs explicitly, since ESO ships CRDs outside the normal Helm hook lifecycle in some versions.

```bash
# Add/update the repo
helm repo add external-secrets https://charts.external-secrets.io
helm repo update

# Check what version you currently have
helm list -n external-secrets

# Inspect the default values diff before upgrading (optional but recommended)
helm show values external-secrets/external-secrets --version 0.14.0 > new-values.yaml
helm get values external-secrets -n external-secrets > current-values.yaml
diff current-values.yaml new-values.yaml

# Upgrade CRDs first (ESO recommends this for chart-based installs)
kubectl apply -f https://raw.githubusercontent.com/external-secrets/external-secrets/helm-chart-2.14.0/deploy/crds/bundle.yaml

# Upgrade the release
helm upgrade external-secrets external-secrets/external-secrets \
  --namespace external-secrets \
  --version 0.14.0 \
  --reuse-values
```

Note: the chart version tag (`helm-chart-2.14.0`) does not map 1:1 to the Helm chart's semver field shown by `helm search repo` — always confirm the actual chart version string with `helm search repo external-secrets/external-secrets --versions` before setting `--version`.

```bash
helm search repo external-secrets/external-secrets --versions | head -5
```

## Verify

```bash
# Confirm the deployed chart and app version
helm list -n external-secrets

# Confirm controller pods are healthy on the new image
kubectl get pods -n external-secrets -l app.kubernetes.io/name=external-secrets

# Confirm CRDs are present and healthy
kubectl get crds | grep external-secrets.io

# Confirm existing ExternalSecret resources still sync
kubectl get externalsecrets -A
kubectl describe externalsecret <name> -n <namespace>
```

Look for `SecretSynced` status conditions remaining `True` after the upgrade — a flip to `False` indicates a provider API or RBAC regression introduced by the new chart/controller version.

## Common Issues

- **CRD validation errors on upgrade**: Helm doesn't always update existing CRDs on `helm upgrade`. Apply the CRD bundle manually (as shown above) before upgrading the release.
- **Webhook TLS cert mismatch**: if the `certController` was previously disabled and is now enabled (or vice versa) between chart versions, the validating/mutating webhook can start rejecting ExternalSecret/SecretStore objects — check `kubectl get validatingwebhookconfigurations | grep external-secrets`.
- **Empty/thin release notes**: when upstream publishes a release with no real changelog, don't roll it into production without first diffing the chart templates and `values.yaml` yourself, as shown in the diff command above.

## Best Practices

- Pin the exact chart version in your GitOps manifests (Argo CD `Application` / Flux `HelmRelease`) rather than tracking `latest`.
- Always upgrade CRDs before the Helm release when using ESO's chart, since CRD schema changes are a common source of silent sync failures.
- Run the upgrade in a staging namespace/cluster first and confirm `ExternalSecret` sync status before touching production secret stores.
- Subscribe to the ESO GitHub Releases feed rather than relying on in-dashboard release text, since (as seen here) the notes field is sometimes left empty for chart-only bumps.
