---
title: "What's New in Cluster API v1.14.3 (Kubernetes Cluster Lifecycle Management)"
description: "Cluster API v1.14.3 patch release: KCP/etcd and owner-reference bug fixes, expanded K8s support up to v1.37, upgrade steps with clusterctl."
publishDate: "2026-10-30"
author: "Luca Berton"
category: "deployments"
difficulty: "intermediate"
timeToComplete: "15 minutes"
kubernetesVersion: "1.33+"
tags:
  - "cluster-api"
  - "clusterctl"
  - "kubeadm-control-plane"
  - "patch-release"
  - "cluster-lifecycle"
  - "etcd"
  - "upgrade"
---
> 💡 **Quick Answer:** Cluster API v1.14.3 is a patch release with 6 bug fixes (notably a KCP/etcd member-matching race and a Machine/MachineSet owner-reference panic) plus dependency security bumps (grpc, otel, cert-manager). It extends supported Kubernetes versions to v1.37.x and is a safe, low-risk upgrade for existing v1.14.x management clusters.

## The Problem

Operators running Cluster API v1.14.2 or earlier may hit two concrete bugs this release fixes:

- KubeadmControlPlane (KCP) could mismatch an etcd member to the wrong Machine during a scale-down/deletion, risking etcd member removal races (#14263), plus a separate race in KCP's proxy `DialContext` (#14278).
- Machine/MachineSet controllers could error instead of gracefully handling `not-found` owner references during reconciliation (#14250), and Clusters without a `ClusterClass` were missing the `cluster-name` label (#14310).

None of these are breaking changes — they're reliability fixes that reduce noisy reconcile errors and reduce risk during control-plane scale-down.

## The Solution

Upgrade the Cluster API management components (core, bootstrap, control-plane, and infrastructure providers) to v1.14.3 using `clusterctl`. This is a drop-in patch release for anyone already on the v1.14 minor line — no CRD schema changes or API deprecations are called out in the release notes.

## Whats New

**Kubernetes version support**
- Management Cluster: v1.33.x → v1.37.x
- Workload Cluster: v1.31.x → v1.37.x

**Bug fixes (6)**
- KCP: fixed race in proxy `DialContext` (#14278)
- KCP: correctly match etcd member to the Machine being deleted (#14263)
- Machine/MachineSet: gracefully handle not-found owner references instead of erroring (#14250)
- Cluster: set `cluster-name` label on Clusters that don't use a `ClusterClass` (#14310)
- Misc: multi-namespace informer support added to the controller-util consistency store (#14290)
- CI: bumped test runner to `highcpu-32` (#14225, test infra only, no runtime impact)

**Dependency/security bumps**
- `clusterctl`: bundled cert-manager bumped to v1.21.2 (#14238)
- grpc bumped to v1.83.2 to address security advisories (#14243)
- OpenTelemetry stack bumped to v1.45.0 (#14315)
- Runtime SDK: improved discovery (#14261)

No items are listed under Deprecations, Removals, or Breaking Changes in this release's notes.

## Upgrade Steps

Check current versions first:

```bash
clusterctl version
kubectl get deployment -n capi-system capi-controller-manager -o jsonpath='{.spec.template.spec.containers[0].image}'
```

Upgrade `clusterctl` itself (adjust OS/arch as needed):

```bash
curl -L https://github.com/kubernetes-sigs/cluster-api/releases/download/v1.14.3/clusterctl-linux-amd64 -o clusterctl
chmod +x clusterctl && sudo mv clusterctl /usr/local/bin/clusterctl
clusterctl version
```

See what providers can be upgraded:

```bash
clusterctl upgrade plan
```

Apply the upgrade to core, bootstrap, and control-plane providers (keep your existing infrastructure provider version unless it has a matching release):

```bash
clusterctl upgrade apply \
  --core cluster-api:v1.14.3 \
  --bootstrap kubeadm:v1.14.3 \
  --control-plane kubeadm:v1.14.3
```

Since `clusterctl` now bundles cert-manager v1.21.2, re-run init's cert-manager install if you let clusterctl manage it:

```bash
clusterctl upgrade apply --wait-providers
```

## Verify

```bash
kubectl get pods -n capi-system
kubectl get pods -n capi-kubeadm-bootstrap-system
kubectl get pods -n capi-kubeadm-control-plane-system

# Confirm image tags match v1.14.3
kubectl get deployment -n capi-system capi-controller-manager \
  -o jsonpath='{.spec.template.spec.containers[0].image}{"\n"}'

# Confirm no reconcile errors on existing clusters
kubectl get clusters -A
kubectl get kubeadmcontrolplane -A
```

All controller pods should report `Running`/`1/1 Ready`, and `clusterctl version` should report `v1.14.3` for `clusterctlVersion` and the relevant providers.

## Common Issues

- **Stuck Machine deletion during control-plane scale-down on older versions**: was caused by the KCP etcd-member matching bug (#14263); upgrading resolves it — no manual etcd surgery needed going forward.
- **Noisy `not found` errors in Machine/MachineSet controller logs**: fixed by #14250; if you still see them post-upgrade, confirm the controller image tag actually changed (check for cached/old ReplicaSets).
- **cert-manager version drift**: if you manage cert-manager outside of `clusterctl init`, there's nothing to do — the v1.21.2 bump only affects clusterctl's bundled manifest, not an existing external install.

## Best Practices

- Always run `clusterctl upgrade plan` before `apply` to confirm which providers/contracts will change.
- Upgrade management-cluster components before bumping workload-cluster Kubernetes versions toward the new v1.37.x ceiling.
- Patch releases like this one are low-risk; still test in a non-production management cluster first if you run custom Runtime SDK extensions, since discovery behavior changed slightly (#14261).
- Track the full changelog at the release page for anything added between patch releases: https://github.com/kubernetes-sigs/cluster-api/releases/tag/v1.14.3
