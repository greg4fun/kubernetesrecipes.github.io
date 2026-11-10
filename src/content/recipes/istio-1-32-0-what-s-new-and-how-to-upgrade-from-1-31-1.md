---
title: "Istio 1.32.0: What's New and How to Upgrade from 1.31.1"
description: "Istio 1.32.0 release overview, canary upgrade steps from 1.31.1, verification commands, and where to find full changelog details."
publishDate: "2026-11-10"
author: "Luca Berton"
category: "networking"
difficulty: "intermediate"
timeToComplete: "20 minutes"
kubernetesVersion: "1.27+"
tags:
  - "istio"
  - "service-mesh"
  - "upgrade"
  - "istioctl"
  - "gateway-api"
  - "sidecar"
---
> 💡 **Quick Answer:** Istio 1.32.0 is out, succeeding 1.31.1. The release notes provided here are just a link with no pasted changelog, so this recipe sticks to a safe canary upgrade procedure and verification steps rather than guessing at specific features — check the official announcement for the full list of changes before upgrading production clusters.

## The Problem

A new minor version of Istio (1.32.0) has been published, but the only release artifact supplied is the announcement URL (`https://istio.io/latest/news/releases/1.32.x/announcing-1.32/`) without the actual changelog text. Operators still need a safe, repeatable way to move from 1.31.1 to 1.32.0 without breaking the data plane.

## The Solution

Treat this as a standard Istio minor-version upgrade: read the official release notes for the concrete feature list, deprecations, and breaking changes, then perform a canary control-plane upgrade and a rolling proxy upgrade, validating at each step.

## What's New

The detailed feature list (new APIs, deprecations, breaking changes) for 1.32.0 is **not included** in the notes supplied — only the release URL was given. Do not assume specific features exist until confirmed. Before upgrading, read:

- Official announcement: https://istio.io/latest/news/releases/1.32.x/announcing-1.32/
- GitHub release: https://github.com/istio/istio/releases/tag/1.32.0
- Upgrade notes page: https://istio.io/latest/news/releases/1.32.x/change-notes/

Pay particular attention to:
- Any listed **breaking changes** section (API removals, default behavior changes).
- The **supported Kubernetes version** matrix for 1.32.x.
- Any **Envoy version bump**, since it can change proxy resource usage and flags.
- Gateway API CRD version requirements, since Istio minor releases frequently bump the minimum supported Gateway API CRD version.

## Upgrade Steps

Always upgrade one minor version at a time (1.31.x → 1.32.0), never skip minors.

1. Install istioctl 1.32.0:

```bash
curl -L https://istio.io/downloadIstio | ISTIO_VERSION=1.32.0 sh -
cd istio-1.32.0
export PATH=$PWD/bin:$PATH
istioctl version
```

2. Run a precheck against the live cluster:

```bash
istioctl x precheck
```

3. Install the new control plane as a canary revision alongside 1.31.1 (recommended for production):

```bash
istioctl install \
  --set revision=1-32-0 \
  --set profile=default \
  -y
```

4. Verify the canary control plane is healthy before moving any workloads:

```bash
kubectl get pods -n istio-system -l istio.io/rev=1-32-0
```

5. Label a test namespace to use the new revision, then restart workloads to pick up the new sidecar:

```bash
kubectl label namespace test-ns istio.io/rev=1-32-0 --overwrite
kubectl label namespace test-ns istio-injection- --overwrite
kubectl rollout restart deployment -n test-ns
```

6. Once validated, migrate remaining namespaces the same way, then remove the old revision:

```bash
istioctl uninstall --revision=1-31-1 -y
```

If using Helm instead of istioctl:

```bash
helm repo update
helm upgrade istio-base istio/base -n istio-system --version 1.32.0
helm upgrade istiod istio/istiod -n istio-system --version 1.32.0 --set revision=1-32-0
```

## Verify

```bash
istioctl version
istioctl analyze -A
kubectl get pods -n istio-system
kubectl get mutatingwebhookconfiguration -o wide | grep istio
istioctl proxy-status
```

All proxies in `istioctl proxy-status` should show `SYNCED` for CDS/LDS/EDS/RDS against the new control plane revision before declaring the upgrade complete.

## Common Issues

- **Sidecar version mismatch**: workloads restarted before relabeling the namespace keep the old sidecar; confirm with `istioctl proxy-status` and `kubectl get pod <name> -o jsonpath='{.spec.containers[*].image}'`.
- **Gateway API CRD too old**: if Istio 1.32.0 requires a newer Gateway API CRD minimum version, `istioctl install` will fail validation; upgrade CRDs first with `kubectl apply -f` the experimental or standard channel release matching the required version.
- **precheck warnings ignored**: always resolve `istioctl x precheck` warnings before proceeding; they often flag deprecated field usage that becomes a breaking change in the new version.
- **Stale old revision left running**: forgetting to run `istioctl uninstall --revision=<old>` leaves two control planes competing for xDS pushes and consumes extra resources.

## Best Practices

- Always read the linked release/change notes in full before upgrading — do not rely on summaries that lack the actual changelog.
- Use canary (per-revision) control plane upgrades in production, never in-place upgrades on a live mesh.
- Pin the istioctl binary version to match the target Istio version exactly.
- Run `istioctl analyze -A` both before and after the upgrade to catch configuration drift.
- Keep Kubernetes and Gateway API CRD versions aligned with Istio's supported matrix for each release.
