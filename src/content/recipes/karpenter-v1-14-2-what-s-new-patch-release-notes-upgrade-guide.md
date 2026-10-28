---
title: "Karpenter v1.14.2: What's New (Patch Release Notes & Upgrade Guide)"
description: "Karpenter v1.14.2 patch release fixes NodeRepair label sync and capacity buffer workload watching. Upgrade steps and verification included."
publishDate: "2026-10-17"
author: "Luca Berton"
category: "autoscaling"
difficulty: "intermediate"
timeToComplete: "15 minutes"
kubernetesVersion: "1.28+"
tags:
  - "karpenter"
  - "autoscaling"
  - "node-autoscaling"
  - "patch-release"
  - "nodeclaim"
  - "capacity-buffer"
  - "helm"
---
> 💡 **Quick Answer:** Karpenter v1.14.2 is a bug-fix-only patch release: it fixes a NodeRepair controller enqueue race and makes capacity buffers correctly watch scalable workload references. No new features, no deprecations, no breaking changes — a routine upgrade for operators already on v1.14.x.

## The Problem

Teams running Karpenter v1.14.x on the kubernetes-sigs fork may hit two specific bugs:

- The **NodeRepair** controller could miss nodes whose repair-relevant label was synced *after* node creation, because the controller wasn't re-enqueuing the object once the label appeared. This could delay automated repair of unhealthy nodes.
- The **capacity buffer** feature did not watch the workloads referenced by `scalableRef`, so buffers could fail to resolve (or resolve late) when the referenced scalable workload changed after the buffer was created.

Both are addressed in v1.14.2.

## The Solution

Upgrade to v1.14.2. This is a drop-in patch release for anyone already on v1.x — no CRD schema changes or new flags are introduced in these notes, so the upgrade is low-risk and can be rolled out with a standard Helm upgrade.

## What's New

Release notes for v1.14.2 list two bug fixes only ([release page](https://github.com/kubernetes-sigs/karpenter/releases/tag/v1.14.2)):

- **Bug fix:** Allow enqueue onto the NodeRepair controller if the repair label is synced after the node/object is created ([#3366](https://github.com/kubernetes-sigs/karpenter/pull/3366)).
- **Bug fix (capacity buffer):** Watch `scalableRef` workloads so capacity buffers resolve correctly when the referenced workload changes ([#3387](https://github.com/kubernetes-sigs/karpenter/pull/3387)).

No new features, no deprecations, and no breaking changes are called out in this release. If you rely on NodeRepair or the capacity buffer feature, this release is worth picking up; otherwise it's a safe, low-urgency patch.

## Upgrade Steps

Replace `<NAMESPACE>` with your Karpenter namespace (commonly `karpenter` or `kube-system`) and set the correct Helm repo/OCI reference for the kubernetes-sigs distribution you're using.

```bash
# Check current version
helm list -n <NAMESPACE> | grep karpenter
kubectl get deploy -n <NAMESPACE> karpenter -o jsonpath='{.spec.template.spec.containers[0].image}'
```

```bash
# Update Helm repo index (or pull the OCI chart directly if you use oci://)
helm repo update

# Upgrade in place to v1.14.2
helm upgrade karpenter oci://public.ecr.aws/karpenter/karpenter \
  --version 1.14.2 \
  --namespace <NAMESPACE> \
  --reuse-values
```

```bash
# Watch the rollout
kubectl rollout status deployment/karpenter -n <NAMESPACE>
```

## Verify

```bash
# Confirm the running image/tag matches v1.14.2
kubectl get pods -n <NAMESPACE> -l app.kubernetes.io/name=karpenter \
  -o jsonpath='{.items[*].spec.containers[*].image}'
```

```bash
# Confirm controller is healthy and leader-elected
kubectl logs -n <NAMESPACE> deploy/karpenter --tail=50 | grep -i "leader\|started controller"
```

```bash
# If you use capacity buffers, confirm existing buffers still resolve
kubectl get capacitybuffers -A
```

## Common Issues

- **Image not updating after `helm upgrade`:** confirm the chart version actually changed (`helm history karpenter -n <NAMESPACE>`) and that your values file doesn't pin `controller.image.tag`.
- **NodeRepair behavior unchanged:** this fix only addresses the case where the repair label arrives *after* object creation; unrelated repair issues (e.g., missing node conditions, provider-specific health checks) are out of scope for this patch.
- **Capacity buffer still not resolving:** verify the `scalableRef` in your `CapacityBuffer` resource points to an existing, correctly-named workload (Deployment/StatefulSet/etc.) in the same namespace.

## Best Practices

- Treat patch releases like v1.14.2 as low-risk, routine upgrades — apply them promptly rather than batching many versions together, since later patches may depend on earlier bug fixes.
- Always diff `helm get values` before and after an upgrade with `--reuse-values` to confirm nothing unexpected changed.
- Pin the exact chart version (`--version 1.14.2`) in CI/GitOps manifests rather than tracking `latest`, so upgrades are explicit and auditable.
- Review the [full release page](https://github.com/kubernetes-sigs/karpenter/releases/tag/v1.14.2) directly before upgrading production clusters, since patch notes can be thin and future patches may add detail retroactively.
