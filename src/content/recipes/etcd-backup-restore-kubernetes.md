---
title: "etcd Backup Restore Kubernetes"
description: "Back up and restore etcd in Kubernetes and OpenShift clusters. Automated snapshots, disaster recovery procedures, and cluster state restoration."
publishDate: "2026-04-29"
author: "Luca Berton"
category: "storage"
difficulty: "advanced"
timeToComplete: "20 minutes"
kubernetesVersion: "1.28+"
tags:
  - "etcd"
  - "backup"
  - "disaster-recovery"
  - "openshift"
  - "control-plane"
relatedRecipes:
  - "kubernetes-backup-velero-guide"
  - "kubernetes-disaster-recovery-planning"
  - "etcd-leader-election-troubleshooting"
---

> 💡 **Quick Answer:** For OpenShift: run `cluster-backup.sh /home/core/backup` on a control plane node to snapshot etcd + static pod manifests. For vanilla Kubernetes: use `etcdctl snapshot save /backup/etcd-snapshot.db`. Automate daily with a CronJob or systemd timer. etcd backup is your last-resort recovery — the only way to rebuild a cluster from total control plane loss.

## The Problem

etcd stores the entire Kubernetes cluster state — every resource, secret, config, and certificate. If etcd is corrupted or all control plane nodes are lost:

- The cluster is unrecoverable without an etcd backup
- Velero backups alone can't restore the control plane
- Certificate rotation failures can render etcd inaccessible
- Split-brain scenarios can corrupt the etcd database

## The Solution

### OpenShift etcd Backup

```bash
# SSH to a control plane node
oc debug node/<control-plane-node>
chroot /host

# Run the built-in backup script
/usr/local/bin/cluster-backup.sh /home/core/backup

# Output:
# /home/core/backup/snapshot_2026-04-29_020000.db
# /home/core/backup/static_kuberesources_2026-04-29_020000.tar.gz
```

Automate with a CronJob:

```yaml
apiVersion: batch/v1
kind: CronJob
metadata:
  name: etcd-backup
  namespace: openshift-etcd
spec:
  schedule: "0 2 * * *"
  jobTemplate:
    spec:
      template:
        spec:
          containers:
          - name: etcd-backup
            image: registry.redhat.io/openshift4/ose-tools-rhel9:latest
            command:
            - /bin/sh
            - -c
            - |
              /usr/local/bin/cluster-backup.sh /home/core/backup
              # Copy to persistent storage
              cp /home/core/backup/* /backup/
            volumeMounts:
            - name: backup-vol
              mountPath: /backup
            - name: host
              mountPath: /home/core
          volumes:
          - name: backup-vol
            persistentVolumeClaim:
              claimName: etcd-backup-pvc
          - name: host
            hostPath:
              path: /home/core
          restartPolicy: OnFailure
          nodeSelector:
            node-role.kubernetes.io/master: ""
          tolerations:
          - operator: Exists
```

### Vanilla Kubernetes etcd Backup

```bash
# Using etcdctl directly
ETCDCTL_API=3 etcdctl snapshot save /backup/etcd-snapshot.db \
  --endpoints=https://127.0.0.1:2379 \
  --cacert=/etc/kubernetes/pki/etcd/ca.crt \
  --cert=/etc/kubernetes/pki/etcd/healthcheck-client.crt \
  --key=/etc/kubernetes/pki/etcd/healthcheck-client.key

# Verify snapshot
ETCDCTL_API=3 etcdctl snapshot status /backup/etcd-snapshot.db --write-table
```

### Restore etcd (OpenShift)

```bash
# On ALL control plane nodes, stop etcd and API server
# Then on ONE node:
/usr/local/bin/cluster-restore.sh /home/core/backup

# Restart kubelet on all control plane nodes
systemctl restart kubelet

# Monitor recovery
oc get nodes
oc get co
```

### Restore etcd (Vanilla Kubernetes)

```bash
# Stop kube-apiserver and etcd on all control plane nodes
# On each control plane node:
ETCDCTL_API=3 etcdctl snapshot restore /backup/etcd-snapshot.db \
  --data-dir=/var/lib/etcd-restored \
  --name=<node-name> \
  --initial-cluster=<node1>=https://<ip1>:2380,<node2>=https://<ip2>:2380,<node3>=https://<ip3>:2380 \
  --initial-advertise-peer-urls=https://<this-node-ip>:2380

# Update etcd static pod to use new data directory
# Restart kubelet
```

## Common Issues

**Backup file is 0 bytes**

etcd is unhealthy or the certificates are wrong. Check `etcdctl endpoint health` first.

**Restore fails with "member already exists"**

The old data directory wasn't removed. Delete `/var/lib/etcd` before restoring on each node.

## Best Practices

- **Daily automated backups** — CronJob or systemd timer
- **Store backups offsite** — S3, NFS, or physically separate location
- **Test restore quarterly** — on a non-production cluster
- **Back up before ANY control plane change** — upgrades, certificate rotation, etcd defrag
- **Keep 7 daily + 4 weekly snapshots** — rotation prevents unbounded growth
- **Encrypt backup files** — etcd contains secrets in plaintext

## Key Takeaways

- etcd backup is the ONLY way to recover from total control plane loss
- OpenShift provides `cluster-backup.sh` — backs up etcd snapshot + static pod resources
- Automate with CronJob targeting control plane nodes
- Restore requires stopping ALL control plane components first
- Velero doesn't backup etcd — both tools are needed for complete DR
