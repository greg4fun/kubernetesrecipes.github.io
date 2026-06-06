---
title: "Velero Kubernetes Backup and Disaster Recovery"
description: "Deploy Velero for Kubernetes cluster backup and disaster recovery. Configure scheduled backups, restore namespaces, migrate workloads between"
tags:
  - "velero"
  - "backup"
  - "disaster-recovery"
  - "migration"
  - "persistent-volumes"
category: "storage"
publishDate: "2026-06-01"
author: "Luca Berton"
difficulty: "intermediate"
relatedRecipes:
  - "kubernetes-persistent-volume-guide"
  - "kubernetes-etcd-backup-restore"
---

> 💡 **Quick Answer:** Velero backs up Kubernetes resources and persistent volumes to object storage (S3/GCS/Azure Blob). Install with `velero install`, create scheduled backups with `velero schedule create`, and restore with `velero restore create`. Supports full cluster backup, namespace-level backup, and cross-cluster migration.

## The Problem

- No built-in Kubernetes backup solution for applications + persistent data
- etcd backup alone doesn't capture PV data or application state
- Need to migrate workloads between clusters (upgrade, cloud migration)
- Disaster recovery requires both resource definitions and volume data
- Namespace deletion is permanent without external backup

## The Solution

### Install Velero

```bash
# Install Velero CLI
curl -fsSL https://github.com/vmware-tanzu/velero/releases/download/v1.14.0/velero-v1.14.0-linux-amd64.tar.gz | \
  tar xz && mv velero-v1.14.0-linux-amd64/velero /usr/local/bin/

# Install Velero server with AWS S3 backend
velero install \
  --provider aws \
  --plugins velero/velero-plugin-for-aws:v1.10.0 \
  --bucket velero-backups \
  --secret-file ./credentials-velero \
  --backup-location-config region=us-east-1 \
  --snapshot-location-config region=us-east-1 \
  --use-node-agent    # For filesystem-level PV backup

# Verify
velero version
kubectl get pods -n velero
```

### Create Backups

```bash
# Backup entire cluster
velero backup create full-backup

# Backup specific namespace
velero backup create app-backup --include-namespaces production

# Backup with label selector
velero backup create api-backup --selector app=api-server

# Backup excluding certain resources
velero backup create cluster-backup \
  --exclude-namespaces kube-system,velero \
  --exclude-resources events,pods

# Check backup status
velero backup describe full-backup
velero backup logs full-backup
```

### Scheduled Backups

```bash
# Daily backup of production namespace (retain 30 days)
velero schedule create daily-production \
  --schedule="0 2 * * *" \
  --include-namespaces production \
  --ttl 720h

# Weekly full cluster backup (retain 90 days)
velero schedule create weekly-full \
  --schedule="0 3 * * 0" \
  --ttl 2160h

# List schedules
velero schedule get
```

```yaml
# Or as YAML
apiVersion: velero.io/v1
kind: Schedule
metadata:
  name: daily-production
  namespace: velero
spec:
  schedule: "0 2 * * *"
  template:
    includedNamespaces:
      - production
    ttl: 720h0m0s
    storageLocation: default
    volumeSnapshotLocations:
      - default
```

### Restore from Backup

```bash
# Restore entire backup
velero restore create --from-backup full-backup

# Restore specific namespace
velero restore create --from-backup full-backup \
  --include-namespaces production

# Restore to different namespace (mapping)
velero restore create --from-backup full-backup \
  --namespace-mappings "production:production-restored"

# Restore excluding certain resources
velero restore create --from-backup full-backup \
  --exclude-resources persistentvolumeclaims

# Check restore status
velero restore describe <restore-name>
velero restore logs <restore-name>
```

### Persistent Volume Backup

```yaml
# Option 1: CSI Snapshots (preferred for cloud PVs)
# Velero uses VolumeSnapshotClass to create CSI snapshots
apiVersion: snapshot.storage.k8s.io/v1
kind: VolumeSnapshotClass
metadata:
  name: velero-snapshot-class
  labels:
    velero.io/csi-volumesnapshot-class: "true"
driver: ebs.csi.aws.com    # Your CSI driver
deletionPolicy: Retain

---
# Option 2: File System Backup (for any PV type)
# Annotate pods to use Kopia/Restic file-level backup
apiVersion: v1
kind: Pod
metadata:
  annotations:
    backup.velero.io/backup-volumes: data,config
spec:
  containers:
    - name: app
      volumeMounts:
        - name: data
          mountPath: /data
        - name: config
          mountPath: /config
  volumes:
    - name: data
      persistentVolumeClaim:
        claimName: app-data
    - name: config
      persistentVolumeClaim:
        claimName: app-config
```

### Cross-Cluster Migration

```bash
# Source cluster: create backup
velero backup create migration-backup --include-namespaces my-app

# Target cluster: configure same backup location
velero backup-location create source \
  --provider aws \
  --bucket velero-backups \
  --config region=us-east-1

# Target cluster: restore from source backup
velero restore create --from-backup migration-backup
```

### Check Backup Storage

```bash
# List backup locations
velero backup-location get
# NAME      PROVIDER   BUCKET/PREFIX   PHASE       LAST VALIDATED
# default   aws        velero-backups  Available   2026-06-01 10:00:00

# List snapshot locations
velero snapshot-location get

# Verify backup exists in storage
velero backup get
# NAME              STATUS      ERRORS   WARNINGS   CREATED                         EXPIRES
# daily-prod-xxx    Completed   0        0          2026-06-01 02:00:05 +0000 UTC   29d
```

## Common Issues

### Backup completed with warnings about PVCs
- **Cause**: No volume snapshot location configured, or pod not annotated for FS backup
- **Fix**: Configure VolumeSnapshotLocation; or annotate pods with `backup.velero.io/backup-volumes`

### Restore fails with "already exists" errors
- **Cause**: Resources still exist in cluster (restore is additive, not destructive)
- **Fix**: Delete existing resources first; or use `--existing-resource-policy=update`

### Large PV backup taking too long / timing out
- **Cause**: File-level backup scanning millions of small files
- **Fix**: Use CSI snapshots instead (instant); or increase backup timeout

### Backup location shows "Unavailable"
- **Cause**: Credentials expired or bucket permissions changed
- **Fix**: Update credentials secret; verify IAM role/policy

## Best Practices

1. **Schedule daily namespace + weekly full backups** — balanced protection vs cost
2. **Use CSI snapshots for PVs when possible** — faster than file-level backup
3. **Test restores regularly** — backups are worthless if restore doesn't work
4. **Set TTL on backups** — prevent unbounded storage growth (30-90 days typical)
5. **Exclude ephemeral resources** — events, pods (they're recreated by controllers)
6. **Backup before cluster upgrades** — safety net for rollback
7. **Use separate bucket/account for DR** — survive source account compromise

## Key Takeaways

- Velero backs up K8s resources + PV data to object storage (S3/GCS/Azure)
- Two PV backup methods: CSI snapshots (fast, cloud-native) or file-level (any storage)
- Scheduled backups with TTL for automated protection
- Cross-cluster restore enables migration between clusters
- Always test restores — a backup you can't restore is useless
- `velero backup create` + `velero restore create` — the core workflow
