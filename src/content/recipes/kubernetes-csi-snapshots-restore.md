---
title: "Kubernetes CSI VolumeSnapshot: Create and Restore"
description: "Create and restore Kubernetes CSI volume snapshots: snapshot controller, VolumeSnapshotClass, restore to a new PVC, PVC cloning, scheduled snapshots."
publishDate: "2026-04-20"
author: "Luca Berton"
category: "storage"
difficulty: "intermediate"
timeToComplete: "15 minutes"
kubernetesVersion: "1.28+"
tags:
  - csi
  - snapshots
  - storage
  - backup
  - restore
  - volumesnapshot
relatedRecipes:
  - "kubernetes-1-36-volume-group-snapshot"
  - "kubernetes-1-36-csi-differential-snapshots"
  - "kubernetes-velero-snapshot-locations"
  - "velero-kubernetes-backup-disaster-recovery"
  - "kubernetes-storage-best-practices"
  - "kubernetes-fsgroupchangepolicy"
---

> 💡 **Quick Answer:** Create a `VolumeSnapshot` referencing a PVC to take a point-in-time backup. Restore by creating a new PVC with `dataSource: {kind: VolumeSnapshot, name: my-snapshot}`. Requires CSI driver with snapshot support and the snapshot controller installed.

## The Problem

You need point-in-time backups of persistent volumes for disaster recovery, pre-upgrade snapshots, or cloning data to new environments — without stopping your application.

## The Solution

### Prerequisites

```bash
# Already installed? (EKS/GKE/AKS add-ons and OpenShift ship it)
kubectl get crd volumesnapshots.snapshot.storage.k8s.io
kubectl get pods -A | grep snapshot-controller

# Otherwise install CRDs + snapshot-controller from a pinned release
REPO=https://github.com/kubernetes-csi/external-snapshotter
kubectl kustomize "$REPO/client/config/crd?ref=v8.2.0" | kubectl apply -f -
kubectl kustomize "$REPO/deploy/kubernetes/snapshot-controller?ref=v8.2.0" | kubectl apply -f -
```

The CSI driver itself must also run the `csi-snapshotter` sidecar in its controller pod — that's what actually calls the storage backend.

### VolumeSnapshotClass

```yaml
apiVersion: snapshot.storage.k8s.io/v1
kind: VolumeSnapshotClass
metadata:
  name: csi-snapclass
  annotations:
    snapshot.storage.kubernetes.io/is-default-class: "true"
driver: ebs.csi.aws.com  # or your CSI driver
deletionPolicy: Delete
parameters:
  # Driver-specific parameters
  encrypted: "true"
```

### Take a Snapshot

```yaml
apiVersion: snapshot.storage.k8s.io/v1
kind: VolumeSnapshot
metadata:
  name: db-snapshot-20260420
  namespace: production
spec:
  volumeSnapshotClassName: csi-snapclass
  source:
    persistentVolumeClaimName: postgres-data
```

### Restore from Snapshot

```yaml
apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: postgres-data-restored
  namespace: production
spec:
  accessModes:
    - ReadWriteOnce
  storageClassName: gp3-encrypted
  resources:
    requests:
      storage: 100Gi
  dataSource:
    name: db-snapshot-20260420
    kind: VolumeSnapshot
    apiGroup: snapshot.storage.k8s.io
```

## Application Consistency

A CSI snapshot is crash-consistent: equivalent to pulling the power cord. Databases with a write-ahead log (PostgreSQL, MySQL/InnoDB) recover from that **if data and WAL live on the same volume**. When they span volumes, snapshot them atomically with a [VolumeGroupSnapshot](/recipes/storage/kubernetes-1-36-volume-group-snapshot/), or quiesce first:

```bash
# Flush dirty pages to shorten crash recovery on restore
kubectl exec -n production postgres-0 -- psql -U postgres -c "CHECKPOINT;"

# Or freeze the filesystem for the duration of the snapshot (needs privileges; keep it short)
kubectl exec -n production postgres-0 -- fsfreeze -f /var/lib/postgresql/data
# ...create VolumeSnapshot, wait for readyToUse...
kubectl exec -n production postgres-0 -- fsfreeze -u /var/lib/postgresql/data
```

For hands-off pre/post hooks, use Velero's CSI snapshot integration with `pre.hook.backup.velero.io/command` annotations. Note `pg_start_backup()` was renamed `pg_backup_start()` in PostgreSQL 15 and only holds while its session stays open — it doesn't work from a one-shot `psql -c`.

## Automated Snapshot CronJob

