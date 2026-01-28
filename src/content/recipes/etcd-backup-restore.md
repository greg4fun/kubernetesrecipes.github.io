---
title: "How to Backup and Restore etcd"
description: "Protect your Kubernetes cluster with etcd backup strategies. Learn to create snapshots, automate backups, and restore etcd data for disaster recovery."
category: "storage"
difficulty: "advanced"
timeToComplete: "30 minutes"
kubernetesVersion: "1.28+"
prerequisites:
  - "Access to Kubernetes control plane nodes"
  - "SSH access to master nodes (for self-managed clusters)"
  - "etcdctl CLI tool installed"
  - "Root or sudo access on control plane nodes"
relatedRecipes:
  - "velero-backup-restore"
  - "statefulset-management"
  - "secrets-management-best-practices"
tags:
  - etcd
  - backup
  - restore
  - disaster-recovery
  - cluster-management
  - high-availability
publishDate: "2026-01-28"
author: "Luca Berton"
---

## The Problem

Your Kubernetes cluster's entire state is stored in etcd. Without proper backups, a corrupted or lost etcd database means losing all cluster configuration, secrets, and resource definitions.

## The Solution

Implement a robust etcd backup strategy with regular snapshots, secure storage, and tested restore procedures.

## etcd Architecture Overview

```
Kubernetes etcd Data Flow:

┌─────────────────────────────────────────────────────────────────┐
│                      KUBERNETES CLUSTER                          │
│                                                                  │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │                   CONTROL PLANE                           │   │
│  │                                                           │   │
│  │   ┌──────────────┐    ┌──────────────┐                   │   │
│  │   │  API Server  │───►│     etcd     │                   │   │
│  │   └──────────────┘    │              │                   │   │
│  │          │            │  ┌────────┐  │                   │   │
│  │          ▼            │  │ Data:  │  │                   │   │
│  │   ┌──────────────┐    │  │ - Pods │  │                   │   │
│  │   │ Controllers  │    │  │ - Svcs │  │                   │   │
│  │   └──────────────┘    │  │ - Cfg  │  │                   │   │
│  │          │            │  │ - Secrets│ │                   │   │
│  │          ▼            │  └────────┘  │                   │   │
│  │   ┌──────────────┐    └──────────────┘                   │   │
│  │   │  Scheduler   │           │                            │   │
│  │   └──────────────┘           │                            │   │
│  │                              ▼                            │   │
│  │                     ┌──────────────┐                      │   │
│  │                     │  SNAPSHOT    │                      │   │
│  │                     │  (Backup)    │                      │   │
│  │                     └──────────────┘                      │   │
│  └──────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
```

## Step 1: Install etcdctl

### On Control Plane Node

```bash
# Download etcdctl matching your etcd version
ETCD_VERSION=v3.5.11
wget https://github.com/etcd-io/etcd/releases/download/${ETCD_VERSION}/etcd-${ETCD_VERSION}-linux-amd64.tar.gz
tar xzf etcd-${ETCD_VERSION}-linux-amd64.tar.gz
sudo mv etcd-${ETCD_VERSION}-linux-amd64/etcdctl /usr/local/bin/

# Verify installation
etcdctl version
```

### Find etcd Connection Details

```bash
# Get etcd pod info
kubectl get pods -n kube-system -l component=etcd

# View etcd configuration
kubectl describe pod etcd-controlplane -n kube-system | grep -A 20 Command

# Common paths (kubeadm clusters)
# Certificates: /etc/kubernetes/pki/etcd/
# Data directory: /var/lib/etcd
```

## Step 2: Create etcd Snapshot

### Manual Snapshot

```bash
# Set environment variables
export ETCDCTL_API=3
export ETCDCTL_ENDPOINTS=https://127.0.0.1:2379
export ETCDCTL_CACERT=/etc/kubernetes/pki/etcd/ca.crt
export ETCDCTL_CERT=/etc/kubernetes/pki/etcd/server.crt
export ETCDCTL_KEY=/etc/kubernetes/pki/etcd/server.key

# Create snapshot
etcdctl snapshot save /backup/etcd-snapshot-$(date +%Y%m%d-%H%M%S).db

# Verify snapshot
etcdctl snapshot status /backup/etcd-snapshot-20260128-120000.db --write-out=table
```

### One-liner Backup Command

