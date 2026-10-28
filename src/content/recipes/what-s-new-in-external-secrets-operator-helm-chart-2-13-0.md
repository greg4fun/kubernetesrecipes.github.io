---
title: "What's New in External Secrets Operator Helm Chart 2.13.0"
description: "Release notes for ESO helm-chart-2.13.0 are thin; practical helm upgrade steps and verification for operators."
publishDate: "2026-10-17"
author: "Luca Berton"
category: "security"
difficulty: "intermediate"
timeToComplete: "10 minutes"
kubernetesVersion: "1.28+"
tags:
  - "external-secrets"
  - "helm"
  - "secrets-management"
  - "security"
  - "upgrade"
  - "helm-chart"
---
> 💡 **Quick Answer:** The `helm-chart-2.13.0` release notes for External Secrets Operator (ESO) contain no changelog detail beyond the generic project description, so there's nothing version-specific to call out here — treat this as a routine chart bump, follow the standard Helm upgrade procedure below, and check the release page/CRDs diff yourself before rolling out to production.

## The Problem

A new chart tag, `helm-chart-2.13.0`, was published for [external-secrets/external-secrets](https://github.com/external-secrets/external-secrets). Operators tracking new releases need to know whether to upgrade now and what, if anything, breaks.

## The Solution

The published release notes for this tag are effectively empty (just the standard "External secrets management for Kubernetes" tagline, no PRs, flags, or deprecations listed). Rather than guessing at features that may or may not exist, treat this as a maintenance-level chart update: back up your `ClusterSecretStore`/`SecretStore`/`ExternalSecret` CRs, diff the CRDs, and upgrade through Helm as usual.

👉 Check the actual diff before upgrading: https://github.com/external-secrets/external-secrets/releases/tag/helm-chart-2.13.0

## Whats New

- No specific features, deprecations, or breaking changes are documented in the release notes for `helm-chart-2.13.0` at the time of writing.
- If you need the real delta, compare against the previous chart tag directly:

```bash
git clone https://github.com/external-secrets/external-secrets.git
cd external-secrets
git log --oneline <previous-chart-tag>..helm-chart-2.13.0 -- deploy/charts/external-secrets
```

- Since this is a first-tracked release in this cookbook (no previous known version), also confirm current CRD versions before upgrading:

```bash
kubectl get crd | grep external-secrets.io
```

## Upgrade Steps

```bash
# Add/update the Helm repo
helm repo add external-secrets https://charts.external-secrets.io
helm repo update

# Check current installed version
helm list -n external-secrets

# Inspect what will change (values + CRDs) before applying
helm diff upgrade external-secrets external-secrets/external-secrets \
  -n external-secrets --version 0.13.0 \
  -f values.yaml

# Apply the upgrade (chart version corresponding to helm-chart-2.13.0)
helm upgrade external-secrets external-secrets/external-secrets \
  -n external-secrets \
  --version 0.13.0 \
  --create-namespace \
  -f values.yaml
```

> Note: ESO's Helm chart versioning is independent from the `helm-chart-X.Y.Z` git tag naming — always confirm the matching chart `version:` field in `Chart.yaml` or via `helm search repo external-secrets/external-secrets --versions` before setting `--version`.

If you manage CRDs separately (recommended for GitOps setups where `installCRDs` is disabled):

```bash
kubectl apply -f https://raw.githubusercontent.com/external-secrets/external-secrets/helm-chart-2.13.0/deploy/crds/bundle.yaml
```

## Verify

```bash
# Confirm pods are healthy post-upgrade
kubectl get pods -n external-secrets -l app.kubernetes.io/name=external-secrets

# Confirm the deployed chart/app version
helm list -n external-secrets

# Confirm CRDs are present and at expected version
kubectl get crd externalsecrets.external-secrets.io -o jsonpath='{.spec.versions[*].name}'

# Sanity-check an existing ExternalSecret still syncs
kubectl get externalsecret -A
kubectl describe externalsecret <name> -n <namespace>
```

Look for `SecretSynced` status condition `True` and no new errors in the operator logs:

```bash
kubectl logs -n external-secrets deploy/external-secrets --tail=100
```

## Common Issues

- **CRD drift**: if `installCRDs` was left at its default and CRDs were also applied manually, `helm upgrade` can fail on ownership conflicts. Check CRD annotations (`meta.helm.sh/release-name`) before upgrading.
- **Webhook cert rotation**: ESO's validating/mutating webhooks use cert-controller; a failed upgrade can leave stale webhook configs. Restart the `external-secrets-cert-controller` pod if `ExternalSecret` creation starts failing with TLS errors.
- **Provider-specific breaking changes**: because this release's notes are empty, double-check your specific provider (AWS SM, Vault, GCP SM, Azure KV, etc.) config against the chart's `values.yaml` diff — provider auth fields occasionally get renamed between versions.

## Best Practices

- Pin the Helm chart version explicitly in CI/CD (`--version`) rather than tracking `latest`.
- Run `helm diff upgrade` (via the `helm-diff` plugin) before every production upgrade.
- Keep CRD management (`kubectl apply`) separate from Helm lifecycle when running GitOps (Argo CD/Flux) to avoid uninstall-time CRD deletion.
- Watch the [ESO releases page](https://github.com/external-secrets/external-secrets/releases) directly for future tags — this particular release's notes were too thin to extract actionable detail, so don't assume "no notes" means "no changes."
