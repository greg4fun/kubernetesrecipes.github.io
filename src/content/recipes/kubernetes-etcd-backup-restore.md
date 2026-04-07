---
title: "Kubernetes etcd Backup and Restore"
description: "configuration"
category: "configuration"
difficulty: "Backup and restore Kubernetes etcd database for disaster recovery. Covers snapshot creation, scheduled backups, restore procedure, and etcd health monitoring."
publishDate: "2026-04-05"
tags: ["etcd", "backup", "disaster-recovery", "restore", "cluster-recovery"]
author: "Luca Berton"
relatedRecipes:

---

> 💡 **Quick Answer:** configuration

## The Problem

This is a fundamental Kubernetes topic that engineers search for frequently. A comprehensive reference with production-ready examples saves hours of trial and error.

## The Solution

### Create etcd Snapshot

```bash
# Find etcd certs
ls /etc/kubernetes/pki/etcd/

# Create snapshot
ETCDCTL_API=3 etcdctl snapshot save /backup/etcd-$(date +%Y%m%d-%H%M).db \
  --endpoints=https://127.0.0.1:2379 \
  --cacert=/etc/kubernetes/pki/etcd/ca.crt \
  --cert=/etc/kubernetes/pki/etcd/server.crt \
  --key=/etc/kubernetes/pki/etcd/server.key

# Verify snapshot
ETCDCTL_API=3 etcdctl snapshot status /backup/etcd-20260405.db --write-out=table
```

### Automated Backup CronJob

```yaml
apiVersion: batch/v1
kind: CronJob
metadata:
  name: etcd-backup
  namespace: kube-system
spec:
  schedule: "0 */6 * * *"    # Every 6 hours
  jobTemplate:
    spec:
      template:
        spec:
          hostNetwork: true
          nodeSelector:
            node-role.kubernetes.io/control-plane: ""
          tolerations:
            - operator: Exists
          containers:
            - name: backup
              image: bitnami/etcd:3.5
              command: ["/bin/sh", "-c"]
              args:
                - |
                  etcdctl snapshot save /backup/etcd-$(date +%Y%m%d-%H%M).db \
                    --endpoints=https://127.0.0.1:2379 \
                    --cacert=/certs/ca.crt \
                    --cert=/certs/server.crt \
                    --key=/certs/server.key
                  # Keep last 7 days
                  find /backup -name "etcd-*.db" -mtime +7 -delete
              volumeMounts:
                - name: etcd-certs
                  mountPath: /certs
                  readOnly: true
                - name: backup
                  mountPath: /backup
          volumes:
            - name: etcd-certs
              hostPath:
                path: /etc/kubernetes/pki/etcd
            - name: backup
              hostPath:
                path: /var/backups/etcd
          restartPolicy: OnFailure
```

### Restore from Snapshot

```bash
# STOP kube-apiserver and etcd on ALL control plane nodes
sudo mv /etc/kubernetes/manifests/kube-apiserver.yaml /tmp/
sudo mv /etc/kubernetes/manifests/etcd.yaml /tmp/

# Restore snapshot
ETCDCTL_API=3 etcdctl snapshot restore /backup/etcd-20260405.db \
  --data-dir=/var/lib/etcd-restored \
  --name=$(hostname) \
  --initial-cluster="cp1=https://cp1:2380,cp2=https://cp2:2380,cp3=https://cp3:2380" \
  --initial-advertise-peer-urls=https://$(hostname):2380

# Replace etcd data
sudo rm -rf /var/lib/etcd
sudo mv /var/lib/etcd-restored /var/lib/etcd

# Restart etcd and API server
sudo mv /tmp/etcd.yaml /etc/kubernetes/manifests/
sudo mv /tmp/kube-apiserver.yaml /etc/kubernetes/manifests/

# Verify
kubectl get nodes
kubectl get pods -A
```

```mermaid
graph TD
    A[CronJob: every 6h] --> B[etcdctl snapshot save]
    B --> C[/var/backups/etcd/etcd-DATE.db]
    C --> D[Copy to off-cluster storage!]
    E[Disaster!] --> F[Stop API server + etcd]
    F --> G[etcdctl snapshot restore]
    G --> H[Replace data dir]
    H --> I[Restart etcd + API server]
```

## Frequently Asked Questions

### How often should I backup etcd?

Every 1-6 hours for production clusters. Always backup before cluster upgrades. Store backups off-cluster (S3, GCS) — if the cluster dies, local backups die with it.

## Best Practices

- Start with the simplest configuration that meets your needs
- Test changes in staging before production
- Use `kubectl describe` and events for troubleshooting
- Document your decisions for the team

## Key Takeaways

- This is essential Kubernetes knowledge for production operations
- Follow the principle of least privilege and minimal configuration
- Monitor and iterate based on real-world behavior
- Automation reduces human error and improves consistency