```bash
ETCDCTL_API=3 etcdctl snapshot save /backup/etcd-snapshot-$(date +%Y%m%d-%H%M%S).db \
  --endpoints=https://127.0.0.1:2379 \
  --cacert=/etc/kubernetes/pki/etcd/ca.crt \
  --cert=/etc/kubernetes/pki/etcd/server.crt \
  --key=/etc/kubernetes/pki/etcd/server.key
```

## Step 3: Automate Backups with CronJob

### Backup Script

```bash
#!/bin/bash
# /usr/local/bin/etcd-backup.sh

set -e

BACKUP_DIR="/backup/etcd"
RETENTION_DAYS=7
TIMESTAMP=$(date +%Y%m%d-%H%M%S)
SNAPSHOT_NAME="etcd-snapshot-${TIMESTAMP}.db"

# Create backup directory
mkdir -p ${BACKUP_DIR}

# Create snapshot
ETCDCTL_API=3 etcdctl snapshot save ${BACKUP_DIR}/${SNAPSHOT_NAME} \
  --endpoints=https://127.0.0.1:2379 \
  --cacert=/etc/kubernetes/pki/etcd/ca.crt \
  --cert=/etc/kubernetes/pki/etcd/server.crt \
  --key=/etc/kubernetes/pki/etcd/server.key

# Verify snapshot
ETCDCTL_API=3 etcdctl snapshot status ${BACKUP_DIR}/${SNAPSHOT_NAME}

# Compress snapshot
gzip ${BACKUP_DIR}/${SNAPSHOT_NAME}

# Clean up old backups
find ${BACKUP_DIR} -name "etcd-snapshot-*.db.gz" -mtime +${RETENTION_DAYS} -delete

echo "Backup completed: ${BACKUP_DIR}/${SNAPSHOT_NAME}.gz"
```

### Cron Schedule

```bash
# Add to crontab
sudo crontab -e

# Backup every 6 hours
0 */6 * * * /usr/local/bin/etcd-backup.sh >> /var/log/etcd-backup.log 2>&1
```

### Kubernetes CronJob (Alternative)

```yaml
apiVersion: batch/v1
kind: CronJob
metadata:
  name: etcd-backup
  namespace: kube-system
spec:
  schedule: "0 */6 * * *"  # Every 6 hours
  concurrencyPolicy: Forbid
  successfulJobsHistoryLimit: 3
  failedJobsHistoryLimit: 3
  jobTemplate:
    spec:
      template:
        spec:
          hostNetwork: true
          nodeSelector:
            node-role.kubernetes.io/control-plane: ""
          tolerations:
            - key: node-role.kubernetes.io/control-plane
              operator: Exists
              effect: NoSchedule
          containers:
            - name: backup
              image: bitnami/etcd:3.5
              command:
                - /bin/sh
                - -c
                - |
                  TIMESTAMP=$(date +%Y%m%d-%H%M%S)
                  etcdctl snapshot save /backup/etcd-snapshot-${TIMESTAMP}.db \
                    --endpoints=https://127.0.0.1:2379 \
                    --cacert=/etc/kubernetes/pki/etcd/ca.crt \
                    --cert=/etc/kubernetes/pki/etcd/server.crt \
                    --key=/etc/kubernetes/pki/etcd/server.key
                  # Upload to cloud storage
                  aws s3 cp /backup/etcd-snapshot-${TIMESTAMP}.db s3://my-backup-bucket/etcd/
              volumeMounts:
                - name: etcd-certs
                  mountPath: /etc/kubernetes/pki/etcd
                  readOnly: true
                - name: backup
                  mountPath: /backup
              env:
                - name: ETCDCTL_API
                  value: "3"
          restartPolicy: OnFailure
          volumes:
            - name: etcd-certs
              hostPath:
                path: /etc/kubernetes/pki/etcd
            - name: backup
              hostPath:
                path: /backup/etcd
```

## Step 4: Store Backups Securely

### Upload to S3

```bash
#!/bin/bash
# Add to backup script

# Upload to S3
aws s3 cp ${BACKUP_DIR}/${SNAPSHOT_NAME}.gz s3://my-cluster-backups/etcd/

# Encrypt with KMS
aws s3 cp ${BACKUP_DIR}/${SNAPSHOT_NAME}.gz \
  s3://my-cluster-backups/etcd/ \
  --sse aws:kms \
  --sse-kms-key-id alias/etcd-backup-key
```

### Upload to Azure Blob

```bash
# Upload to Azure Blob Storage
az storage blob upload \
  --account-name mystorageaccount \
  --container-name etcd-backups \
  --name ${SNAPSHOT_NAME}.gz \
  --file ${BACKUP_DIR}/${SNAPSHOT_NAME}.gz
```

