---
title: "How to Backup and Restore with Velero"
description: "Implement disaster recovery for Kubernetes using Velero. Learn to backup clusters, restore applications, and migrate workloads between clusters."
category: "storage"
difficulty: "intermediate"
timeToComplete: "35 minutes"
kubernetesVersion: "1.28+"
prerequisites:
  - "A running Kubernetes cluster"
  - "kubectl with admin privileges"
  - "Object storage (S3, GCS, or Azure Blob)"
relatedRecipes:
  - "statefulset-mysql"
  - "pvc-storageclass-examples"
tags:
  - velero
  - backup
  - disaster-recovery
  - restore
  - migration
publishDate: "2026-01-21"
author: "Luca Berton"
---

## The Problem

You need to backup your Kubernetes cluster resources and persistent volumes for disaster recovery or migration purposes.

## The Solution

Use Velero (formerly Heptio Ark) to backup and restore cluster resources and persistent volumes.

## How Velero Works

1. **Backup**: Captures cluster state and volume snapshots
2. **Storage**: Stores backups in object storage (S3, GCS, Azure)
3. **Restore**: Recreates resources from backup
4. **Schedule**: Automated periodic backups

## Step 1: Install Velero CLI

```bash
# macOS
brew install velero

# Linux
curl -LO https://github.com/vmware-tanzu/velero/releases/download/v1.12.0/velero-v1.12.0-linux-amd64.tar.gz
tar -xvf velero-v1.12.0-linux-amd64.tar.gz
sudo mv velero-v1.12.0-linux-amd64/velero /usr/local/bin/

# Verify
velero version
```

## Step 2: Set Up Storage

### AWS S3

Create credentials file `credentials-velero`:
```
[default]
aws_access_key_id=YOUR_ACCESS_KEY
aws_secret_access_key=YOUR_SECRET_KEY
```

Install Velero:
```bash
velero install \
  --provider aws \
  --plugins velero/velero-plugin-for-aws:v1.8.0 \
  --bucket my-velero-bucket \
  --backup-location-config region=us-east-1 \
  --snapshot-location-config region=us-east-1 \
  --secret-file ./credentials-velero
```

### Google Cloud Storage

```bash
# Create service account
gcloud iam service-accounts create velero \
  --display-name "Velero"

# Grant permissions
BUCKET=my-velero-bucket
PROJECT_ID=$(gcloud config get-value project)

gsutil mb gs://$BUCKET

gcloud iam service-accounts keys create credentials-velero \
  --iam-account velero@$PROJECT_ID.iam.gserviceaccount.com

# Install Velero
velero install \
  --provider gcp \
  --plugins velero/velero-plugin-for-gcp:v1.8.0 \
  --bucket $BUCKET \
  --secret-file ./credentials-velero
```

### Azure Blob Storage

```bash
AZURE_BACKUP_RESOURCE_GROUP=velero-backups
AZURE_STORAGE_ACCOUNT_ID="velero$(uuidgen | cut -d '-' -f5 | tr '[A-Z]' '[a-z]')"
BLOB_CONTAINER=velero

az storage account create \
  --name $AZURE_STORAGE_ACCOUNT_ID \
  --resource-group $AZURE_BACKUP_RESOURCE_GROUP \
  --sku Standard_GRS \
  --encryption-services blob \
  --https-only true

velero install \
  --provider azure \
  --plugins velero/velero-plugin-for-microsoft-azure:v1.8.0 \
  --bucket $BLOB_CONTAINER \
  --secret-file ./credentials-velero
```

## Step 3: Create Backups

### Full Cluster Backup

```bash
velero backup create full-backup
```

### Namespace Backup

```bash
velero backup create production-backup \
  --include-namespaces production
```

### Multiple Namespaces

```bash
velero backup create app-backup \
  --include-namespaces production,staging
```

### Exclude Namespaces

```bash
velero backup create backup-without-system \
  --exclude-namespaces kube-system,kube-public
```

### Label-Based Backup

```bash
velero backup create backend-backup \
  --selector app=backend
```

### Backup with TTL

```bash
velero backup create daily-backup \
  --ttl 720h  # 30 days
```

## Step 4: Scheduled Backups

### Create Schedule

```bash
# Daily backup at 2 AM
velero schedule create daily-backup \
  --schedule="0 2 * * *" \
  --ttl 168h  # Keep for 7 days

# Weekly backup on Sunday
velero schedule create weekly-backup \
  --schedule="0 0 * * 0" \
  --ttl 720h  # Keep for 30 days
```

### Schedule with Namespace Selection

```bash
velero schedule create production-daily \
  --schedule="0 1 * * *" \
  --include-namespaces production \
  --ttl 336h  # 14 days
```

### List Schedules

```bash
velero schedule get
```

## Step 5: Restore from Backup

### Full Restore

```bash
velero restore create --from-backup full-backup
```

### Restore Specific Namespace

```bash
velero restore create --from-backup full-backup \
  --include-namespaces production
```

