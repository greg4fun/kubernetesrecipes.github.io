---
title: "How to Set Up Volume Snapshots"
description: "Create and restore volume snapshots for persistent data backup. Learn to configure VolumeSnapshotClass and automate snapshot schedules."
category: "storage"
difficulty: "intermediate"
publishDate: "2026-01-22"
tags: ["snapshots", "backup", "storage", "pvc", "disaster-recovery"]
---

# How to Set Up Volume Snapshots

Volume snapshots capture the state of persistent volumes for backup and recovery. Create point-in-time copies and restore them to new volumes when needed.

## Prerequisites

```bash
# Install snapshot CRDs (if not present)
kubectl apply -f https://raw.githubusercontent.com/kubernetes-csi/external-snapshotter/master/client/config/crd/snapshot.storage.k8s.io_volumesnapshots.yaml
kubectl apply -f https://raw.githubusercontent.com/kubernetes-csi/external-snapshotter/master/client/config/crd/snapshot.storage.k8s.io_volumesnapshotcontents.yaml
kubectl apply -f https://raw.githubusercontent.com/kubernetes-csi/external-snapshotter/master/client/config/crd/snapshot.storage.k8s.io_volumesnapshotclasses.yaml

# Install snapshot controller
kubectl apply -f https://raw.githubusercontent.com/kubernetes-csi/external-snapshotter/master/deploy/kubernetes/snapshot-controller/rbac-snapshot-controller.yaml
kubectl apply -f https://raw.githubusercontent.com/kubernetes-csi/external-snapshotter/master/deploy/kubernetes/snapshot-controller/setup-snapshot-controller.yaml
```

## Create VolumeSnapshotClass

```yaml
# snapshot-class.yaml
apiVersion: snapshot.storage.k8s.io/v1
kind: VolumeSnapshotClass
metadata:
  name: csi-snapclass
  annotations:
    snapshot.storage.kubernetes.io/is-default-class: "true"
driver: ebs.csi.aws.com  # Your CSI driver
deletionPolicy: Delete   # or Retain
parameters:
  # Driver-specific parameters
```

```yaml
# GCP example
apiVersion: snapshot.storage.k8s.io/v1
kind: VolumeSnapshotClass
metadata:
  name: gcp-snapclass
driver: pd.csi.storage.gke.io
deletionPolicy: Retain
parameters:
  storage-locations: us-central1
```

## Create Volume Snapshot

```yaml
# volume-snapshot.yaml
apiVersion: snapshot.storage.k8s.io/v1
kind: VolumeSnapshot
metadata:
  name: myapp-snapshot-20260122
  namespace: default
spec:
  volumeSnapshotClassName: csi-snapclass
  source:
    persistentVolumeClaimName: myapp-data
```

```bash
# Apply and verify
kubectl apply -f volume-snapshot.yaml

# Check snapshot status
kubectl get volumesnapshot myapp-snapshot-20260122

# Detailed info
kubectl describe volumesnapshot myapp-snapshot-20260122
```

## Restore from Snapshot

```yaml
# restore-pvc.yaml
apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: myapp-data-restored
  namespace: default
spec:
  storageClassName: gp3
  dataSource:
    name: myapp-snapshot-20260122
    kind: VolumeSnapshot
    apiGroup: snapshot.storage.k8s.io
  accessModes:
    - ReadWriteOnce
  resources:
    requests:
      storage: 20Gi  # Must be >= snapshot size
```

## Pre-Snapshot Hook (Quiesce Application)

```yaml
# snapshot-with-hook.yaml
apiVersion: batch/v1
kind: Job
metadata:
  name: pre-snapshot-quiesce
spec:
  template:
    spec:
      containers:
        - name: quiesce
          image: bitnami/postgresql:15
          command:
            - sh
            - -c
            - |
              # Flush and lock tables before snapshot
              PGPASSWORD=$DB_PASSWORD psql -h $DB_HOST -U $DB_USER -c "SELECT pg_start_backup('snapshot');"
          envFrom:
            - secretRef:
                name: db-credentials
      restartPolicy: Never
---
# Then create snapshot
apiVersion: snapshot.storage.k8s.io/v1
kind: VolumeSnapshot
metadata:
  name: db-snapshot-20260122
spec:
  volumeSnapshotClassName: csi-snapclass
  source:
    persistentVolumeClaimName: postgres-data
```

## Scheduled Snapshots with CronJob