### Upload to GCS

```bash
# Upload to Google Cloud Storage
gsutil cp ${BACKUP_DIR}/${SNAPSHOT_NAME}.gz gs://my-cluster-backups/etcd/
```

## Step 5: Restore etcd from Snapshot

### Pre-Restore Checklist

```bash
# 1. Stop kube-apiserver (on all control plane nodes)
sudo mv /etc/kubernetes/manifests/kube-apiserver.yaml /etc/kubernetes/

# 2. Stop etcd (on all control plane nodes)
sudo mv /etc/kubernetes/manifests/etcd.yaml /etc/kubernetes/

# 3. Wait for pods to terminate
kubectl get pods -n kube-system -l component=etcd
# Should return "No resources found"

# 4. Backup current data directory
sudo mv /var/lib/etcd /var/lib/etcd.backup
```

### Restore Snapshot

```bash
# Restore to new data directory
ETCDCTL_API=3 etcdctl snapshot restore /backup/etcd-snapshot-20260128-120000.db \
  --data-dir=/var/lib/etcd \
  --name=controlplane \
  --initial-cluster=controlplane=https://192.168.1.10:2380 \
  --initial-cluster-token=etcd-cluster-1 \
  --initial-advertise-peer-urls=https://192.168.1.10:2380

# Set correct ownership
sudo chown -R etcd:etcd /var/lib/etcd
```

### Post-Restore Steps

```bash
# 1. Restore etcd manifest
sudo mv /etc/kubernetes/etcd.yaml /etc/kubernetes/manifests/

# 2. Wait for etcd to start
sudo crictl ps | grep etcd

# 3. Verify etcd health
ETCDCTL_API=3 etcdctl endpoint health \
  --endpoints=https://127.0.0.1:2379 \
  --cacert=/etc/kubernetes/pki/etcd/ca.crt \
  --cert=/etc/kubernetes/pki/etcd/server.crt \
  --key=/etc/kubernetes/pki/etcd/server.key

# 4. Restore kube-apiserver manifest
sudo mv /etc/kubernetes/kube-apiserver.yaml /etc/kubernetes/manifests/

# 5. Verify cluster health
kubectl get nodes
kubectl get pods -A
```

## Multi-Node etcd Cluster Restore

### For Each Control Plane Node

```bash
# Node 1 (192.168.1.10)
ETCDCTL_API=3 etcdctl snapshot restore /backup/etcd-snapshot.db \
  --data-dir=/var/lib/etcd \
  --name=node1 \
  --initial-cluster=node1=https://192.168.1.10:2380,node2=https://192.168.1.11:2380,node3=https://192.168.1.12:2380 \
  --initial-cluster-token=etcd-cluster-1 \
  --initial-advertise-peer-urls=https://192.168.1.10:2380

# Node 2 (192.168.1.11)
ETCDCTL_API=3 etcdctl snapshot restore /backup/etcd-snapshot.db \
  --data-dir=/var/lib/etcd \
  --name=node2 \
  --initial-cluster=node1=https://192.168.1.10:2380,node2=https://192.168.1.11:2380,node3=https://192.168.1.12:2380 \
  --initial-cluster-token=etcd-cluster-1 \
  --initial-advertise-peer-urls=https://192.168.1.11:2380

# Node 3 (192.168.1.12)
ETCDCTL_API=3 etcdctl snapshot restore /backup/etcd-snapshot.db \
  --data-dir=/var/lib/etcd \
  --name=node3 \
  --initial-cluster=node1=https://192.168.1.10:2380,node2=https://192.168.1.11:2380,node3=https://192.168.1.12:2380 \
  --initial-cluster-token=etcd-cluster-1 \
  --initial-advertise-peer-urls=https://192.168.1.12:2380
```

## etcd Health Monitoring

### Check Cluster Health

