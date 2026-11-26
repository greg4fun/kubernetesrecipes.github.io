---
title: "What's New in Velero v1.19: Block Data Mover"
description: "Velero 1.19 adds block data mover, in-place restore, fine-grained filters; Restic removed and repo moved to velero-io."
publishDate: "2026-11-26"
author: "Luca Berton"
category: "storage"
difficulty: "intermediate"
timeToComplete: "25 minutes"
kubernetesVersion: "1.28+"
tags:
  - "velero"
  - "backup"
  - "restore"
  - "csi"
  - "data-mover"
  - "disaster-recovery"
  - "upgrade"
---
> 💡 **Quick Answer:** Velero v1.19.0 adds a block-level CSI data mover, in-place volume restore, and fine-grained ResourcePolicy filters, while permanently removing Restic fs-backup support and moving its GitHub repo/Go module path from `vmware-tanzu/velero` to `velero-io/velero` — plan to migrate any Restic-based backups before upgrading.

## The Problem

Operators backing up block storage volumes with CSI snapshot data movement previously paid the cost of full file-system scans even for incremental backups, had no first-class way to restore data directly into an existing PVC, and lacked per-namespace/per-resource filtering finer than label selectors. Teams still relying on the legacy Restic path for File System Backup also needed a clear migration signal before it was removed entirely.

## The Solution

Velero 1.19 introduces a new block data mover (`velero-block`) that uses the Kubernetes CSI Changed Block Tracking (CBT) API to move only changed blocks on incremental backup/restore, adds in-place volume restore for both file-system and block data movers, and layers ResourcePolicy ConfigMaps on top of existing resource/namespace filtering for finer, centrally managed control. It also finalizes the Restic removal that was deprecated in earlier releases.

## What's New