```yaml
# scheduled-snapshot.yaml
apiVersion: batch/v1
kind: CronJob
metadata:
  name: daily-snapshot
  namespace: default
spec:
  schedule: "0 2 * * *"  # Daily at 2 AM
  jobTemplate:
    spec:
      template:
        spec:
          serviceAccountName: snapshot-creator
          containers:
            - name: snapshot
              image: bitnami/kubectl:latest
              command:
                - /bin/sh
                - -c
                - |
                  TIMESTAMP=$(date +%Y%m%d-%H%M%S)
                  cat <<EOF | kubectl apply -f -
                  apiVersion: snapshot.storage.k8s.io/v1
                  kind: VolumeSnapshot
                  metadata:
                    name: myapp-snapshot-${TIMESTAMP}
                    namespace: default
                  spec:
                    volumeSnapshotClassName: csi-snapclass
                    source:
                      persistentVolumeClaimName: myapp-data
                  EOF
          restartPolicy: OnFailure
---
# RBAC for snapshot creation
apiVersion: rbac.authorization.k8s.io/v1
kind: Role
metadata:
  name: snapshot-creator
  namespace: default
rules:
  - apiGroups: ["snapshot.storage.k8s.io"]
    resources: ["volumesnapshots"]
    verbs: ["create", "get", "list"]
---
apiVersion: rbac.authorization.k8s.io/v1
kind: RoleBinding
metadata:
  name: snapshot-creator
  namespace: default
roleRef:
  apiGroup: rbac.authorization.k8s.io
  kind: Role
  name: snapshot-creator
subjects:
  - kind: ServiceAccount
    name: snapshot-creator
    namespace: default
---
apiVersion: v1
kind: ServiceAccount
metadata:
  name: snapshot-creator
  namespace: default
```

## Cleanup Old Snapshots

```yaml
# cleanup-snapshots.yaml
apiVersion: batch/v1
kind: CronJob
metadata:
  name: snapshot-cleanup
spec:
  schedule: "0 3 * * 0"  # Weekly on Sunday at 3 AM
  jobTemplate:
    spec:
      template:
        spec:
          serviceAccountName: snapshot-cleanup
          containers:
            - name: cleanup
              image: bitnami/kubectl:latest
              command:
                - /bin/sh
                - -c
                - |
                  # Delete snapshots older than 7 days
                  CUTOFF=$(date -d '7 days ago' +%Y%m%d)
                  kubectl get volumesnapshots -o json | \
                    jq -r ".items[] | select(.metadata.creationTimestamp < \"$(date -d '7 days ago' -Iseconds)\") | .metadata.name" | \
                    xargs -r kubectl delete volumesnapshot
          restartPolicy: OnFailure
```

## Clone PVC from Snapshot

```yaml
# clone-for-testing.yaml
apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: myapp-data-test
  namespace: testing
spec:
  storageClassName: gp3
  dataSource:
    name: myapp-snapshot-20260122
    kind: VolumeSnapshot
    apiGroup: snapshot.storage.k8s.io
  accessModes:
    - ReadWriteOnce
  resources:
    requests:
      storage: 20Gi
---
# Use clone in test deployment
apiVersion: apps/v1
kind: Deployment
metadata:
  name: myapp-test
  namespace: testing
spec:
  replicas: 1
  selector:
    matchLabels:
      app: myapp-test
  template:
    metadata:
      labels:
        app: myapp-test
    spec:
      containers:
        - name: app
          image: myapp:v1
          volumeMounts:
            - name: data
              mountPath: /data
      volumes:
        - name: data
          persistentVolumeClaim:
            claimName: myapp-data-test
```

## List and Manage Snapshots

```bash
# List all snapshots
kubectl get volumesnapshots -A

# Check snapshot content
kubectl get volumesnapshotcontents

# Get snapshot details
kubectl describe volumesnapshot myapp-snapshot-20260122

# Delete snapshot
kubectl delete volumesnapshot myapp-snapshot-20260122
```

## Verify CSI Driver Support

```bash
# Check if CSI driver supports snapshots
kubectl get csidrivers -o custom-columns=\
NAME:.metadata.name,\
SNAPSHOT:.spec.volumeLifecycleModes

# List snapshot classes
kubectl get volumesnapshotclasses
```

## Summary

Volume snapshots provide point-in-time backup for persistent volumes. Create a VolumeSnapshotClass for your CSI driver, take snapshots before critical operations, and restore to new PVCs when needed. Automate with CronJobs for scheduled backups and cleanup routines.
