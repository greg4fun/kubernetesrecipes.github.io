---
title: "NVIDIA GPU Operator v26.7.2: What's New and Upgrade Guide"
description: "Upgrade notes and verification steps for NVIDIA GPU Operator v26.7.2 on Kubernetes using Helm."
publishDate: "2026-11-03"
author: "Luca Berton"
category: "ai"
difficulty: "intermediate"
timeToComplete: "20 minutes"
kubernetesVersion: "1.27+"
tags:
  - "gpu-operator"
  - "nvidia"
  - "gpu"
  - "helm"
  - "ai"
  - "driver"
---
> 💡 **Quick Answer:** NVIDIA GPU Operator v26.7.2 is a patch release in the 26.7 branch; the detailed changelog lives on NVIDIA's docs site rather than the GitHub release page, so check it before upgrading rather than assuming feature parity with prior branches.

## The Problem

GPU Operator automates installing and managing NVIDIA drivers, device plugin, DCGM exporter, GPU feature discovery, and related components on Kubernetes nodes. When a new patch version ships, operators need to know whether it's a safe drop-in upgrade, whether any CRDs/values changed, and how to validate the GPU stack still works after the bump.

## The Solution

Treat v26.7.2 as a routine patch upgrade within the 26.7.x line: pull the chart, diff your `values.yaml` against the new chart defaults, upgrade via Helm, and re-run the standard GPU validation checks (driver pods healthy, `nvidia-smi` works, device plugin advertises `nvidia.com/gpu` resources).

## What's New

The official release notes for this patch are published on NVIDIA's docs site, not inline in the GitHub release:

- Release notes: https://docs.nvidia.com/datacenter/cloud-native/gpu-operator/26.7/release-notes.html#v26-7-2
- GitHub release: https://github.com/NVIDIA/gpu-operator/releases/tag/v26.7.2

No prior version of the 26.7 branch was tracked in this cookbook, so there is no diff baseline to compare against here. Rather than guessing at specific fixes or CRD changes, review the NVIDIA release notes link above for the exact list of bug fixes, driver/toolkit version bumps, and any deprecations before upgrading production clusters. Treat any claim of "new feature" in this recipe as unverified until confirmed on that page.

## Upgrade Steps

Add/update the NVIDIA Helm repo and inspect what the new chart version changes:

```bash
helm repo add nvidia https://helm.ngc.nvidia.com/nvidia \
  && helm repo update

helm search repo nvidia/gpu-operator --versions | head -n 10
```

Check your current release and diff values before upgrading:

```bash
helm get values gpu-operator -n gpu-operator-resources -o yaml > current-values.yaml

helm show values nvidia/gpu-operator --version 26.7.2 > new-defaults.yaml

diff current-values.yaml new-defaults.yaml
```

Upgrade in place (adjust namespace/values file to your environment):

```bash
helm upgrade gpu-operator nvidia/gpu-operator \
  --version 26.7.2 \
  -n gpu-operator-resources \
  -f current-values.yaml
```

If installing fresh instead of upgrading:

```bash
kubectl create namespace gpu-operator-resources

helm install gpu-operator nvidia/gpu-operator \
  --version 26.7.2 \
  -n gpu-operator-resources
```

## Verify

Confirm the ClusterPolicy and pods report ready, and GPUs are schedulable:

```bash
kubectl get pods -n gpu-operator-resources

kubectl get clusterpolicy -o wide

kubectl describe clusterpolicy cluster-policy | grep -A5 Status

kubectl get nodes -o jsonpath='{range .items[*]}{.metadata.name}{"\t"}{.status.allocatable.nvidia\.com/gpu}{"\n"}{end}'
```

Exec into a driver pod to confirm the driver loaded correctly:

```bash
kubectl exec -n gpu-operator-resources -it \
  $(kubectl get pod -n gpu-operator-resources -l app=nvidia-driver-daemonset -o jsonpath='{.items[0].metadata.name}') \
  -- nvidia-smi
```

Run a quick GPU workload smoke test:

```bash
kubectl run gpu-test --rm -it --restart=Never \
  --image=nvidia/cuda:12.4.0-base-ubuntu22.04 \
  --limits=nvidia.com/gpu=1 \
  -- nvidia-smi
```

## Common Issues

- **CrashLoopBackOff on driver pods after upgrade**: usually a kernel/driver mismatch on nodes with a pre-installed NVIDIA driver; either disable the operator-managed driver (`driver.enabled=false`) or drain and let it reinstall cleanly.
- **`nvidia.com/gpu` resource missing from node allocatable**: check `device-plugin` and `gpu-feature-discovery` pod logs in `gpu-operator-resources`; often a stale node label (`nvidia.com/gpu.present`) blocks discovery.
- **Helm upgrade stuck/pending**: ClusterPolicy CRD changes between minor versions can require `kubectl apply` of updated CRDs before `helm upgrade` succeeds; check `helm upgrade --dry-run` output first.
- **MIG or time-slicing config lost after upgrade**: confirm `current-values.yaml` was actually passed with `-f`; Helm upgrades silently reset to chart defaults if values aren't re-supplied.

## Best Practices

- Pin the exact chart version (`--version 26.7.2`) in CI/GitOps rather than tracking `latest`, since GPU Operator upgrades touch node-level drivers.
- Always diff current Helm values against new chart defaults before upgrading (shown above) — silent defaulting is the most common source of regressions.
- Test upgrades on a single-node or canary node pool with `nodeSelector`/taints before rolling out cluster-wide, since driver reinstalls cause brief GPU unavailability.
- Keep the NVIDIA release notes page bookmarked per branch (26.7.x here) since GitHub release bodies for this project are often sparse and the authoritative changelog lives in NVIDIA's docs.
