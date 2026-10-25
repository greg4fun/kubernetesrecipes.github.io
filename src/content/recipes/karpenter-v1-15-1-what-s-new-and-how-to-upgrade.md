---
title: "Karpenter v1.15.1: What's New and How to Upgrade"
description: "Karpenter v1.15.1 is a chores-only cherrypick release; see what changed and how to safely upgrade from v1.14.2."
publishDate: "2026-10-24"
author: "Luca Berton"
category: "autoscaling"
difficulty: "intermediate"
timeToComplete: "15 minutes"
kubernetesVersion: "1.28+"
tags:
  - "karpenter"
  - "autoscaling"
  - "node-provisioning"
  - "helm"
  - "upgrade"
  - "aws"
---
> 💡 **Quick Answer:** Karpenter v1.15.1 is a patch release containing only a chores cherrypick (PR #3463) — there are no new features, deprecations, or breaking changes documented for this tag. If you're coming from v1.14.2, you're also skipping the entire v1.15.0 minor release, so review those notes separately before upgrading.

## The Problem

A new Karpenter release landed (v1.15.1), and the jump from your previously known version (v1.14.2) spans a minor version boundary (1.14 → 1.15). Operators need to know whether this introduces behavior changes to node provisioning/consolidation, and whether it's safe to roll out to production clusters.

## The Solution

Treat v1.15.1 as a low-risk patch on top of v1.15.0. Upgrade via Helm as usual, but since the upstream release notes for v1.15.1 are thin, read the v1.15.0 changelog/release page first to understand the actual feature/behavior delta you're absorbing when moving off v1.14.2.

## What's New

The published release notes for v1.15.1 contain exactly one entry:

- **Chores:** cherrypicks for v1.15.1 ([#3463](https://github.com/kubernetes-sigs/karpenter/pull/3463))

No new CRD fields, flags, metrics, or deprecations are documented in this tag. Because the notes are this thin, don't assume parity-only behavior — check the full release page for the complete diff and the v1.15.0 notes for the real feature set:

👉 https://github.com/kubernetes-sigs/karpenter/releases/tag/v1.15.1

## Upgrade Steps

Karpenter is typically distributed as a cloud-provider-specific Helm chart (e.g. `karpenter` for AWS). Adjust the chart repo/name for your provider.

```bash
# Check current installed version
helm list -n kube-system | grep karpenter

# Update the Helm repo index
helm repo update

# Review the chart version mapped to app version 1.15.1
helm search repo karpenter --versions | grep 1.15

# Upgrade in place (example for the AWS provider chart)
helm upgrade karpenter oci://public.ecr.aws/karpenter/karpenter \
  --version 1.15.1 \
  --namespace kube-system \
  --reuse-values \
  --wait
```

Because this spans v1.14.2 → v1.15.x, also diff your `NodePool` and `EC2NodeClass` (or equivalent provider CRD) manifests against the v1.15.0 CRD schema before upgrading, since minor versions can add/rename fields even when a patch release itself is quiet.

```bash
# Re-apply updated CRDs if the chart doesn't manage them automatically
kubectl apply -f https://raw.githubusercontent.com/kubernetes-sigs/karpenter/v1.15.1/pkg/apis/crds/karpenter.sh_nodepools.yaml
kubectl apply -f https://raw.githubusercontent.com/kubernetes-sigs/karpenter/v1.15.1/pkg/apis/crds/karpenter.sh_nodeclaims.yaml
```

## Verify

```bash
# Confirm the controller image/tag rolled out
kubectl get deployment karpenter -n kube-system \
  -o jsonpath='{.spec.template.spec.containers[0].image}'

# Confirm pods are healthy on the new version
kubectl get pods -n kube-system -l app.kubernetes.io/name=karpenter

# Tail logs for errors after rollout
kubectl logs -n kube-system -l app.kubernetes.io/name=karpenter --tail=100

# Confirm NodePools/NodeClaims are still being reconciled
kubectl get nodepools
kubectl get nodeclaims
```

If scaling events happen normally within a few minutes of a workload scheduling pressure test, the upgrade is functioning correctly.

## Common Issues

- **CRD drift:** If `NodePool`/`NodeClaim` CRDs weren't updated alongside the controller during the 1.14→1.15 jump, you may see validation errors on apply — reconcile CRDs first.
- **Helm chart version vs app version mismatch:** The Helm chart version doesn't always match the `appVersion` 1-to-1; confirm with `helm show chart karpenter --version <x>` before assuming you're on 1.15.1.
- **Thin release notes ≠ no risk:** Don't skip canarying this upgrade just because v1.15.1's notes are chores-only — the controller image itself still changed.

## Best Practices

- Always read the full minor release (v1.15.0 here) notes when skipping a minor version, not just the latest patch tag.
- Canary the upgrade on a non-production cluster and watch consolidation/provisioning behavior for at least one scaling cycle.
- Pin Helm chart versions explicitly in CI/CD rather than using `latest` to keep upgrades auditable.
- Keep provider-specific CRDs (`EC2NodeClass`, etc.) under version control so diffs are visible during upgrades.
