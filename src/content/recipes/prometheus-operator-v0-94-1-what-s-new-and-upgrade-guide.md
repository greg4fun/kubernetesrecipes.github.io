---
title: "Prometheus Operator v0.94.1: What's New and Upgrade Guide"
description: "Prometheus Operator v0.94.1 fixes a ClusterRole RBAC bug affecting owner-reference finalizer updates. Upgrade steps and verification included."
publishDate: "2026-10-16"
author: "Luca Berton"
category: "security"
difficulty: "beginner"
timeToComplete: "10 minutes"
kubernetesVersion: "1.28+"
tags:
  - "prometheus-operator"
  - "rbac"
  - "clusterrole"
  - "bugfix"
  - "upgrade"
  - "prometheus"
  - "helm"
---
> 💡 **Quick Answer:** v0.94.1 is a single-bugfix patch release that restores the `update` permission on finalizer subresources in the operator's ClusterRole. Upgrade if you rely on `OwnerReferencesPermissionEnforcement` with `blockOwnerDeletion` set, otherwise it's a safe, low-risk patch to apply.

## The Problem

Clusters running the `OwnerReferencesPermissionEnforcement` admission plugin reject owner-reference updates on objects that set `blockOwnerDeletion: true` unless the acting ServiceAccount has `update` permission on the resource's `finalizers` subresource. A prior release of the Prometheus Operator dropped this permission from the operator's ClusterRole, causing reconciliation errors (403 Forbidden on finalizer updates) on clusters with that admission plugin enabled — common on GKE and other hardened distributions.

## The Solution

v0.94.1 restores the missing `update` verb on the `finalizers` subresource in the bundled ClusterRole manifests (`prometheus-operator-clusterrole`). No CRD or API changes are involved — this is purely an RBAC fix shipped in the static manifests, Helm chart, and Jsonnet/kube-prometheus bundles that reference this operator version.

## Whats New

The release notes for v0.94.1 are thin — a single bugfix:

- **[BUGFIX]** Restore `update` permission on finalizer subresources in the operator's ClusterRole, required by `OwnerReferencesPermissionEnforcement` when `blockOwnerDeletion` is set. ([#8830](https://github.com/prometheus-operator/prometheus-operator/pull/8830))

No new features, no deprecations, no breaking changes are listed. See the [release page](https://github.com/prometheus-operator/prometheus-operator/releases/tag/v0.94.1) for the authoritative, up-to-date notes.

## Upgrade Steps

### Option 1: Plain manifests (bundle.yaml)

```bash
kubectl apply --server-side -f https://raw.githubusercontent.com/prometheus-operator/prometheus-operator/v0.94.1/bundle.yaml
```

### Option 2: Helm (kube-prometheus-stack or standalone operator chart)

```bash
helm repo update

helm upgrade prometheus-operator prometheus-community/prometheus-operator-crds \
  --namespace monitoring

helm upgrade prometheus-operator prometheus-community/kube-prometheus-stack \
  --namespace monitoring \
  --set prometheusOperator.image.tag=v0.94.1
```

Check the chart's `appVersion` mapping before pinning the image tag directly — prefer bumping the chart version if a release that pins v0.94.1 as `appVersion` is available.

### Option 3: kubectl set image (quick patch)

```bash
kubectl set image deployment/prometheus-operator \
  prometheus-operator=quay.io/prometheus-operator/prometheus-operator:v0.94.1 \
  -n monitoring
```

## Verify

```bash
# Confirm the operator pod is running the new version
kubectl get deployment prometheus-operator -n monitoring \
  -o jsonpath='{.spec.template.spec.containers[0].image}'

# Confirm the ClusterRole now includes the finalizers update verb
kubectl get clusterrole prometheus-operator -o yaml | grep -A3 finalizers

# Tail operator logs for any lingering 403 errors on owner-reference updates
kubectl logs -n monitoring deploy/prometheus-operator --since=5m | grep -i forbidden
```

Expect no `forbidden` entries related to `finalizers` after the upgrade and a clean rollout (`kubectl rollout status deployment/prometheus-operator -n monitoring`).

## Common Issues

- **ClusterRole not updated after Helm upgrade**: Helm does not always reconcile RBAC changes on `helm upgrade` if the chart didn't bump its templated RBAC version. Run `kubectl apply --server-side` on the chart's rendered ClusterRole manually, or force with `helm upgrade --force`.
- **Still seeing 403s post-upgrade**: confirm the operator's Deployment actually picked up the new image (`kubectl rollout status`) and that no `ClusterRoleBinding` is pointing at a stale, duplicated ClusterRole from a previous install method (manifest vs Helm vs Operator Lifecycle Manager).
- **Mixed install methods**: if the operator was installed via OLM/bundle and later via Helm, duplicate RBAC objects can mask which one is actually in effect — check `kubectl get clusterrolebinding -o wide | grep prometheus-operator`.

## Best Practices

- Treat patch releases like this one as low-risk and apply them promptly — RBAC gaps can silently break reconciliation on hardened clusters (GKE, clusters with `OwnerReferencesPermissionEnforcement` enabled) without obvious alerts.
- Always diff the ClusterRole before and after upgrade in GitOps-managed clusters (`kubectl diff -f bundle.yaml`) to catch unexpected permission changes.
- Pin the operator image tag explicitly in Helm values or manifests rather than tracking `latest`, so upgrades like this are deliberate and auditable.
- After upgrading, watch operator logs for a few minutes for any `forbidden`/`finalizer` errors before considering the rollout complete.
