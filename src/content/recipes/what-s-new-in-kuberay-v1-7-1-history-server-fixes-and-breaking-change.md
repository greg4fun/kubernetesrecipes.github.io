---
title: "What's New in KubeRay v1.7.1: History Server Fixes and Breaking Change"
description: "KubeRay v1.7.1 patch release: History Server log loss fix, memory reduction, and live-cluster proxying disabled by default."
publishDate: "2026-11-03"
author: "Luca Berton"
category: "ai"
difficulty: "intermediate"
timeToComplete: "15 minutes"
kubernetesVersion: "1.27+"
tags:
  - "kuberay"
  - "ray"
  - "ai-workloads"
  - "history-server"
  - "helm"
  - "rayjob"
  - "kubectl-plugin"
---
> 💡 **Quick Answer:** KubeRay v1.7.1 is a patch release on the 1.7 line that fixes a `kubectl ray job submit` hang, repairs History Server log rotation and memory usage, and — as a breaking change — disables History Server live-cluster proxying by default for security reasons.

## The Problem

Operators running KubeRay v1.7.0 hit three operational pain points: the `kubectl ray job submit` plugin could hang forever if the port-forward connection dropped before it re-checked RayJob status; the History Server could silently lose logs because it only collected rotated log files after they'd already been overwritten; and the History Server's in-memory session cache stored raw JSON snapshots, driving up memory usage on busy clusters. Additionally, some ML sample manifests broke because the `rayproject/ray-ml:2.46.0.0e19ea-*` image tags were pulled from Docker Hub, leaving sample deployments in `ImagePullBackOff`.

## The Solution

v1.7.1 is a targeted bugfix release on the `release-1.7` branch (no new CRDs or APIs). It fixes the plugin hang, the log-rotation race, and the memory footprint, repairs the sample manifests, and — notably — flips a security-relevant default: History Server no longer proxies to live Ray clusters unless explicitly re-enabled.

## What's New

**Bug fixes:**
- `kubectl ray job submit` now re-checks RayJob status after a lost port-forward connection instead of hanging indefinitely ([#5147](https://github.com/ray-project/kuberay/pull/5147)).
- History Server collects rotated Ray logs before they're overwritten, preventing silent log loss ([#5101](https://github.com/ray-project/kuberay/pull/5101)).
- History Server now caches the decoded snapshot struct in the session LRU instead of raw JSON bytes, reducing memory usage ([#5208](https://github.com/ray-project/kuberay/pull/5208)).
- Broken sample manifests fixed ([#5154](https://github.com/ray-project/kuberay/pull/5154)).
- ML samples repinned to a base Ray image with runtime-installed deps after `rayproject/ray-ml:2.46.0.0e19ea-*` tags were removed from Docker Hub ([#5194](https://github.com/ray-project/kuberay/pull/5194)).

**⚠️ Breaking change:**
- History Server live-cluster support is now **disabled by default** to avoid unintended proxying to running clusters ([#5199](https://github.com/ray-project/kuberay/pull/5199)). If your workflow relies on the History Server proxying to live Ray clusters (not just archived job history), you must explicitly re-enable this behavior after upgrading — check the History Server config/flag introduced in that PR before upgrading production.

Full diff: [v1.7.0...v1.7.1](https://github.com/ray-project/kuberay/compare/v1.7.0...v1.7.1)

## Upgrade Steps

KubeRay is typically installed via Helm (operator + CRDs).

```bash
# Add/update the KubeRay Helm repo
helm repo add kuberay https://ray-project.github.io/kuberay-helm/
helm repo update

# Check current installed version
helm list -n kuberay-operator

# Upgrade CRDs first (KubeRay ships CRDs as a separate chart)
helm upgrade kuberay-crds kuberay/kuberay-crds \
  --version 1.7.1 \
  -n kuberay-operator

# Upgrade the operator
helm upgrade kuberay-operator kuberay/kuberay-operator \
  --version 1.7.1 \
  -n kuberay-operator

# If you use the kubectl ray plugin, upgrade it too (krew example)
kubectl krew upgrade ray
```

If you install manifests directly instead of Helm:

```bash
kubectl apply -k "github.com/ray-project/kuberay/ray-operator/config/crd?ref=v1.7.1"
kubectl apply -k "github.com/ray-project/kuberay/ray-operator/config/default?ref=v1.7.1"
```

## Verify

```bash
# Confirm operator image/version
kubectl get deployment -n kuberay-operator kuberay-operator \
  -o jsonpath='{.spec.template.spec.containers[0].image}'

# Confirm CRDs are present and healthy
kubectl get crd | grep ray.io

# Confirm existing RayClusters/RayJobs are reconciling
kubectl get raycluster -A
kubectl get rayjob -A

# Test the kubectl plugin fix (should no longer hang after port-forward drop)
kubectl ray job submit --cluster-name <your-cluster> -- python script.py
```

## Common Issues

- **History Server no longer shows live cluster data after upgrade** — expected, this is the breaking change in [#5199](https://github.com/ray-project/kuberay/pull/5199). Review the History Server deployment flags/config to re-enable live-cluster proxying if your use case requires it, understanding the proxying tradeoff.
- **ML sample pods still in `ImagePullBackOff`** — make sure you re-applied the updated sample manifests from v1.7.1 ([#5194](https://github.com/ray-project/kuberay/pull/5194)); old manifests reference removed `ray-ml:2.46.0.0e19ea-*` tags.
- **CRD upgrade conflicts** — always `helm upgrade` the `kuberay-crds` chart before the `kuberay-operator` chart to avoid schema mismatches.

## Best Practices

- Pin Helm chart versions explicitly (`--version 1.7.1`) in CI/CD rather than tracking `latest`.
- After upgrading, review History Server configuration since the live-cluster default flipped — don't assume prior behavior persists.
- Avoid pinning sample/ML images by tag long-term; prefer digests or actively maintained base images to avoid future `ImagePullBackOff` incidents like the one fixed here.
- Test `kubectl ray job submit` against a cluster with an intentionally interrupted port-forward in staging to confirm the hang fix behaves as expected in your environment.
