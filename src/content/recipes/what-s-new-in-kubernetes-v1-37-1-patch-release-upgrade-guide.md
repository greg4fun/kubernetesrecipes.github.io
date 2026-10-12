---
title: "What's New in Kubernetes v1.37.1: Patch Release Upgrade Guide"
description: "Kubernetes v1.37.1 is a patch release with thin release notes; covers upgrade steps, verification, and where to find real changelog details."
publishDate: "2026-10-11"
author: "Luca Berton"
category: "deployments"
difficulty: "intermediate"
timeToComplete: "20 minutes"
kubernetesVersion: "1.37+"
tags:
  - "kubernetes"
  - "release-notes"
  - "upgrade"
  - "kubeadm"
  - "patch-release"
  - "cluster-maintenance"
---
> 💡 **Quick Answer:** Kubernetes v1.37.1 is a patch (z-stream) release on the 1.37 minor line. The GitHub release notes for this tag are thin (just a pointer to the changelog), so this recipe focuses on how to safely upgrade a 1.37.x cluster to v1.37.1 and verify the result; for the actual list of fixed bugs/CVEs, consult the CHANGELOG directly.

## The Problem

Patch releases in Kubernetes (the `.Z` in `1.37.Z`) typically ship bug fixes, dependency bumps, and occasionally CVE patches — not new features. The release page for v1.37.1 does not include an inline list of changes; it only links to `kubernetes-announce@` and `CHANGELOG-1.37.md`. Operators still need a safe, repeatable way to pick up these fixes without guessing what changed.

## The Solution

Treat v1.37.1 as a routine patch upgrade: pull the real diff from the changelog, upgrade control plane components first via `kubeadm`, then nodes, then client tooling, and confirm the version skew policy is respected. Because no breaking changes or deprecations are listed in the release notes themselves, no special migration steps are implied — but always read `CHANGELOG-1.37.md` before upgrading production, since CVE fixes are common in z-releases.

## Whats New

The GitHub release notes for `v1.37.1` are effectively empty — they only state:

> See kubernetes-announce@ ... Additional binary downloads are linked in the CHANGELOG ... See the CHANGELOG for more details.

No features, flags, deprecations, or breaking changes are enumerated in this notes block. Do not assume anything was added or removed. For the authoritative list of merged PRs/issues in this patch, check:

- Changelog: https://github.com/kubernetes/kubernetes/blob/master/CHANGELOG/CHANGELOG-1.37.md
- Release page: https://github.com/kubernetes/kubernetes/releases/tag/v1.37.1

As a general rule for Kubernetes z-releases, expect only bug fixes, dependency/version bumps, and possibly security patches — never new APIs or behavioral features (those land in `.0` minor releases).

## Upgrade Steps

Assumes a `kubeadm`-managed cluster already running a 1.37.x release. Adjust package manager commands (`apt`/`yum`) for your OS.

1. Check current version:

```bash
kubectl version --short
kubeadm version
```

2. On the first control-plane node, update `kubeadm` to 1.37.1:

```bash
apt-mark unhold kubeadm
apt-get update && apt-get install -y kubeadm=1.37.1-1.1
apt-mark hold kubeadm
```

3. Verify the upgrade plan:

```bash
kubeadm upgrade plan
```

4. Apply the upgrade on the first control-plane node:

```bash
kubeadm upgrade apply v1.37.1
```

5. On additional control-plane nodes:

```bash
kubeadm upgrade node
```

6. Upgrade `kubelet` and `kubectl` on every node (drain first):

```bash
kubectl drain <node-name> --ignore-daemonsets --delete-emptydir-data

apt-mark unhold kubelet kubectl
apt-get update && apt-get install -y kubelet=1.37.1-1.1 kubectl=1.37.1-1.1
apt-mark hold kubelet kubectl

systemctl daemon-reload
systemctl restart kubelet

kubectl uncordon <node-name>
```

7. If using managed Helm-based add-ons, recheck compatibility after the control-plane bump:

```bash
helm list -A
helm repo update
```

## Verify

```bash
kubectl get nodes -o wide
# Confirm every node reports v1.37.1 under KUBELET-VERSION

kubectl version --short
# Confirm Server Version is v1.37.1

kubectl get componentstatuses 2>/dev/null || kubectl get --raw='/healthz'
# Confirm control plane is healthy

kubectl get pods -A | grep -v Running
# Confirm no workload disruption after the rolling upgrade
```

## Common Issues

- **`kubeadm upgrade plan` refuses to proceed**: usually a version-skew violation — ensure kubelets are no more than 2 minor versions behind the control plane per the Kubernetes skew policy.
- **Package manager installs a different patch version**: pin the exact version string (`1.37.1-1.1` on Debian/Ubuntu, `1.37.1-0` on RHEL) instead of a bare `1.37.1`.
- **CNI or CSI plugin pods crash after upgrade**: check their compatibility matrix against 1.37 — some third-party add-ons lag behind new Kubernetes minor lines even for patch bumps.
- **Empty/misleading release notes cause confusion**: always cross-reference `CHANGELOG-1.37.md` — the GitHub release page for patch tags frequently omits the detailed PR list.

## Best Practices

- Never skip reading `CHANGELOG-1.37.md` before a production upgrade, even for "just a patch" — z-releases often contain CVE fixes.
- Upgrade control plane nodes before worker nodes, one node at a time, with `kubectl drain`/`uncordon`.
- Pin exact package versions and use `apt-mark hold` / `yum versionlock` to prevent accidental drift.
- Test the upgrade in staging against the same CNI/CSI/Ingress stack used in production before touching live clusters.
- Subscribe to `kubernetes-announce@` for timely notice of security-relevant patch releases.