```bash
# Endpoint health
ETCDCTL_API=3 etcdctl endpoint health \
  --endpoints=https://192.168.1.10:2379,https://192.168.1.11:2379,https://192.168.1.12:2379 \
  --cacert=/etc/kubernetes/pki/etcd/ca.crt \
  --cert=/etc/kubernetes/pki/etcd/server.crt \
  --key=/etc/kubernetes/pki/etcd/server.key

# Endpoint status
ETCDCTL_API=3 etcdctl endpoint status \
  --endpoints=https://192.168.1.10:2379,https://192.168.1.11:2379,https://192.168.1.12:2379 \
  --cacert=/etc/kubernetes/pki/etcd/ca.crt \
  --cert=/etc/kubernetes/pki/etcd/server.crt \
  --key=/etc/kubernetes/pki/etcd/server.key \
  --write-out=table

# Member list
ETCDCTL_API=3 etcdctl member list \
  --endpoints=https://127.0.0.1:2379 \
  --cacert=/etc/kubernetes/pki/etcd/ca.crt \
  --cert=/etc/kubernetes/pki/etcd/server.crt \
  --key=/etc/kubernetes/pki/etcd/server.key \
  --write-out=table
```

### Prometheus Alerts for etcd

```yaml
apiVersion: monitoring.coreos.com/v1
kind: PrometheusRule
metadata:
  name: etcd-alerts
  namespace: monitoring
spec:
  groups:
    - name: etcd
      rules:
        - alert: EtcdMembersDown
          expr: |
            max without (endpoint) (
              sum without (instance) (up{job="etcd"} == bool 0)
              or
              count without (To) (
                sum without (instance) (rate(etcd_network_peer_sent_failures_total[120s])) > 0.01
              )
            ) > 0
          for: 10m
          labels:
            severity: critical
          annotations:
            summary: "etcd cluster members are down"
            
        - alert: EtcdNoLeader
          expr: etcd_server_has_leader == 0
          for: 1m
          labels:
            severity: critical
          annotations:
            summary: "etcd cluster has no leader"
            
        - alert: EtcdHighNumberOfFailedGRPCRequests
          expr: |
            sum(rate(grpc_server_handled_total{job="etcd", grpc_code=~"Unknown|FailedPrecondition|ResourceExhausted|Internal|Unavailable|DataLoss|DeadlineExceeded"}[5m])) 
            / sum(rate(grpc_server_handled_total{job="etcd"}[5m])) > 0.05
          for: 10m
          labels:
            severity: warning
          annotations:
            summary: "High rate of failed gRPC requests"
            
        - alert: EtcdDatabaseQuotaLow
          expr: |
            (etcd_mvcc_db_total_size_in_bytes / etcd_server_quota_backend_bytes) * 100 > 80
          for: 5m
          labels:
            severity: warning
          annotations:
            summary: "etcd database quota usage above 80%"
```

## Backup Verification Script

```bash
#!/bin/bash
# /usr/local/bin/verify-etcd-backup.sh

SNAPSHOT=$1
TEMP_DIR=$(mktemp -d)

echo "Verifying snapshot: ${SNAPSHOT}"

# Check snapshot integrity
ETCDCTL_API=3 etcdctl snapshot status ${SNAPSHOT} --write-out=table

# Test restore to temp directory
ETCDCTL_API=3 etcdctl snapshot restore ${SNAPSHOT} \
  --data-dir=${TEMP_DIR}/etcd \
  --name=test-restore \
  --initial-cluster=test-restore=http://localhost:2380 \
  --initial-cluster-token=test-token \
  --initial-advertise-peer-urls=http://localhost:2380

if [ $? -eq 0 ]; then
    echo "✓ Snapshot is valid and restorable"
    rm -rf ${TEMP_DIR}
    exit 0
else
    echo "✗ Snapshot verification failed"
    rm -rf ${TEMP_DIR}
    exit 1
fi
```

## Disaster Recovery Runbook

```markdown
## etcd Disaster Recovery Procedure

### 1. Assess Situation
- [ ] Check which nodes are affected
- [ ] Verify backup availability
- [ ] Document current cluster state

### 2. Prepare for Restore
- [ ] SSH to all control plane nodes
- [ ] Stop kube-apiserver on all nodes
- [ ] Stop etcd on all nodes
- [ ] Backup existing /var/lib/etcd directories

### 3. Restore etcd
- [ ] Download latest verified backup
- [ ] Run restore command on each node
- [ ] Set correct file permissions
- [ ] Start etcd on all nodes

### 4. Verify Restore
- [ ] Check etcd member list
- [ ] Verify endpoint health
- [ ] Start kube-apiserver
- [ ] Run kubectl get nodes
- [ ] Verify all workloads

### 5. Post-Recovery
- [ ] Document incident
- [ ] Review backup schedule
- [ ] Update runbook if needed
```

## Summary

Regular etcd backups are essential for Kubernetes disaster recovery. Automate backups with cron jobs, store them securely off-cluster, and regularly test your restore procedures to ensure they work when needed.

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
