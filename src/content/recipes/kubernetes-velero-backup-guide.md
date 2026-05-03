---
title: "Velero: K8s Backup and Disaster Recovery"
description: "Back up and restore Kubernetes clusters with Velero. Schedule backups, restore namespaces, migrate between clusters."
publishDate: "2026-05-02"
author: "Luca Berton"
category: "storage"
difficulty: "intermediate"
timeToComplete: "12 minutes"
kubernetesVersion: "1.28+"
tags:
  - "backup"
  - "disaster-recovery"
  - "velero"
  - "storage"
  - "migration"
relatedRecipes:
  - "kubernetes-etcd-deep-dive-guide"
  - "kubernetes-etcd-backup-guide"
  - "kubernetes-persistent-volume-guide"
---

> 💡 **Quick Answer:** Velero backs up Kubernetes resources AND persistent volumes. Install: `velero install --provider aws --bucket my-backups --secret-file creds`. Backup: `velero backup create daily --include-namespaces production`. Restore: `velero restore create --from-backup daily`. Schedule: `velero schedule create hourly --schedule="0 * * * *"`. Supports AWS S3, GCS, Azure Blob, MinIO.

## The Problem

etcd backup protects cluster state, but not:

- Persistent volume data (databases, uploads)
- Application-level consistency
- Selective namespace restore
- Cross-cluster migration
- Scheduled backup with retention

## The Solution

### Install Velero

```bash
# Install CLI
wget https://github.com/vmware-tanzu/velero/releases/download/v1.13.0/velero-v1.13.0-linux-amd64.tar.gz
tar xzf velero-v1.13.0-linux-amd64.tar.gz
mv velero-v1.13.0-linux-amd64/velero /usr/local/bin/

# Install in cluster (AWS S3 example)
velero install \
  --provider aws \
  --plugins velero/velero-plugin-for-aws:v1.9.0 \
  --bucket my-k8s-backups \
  --backup-location-config region=us-east-1 \
  --snapshot-location-config region=us-east-1 \
  --secret-file ./aws-credentials

# MinIO (self-hosted S3-compatible)
velero install \
  --provider aws \
  --plugins velero/velero-plugin-for-aws:v1.9.0 \
  --bucket velero \
  --backup-location-config region=minio,s3ForcePathStyle=true,s3Url=http://minio.velero:9000 \
  --secret-file ./minio-credentials \
  --use-volume-snapshots=false

# Verify
velero version
kubectl get pods -n velero
```

### Create Backups

```bash
# Backup entire cluster
velero backup create full-backup

# Backup specific namespaces
velero backup create prod-backup --include-namespaces production,monitoring

# Backup by label selector
velero backup create app-backup --selector app=my-app

# Backup excluding resources
velero backup create clean-backup \
  --exclude-resources events,events.events.k8s.io \
  --exclude-namespaces kube-system

# Backup with TTL (auto-expire)
velero backup create temp-backup --ttl 72h

# Check backup status
velero backup describe prod-backup
velero backup logs prod-backup

# List all backups
velero backup get
```

### Schedule Backups

```bash
# Every hour
velero schedule create hourly \
  --schedule="0 * * * *" \
  --include-namespaces production \
  --ttl 168h                    # 7 day retention

# Daily at 2 AM
velero schedule create daily \
  --schedule="0 2 * * *" \
  --ttl 720h                    # 30 day retention

# Weekly full backup
velero schedule create weekly \
  --schedule="0 3 * * 0" \
  --ttl 2160h                   # 90 day retention

# List schedules
velero schedule get

# Pause/unpause schedule
velero schedule pause daily
velero schedule unpause daily
```

### Restore

```bash
# Restore from backup
velero restore create --from-backup prod-backup

# Restore to different namespace
velero restore create --from-backup prod-backup \
  --namespace-mappings production:staging

# Restore specific resources only
velero restore create --from-backup prod-backup \
  --include-resources deployments,services,configmaps

# Restore excluding specific resources
velero restore create --from-backup prod-backup \
  --exclude-resources persistentvolumeclaims

# Check restore status
velero restore describe <restore-name>
velero restore logs <restore-name>
```

### Persistent Volume Backup

```yaml
# Option 1: Volume Snapshots (cloud provider)
# Automatic if snapshot-location configured
velero backup create pv-backup --include-namespaces production
# PVs are snapshotted via cloud API (EBS, GCE PD, Azure Disk)

# Option 2: Restic/Kopia (file-level backup)
# For any storage — NFS, local, hostPath
velero install --use-restic   # or --use-node-agent for kopia

# Annotate pods to back up volumes
kubectl annotate pod my-pod \
  backup.velero.io/backup-volumes=data-volume

# Or opt-out specific volumes
kubectl annotate pod my-pod \
  backup.velero.io/backup-volumes-excludes=cache-volume
```

```yaml
# Pod annotation for volume backup
apiVersion: v1
kind: Pod
metadata:
  name: db
  annotations:
    backup.velero.io/backup-volumes: data    # Volume name to back up
spec:
  containers:
  - name: postgres
    image: postgres:16
    volumeMounts:
    - name: data
      mountPath: /var/lib/postgresql/data
  volumes:
  - name: data
    persistentVolumeClaim:
      claimName: db-pvc
```

### Cluster Migration

```bash
# Source cluster: create backup
velero backup create migration --include-namespaces production

# Target cluster: install Velero with SAME storage bucket
velero install \
  --provider aws \
  --bucket my-k8s-backups \
  --backup-location-config region=us-east-1 \
  --secret-file ./aws-credentials

# Target cluster: restore
velero restore create --from-backup migration

# Verify
kubectl get all -n production
```

### Backup Location Management

```bash
# List backup locations
velero backup-location get

# Add additional location
velero backup-location create secondary \
  --provider aws \
  --bucket secondary-backups \
  --config region=eu-west-1

# Backup to specific location
velero backup create eu-backup \
  --storage-location secondary

# Check location availability
velero backup-location get
# NAME      PROVIDER   BUCKET              PHASE       LAST VALIDATED
# default   aws        my-k8s-backups      Available   2026-05-02
# secondary aws        secondary-backups   Available   2026-05-02
```

## Common Issues

**Backup stuck in "InProgress"**

Velero pod might have crashed. Check: `kubectl logs -n velero deployment/velero`. Common: credentials expired or bucket permissions.

**Restore doesn't create PVs**

Using cloud snapshots but snapshot-location not configured. Or volumes need Restic/Kopia annotations.

**Restored resources conflict with existing**

Velero skips existing resources by default. Use `--existing-resource-policy=update` to overwrite.

## Best Practices

- **Schedule backups with retention** — hourly/daily/weekly with decreasing TTL
- **Test restores regularly** — backup is useless if restore doesn't work
- **Use Restic/Kopia for non-cloud PVs** — NFS, local storage
- **Annotate pods with volumes** — explicitly mark which volumes to back up
- **Separate backup bucket from cluster** — different region or account

## Key Takeaways

- Velero backs up K8s resources AND persistent volumes (etcd backup doesn't)
- Supports cloud snapshots (EBS, GCE PD) and file-level backup (Restic/Kopia)
- Schedule backups with `velero schedule` and retention TTL
- Restore to same cluster or migrate to different cluster
- Annotate pods to explicitly include/exclude volume backup
