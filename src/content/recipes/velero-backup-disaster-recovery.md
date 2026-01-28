---
title: "Kubernetes Backup and Disaster Recovery with Velero"
description: "Implement comprehensive backup and disaster recovery strategies for Kubernetes clusters using Velero to protect workloads, configurations, and persistent data"
category: "storage"
difficulty: "intermediate"
timeToComplete: "45 minutes"
kubernetesVersion: "1.28+"
prerequisites:
  - "Understanding of PersistentVolumes and StorageClasses"
  - "Access to S3-compatible object storage"
  - "Knowledge of Kubernetes resource types"
relatedRecipes:
  - "etcd-backup-restore"
  - "volume-snapshots"
  - "persistent-volumes-claims"
tags:
  - velero
  - backup
  - disaster-recovery
  - migration
  - business-continuity
publishDate: 2026-01-28
author: "kubernetes-recipes"
---

## Problem

You need a comprehensive backup and disaster recovery solution for Kubernetes clusters to protect against data loss, cluster failures, and facilitate migration between environments.

## Solution

Use Velero (formerly Heptio Ark) to create backups of cluster resources and persistent volumes, enabling disaster recovery, cluster migration, and point-in-time restores.

### Architecture

```
┌─────────────────────────────────────────────────────┐
│         Kubernetes Cluster (Source)                  │
│  ┌─────────────┐  ┌─────────────┐                  │
│  │  Workloads  │  │  Persistent │                  │
│  │  Resources  │  │   Volumes   │                  │
│  └──────┬──────┘  └──────┬──────┘                  │
│         │                │                          │
│         └────────┬───────┘                          │
│                  ▼                                   │
│         ┌─────────────────┐                         │
│         │  Velero Server  │                         │
│         └────────┬────────┘                         │
└──────────────────┼──────────────────────────────────┘
                   │
                   ▼
┌─────────────────────────────────────────────────────┐
│          Object Storage (S3/MinIO/GCS)              │
│  ┌──────────────────────────────────────────┐      │
│  │  Backups (YAML manifests, metadata)      │      │
│  │  Volume Snapshots (references)           │      │
│  └──────────────────────────────────────────┘      │
└─────────────────────┬───────────────────────────────┘
                      │ Restore
                      ▼
┌─────────────────────────────────────────────────────┐
│         Kubernetes Cluster (Target)                  │
│  ┌─────────────┐  ┌─────────────┐                  │
│  │  Restored   │  │  Restored   │                  │
│  │  Workloads  │  │   Volumes   │                  │
│  └─────────────┘  └─────────────┘                  │
└─────────────────────────────────────────────────────┘
```

### Step 1: Install Velero CLI

Install the Velero command-line tool:

```bash
# macOS
brew install velero

# Linux
wget https://github.com/vmware-tanzu/velero/releases/download/v1.12.0/velero-v1.12.0-linux-amd64.tar.gz
tar -xvf velero-v1.12.0-linux-amd64.tar.gz
sudo mv velero-v1.12.0-linux-amd64/velero /usr/local/bin/

# Verify installation
velero version --client-only
```

### Step 2: Configure AWS S3 Backend

Create S3 bucket and IAM credentials for AWS:

```bash
# Create S3 bucket
aws s3 mb s3://kubernetes-backups --region us-east-1

# Create IAM policy
cat > velero-policy.json <<EOF
{
    "Version": "2012-10-17",
    "Statement": [
        {
            "Effect": "Allow",
            "Action": [
                "ec2:DescribeVolumes",
                "ec2:DescribeSnapshots",
                "ec2:CreateTags",
                "ec2:CreateVolume",
                "ec2:CreateSnapshot",
                "ec2:DeleteSnapshot"
            ],
            "Resource": "*"
        },
        {
            "Effect": "Allow",
            "Action": [
                "s3:GetObject",
                "s3:DeleteObject",
                "s3:PutObject",
                "s3:AbortMultipartUpload",
                "s3:ListMultipartUploadParts"
            ],
            "Resource": "arn:aws:s3:::kubernetes-backups/*"
        },
        {
            "Effect": "Allow",
            "Action": "s3:ListBucket",
            "Resource": "arn:aws:s3:::kubernetes-backups"
        }
    ]
}
EOF

# Create IAM user
aws iam create-user --user-name velero
aws iam put-user-policy \
  --user-name velero \
  --policy-name velero \
  --policy-document file://velero-policy.json

# Create access key
aws iam create-access-key --user-name velero

# Create credentials file
cat > credentials-velero <<EOF
[default]
aws_access_key_id=YOUR_ACCESS_KEY_ID
aws_secret_access_key=YOUR_SECRET_ACCESS_KEY
EOF
```

