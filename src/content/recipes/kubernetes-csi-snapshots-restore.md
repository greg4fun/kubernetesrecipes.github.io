---
title: "CSI Volume Snapshots and Restore"
description: "Create and restore volume snapshots using CSI VolumeSnapshot API. Configure VolumeSnapshotClass, take point-in-time backups, and clone PVCs from snapshots."
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
relatedRecipes:
  - "velero-backup-disaster-recovery"
  - "kubernetes-storage-best-practices"
  - "kubernetes-fsgroupchangepolicy"
---

> 💡 **Quick Answer:** Create a `VolumeSnapshot` referencing a PVC to take a point-in-time backup. Restore by creating a new PVC with `dataSource: {kind: VolumeSnapshot, name: my-snapshot}`. Requires CSI driver with snapshot support and the snapshot controller installed.

## The Problem

You need point-in-time backups of persistent volumes for disaster recovery, pre-upgrade snapshots, or cloning data to new environments — without stopping your application.

## The Solution

### Prerequisites

```bash
# Install snapshot CRDs and controller (if not already present)
kubectl apply -f https://raw.githubusercontent.com/kubernetes-csi/external-snapshotter/master/client/config/crd/snapshot.storage.k8s.io_volumesnapshotclasses.yaml
kubectl apply -f https://raw.githubusercontent.com/kubernetes-csi/external-snapshotter/master/client/config/crd/snapshot.storage.k8s.io_volumesnapshotcontents.yaml
kubectl apply -f https://raw.githubusercontent.com/kubernetes-csi/external-snapshotter/master/client/config/crd/snapshot.storage.k8s.io_volumesnapshots.yaml
kubectl apply -f https://raw.githubusercontent.com/kubernetes-csi/external-snapshotter/master/deploy/kubernetes/snapshot-controller/setup-snapshot-controller.yaml
```

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

## Common Issues

| Issue | Cause | Fix |
|-------|-------|-----|
| `snapshot controller not found` | CRDs/controller not installed | Install snapshot-controller |
| `driver does not support snapshots` | CSI driver limitation | Check driver capabilities |
| Snapshot stuck in `pending` | Driver can't snapshot mounted volume | Some drivers require unmount |
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
