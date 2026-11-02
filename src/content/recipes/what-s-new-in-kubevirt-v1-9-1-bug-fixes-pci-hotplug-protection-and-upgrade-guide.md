---
title: "What's New in KubeVirt v1.9.1: Bug Fixes, PCI Hotplug Protection, and Upgrade Guide"
description: "KubeVirt v1.9.1 release notes: 83 fixes incl. PCI hotplug protection, GPU detection, live migration stability, and upgrade steps."
publishDate: "2026-11-02"
author: "Luca Berton"
category: "deployments"
difficulty: "intermediate"
timeToComplete: "15 minutes"
kubernetesVersion: "1.28+"
tags:
  - "kubevirt"
  - "virtual-machines"
  - "kubevirt-operator"
  - "virtctl"
  - "live-migration"
  - "gpu-passthrough"
  - "bugfix-release"
---
> 💡 **Quick Answer:** KubeVirt v1.9.1 is a patch release on top of v1.9.0 with 83 bug fixes — no new CRD fields or feature gates were introduced. Highlights for operators include a fix for PCI device hotplug abuse (guests ejecting disks/NICs via "Safely Remove Hardware"), a live-migration stat-collection lock fix, Vera Rubin GPU recognition, and several volume/VM lifecycle bugfixes.

## The Problem

KubeVirt v1.9.0 shipped with a number of known bugs affecting VM lifecycle correctness (incorrect status reporting, duplicate attachment pods), hardware passthrough safety (guests could eject critical PCI devices like disks or watchdogs), and live-migration performance (stat collection blocking on libvirt locks for up to 30s). Operators running GPU-passthrough workloads, CBT-enabled backup VMs, or frequent live migrations were most exposed.

## The Solution

Upgrade to KubeVirt v1.9.1, a patch release containing 83 fixes contributed by 24 people (89 files changed). There are no breaking API changes or new feature gates in this release — it is a drop-in replacement for v1.9.0.

## What's New

**Notable fixes (from the signed release notes):**

