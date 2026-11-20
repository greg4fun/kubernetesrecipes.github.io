---
title: "What's New in KubeVirt v1.10.0: Backup & DRA"
description: "KubeVirt v1.10.0 adds IncrementalBackup beta, External snapshots, UtilityVolumes beta, DRA CPU/network gates, and migration safety fixes for operators."
publishDate: "2026-11-19"
author: "Luca Berton"
category: "storage"
difficulty: "advanced"
timeToComplete: "25 minutes"
kubernetesVersion: "1.29+"
tags:
  - "kubevirt"
  - "virtual-machines"
  - "backup"
  - "feature-gates"
  - "live-migration"
  - "snapshot"
  - "dra"
---
> 💡 **Quick Answer:** KubeVirt v1.10.0 promotes IncrementalBackup to Beta (`backup.kubevirt.io/v1beta1`), adds External-mode VM snapshots, graduates UtilityVolumes and ContainerPathVolume to Beta, bumps NetworkDevicesWithDRA to Beta, and fixes several migration/host-device/hook bugs operators hit during rolling upgrades.

## The Problem

Operators running KubeVirt v1.9.x on clusters with SR-IOV/GPU/PCI host devices, device-plugin restarts, mixed-version virt-handler rollouts, or CBT-based incremental backups have hit real bugs: VMIs failing to start when the Plugins feature gate is active, virt-handler panics on device-plugin restart, live migrations scheduled onto not-yet-upgraded nodes, and incorrect incremental backups when a volume's PVC is swapped. v1.10.0 (1761 changes, 104 contributors) targets exactly these pain points plus backup/snapshot maturity.

## The Solution

Upgrade to v1.10.0 to pick up the migration-scheduling fix, the host-device/Plugins fix, and the virt-handler panic fix, and to start evaluating Beta features (IncrementalBackup, UtilityVolumes, ContainerPathVolume, NetworkDevicesWithDRA) before they become GA/default-on in later releases.

## Whats New

