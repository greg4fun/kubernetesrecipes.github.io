---
title: "What's New in KEDA v2.21.0 - Breaking Changes and Upgrade Guide"
description: "KEDA 2.21.0 fixes CVE-2026-77524, changes Azure Pipelines and Temporal scalers, and adds new scalers. Upgrade steps included."
publishDate: "2026-10-28"
author: "Luca Berton"
category: "autoscaling"
difficulty: "intermediate"
timeToComplete: "20 minutes"
kubernetesVersion: "1.28+"
tags:
  - "keda"
  - "autoscaling"
  - "security"
  - "helm"
  - "upgrade"
  - "cve"
  - "event-driven"
---
> 💡 **Quick Answer:** KEDA 2.21.0 patches a critical service-account-token privilege escalation (CVE-2026-77524) and ships three breaking changes — bound-token audience enforcement, Azure Pipelines `scaleOnInFlight` defaulting to `true`, and removal of deprecated Temporal versioning fields — alongside new Cosmos DB Change Feed, ClickHouse, and GCP Cloud Spanner scalers.

## The Problem

Operators running KEDA 2.20 with Vault Kubernetes authentication or any `TriggerAuthentication`/`ClusterTriggerAuthentication` using `boundServiceAccountToken` (Metrics API, Prometheus, Loki, Datadog Cluster Agent, etc.) are exposed to CVE-2026-77524 / GHSA-637c-6jxx-4rwm, a token audience validation flaw that allows privilege escalation. In addition, Temporal and Azure Pipelines scaler configs that were valid in 2.20 may silently break or change scaling behavior after a naive upgrade.

## The Solution

Upgrade to KEDA 2.21.0, but read the migration guide first and treat this as a change-managed upgrade, not a drop-in bump — three behaviors change by default and one scaler is deprecated.

## What's New