### Step 3: Install Velero in Cluster

Deploy Velero server using CLI:

```bash
# Install with AWS provider
velero install \
  --provider aws \
  --plugins velero/velero-plugin-for-aws:v1.8.0 \
  --bucket kubernetes-backups \
  --backup-location-config region=us-east-1 \
  --snapshot-location-config region=us-east-1 \
  --secret-file ./credentials-velero \
  --use-volume-snapshots=true \
  --use-node-agent

# Verify installation
kubectl get pods -n velero
kubectl get crds | grep velero
```

### Step 4: Create Namespace Backup

Backup specific namespace:

```yaml
apiVersion: velero.io/v1
kind: Backup
metadata:
  name: production-backup
  namespace: velero
spec:
  includedNamespaces:
  - production
  excludedResources:
  - events
  - events.events.k8s.io
  ttl: 720h0m0s  # 30 days
  storageLocation: default
  volumeSnapshotLocations:
  - default
  snapshotVolumes: true
  includeClusterResources: false
```

Create backup using CLI:

```bash
# Backup entire namespace
velero backup create production-backup \
  --include-namespaces production \
  --wait

# Backup with label selector
velero backup create app-backup \
  --selector app=my-app \
  --wait

# Backup excluding certain resources
velero backup create config-backup \
  --include-namespaces production \
  --exclude-resources pods,replicasets \
  --wait
```

### Step 5: Schedule Automated Backups

Create backup schedule:

```yaml
apiVersion: velero.io/v1
kind: Schedule
metadata:
  name: daily-production-backup
  namespace: velero
spec:
  schedule: "0 1 * * *"  # Daily at 1 AM
  template:
    includedNamespaces:
    - production
    - staging
    ttl: 720h0m0s  # 30 days
    storageLocation: default
    snapshotVolumes: true
    includeClusterResources: false
```

Using CLI:

```bash
# Daily backup at 1 AM
velero schedule create daily-backup \
  --schedule="0 1 * * *" \
  --include-namespaces production,staging \
  --ttl 720h

# Weekly full cluster backup
velero schedule create weekly-full-backup \
  --schedule="0 0 * * 0" \
  --ttl 2160h \
  --include-cluster-resources=true

# Hourly backup of critical namespace
velero schedule create hourly-critical \
  --schedule="@every 1h" \
  --include-namespaces critical-apps \
  --ttl 168h
```

### Step 6: Restore from Backup

Restore backup to original namespace:

```bash
# List available backups
velero backup get

# Restore entire backup
velero restore create --from-backup production-backup

# Restore to different namespace
velero restore create --from-backup production-backup \
  --namespace-mappings production:production-restore

# Restore with label selector
velero restore create --from-backup production-backup \
  --selector app=database \
  --wait

# Restore excluding certain resources
velero restore create --from-backup production-backup \
  --exclude-resources services,ingresses
```

Using YAML:

```yaml
apiVersion: velero.io/v1
kind: Restore
metadata:
  name: production-restore
  namespace: velero
spec:
  backupName: production-backup
  includedNamespaces:
  - production
  excludedResources:
  - nodes
  - events
  restorePVs: true
  preserveNodePorts: true
  namespaceMapping:
    production: production-dr
```

### Step 7: Cluster Migration

Migrate workloads between clusters:

```bash
# In source cluster: Create backup
velero backup create migration-backup \
  --include-cluster-resources=true \
  --wait

# Configure target cluster with same S3 backend
velero install \
  --provider aws \
  --plugins velero/velero-plugin-for-aws:v1.8.0 \
  --bucket kubernetes-backups \
  --backup-location-config region=us-east-1 \
  --secret-file ./credentials-velero

# In target cluster: Restore backup
velero restore create migration-restore \
  --from-backup migration-backup \
  --wait

# Verify restoration
kubectl get all --all-namespaces
```

### Step 8: Configure Backup Hooks

Run pre/post backup commands in pods:

```yaml
apiVersion: v1
kind: Pod
metadata:
  name: database
  namespace: production
  annotations:
    # Backup hooks
    pre.hook.backup.velero.io/container: database
    pre.hook.backup.velero.io/command: '["/bin/bash", "-c", "pg_dump -U postgres mydb > /tmp/backup.sql"]'
    post.hook.backup.velero.io/container: database
    post.hook.backup.velero.io/command: '["/bin/bash", "-c", "rm /tmp/backup.sql"]'
spec:
  containers:
  - name: database
    image: postgres:15
```

### Step 9: Monitor Backup Status

```bash
# Check backup status
velero backup describe production-backup

# View backup logs
velero backup logs production-backup

# List all backups
velero backup get

# Check backup expiration
velero backup get --show-labels

# Monitor backup progress
watch velero backup get
```

## Verification

Verify backups are created:

```bash
# List backups
velero backup get

# Check backup details
velero backup describe production-backup --details

# Verify backup in S3
aws s3 ls s3://kubernetes-backups/backups/

# Check backup status
kubectl get backups -n velero
kubectl describe backup production-backup -n velero
```

Test restore functionality:

```bash
# Create test namespace
kubectl create namespace restore-test

# Restore to test namespace
velero restore create test-restore \
  --from-backup production-backup \
  --namespace-mappings production:restore-test

# Check restore status
velero restore describe test-restore

# Verify resources
kubectl get all -n restore-test

# Cleanup
kubectl delete namespace restore-test
```

Monitor Velero components:

```bash
# Check Velero pods
kubectl get pods -n velero

# View Velero logs
kubectl logs -n velero deployment/velero

# Check node-agent (for file-level backups)
kubectl logs -n velero daemonset/node-agent

# View backup locations
velero backup-location get

# Check volume snapshot locations
velero snapshot-location get
```

## Advanced Configuration

Configure multiple backup locations:

```bash
# Add secondary backup location
velero backup-location create secondary \
  --provider aws \
  --bucket kubernetes-backups-dr \
  --config region=us-west-2 \
  --access-mode ReadWrite

# Create backup to specific location
velero backup create dr-backup \
  --storage-location secondary \
  --include-namespaces production
```

Enable file-level backup for volumes:

```yaml
apiVersion: v1
kind: Pod
metadata:
  name: app-with-volumes
  namespace: production
  annotations:
    backup.velero.io/backup-volumes: data,config
spec:
  containers:
  - name: app
    image: myapp:v1.0
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
    configMap:
      name: app-config
```

## Best Practices

1. **Schedule regular backups** for critical namespaces
2. **Test restore procedures** regularly
3. **Set appropriate TTL** for backup retention
4. **Use backup hooks** for application-consistent backups
5. **Monitor backup completion** and failures
6. **Store backups offsite** for disaster recovery
7. **Document restore procedures** for operations team
8. **Use namespace mappings** for blue/green deployments
9. **Exclude unnecessary resources** to reduce backup size
10. **Implement backup verification** with automated tests

## Common Issues

**Backup stuck in InProgress:**
- Check Velero pod logs
- Verify object storage connectivity
- Check for large PVs timing out

**Restore failures:**
- Verify target cluster has required StorageClasses
- Check RBAC permissions
- Ensure namespace exists if not using namespaceMapping

**Volume snapshots not working:**
- Verify CSI driver supports snapshots
- Check VolumeSnapshotClass exists
- Ensure proper IAM permissions

## Related Resources

- [Velero Documentation](https://velero.io/docs/)
- [Backup and Restore Workflows](https://velero.io/docs/main/backup-reference/)
- [Disaster Recovery](https://velero.io/docs/main/disaster-case/)
- [Migration Guide](https://velero.io/docs/main/migration-case/)

---

## 📘 Go Further with Kubernetes Recipes

**Love this recipe? There's so much more!** This is just one of **100+ hands-on recipes** in our comprehensive **[Kubernetes Recipes book](/book)**.

Inside the book, you'll master:
- ✅ Production-ready deployment strategies
- ✅ Advanced networking and security patterns  
- ✅ Observability, monitoring, and troubleshooting
- ✅ Real-world best practices from industry experts

> *"The practical, recipe-based approach made complex Kubernetes concepts finally click for me."*

**👉 [Get Your Copy Now](/book)** — Start building production-grade Kubernetes skills today!