### Restore to Different Namespace

```bash
velero restore create --from-backup production-backup \
  --namespace-mappings production:production-restored
```

### Restore Specific Resources

```bash
velero restore create --from-backup full-backup \
  --include-resources deployments,services
```

### Exclude Resources from Restore

```bash
velero restore create --from-backup full-backup \
  --exclude-resources secrets
```

## Backing Up Persistent Volumes

### Using Restic (File-Level Backup)

Enable Restic during installation:

```bash
velero install \
  --provider aws \
  --plugins velero/velero-plugin-for-aws:v1.8.0 \
  --bucket my-velero-bucket \
  --backup-location-config region=us-east-1 \
  --use-node-agent \
  --default-volumes-to-fs-backup
```

Annotate pods for volume backup:

```yaml
apiVersion: v1
kind: Pod
metadata:
  name: myapp
  annotations:
    backup.velero.io/backup-volumes: data-volume
spec:
  containers:
  - name: myapp
    volumeMounts:
    - name: data-volume
      mountPath: /data
  volumes:
  - name: data-volume
    persistentVolumeClaim:
      claimName: myapp-data
```

### Using CSI Snapshots

```yaml
apiVersion: snapshot.storage.k8s.io/v1
kind: VolumeSnapshotClass
metadata:
  name: velero-snapshot-class
  labels:
    velero.io/csi-volumesnapshot-class: "true"
driver: ebs.csi.aws.com
deletionPolicy: Retain
```

## Monitoring Backups

### Check Backup Status

```bash
velero backup describe full-backup
velero backup logs full-backup
```

### List All Backups

```bash
velero backup get
```

### Check Restore Status

```bash
velero restore describe restore-name
velero restore logs restore-name
```

## Disaster Recovery Workflow

### 1. Regular Backups

```bash
# Set up scheduled backups
velero schedule create disaster-recovery \
  --schedule="0 */6 * * *" \
  --ttl 720h
```

### 2. Test Restores Regularly

```bash
# Create test restore
velero restore create dr-test \
  --from-backup disaster-recovery-20240115120000 \
  --namespace-mappings production:dr-test

# Verify restored resources
kubectl get all -n dr-test

# Clean up test
kubectl delete namespace dr-test
```

### 3. Document RTO/RPO

- **RPO** (Recovery Point Objective): Maximum data loss = backup frequency
- **RTO** (Recovery Time Objective): Time to restore from backup

## Migration Between Clusters

### Source Cluster

```bash
# Create backup
velero backup create migration-backup \
  --include-namespaces myapp
```

### Target Cluster

```bash
# Install Velero with same storage backend
velero install \
  --provider aws \
  --plugins velero/velero-plugin-for-aws:v1.8.0 \
  --bucket my-velero-bucket \
  --backup-location-config region=us-east-1 \
  --secret-file ./credentials-velero

# Restore from backup
velero restore create migration-restore \
  --from-backup migration-backup
```

## Pre-Backup Hooks

Execute commands before backup:

```yaml
apiVersion: v1
kind: Pod
metadata:
  name: mysql
  annotations:
    pre.hook.backup.velero.io/container: mysql
    pre.hook.backup.velero.io/command: '["/bin/sh", "-c", "mysqldump -u root mydb > /backup/dump.sql"]'
    post.hook.backup.velero.io/container: mysql
    post.hook.backup.velero.io/command: '["/bin/sh", "-c", "rm /backup/dump.sql"]'
```

## Troubleshooting

### Backup Stuck

```bash
kubectl logs -n velero deployment/velero
```

### Volume Backup Failures

```bash
kubectl logs -n velero daemonset/node-agent
```

### Delete Failed Backup

```bash
velero backup delete failed-backup
```

## Best Practices

1. **Test restores regularly** - Don't assume backups work
2. **Use appropriate TTLs** - Balance storage costs and recovery needs
3. **Backup before major changes** - Create ad-hoc backups before upgrades
4. **Monitor backup status** - Set up alerts for failed backups
5. **Document recovery procedures** - Ensure team knows how to restore

## Key Takeaways

- Velero provides comprehensive Kubernetes backup/restore
- Use schedules for automated backups
- Test restores regularly to validate backups
- Enable volume backups for stateful applications
- Use hooks for application-consistent backups

---

## 📘 Go Further with Kubernetes Recipes

**Love this recipe? There's so much more!** This is just one of **100+ hands-on recipes** in our comprehensive **[Kubernetes Recipes book](https://amzn.to/3DzC8QA)**.

Inside the book, you'll master:
- ✅ Production-ready deployment strategies
- ✅ Advanced networking and security patterns  
- ✅ Observability, monitoring, and troubleshooting
- ✅ Real-world best practices from industry experts

> *"The practical, recipe-based approach made complex Kubernetes concepts finally click for me."*

**👉 [Get Your Copy Now](https://amzn.to/3DzC8QA)** — Start building production-grade Kubernetes skills today!
