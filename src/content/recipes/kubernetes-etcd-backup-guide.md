---
title: "K8s etcd Backup and Restore Commands"
description: "Backup and restore Kubernetes etcd with etcdctl snapshot save and restore. Automated CronJob backups, verification, and disaster recovery procedures."
publishDate: "2026-05-02"
author: "Luca Berton"
category: "storage"
difficulty: "advanced"
timeToComplete: "15 minutes"
kubernetesVersion: "1.28+"
tags:
  - "etcd"
  - "backup"
  - "disaster-recovery"
  - "cka"
  - "administration"
relatedRecipes:
  - "etcd-backup-restore"
  - "kubernetes-persistent-volume-guide"
  - "kubernetes-secret-types-guide"
---

> 💡 **Quick Answer:** `ETCDCTL_API=3 etcdctl snapshot save backup.db --endpoints=https://127.0.0.1:2379 --cacert=/etc/kubernetes/pki/etcd/ca.crt --cert=/etc/kubernetes/pki/etcd/server.crt --key=/etc/kubernetes/pki/etcd/server.key` creates a snapshot backup. Restore: `etcdctl snapshot restore backup.db --data-dir=/var/lib/etcd-restored`. This is a CKA exam topic — know the certificate paths and restore procedure.

## The Problem

etcd stores ALL Kubernetes cluster state:

- Deployments, Services, Secrets, ConfigMaps — everything
- Losing etcd = losing the entire cluster state
- No built-in backup mechanism in Kubernetes
- Disaster recovery requires tested backup/restore procedures

## The Solution

### Manual Backup

```bash
# Set API version
export ETCDCTL_API=3

# Check etcd health
etcdctl endpoint health \
  --endpoints=https://127.0.0.1:2379 \
  --cacert=/etc/kubernetes/pki/etcd/ca.crt \
  --cert=/etc/kubernetes/pki/etcd/server.crt \
  --key=/etc/kubernetes/pki/etcd/server.key

# Create snapshot
etcdctl snapshot save /backup/etcd-$(date +%Y%m%d-%H%M%S).db \
  --endpoints=https://127.0.0.1:2379 \
  --cacert=/etc/kubernetes/pki/etcd/ca.crt \
  --cert=/etc/kubernetes/pki/etcd/server.crt \
  --key=/etc/kubernetes/pki/etcd/server.key

# Verify snapshot
etcdctl snapshot status /backup/etcd-20260502-120000.db --write-table
# +----------+----------+------------+------------+
# |   HASH   | REVISION | TOTAL KEYS | TOTAL SIZE |
# +----------+----------+------------+------------+
# | 7c2f3e1a |   45892  |    1523    |   5.1 MB   |
# +----------+----------+------------+------------+
```

### Find Certificate Paths

```bash
# From etcd pod spec (kubeadm clusters)
kubectl describe pod etcd-control-plane -n kube-system | grep -E "cert|key|ca"

# Or from static pod manifest
cat /etc/kubernetes/manifests/etcd.yaml | grep -E "cert-file|key-file|trusted-ca"
# --cert-file=/etc/kubernetes/pki/etcd/server.crt
# --key-file=/etc/kubernetes/pki/etcd/server.key
# --trusted-ca-file=/etc/kubernetes/pki/etcd/ca.crt

# etcd data directory
# --data-dir=/var/lib/etcd
```

### Restore from Backup

```bash
# Stop kube-apiserver (if using static pods, move manifest)
mv /etc/kubernetes/manifests/kube-apiserver.yaml /tmp/

# Stop etcd
mv /etc/kubernetes/manifests/etcd.yaml /tmp/

# Restore snapshot to new data directory
etcdctl snapshot restore /backup/etcd-20260502-120000.db \
  --data-dir=/var/lib/etcd-restored

# Update etcd manifest to use new data directory
# In /tmp/etcd.yaml, change:
#   --data-dir=/var/lib/etcd-restored
# Also update the hostPath volume:
#   path: /var/lib/etcd-restored

# Move manifests back
mv /tmp/etcd.yaml /etc/kubernetes/manifests/
mv /tmp/kube-apiserver.yaml /etc/kubernetes/manifests/

# Wait for etcd and API server to start
kubectl get pods -n kube-system | grep etcd
kubectl get nodes    # Cluster should be restored
```

### Automated CronJob Backup

```yaml
apiVersion: batch/v1
kind: CronJob
metadata:
  name: etcd-backup
  namespace: kube-system
spec:
  schedule: "0 */6 * * *"    # Every 6 hours
  concurrencyPolicy: Forbid
  jobTemplate:
    spec:
      template:
        spec:
          hostNetwork: true
          containers:
          - name: backup
            image: bitnami/etcd:3.5
            command:
            - /bin/sh
            - -c
            - |
              etcdctl snapshot save /backup/etcd-$(date +%Y%m%d-%H%M%S).db \
                --endpoints=https://127.0.0.1:2379 \
                --cacert=/etc/kubernetes/pki/etcd/ca.crt \
                --cert=/etc/kubernetes/pki/etcd/server.crt \
                --key=/etc/kubernetes/pki/etcd/server.key
              # Keep last 7 days
              find /backup -name "etcd-*.db" -mtime +7 -delete
            env:
            - name: ETCDCTL_API
              value: "3"
            volumeMounts:
            - name: etcd-certs
              mountPath: /etc/kubernetes/pki/etcd
              readOnly: true
            - name: backup
              mountPath: /backup
          restartPolicy: OnFailure
          nodeSelector:
            node-role.kubernetes.io/control-plane: ""
          tolerations:
          - key: node-role.kubernetes.io/control-plane
            effect: NoSchedule
          volumes:
          - name: etcd-certs
            hostPath:
              path: /etc/kubernetes/pki/etcd
          - name: backup
            hostPath:
              path: /opt/etcd-backups
```

### Upload to S3

```bash
# After snapshot, upload to S3
aws s3 cp /backup/etcd-$(date +%Y%m%d).db \
  s3://my-backups/etcd/etcd-$(date +%Y%m%d).db

# Or use a sidecar with s3cmd/rclone in the CronJob
```

## Common Issues

**"context deadline exceeded" during snapshot**

etcd is overloaded or certificates are wrong. Check endpoint health first. Increase timeout: `--command-timeout=30s`.

**"member ID mismatch" on restore**

Don't restore to the existing data directory. Always use a new `--data-dir` path.

**Cluster not recovering after restore**

kube-apiserver may still reference old etcd data. Ensure both etcd and apiserver are restarted and etcd manifest points to restored data dir.

## Best Practices

- **Backup every 6 hours minimum** — automate with CronJob
- **Test restores regularly** — untested backups are not backups
- **Store backups off-cluster** — S3, GCS, or remote storage
- **Keep 7+ days of backups** — for recovering from delayed-discovery issues
- **Backup before cluster upgrades** — always have a rollback point

## Key Takeaways

- `etcdctl snapshot save` creates point-in-time cluster state backups
- Certificate paths are in the etcd static pod manifest or kube-apiserver config
- Restore to a NEW data directory, then update etcd manifest
- Automate backups with CronJob + off-cluster storage
- CKA exam requires knowing backup/restore commands and cert paths