**Stability / upgrade-safety fixes**
- [PR #19732] Live migrations are no longer scheduled from an updated virt-handler node onto a not-yet-updated node — removes a common "stuck migration during rolling upgrade" failure mode.
- [PR #19771] VMIs with SR-IOV/GPU/PCI host devices no longer fail to start when the `Plugins` feature gate is enabled and any Plugin resource exists.
- [PR #19743] Fixed a virt-handler panic on device-plugin restart (hit on every kubelet restart on nodes with host devices).
- [PR #19862] libvirtxml bumped to v1.12007.0; fixes SMMUv3 IOMMU `ssidsize` handling for IOVirtualization VMIs across plugin hooks.
- [PR #19863] Node hooks fall back to the Plugin-level `failureStrategy` (like launcher hooks); plugins with `spec.failureStrategy: Ignore` no longer block VM start/stop/migration on a node-hook failure.
- [PR #19492] Fixed a gRPC connection leak on virt-handler client init failure.
- [PR #19534] Fixed a leaked Unix socket listener on an ownership-setting error.
- [PR #19240] `virt-launcher-monitor` rewritten in C — memory footprint down to ~2Mi.
- [PR #19590] Built with Go 1.26.10.

**Backup / snapshot**
- [PR #19690] **Beta**: IncrementalBackup, introduces `backup.kubevirt.io/v1beta1`.
- [PR #19294] Offline incremental backup.
- [PR #19688] CBT overlays now keyed by volume + PVC name — pointing a volume at a different PVC correctly triggers a Full backup instead of a bad incremental.
- [PR #19435] CBT overlays are cleaned up when CBT is disabled.
- [PR #19409] Live migration of CBT-enabled VMs creates target CBT overlays from the source domain; unplugging a volume removes its CBT overlay regardless of VMI CBT state.
- [PR #19410] HostDisk volumes are no longer eligible for changed block tracking.
- [PR #19056] `VirtualMachineBackup` no longer fails on a lost base-checkpoint bitmap (falls back to full backup for that disk); **breaking**: `status.type` is removed, replaced by per-volume `status.includedVolumes[].type`.
- [PR #19360] VEP 321: External-mode `VirtualMachineSnapshot`.
- [PR #19574] Guest writes are recovered correctly after a virt-launcher crash during an External-mode snapshot.
- [PR #19173] Declarative `VirtualMachineState`.

**Feature gate graduations / changes**
- [PR #19550] `UtilityVolumes` promoted to **Beta, enabled by default**. Memory dumps now attach as utility volumes and require this gate; VM snapshots/exports no longer include the memory-dump PVC.
- [PR #19382] `ContainerPathVolume` graduates to **Beta**.
- [PR #19251] `ContainerPathVolume` feature gate now checked at admission time; `/run/kubevirt*` and `/run/libvirt*` paths are rejected.
- [PR #19511] `NetworkDevicesWithDRA` promoted to **Beta**.
- [PR #19228] **Alpha**: `CPUsWithDRA` — provision dedicated VMI CPUs via a DRA CPU driver instead of kubelet's CPU manager.
- [PR #17135] **Alpha**: UEFI Secure Boot for ARM64 guests via `ARM64SecureBoot` + `FirmwareAutoSelection` feature gates (requires CentOS Stream 10 virt-launcher images with compatible QEMU/libvirt/edk2).
- [PR #19546] **Breaking rename**: alpha feature gate `VGPULiveMigration` renamed to `MDevVGPULiveMigration`. Update any `KubeVirt` CR `featureGates` list referencing the old name.
- [PR #19403] New `PreBoot` and `PreMigrationSource` sidecar hook points for plugins.

**Export / observability**
- [PR #19485] Exported OCI archives now contain the Image Index as a blob referenced from `index.json` (ref.name `latest`); pushing them produces a proper Image Index in the registry.
- [PR #19066] `io.kubevirt.disk.name` annotation on exported OCI artifacts now carries the VM's volume name instead of the PVC name.
- [PR #19064] Fixed `VirtualMachineExport` hang for VMs with two claims whose names differ only by dots.
- [PR #19470] New `has_panic_device` label (true/false) on the `kubevirt_vmi_info` metric.
- [PR #19572] pod-status VMI interface `infoSource` is now reported for DRA-backed and Multus secondary interfaces when `NetworkDevicesWithDRA` is enabled.
- [PR #19215] New `TLSGroupPreferences` feature gate + `Groups` field on `TLSConfiguration` for cluster-wide TLS cipher/group config.
- [PR #18249] IOThread virtqueue mapping for virtio-scsi.
- [PR #19234] New `pkg/render` for rendering Pod specs from VM/VMI definitions without a live cluster (useful for CI/tooling).

## Upgrade Steps

Back up your `KubeVirt` CR and any CBT/backup-related CRs before upgrading. Apply the new operator and CR manifests for your target namespace:

```bash
export VERSION=v1.10.0

# Deploy the updated operator
kubectl apply -f https://github.com/kubevirt/kubevirt/releases/download/${VERSION}/kubevirt-operator.yaml

# Patch the KubeVirt CR to the new version
kubectl apply -f https://github.com/kubevirt/kubevirt/releases/download/${VERSION}/kubevirt-cr.yaml
```

If you manage KubeVirt via a Helm wrapper chart, bump the appVersion/image tag and roll out the same way:

```bash
helm upgrade kubevirt <your-chart> \
  --set version=${VERSION} \
  --namespace kubevirt --reuse-values
```

If you reference the renamed feature gate, update it before or during the upgrade:

```bash
kubectl -n kubevirt patch kubevirt kubevirt \
  --type=json \
  -p '[{"op":"replace","path":"/spec/configuration/developerConfiguration/featureGates","value":["MDevVGPULiveMigration"]}]'
```

Watch the virt-operator roll out virt-api/virt-controller/virt-handler; note PR #19732 means mixed-version virt-handler nodes during the rollout will correctly avoid scheduling migrations onto unupgraded nodes.

## Verify

```bash
# Confirm the target version is observed
kubectl get kubevirt kubevirt -n kubevirt -o jsonpath='{.status.observedKubeVirtVersion}'

# Confirm all components are healthy
kubectl -n kubevirt get pods -l 'kubevirt.io'

# Confirm the KubeVirt CR phase is Deployed
kubectl get kubevirt kubevirt -n kubevirt -o jsonpath='{.status.phase}'

# Check enabled feature gates
kubectl get kubevirt kubevirt -n kubevirt -o jsonpath='{.spec.configuration.developerConfiguration.featureGates}'
```

Expect `observedKubeVirtVersion` to report `v1.10.0` and phase `Deployed` once all operator-managed pods are `Running`.

## Common Issues

- **Stale `VGPULiveMigration` feature gate**: after upgrade the renamed gate is `MDevVGPULiveMigration`; the old name is silently ignored, leaving vGPU live migration disabled. Update your CR.
- **`UtilityVolumes` now default-on**: if you relied on memory dumps being embedded in VM snapshot/export PVCs, that behavior changed — memory dumps are now separate utility volumes and excluded from snapshots/exports.
- **`status.type` removal on `VirtualMachineBackup`**: any automation reading the removed top-level `status.type` field must switch to per-volume `status.includedVolumes[].type`.
- **Mixed virt-handler versions during rollout**: migrations will intentionally avoid landing on not-yet-upgraded nodes (PR #19732) — expect migrations to pend briefly until the rollout completes, this is expected, not a bug.
- **ContainerPathVolume admission rejection**: paths under `/run/kubevirt*` or `/run/libvirt*` are now rejected at admission (PR #19251); update VM specs that used these paths.

## Best Practices

- Test the upgrade in a staging cluster first, especially if you use CBT-based incremental backups, External-mode snapshots, or SR-IOV/GPU/PCI host devices with the `Plugins` feature gate.
- Audit `spec.configuration.developerConfiguration.featureGates` for the renamed `VGPULiveMigration` entry and any Alpha gates you want to evaluate (`CPUsWithDRA`, `ARM64SecureBoot`, `FirmwareAutoSelection`).
- Avoid starting new live migrations mid-rollout when possible; let the virt-handler DaemonSet finish updating first even though v1.10.0 now guards against the worst failure mode.
- Re-point any tooling that read `VirtualMachineBackup.status.type` to the new per-volume field before relying on backup status in automation.
- Review the full notable-changes list on the [release page](https://github.com/kubevirt/kubevirt/releases/tag/v1.10.0) — this recipe covers operator-relevant highlights, not all 1761 changes.
