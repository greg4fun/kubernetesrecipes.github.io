---
title: "How to Backup and Restore with Velero"
description: "Implement Kubernetes backup and disaster recovery with Velero. Backup namespaces, restore clusters, and migrate workloads between environments."
category: "storage"
difficulty: "intermediate"
publishDate: "2026-01-22"
tags: ["velero", "backup", "restore", "disaster-recovery", "migration"]
author: "Luca Berton"
---

> 💡 **Quick Answer:** Install Velero with cloud provider plugin, create backups with `velero backup create my-backup`. Restore with `velero restore create --from-backup my-backup`. Schedule recurring backups with `velero schedule create`. Backs up Kubernetes resources + persistent volume snapshots.
>
> **Key commands:** `velero backup create`, `velero restore create`, `velero schedule create daily --schedule="0 2 * * *"`.
>
> **Gotcha:** Test restores regularly! Velero backs up resource definitions—ensure your storage class supports snapshots for PV data.

# How to Backup and Restore with Velero

Velero backs up Kubernetes resources and persistent volumes. Use it for disaster recovery, cluster migration, and development environment replication.

## Install Velero CLI

```bash
# macOS
brew install velero

# Linux
wget https://github.com/vmware-tanzu/velero/releases/download/v1.12.0/velero-v1.12.0-linux-amd64.tar.gz
tar -xvf velero-v1.12.0-linux-amd64.tar.gz
sudo mv velero-v1.12.0-linux-amd64/velero /usr/local/bin/

# Verify
velero version
```

## Install Velero Server (AWS)

```bash
velero install \
  --provider aws \
  --plugins velero/velero-plugin-for-aws:v1.8.0 \
  --bucket my-velero-bucket \
  --backup-location-config region=us-east-1 \
  --snapshot-location-config region=us-east-1 \
  --secret-file ./credentials-velero
```

## Install Velero Server (GCP)

```bash
velero install \
  --provider gcp \
  --plugins velero/velero-plugin-for-gcp:v1.8.0 \
  --bucket my-velero-bucket \
  --secret-file ./credentials-velero
```

## Install Velero Server (Azure)

```bash
velero install \
  --provider azure \
  --plugins velero/velero-plugin-for-microsoft-azure:v1.8.0 \
  --bucket my-velero-container \
  --backup-location-config resourceGroup=my-rg,storageAccount=myvelero \
  --snapshot-location-config resourceGroup=my-rg \
  --secret-file ./credentials-velero
```

## Create Backup

```bash
# Backup entire cluster
velero backup create full-backup

# Backup specific namespace
velero backup create prod-backup --include-namespaces production

# Backup multiple namespaces
velero backup create app-backup --include-namespaces app1,app2,app3

# Backup by label
velero backup create labeled-backup --selector app=my-app

# Backup excluding resources
velero backup create slim-backup --exclude-resources secrets,configmaps

# Backup with TTL
velero backup create daily-backup --ttl 720h  # 30 days
```

## Describe Backup

```bash
# List backups
velero backup get

# Describe backup
velero backup describe full-backup

# View backup logs
velero backup logs full-backup

# Check backup details
velero backup describe full-backup --details
```

## Restore from Backup

```bash
# Full restore
velero restore create --from-backup full-backup

# Restore to different namespace
velero restore create --from-backup prod-backup \
  --namespace-mappings production:staging

# Restore specific resources
velero restore create --from-backup full-backup \
  --include-resources deployments,services

# Restore excluding namespaces
velero restore create --from-backup full-backup \
  --exclude-namespaces kube-system

# Restore with name
velero restore create my-restore --from-backup full-backup
```

## Schedule Backups

```bash
# Daily backup at 2 AM
velero schedule create daily-backup \
  --schedule="0 2 * * *" \
  --include-namespaces production

# Weekly backup
velero schedule create weekly-backup \
  --schedule="0 3 * * 0" \
  --ttl 2160h  # 90 days

# Hourly backup of critical namespace
velero schedule create hourly-critical \
  --schedule="0 * * * *" \
  --include-namespaces critical \
  --ttl 168h  # 7 days
```

## Manage Schedules

```bash
# List schedules
velero schedule get

# Describe schedule
velero schedule describe daily-backup

# Pause schedule
velero schedule pause daily-backup

# Unpause schedule
velero schedule unpause daily-backup

# Delete schedule
velero schedule delete daily-backup
```

## Backup Hooks

```yaml
# deployment-with-hooks.yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: mysql
  annotations:
    # Pre-backup hook (freeze writes)
    pre.hook.backup.velero.io/command: '["/bin/sh", "-c", "mysql -u root -e \"FLUSH TABLES WITH READ LOCK\""]'
    pre.hook.backup.velero.io/timeout: 30s
    # Post-backup hook (unfreeze)
    post.hook.backup.velero.io/command: '["/bin/sh", "-c", "mysql -u root -e \"UNLOCK TABLES\""]'
```

## Monitor Velero

```bash
# Check velero pods
kubectl get pods -n velero

# View velero logs
kubectl logs deployment/velero -n velero

# Check backup locations
velero backup-location get

# Check snapshot locations
velero snapshot-location get
```

## Disaster Recovery Workflow

```bash
# 1. Ensure regular scheduled backups
velero schedule get

# 2. If disaster occurs, install Velero on new cluster
velero install --provider aws ...

# 3. Verify backup location accessible
velero backup-location get

# 4. List available backups
velero backup get

# 5. Restore
velero restore create --from-backup latest-daily-backup

# 6. Verify restoration
kubectl get all -A
velero restore describe <restore-name>
```

## Migrate Cluster

```bash
# Source cluster: Create backup
velero backup create migration-backup --include-namespaces app1,app2

# Wait for completion
velero backup describe migration-backup

# Target cluster: Install Velero with same storage
velero install --provider aws --bucket same-bucket ...

# Target cluster: Verify backup visible
velero backup get

# Target cluster: Restore
velero restore create --from-backup migration-backup
```

## Best Practices

1. **Test restores regularly** - backups are useless if they can't restore
2. **Use schedules** - automate backup creation
3. **Set TTL** - prevent storage costs from growing indefinitely
4. **Backup before upgrades** - cluster upgrades, major deployments
5. **Include PV snapshots** - resource backups alone don't include data
6. **Use backup hooks** - ensure data consistency (flush caches, etc.)
7. **Monitor backup status** - alert on failures