```yaml
apiVersion: batch/v1
kind: CronJob
metadata:
  name: daily-db-snapshot
  namespace: production
spec:
  schedule: "0 2 * * *"
  jobTemplate:
    spec:
      template:
        spec:
          serviceAccountName: snapshot-creator
          containers:
            - name: snapshot
              image: bitnami/kubectl:1.30
              command:
                - /bin/sh
                - -c
                - |
                  SNAP_NAME="db-snap-$(date +%Y%m%d-%H%M%S)"
                  cat <<EOF | kubectl apply -f -
                  apiVersion: snapshot.storage.k8s.io/v1
                  kind: VolumeSnapshot
                  metadata:
                    name: $SNAP_NAME
                    namespace: production
                    labels:
                      app: postgres
                      type: scheduled
                  spec:
                    volumeSnapshotClassName: csi-snapclass
                    source:
                      persistentVolumeClaimName: postgres-data
                  EOF
                  # Clean up snapshots older than 7 days
                  kubectl get volumesnapshot -n production -l app=postgres \
                    --sort-by=.metadata.creationTimestamp -o name | \
                    head -n -7 | xargs -r kubectl delete -n production
          restartPolicy: OnFailure
```

## Clone a PVC (Without Snapshot)

Same namespace, same StorageClass (driver), size ≥ source:

```yaml
apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: postgres-data-clone
spec:
  accessModes:
    - ReadWriteOnce
  storageClassName: gp3-encrypted
  resources:
    requests:
      storage: 100Gi
  dataSource:
    name: postgres-data      # Source PVC
    kind: PersistentVolumeClaim
```

Restoring or cloning across namespaces needs `dataSourceRef.namespace` plus a `ReferenceGrant` and the alpha `CrossNamespaceVolumeDataSource` feature gate — in practice, most teams restore in the source namespace or use Velero.

## Verify Snapshot Status

```bash
# Check snapshot is ready
kubectl get volumesnapshot db-snapshot-20260420 -o jsonpath='{.status.readyToUse}'
# true

# Check snapshot size
kubectl get volumesnapshot db-snapshot-20260420 -o jsonpath='{.status.restoreSize}'
# 100Gi

# List all snapshots
kubectl get volumesnapshot -A --sort-by=.metadata.creationTimestamp
```

## Verify CSI Driver Support

Not every CSI driver supports snapshots (hostPath/local-path and most NFS provisioners don't). There's no field on `CSIDriver` for it — check for a `csi-snapshotter` sidecar and a matching VolumeSnapshotClass:

```bash
kubectl get pods -A -o jsonpath='{range .items[*]}{.metadata.namespace}/{.metadata.name}: {.spec.containers[*].name}{"\n"}{end}' | grep csi-snapshotter
kubectl get volumesnapshotclasses -o custom-columns=NAME:.metadata.name,DRIVER:.driver,POLICY:.deletionPolicy
kubectl get storageclass -o custom-columns=NAME:.metadata.name,PROVISIONER:.provisioner
```

The VolumeSnapshotClass `driver` must equal the PVC's StorageClass `provisioner`.

## Common Issues

| Issue | Cause | Fix |
|-------|-------|-----|
| `snapshot controller not found` | CRDs/controller not installed | Install snapshot-controller |
| `driver does not support snapshots` | CSI driver limitation | Check driver capabilities |
| Snapshot never `readyToUse` | Backend still uploading, or driver error | `kubectl describe volumesnapshot` and check `volumesnapshotcontent` events / `csi-snapshotter` logs |
| Restore PVC stuck `Pending` | Snapshot not ready, different driver, or `WaitForFirstConsumer` with no pod yet | Check `readyToUse`, driver match; create the consuming pod |
| Restore PVC wrong size | Must match or exceed snapshot size | Set storage ≥ `restoreSize` |
| `VolumeSnapshotClass not found` | No default class set | Create and annotate as default |

## Best Practices

1. **Automate with CronJobs** — Schedule daily snapshots for critical data
2. **Implement retention** — Delete old snapshots to save storage costs
3. **Test restores regularly** — A snapshot you can't restore is worthless
4. **Label snapshots** — Add app, environment, and date labels for management
5. **Use `deletionPolicy: Retain`** — For critical snapshots that must survive class deletion

## Key Takeaways

- VolumeSnapshot provides native K8s point-in-time backup
- Requires CSI driver support + snapshot controller + CRDs
- Restore creates a new PVC pre-populated with snapshot data
- Automate with CronJobs and implement retention policies
- PVC cloning (dataSource: PVC) works without snapshots but is less flexible

## Frequently Asked Questions

### How do I restore a PVC from a VolumeSnapshot?

Create a new PVC with `dataSource: {kind: VolumeSnapshot, apiGroup: snapshot.storage.k8s.io, name: <snapshot>}`, a StorageClass using the same CSI driver, and `storage` ≥ the snapshot's `restoreSize`. You can't restore in place — point the workload at the new PVC.

### Are Kubernetes volume snapshots backups?

Not by themselves. On most clouds the snapshot lives in the same provider account/region, and with `deletionPolicy: Delete` it disappears when the VolumeSnapshot is deleted. Combine with Velero (or driver-level copy-to-region) for off-site backups.

### What is the difference between VolumeSnapshot and VolumeSnapshotContent?

`VolumeSnapshot` is the namespaced request (like a PVC); `VolumeSnapshotContent` is the cluster-scoped object representing the actual backend snapshot (like a PV). Pre-provisioned snapshots are imported by creating the content object with a `snapshotHandle`.

### Does taking a snapshot stop my application?

No. Snapshots are taken online; the result is crash-consistent. Quiesce or checkpoint the application first if you need application consistency.

