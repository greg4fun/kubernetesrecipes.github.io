---
title: "What's New in MetalLB Helm Chart 0.16.1"
description: "MetalLB Helm chart 0.16.1 release notes are thin; practical upgrade steps, verification, and link to full changelog for operators."
publishDate: "2026-11-01"
author: "Luca Berton"
category: "networking"
difficulty: "intermediate"
timeToComplete: "15 minutes"
kubernetesVersion: "1.27+"
tags:
  - "metallb"
  - "load-balancer"
  - "bare-metal"
  - "helm"
  - "networking"
  - "upgrade"
---
> 💡 **Quick Answer:** The `metallb-chart-0.16.1` release notes on GitHub contain no detailed changelog (only the standard project description), so there are no confirmed new features, deprecations, or breaking changes to report beyond a routine Helm chart bump — check the [release page](https://github.com/metallb/metallb/releases/tag/metallb-chart-0.16.1) for the generated diff before upgrading production clusters.

## The Problem

Operators tracking MetalLB releases need to know whether a new chart version changes CRDs, RBAC, default values, or the underlying MetalLB image tag before rolling it out to clusters providing bare-metal LoadBalancer IPs.

## The Solution

Treat `metallb-chart-0.16.1` as a routine Helm chart packaging update until the actual diff is reviewed. Since this release's notes are empty of specifics, pull the chart's `Chart.yaml` and `values.yaml` diff directly from the repo tag before upgrading, and validate in a non-production cluster first.

## What's New

No feature list, deprecations, or breaking changes are documented in the release notes for `metallb-chart-0.16.1` — the notes only repeat MetalLB's standard tagline ("A network load-balancer implementation for Kubernetes using standard routing protocols"). This appears to be the first tracked version for this recipe (no previous version on record), so there is no delta to compare.

Before upgrading, manually inspect:

- The chart's `appVersion` in `Chart.yaml` to confirm which MetalLB controller/speaker image it ships.
- Any changes to `templates/crds/` if you use CRD-mode configuration (`IPAddressPool`, `L2Advertisement`, `BGPAdvertisement`, `BGPPeer`).
- RBAC or `values.yaml` default changes (e.g., `frrk8s.enabled`, `speaker.resources`).

See the full tag comparison here: https://github.com/metallb/metallb/releases/tag/metallb-chart-0.16.1

## Upgrade Steps

```bash
# Add/update the MetalLB Helm repo
helm repo add metallb https://metallb.github.io/metallb
helm repo update

# Check what chart versions are available
helm search repo metallb/metallb --versions | head -5

# Review the diff before upgrading (optional but recommended)
helm show values metallb/metallb --version 0.16.1 > new-values.yaml
helm get values metallb -n metallb-system > current-values.yaml
diff current-values.yaml new-values.yaml

# Upgrade an existing release in place
helm upgrade metallb metallb/metallb \
  --namespace metallb-system \
  --version 0.16.1 \
  --reuse-values

# Or a fresh install
helm install metallb metallb/metallb \
  --namespace metallb-system \
  --create-namespace \
  --version 0.16.1
```

If you manage CRDs separately (common in GitOps setups), re-apply the CRD manifests from the chart before running `helm upgrade`:

```bash
kubectl apply -f https://raw.githubusercontent.com/metallb/metallb/metallb-chart-0.16.1/charts/metallb/crds/
```

## Verify

```bash
# Confirm chart and app versions deployed
helm list -n metallb-system

# Confirm controller and speaker pods are healthy
kubectl get pods -n metallb-system -o wide

# Confirm CRDs are present and at the expected version
kubectl get crds | grep metallb

# Confirm IP pools and advertisements are still applied
kubectl get ipaddresspools.metallb.io -A
kubectl get l2advertisements.metallb.io -A

# Spot-check a LoadBalancer service still gets an external IP
kubectl get svc -A --field-selector spec.type=LoadBalancer
```

## Common Issues

- **CRD drift**: `helm upgrade` does not update or delete CRDs by default. If the chart bumped CRD versions, apply them manually as shown above, or your `IPAddressPool`/`BGPAdvertisement` resources may fail validation.
- **FRR-K8S mode**: if your cluster uses `frrk8s.enabled=true` for BGP, confirm the FRR-K8S subchart/image reference didn't change unexpectedly after upgrade.
- **Speaker DaemonSet restarts**: speaker pods restart on upgrade, causing a brief re-announcement of ARP/BGP routes. Schedule upgrades during a maintenance window if you rely on strict failover timing.
- **Namespace mismatch**: double-check `--namespace metallb-system` matches your existing install; a typo creates a duplicate release.

## Best Practices

- Pin the exact chart version (`--version 0.16.1`) in CI/CD and GitOps manifests instead of tracking `latest`.
- Always diff `values.yaml` between chart versions, even for patch releases, since MetalLB ships both controller and speaker images independently from chart version.
- Keep CRD manifests under version control if using GitOps (Argo CD/Flux) so CRD and chart versions stay in sync.
- Test BGP/L2 mode upgrades in a staging cluster that mirrors production's `IPAddressPool` and `BGPPeer` configuration before touching production.
- Subscribe to the [MetalLB releases page](https://github.com/metallb/metallb/releases) for future versions, since this release's notes were too thin to extract concrete change details.