- **VM status correctness** — Fixed `RunStrategyRerunOnFailure` VMs incorrectly showing `WaitingForVolumeBinding` after manual stop with an unbound PVC ([PR #19345](https://github.com/kubevirt/kubevirt/pull/19345)).
- **Windows crash/hyperv panic device** — KubeVirt no longer force-terminates a VM on Windows guest crash when a `hyperv` panic device is configured; Windows can complete its memory-dump/reboot flow (guest-configurable) ([PR #19346](https://github.com/kubevirt/kubevirt/pull/19346)).
- **Filesystem volume resize spam** — Fixed excessive blockresize calls during I/O for filesystem volumes ([PR #19270](https://github.com/kubevirt/kubevirt/pull/19270)).
- **Libvirt bump** — Updated to libvirt 11.10.0-19.el9 ([PR #19122](https://github.com/kubevirt/kubevirt/pull/19122)).
- **PCI hotplug security/stability fix** — Guests can no longer eject critical PCI devices (disks, memory balloon, RNG, watchdog) via guest-side hotplug (e.g. Windows "Safely Remove Hardware"). PCI root ports hosting non-NIC devices are now marked non-hotpluggable; NIC ports and reserved empty ports stay hotpluggable ([PR #18833](https://github.com/kubevirt/kubevirt/pull/18833)).
- **Vera Rubin GPU recognition** — GPU ID `10de:3041` is now recognized as a Grace GPU, enabling `GraceIOVirtualization` for passthrough ([PR #19135](https://github.com/kubevirt/kubevirt/pull/19135)).
- **Seccomp profile hardening** — `/var/lib/kubelet/seccomp/kubevirt/kubevirt.json` is now deployed non-executable ([PR #19055](https://github.com/kubevirt/kubevirt/pull/19055)).
- **Duplicate attachment pods** — Fixed duplicate attachment pods when a VM mixes utility volumes and hotplug volumes ([PR #19088](https://github.com/kubevirt/kubevirt/pull/19088)).
- **Hugepages memory overcommit** — Memory overcommit settings are now ignored for VMIs using hugepages ([PR #18930](https://github.com/kubevirt/kubevirt/pull/18930)).
- **Stale socket handling** — Stale socket connections are now handled correctly ([PR #19003](https://github.com/kubevirt/kubevirt/pull/19003)).
- **virt-template** — Updated to v0.2.3 ([PR #18933](https://github.com/kubevirt/kubevirt/pull/18933)).
- **PCI passthrough regression fix** — VMs with GPU/PCI host devices now correctly fall back to the legacy VFIO group interface on kernels lacking `CONFIG_VFIO_DEVICE_CDEV` ([PR #18931](https://github.com/kubevirt/kubevirt/pull/18931)).
- **VM restore fix** — Fixed VM restore when backend storage is not snapshottable ([PR #18440](https://github.com/kubevirt/kubevirt/pull/18440)).
- **Alert labeling** — Added mandatory, cluster-scoped `namespace` label to `OrphanedVirtualMachineInstances` and `VirtLauncherPodsStuckFailed` alerts ([PR #18869](https://github.com/kubevirt/kubevirt/pull/18869)) — check alerting rules/dashboards for label-matching changes.
- **virtctl fix** — `virtctl evacuate-cancel` now works ([PR #18864](https://github.com/kubevirt/kubevirt/pull/18864)).
- **Node hooks** — Fixed `CallNodeHooks` to correctly evaluate plugin-level `Spec.Condition` ([PR #18583](https://github.com/kubevirt/kubevirt/pull/18583)).
- **Online volume expansion** — Fixed poor scaling with many volumes ([PR #18690](https://github.com/kubevirt/kubevirt/pull/18690)).
- **Backend storage sizing** — PVC size for CBT-enabled VMs increased by 1Gi ([PR #18744](https://github.com/kubevirt/kubevirt/pull/18744)) — expect slightly larger backend-storage PVC requests after upgrade.
- **Live migration stats lock** — Domain stats collection during live migration uses the libvirt `NOWAIT` flag instead of blocking up to 30s on a locked domain ([PR #18663](https://github.com/kubevirt/kubevirt/pull/18663)).

No deprecations, feature-gate changes, or CRD schema changes were called out in the release notes.

## Upgrade Steps

KubeVirt is upgraded in place by applying the new operator and CR manifests (or bumping the Helm chart if you manage it that way). Always upgrade sequentially and avoid skipping minor versions.

**Using the operator manifests (kubectl):**

```bash
export VERSION=v1.9.1

# Apply the updated operator
kubectl apply -f https://github.com/kubevirt/kubevirt/releases/download/${VERSION}/kubevirt-operator.yaml

# Trigger the operator to roll out the new CR version
kubectl apply -f https://github.com/kubevirt/kubevirt/releases/download/${VERSION}/kubevirt-cr.yaml
```

**If managing via Helm (community chart):**

```bash
helm repo update
helm upgrade kubevirt kubevirt/kubevirt \
  --namespace kubevirt --version 1.9.1
```

**Upgrade virtctl to match:**

```bash
VERSION=v1.9.1
curl -L -o virtctl \
  https://github.com/kubevirt/kubevirt/releases/download/${VERSION}/virtctl-${VERSION}-linux-amd64
chmod +x virtctl
sudo install virtctl /usr/local/bin
```

## Verify

```bash
# Confirm operator and target image versions
kubectl get kubevirt kubevirt -n kubevirt -o jsonpath='{.status.observedKubeVirtVersion}{"\n"}'
kubectl get kubevirt kubevirt -n kubevirt -o jsonpath='{.status.targetKubeVirtVersion}{"\n"}'

# Confirm overall phase is Deployed
kubectl get kubevirt kubevirt -n kubevirt -o jsonpath='{.status.phase}{"\n"}'

# Check virt-operator/virt-controller/virt-handler pods are healthy
kubectl get pods -n kubevirt

# Check virtctl client version matches
virtctl version
```

If running GPU passthrough or CBT-enabled VMs, also check:

```bash
# Verify backend storage PVCs resized as expected for CBT VMs
kubectl get pvc -n <vm-namespace> -l kubevirt.io/backend-storage
```

## Common Issues

- **Operator stuck in `Deploying` phase** — check `virt-operator` logs (`kubectl logs -n kubevirt deploy/virt-operator`) for CRD conversion or RBAC issues before assuming a regression.
- **Alert rules not firing after upgrade** — the new mandatory `namespace` label on `OrphanedVirtualMachineInstances`/`VirtLauncherPodsStuckFailed` alerts (PR #18869) can break label-matching in external alert routing/silencing rules; update Alertmanager matchers accordingly.
- **Backend storage PVC resize denied** — the +1Gi backend storage increase (PR #18744) can fail if the StorageClass doesn't support expansion; verify `allowVolumeExpansion: true` on the relevant StorageClass.
- **GPU passthrough still failing on older kernels** — confirm kernel support for `CONFIG_VFIO_DEVICE_CDEV`; PR #18931 only restores correct fallback behavior, it does not add new capabilities.

## Best Practices

- Pin `virtctl` and the KubeVirt operator to the same release to avoid API drift.
- Review Alertmanager/Grafana label selectors after upgrading past PR #18869 if you rely on `OrphanedVirtualMachineInstances` or `VirtLauncherPodsStuckFailed` alerts.
- Test the upgrade in a staging cluster with representative GPU-passthrough and CBT-enabled VMs before rolling out to production, given the PCI hotplug and backend-storage behavior changes in this release.
- Since this is a patch release with no feature-gate or CRD changes, it's low-risk, but still follow standard KubeVirt upgrade practice: verify `kubevirt` CR `status.phase` is `Deployed` before considering the upgrade complete.
- Full details: https://github.com/kubevirt/kubevirt/releases/tag/v1.9.1
