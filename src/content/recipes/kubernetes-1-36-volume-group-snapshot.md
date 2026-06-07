---
title: "Kubernetes 1.36 VolumeGroupSnapshot GA"
description: "Use VolumeGroupSnapshot in Kubernetes 1.36 to take crash-consistent snapshots of multiple volumes atomically. Now GA and production-ready."
tags:
  - "kubernetes-1.36"
  - "storage"
  - "snapshots"
  - "backup"
  - "disaster-recovery"
category: "storage"
publishDate: "2026-05-03"
author: "Luca Berton"
difficulty: "intermediate"
relatedRecipes:
  - "kubernetes-velero-backup-guide"
  - "kubernetes-persistent-volume-guide"
  - "kubernetes-1-36-oci-volume-source"
  - "kubernetes-1-36-csi-differential-snapshots"
---

> 💡 **Quick Answer:** VolumeGroupSnapshot graduates to **GA in Kubernetes 1.36**. Take crash-consistent snapshots of multiple PersistentVolumes atomically — essential for databases, stateful apps, and disaster recovery.

## The Problem

Applications often spread data across multiple volumes (data + WAL, primary + index, etc.). Snapshotting each volume individually creates **inconsistent backups**:

- Database data volume snapped at T=1, WAL volume at T=3 — corrupted restore
- Multi-volume StatefulSet where volumes are interdependent
- Distributed databases requiring point-in-time consistency across shards
- No atomic guarantee across individual VolumeSnapshot operations

## The Solution

VolumeGroupSnapshot takes a single, atomic snapshot of multiple volumes at the same point in time.

### Create a VolumeGroupSnapshot

```yaml
apiVersion: groupsnapshot.storage.k8s.io/v1
kind: VolumeGroupSnapshot
metadata:
  name: db-backup-2026-05-03
  namespace: production
spec:
  source:
    selector:
      matchLabels:
        app: postgres
        snapshot-group: "db-volumes"
  volumeGroupSnapshotClassName: csi-group-snapclass
```

### VolumeGroupSnapshotClass

```yaml
apiVersion: groupsnapshot.storage.k8s.io/v1
kind: VolumeGroupSnapshotClass
metadata:
  name: csi-group-snapclass
driver: ebs.csi.aws.com    # or your CSI driver
deletionPolicy: Retain
parameters:
  consistency-group: "true"
```

### Label Your Volumes for Group Snapshots

```yaml
apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: postgres-data
  labels:
    app: postgres
    snapshot-group: "db-volumes"
spec:
  accessModes: ["ReadWriteOnce"]
  storageClassName: gp3-encrypted
  resources:
    requests:
      storage: 100Gi
---
apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: postgres-wal
  labels:
    app: postgres
    snapshot-group: "db-volumes"
spec:
  accessModes: ["ReadWriteOnce"]
  storageClassName: gp3-encrypted
  resources:
    requests:
      storage: 50Gi
```

### Restore from VolumeGroupSnapshot

```yaml
apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: postgres-data-restored
spec:
  accessModes: ["ReadWriteOnce"]
  storageClassName: gp3-encrypted
  resources:
    requests:
      storage: 100Gi
  dataSource:
    name: db-backup-2026-05-03-data    # Individual snapshot from group
    kind: VolumeSnapshot
    apiGroup: snapshot.storage.k8s.io
---
apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: postgres-wal-restored
spec:
  accessModes: ["ReadWriteOnce"]
  storageClassName: gp3-encrypted
  resources:
    requests:
      storage: 50Gi
  dataSource:
    name: db-backup-2026-05-03-wal
    kind: VolumeSnapshot
    apiGroup: snapshot.storage.k8s.io
```

### Scheduled Group Snapshots with CronJob

```yaml
apiVersion: batch/v1
kind: CronJob
metadata:
  name: db-group-snapshot
  namespace: production
spec:
  schedule: "0 */6 * * *"    # Every 6 hours
  jobTemplate:
    spec:
      template:
        spec:
          serviceAccountName: snapshot-creator
          containers:
            - name: snapshot
              image: bitnami/kubectl:1.36
              command:
                - /bin/sh
                - -c
                - |
                  TIMESTAMP=$(date +%Y%m%d-%H%M%S)
                  cat <<SNAP | kubectl apply -f -
                  apiVersion: groupsnapshot.storage.k8s.io/v1
                  kind: VolumeGroupSnapshot
                  metadata:
                    name: db-backup-${TIMESTAMP}
                    namespace: production
                  spec:
                    source:
                      selector:
                        matchLabels:
                          snapshot-group: db-volumes
                    volumeGroupSnapshotClassName: csi-group-snapclass
                  SNAP
          restartPolicy: OnFailure
```

### Check Group Snapshot Status

```bash
# List group snapshots
kubectl get volumegroupsnapshot -n production

# Check individual snapshots created by the group
kubectl get volumesnapshot -n production -l group-snapshot=db-backup-2026-05-03

# Verify readiness
kubectl get volumegroupsnapshot db-backup-2026-05-03 -o jsonpath='{.status.readyToUse}'
# true
```

## Common Issues

### CSI driver doesn't support group snapshots
- **Cause**: Not all CSI drivers implement the GroupSnapshot capability
- **Fix**: Check driver documentation; AWS EBS, GCE PD, and NetApp support it

### Group snapshot stuck in Pending
- **Cause**: One or more volumes are in use by a running Pod
- **Fix**: Some drivers require quiescing — pause writes or use application-consistent hooks

### Label selector matches wrong volumes
- **Cause**: Broad label selector includes unrelated PVCs
- **Fix**: Use specific labels like `snapshot-group: db-volumes` instead of just `app: postgres`

## Best Practices

1. **Label volumes consistently** — use dedicated `snapshot-group` labels
2. **Use `deletionPolicy: Retain`** — keep snapshots even if the source is deleted
3. **Schedule regular group snapshots** — CronJob every 4-6 hours for databases
4. **Test restores regularly** — snapshots are useless if restores don't work
5. **Quiesce applications** — flush buffers before snapping for application consistency

## Key Takeaways

- VolumeGroupSnapshot is **GA in Kubernetes 1.36** — production-ready
- Takes atomic, crash-consistent snapshots of multiple volumes
- Essential for multi-volume databases and stateful applications
- Restores use individual VolumeSnapshots created by the group operation
- CSI driver must support the GroupSnapshot capability