**Security fix (CVE-2026-77524 / GHSA-637c-6jxx-4rwm)** — KEDA now enforces explicit service account token audiences, closing a `TriggerAuthentication` privilege escalation vector. Affects Vault Kubernetes auth (operator token, projected token, `credential.serviceAccountName`) and any trigger auth using `boundServiceAccountToken`. Review [Service account token audiences](https://keda.sh/docs/2.21/migration/#service-account-token-audiences) before upgrading.

**Breaking changes:**
- **Azure Pipelines scaler**: new `scaleOnInFlight` field defaults to `true` ([#7905](https://github.com/kedacore/keda/pull/7905)). Queue length now includes jobs already assigned to an agent but not finished. Set `scaleOnInFlight: false` to keep 2.20 behavior (unassigned-only); for `ScaledJob`, pair with the `accurate` scaling strategy.
- **Temporal scaler**: deprecated `buildId`, `selectAllActive`, and `selectUnversioned` fields are removed ([#7985](https://github.com/kedacore/keda/pull/7985)). `ScaledObject`/`ScaledJob` still using them will fail metadata parsing. Migrate versioned workers to `workerDeploymentName` + `workerDeploymentBuildId`, or drop the fields for unversioned workers.
- **Service account token audiences**: explicit audience enforcement for bound tokens (see security fix above) can break existing `TriggerAuthentication`/Vault configs that relied on implicit/default audiences.

**Deprecation:**
- **Liiklus scaler** is deprecated; upstream project is unmaintained. Removal planned for a future release ([#7929](https://github.com/kedacore/keda/issues/7929), [#7938](https://github.com/kedacore/keda/pull/7938)).

**New scalers and features:**
- Azure Cosmos DB Change Feed scaler
- ClickHouse scaler
- GCP Cloud Spanner scaler ([#7844](https://github.com/kedacore/keda/pull/7844))
- External scalers can now push dynamic HPA targets via `StreamMetricSpec` ([#7794](https://github.com/kedacore/keda/pull/7794)), plus new external-scaler gRPC client metrics
- Prometheus OAuth2 client-credentials auth
- Kafka Kerberos credential-cache support
- Azure Pipelines service-principal authentication
- Controller sharding by label selectors ([#7816](https://github.com/kedacore/keda/pull/7816))
- `ScaledObject` validation now accepts pod-level CPU/memory requests ([#8119](https://github.com/kedacore/keda/pull/8119))
- Reduced redundant scaler-backend polling when the HPA already owns the scaling decision ([#7999](https://github.com/kedacore/keda/issues/7999), [#8031](https://github.com/kedacore/keda/pull/8031))
- More deterministic scaler/auth lifecycle: cancellation, refresh handling, Kubernetes API timeouts, external-scaler connection cleanup

Full notes: [v2.21.0 release page](https://github.com/kedacore/keda/releases/tag/v2.21.0).

## Upgrade Steps

1. Inventory affected resources before touching the cluster:

```bash
# Find TriggerAuthentication/ClusterTriggerAuthentication using boundServiceAccountToken
kubectl get triggerauthentications,clustertriggerauthentications -A -o yaml | grep -B5 boundServiceAccountToken

# Find Temporal scalers using removed settings
kubectl get scaledobjects,scaledjobs -A -o yaml | grep -E 'buildId|selectAllActive|selectUnversioned'

# Find Azure Pipelines scalers (check if scaleOnInFlight needs to be set)
kubectl get scaledobjects,scaledjobs -A -o yaml | grep -B10 'azure-pipelines'
```

2. Read the full migration guide: https://keda.sh/docs/2.21/migration/#upgrading-from-keda-220-to-221

3. Patch Vault/token-auth `TriggerAuthentication` resources to set explicit audiences per the [service account token audiences guide](https://keda.sh/docs/2.21/migration/#service-account-token-audiences).

4. For Azure Pipelines workloads that must preserve 2.20 behavior, add:

```yaml
metadata:
  scaleOnInFlight: "false"
```

5. Remove deprecated Temporal fields (`buildId`, `selectAllActive`, `selectUnversioned`) and migrate to `workerDeploymentName`/`workerDeploymentBuildId` where applicable.

6. Upgrade KEDA via Helm:

```bash
helm repo add kedacore https://kedacore.github.io/charts
helm repo update

helm upgrade keda kedacore/keda \
  --namespace keda \
  --version 2.21.0 \
  --install
```

Or via kubectl manifests:

```bash
kubectl apply --server-side -f https://github.com/kedacore/keda/releases/download/v2.21.0/keda-2.21.0.yaml
```

## Verify

```bash
# Confirm KEDA version
kubectl get deployment keda-operator -n keda -o jsonpath='{.spec.template.spec.containers[0].image}'

# Confirm all KEDA pods are healthy
kubectl get pods -n keda

# Confirm CRDs are updated
kubectl get crd scaledobjects.keda.sh -o jsonpath='{.spec.versions[*].name}'

# Check operator logs for metadata parsing errors (e.g. Temporal/removed fields)
kubectl logs -n keda deployment/keda-operator | grep -i error
```

Confirm HPAs are still generated and scaling for each `ScaledObject`:

```bash
kubectl get hpa -A
```

## Common Issues

- **ScaledObject stuck after upgrade with a metadata parsing error**: almost always a Temporal scaler still using `buildId`, `selectAllActive`, or `selectUnversioned`. Remove them per the migration guide.
- **Azure Pipelines queue scales more aggressively than before**: `scaleOnInFlight` now defaults to `true`, counting assigned-but-unfinished jobs. Set `scaleOnInFlight: false` to revert, and add the `accurate` scaling strategy on `ScaledJob` if needed.
- **TriggerAuthentication suddenly fails to authenticate (Vault, Prometheus, Loki, Datadog Cluster Agent)**: the fix for CVE-2026-77524 enforces explicit token audiences. Update the auth config per the [token audiences guide](https://keda.sh/docs/2.21/migration/#service-account-token-audiences) rather than disabling the check.

## Best Practices

- Treat the CVE-2026-77524 fix as mandatory and schedule the upgrade promptly if you use Vault Kubernetes auth or bound-token `TriggerAuthentication`.
- Audit all `ScaledObject`/`ScaledJob` manifests for Temporal and Azure Pipelines scalers before upgrading, not after.
- Pin the Helm chart `--version` explicitly in CI/CD instead of tracking `latest` to keep breaking-change upgrades intentional.
- Start migrating off the Liiklus scaler now; it is deprecated and slated for removal.
- Re-run `kubectl get hpa -A` and check scaler-backend request volume after upgrading to confirm the new HPA-ownership optimization (#8031) is reducing redundant polling as expected.