- **Block data mover (`velero-block`)** — block-level backup/restore for CSI volumes backed by block storage, integrating with the [CSI Changed Block Tracking API](https://kubernetes.io/blog/2025/09/25/csi-changed-block-tracking/) so incremental backups/restores transfer only changed blocks. Docs: https://velero.io/docs/v1.19/csi-snapshot-data-movement/
 - Known gap: CSI drivers that require the parent snapshot to persist (e.g. Ceph RBD) are **not** supported for true incremental block mover in 1.19.0 — incremental backups fall back to reading all blocks and incremental restores run as full restores. Tracked in velero-io/velero#10743.
- **Volume data in-place restore** — restore directly into an existing PVC (full or incremental) for CSI snapshot data movement (`velero-fs`/`velero-block`) and File System Backup, including clone-and-restore workflows. Docs: https://velero.io/docs/v1.19/volume-data-inplace-restore/
- **Fine-grained backup/restore filters** — per-namespace and per-resource-kind rules with independent label selectors and name patterns via ResourcePolicy ConfigMaps. Docs: https://velero.io/docs/v1.19/fine-grained-backup-filters/ and .../fine-grained-restore-filters/
- **Namespace selection by label** — backups/schedules can dynamically include/exclude namespaces by label at run time instead of maintaining static namespace lists (backup only).
- **Global volume policy** — define default volume backup rules in a shared ConfigMap; per-backup volume policies still override the global default.
- **Custom action type in volume policy** — lets third-party BackupItemAction plugins handle volume backups with plugin-specific parameters.
- **Default restore resource modifier** — configure a cluster-wide default resource modifier ConfigMap for restores; individual restores can override or explicitly skip it.
- **Runtime bump** — built with Go 1.27.3 and kopia 0.23.1.

### Breaking Changes

- **Repository move**: code and Go module path changed from `github.com/vmware-tanzu/velero` to `github.com/velero-io/velero`. Anything that imports Velero as a Go library must update imports and `go.mod`. Container image names and CLI usage are unchanged.
- **Restic removal**: the Restic path for fs-backup is fully removed. Restores from backups that used the Restic path now fail with `FailedValidation`, and backup sync ignores (hides) Restic-path backups from the cluster, though the data remains in object storage. Migrate any remaining Restic-based backups to Kopia before upgrading, or accept that they'll no longer be restorable through Velero after the upgrade.

### Known Limitation

CSI snapshot data movement restore of a pod mounting both `Immediate` and `WaitForFirstConsumer` PVCs can stall and land `PartiallyFailed`. Workaround (non-multi-zone clusters only): set node-agent config `restorePVC.ignoreDelayBinding: true`; otherwise avoid mixing binding modes on a single pod.

## Upgrade Steps

Check the full upgrade guide first: https://velero.io/docs/v1.19/upgrade-to-1.19/

```bash
# 1. Back up your current Velero CRDs/config as a precaution
kubectl get backupstoragelocations,volumesnapshotlocations,schedules -A -o yaml > velero-pre-1.19-backup.yaml

# 2. If installed via Helm, update the repo and inspect the diff
helm repo update vmware-tanzu
helm search repo vmware-tanzu/velero --versions | head

# 3. Upgrade CRDs explicitly (Velero does not auto-upgrade CRDs)
velero install --crds-only --dry-run -o yaml | kubectl apply -f -

# 4. Upgrade the Velero Deployment image
kubectl set image deployment/velero velero=velero/velero:v1.19.0 -n velero

# 5. Or, if using Helm chart
helm upgrade velero vmware-tanzu/velero \
  --namespace velero \
  --set image.tag=v1.19.0 \
  --reuse-values

# 6. Update the CLI to match
velero version --client-only
```

If you import Velero's Go module in your own tooling, update the module path before rebuilding:

```bash
go mod edit -replace github.com/vmware-tanzu/velero=github.com/velero-io/velero@v1.19.0
go mod tidy
```

## Verify

```bash
# Confirm server and client versions match
velero version

# Confirm pods are healthy on the new image
kubectl get pods -n velero -o wide
kubectl get deployment velero -n velero -o jsonpath='{.spec.template.spec.containers[0].image}'

# Run a smoke-test backup and watch it complete
velero backup create smoke-test-1-19 --include-namespaces default
velero backup describe smoke-test-1-19
velero backup logs smoke-test-1-19
```

If you rely on fs-backup, confirm no backups are still tagged with the Restic path:

```bash
velero backup describe <backup-name> --details | grep -i restic
```

## Common Issues

- **Restores failing with `FailedValidation`**: the source backup used the removed Restic path — re-backup the workload using Kopia (`velero-fs`) before you can restore it.
- **Backups silently missing after upgrade**: backup sync ignores Restic-path backups; this is expected, data remains in object storage but Velero won't list it.
- **Go build breaks after upgrade**: update `go.mod`/imports for the `velero-io/velero` module path; container images and CLI are unaffected.
- **Incremental block mover acting like a full backup/restore**: check if your CSI driver requires the parent snapshot to persist (e.g., Ceph RBD) — not yet optimized in 1.19.0 (velero-io/velero#10743).
- **CSI data-movement restore stuck `PartiallyFailed`** on pods with mixed PVC binding modes: set `restorePVC.ignoreDelayBinding: true` in node-agent config if you're not running multi-zone topology.

## Best Practices

- Run `velero install --crds-only --dry-run -o yaml | kubectl diff -f -` before applying CRD changes to review schema additions for ResourcePolicy and volume policy fields.
- Audit existing backups for the Restic path before upgrading and re-run them with Kopia if you need them restorable going forward.
- Adopt ResourcePolicy ConfigMaps incrementally — start with namespace-label selection or a global volume policy before layering fine-grained per-kind filters.
- Pin your Helm chart and image tag together in GitOps manifests so CRDs and the controller image always upgrade atomically.
- For CSI block mover, validate CBT support with your storage vendor before relying on incremental behavior in production; fall back to `velero-fs` where CBT isn't supported.
