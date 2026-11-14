---
title: "Rook v1.21.1: Ceph Operator Patch Release Guide"
description: "Rook v1.21.1 patch release: msgr2 security enforcement, nvmeof improvements, OSD fixes, and Helm upgrade steps for Ceph on Kubernetes."
publishDate: "2026-11-01"
author: "Luca Berton"
category: "storage"
difficulty: "intermediate"
timeToComplete: "20 minutes"
kubernetesVersion: "1.28+"
tags:
  - "rook"
  - "ceph"
  - "storage"
  - "operator"
  - "helm"
  - "upgrade"
  - "nvmeof"
---
> 💡 **Quick Answer:** Rook v1.21.1 is a patch release for the Ceph operator that enforces secure msgr2 mode for mon connections, adds Prometheus scrape timeout configuration, improves nvmeof gateway stability, and fixes several OSD/device-discovery bugs — upgrade via Helm after manually deleting the existing StorageClass as documented.

## The Problem

Operators running Rook-Ceph clusters need to track patch releases for security hardening (msgr2), stability fixes in critical paths (clusterdisruption failure-domain detection, nvmeof gateway Service churn), and operational improvements (Prometheus scrape timeout, device discovery exclusions) without re-reading the full changelog every time.

## The Solution

Apply the v1.21.1 patch via Helm (or manifests) following the documented upgrade path. This is a **patch** release (1.21.0 → 1.21.1), so no CRD schema migrations are expected beyond what 1.21.x already introduced, but note the mandatory StorageClass deletion step called out in the release notes for Helm upgrades into the 1.21 line.

## Whats New

**Security**
- Secure msgr2 mode is now enforced for mon connections (#18324) — mon traffic encryption/auth is no longer optional once set.
- Insecure global ID reclaim is now **disabled** outright instead of just logging a warning (#18597). If any legacy Ceph clients rely on insecure global ID reclaim, they will stop working after this upgrade — audit clients before upgrading.

**Operator / Core**
- Prometheus scrape timeout is now configurable on the cluster (#18424).
- Scrape interval comparisons are now numeric, avoiding unnecessary mgr config updates/restarts (#18583).
- Custom resources now surface a status message for easier troubleshooting (#18533).
- `clusterdisruption`: fixed minimum failure-domain detection for the `region` level (#18577) — matters for PodDisruptionBudget correctness in multi-region topologies.

**OSD / Devices**
- Device discovery now skips `nbd`, `drbd`, and `zram` devices (#18490), reducing false-positive device candidates.
- Purely numeric topology values are now rejected at validation time (#18539).
- Fixed empty label selector when an entire OSD batch is skipped (#18564).

**Object (RGW)**
- New `CephObjectStoreUser` `secretTemplate` field for customizing generated secrets (#18469).
- `rgwCommandFlags` are now emitted in deterministic order to avoid spurious RGW restarts (#18592).
- New `trafficDistribution` field on the RGW Service spec (#18541).
- Dashboard per-realm credential map is now ignored where not applicable (#18425).

**NVMe-oF**
- SPDK interrupt mode can now be enabled to cut idle CPU usage (#18599).
- Gateway `Service` is now preserved across scale-down, keeping the ClusterIP stable (#18584) — avoids breaking existing client connections on scale events.
- New documentation for external client access (#17719).

**NFS**
- Temporary Ganesha config files are now cleaned up (#18538).

**CI / Supply chain**
- `golang.org/x/net` bumped to v0.60.0 to resolve a govulncheck finding (#18540).
- Release images now build with the latest Go patch (#18609).

## Upgrade Steps

This is a first-tracked release for this environment (no prior pinned Rook version recorded), so treat it as a standard install/upgrade onto a supported cluster.

1. Review the official upgrade guide for breaking changes specific to the 1.21.x line (the release notes explicitly call out a StorageClass deletion step before the Helm upgrade — see #18574).

2. Delete the existing CephFS/RBD `StorageClass` objects managed by the Helm chart if upgrading an existing 1.20.x → 1.21.x install (skip this if this is a fresh install):

```bash
kubectl get storageclass -l app=rook-ceph
kubectl delete storageclass <storageclass-name>
```

3. Update the Helm repo and inspect available versions:

```bash
helm repo add rook-release https://charts.rook.io/release
helm repo update
helm search repo rook-release/rook-ceph --versions | head
```

4. Upgrade (or install) the operator:

```bash
helm upgrade --install rook-ceph rook-release/rook-ceph \
  --namespace rook-ceph --create-namespace \
  --version v1.21.1
```

5. Upgrade the Ceph cluster chart (adjust namespace/values as needed):

```bash
helm upgrade --install rook-ceph-cluster rook-release/rook-ceph-cluster \
  --namespace rook-ceph \
  --version v1.21.1 \
  -f cluster-values.yaml
```

6. If this cluster relies on legacy clients using insecure global ID reclaim, verify compatibility **before** rolling the upgrade to the fleet, since #18597 now disables that fallback instead of merely warning.

## Verify

```bash
# Confirm operator image/version
kubectl -n rook-ceph get deployment rook-ceph-operator -o jsonpath='{.spec.template.spec.containers[0].image}'

# Confirm Ceph cluster health
kubectl -n rook-ceph get cephcluster -o wide

# Check new CR status messages (#18533)
kubectl -n rook-ceph describe cephcluster | grep -A3 Status

# Confirm mon connections are using msgr2 secure mode
kubectl -n rook-ceph exec deploy/rook-ceph-tools -- ceph daemon mon.a config show | grep ms_mon_secure_required || \
kubectl -n rook-ceph exec deploy/rook-ceph-tools -- ceph mon dump

# Confirm OSD pods are healthy after device-discovery changes
kubectl -n rook-ceph get pods -l app=rook-ceph-osd
```

## Common Issues

- **StorageClass conflicts on Helm upgrade**: if step 2 is skipped, the Helm upgrade may fail or leave orphaned StorageClass objects; delete and let the chart recreate it per #18574.
- **Legacy clients breaking after upgrade**: #18597 disables insecure global ID reclaim entirely. Pre-1.11-era Ceph clients using this fallback will fail to authenticate — upgrade clients first.
- **RGW restarts after upgrade**: if `rgwCommandFlags` ordering was previously inconsistent, expect one restart cycle post-upgrade as the deterministic ordering from #18592 takes effect; subsequent reconciles should be restart-free.
- **nvmeof gateway IP changes on old versions**: clusters that scaled nvmeof gateways down/up on pre-1.21.1 Rook may have had ClusterIP churn; this is now fixed (#18584), but existing clients pointed at a stale IP should be re-validated.

## Best Practices

- Always read the Rook upgrade guide for the specific minor version line before running `helm upgrade`, since prerequisite manual steps (like the StorageClass deletion here) are not enforced by Helm itself.
- Run `rook-ceph-tools` and check `ceph status` / `ceph health detail` immediately after upgrade, not just pod readiness.
- Pin the exact chart version (`--version v1.21.1`) in CI/CD pipelines rather than tracking `latest` to keep upgrades auditable.
- Audit client authentication methods against the mon cluster before applying this release if insecure global ID reclaim has historically been relied upon.
- For full details on every change, see the release page: https://github.com/rook/rook/releases/tag/v1.21.1
