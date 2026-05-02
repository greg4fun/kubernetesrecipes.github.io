---
title: "etcd Deep Dive: K8s Data Store Operations"
description: "Master etcd operations for Kubernetes. Backup and restore, compaction, defragmentation, health checks, member management, and performance tuning for production."
publishDate: "2026-05-02"
author: "Luca Berton"
category: "configuration"
difficulty: "advanced"
timeToComplete: "15 minutes"
kubernetesVersion: "1.28+"
tags:
  - "etcd"
  - "backup"
  - "cluster-administration"
  - "disaster-recovery"
  - "cka"
relatedRecipes:
  - "kubernetes-etcd-backup-guide"
  - "kubernetes-kubeadm-init-guide"
  - "kubernetes-certificate-management"
---

> 💡 **Quick Answer:** etcd stores all Kubernetes state. Backup: `etcdctl snapshot save /backup/etcd.db`. Restore: `etcdctl snapshot restore /backup/etcd.db --data-dir=/var/lib/etcd-new`. Health: `etcdctl endpoint health`. Always use `--cacert`, `--cert`, `--key` flags. For production: 3 or 5 members, SSD storage, automated hourly backups, monitor with Prometheus.

## The Problem

etcd is the single source of truth for Kubernetes:

- Losing etcd = losing the entire cluster state
- Slow etcd = slow API server (every kubectl call)
- Corrupted etcd = unpredictable cluster behavior
- No backup = no disaster recovery

## The Solution

### etcd Basics

```bash
# etcd auth flags (required for kubeadm clusters)
export ETCDCTL_API=3
export ETCDCTL_ENDPOINTS=https://127.0.0.1:2379
export ETCDCTL_CACERT=/etc/kubernetes/pki/etcd/ca.crt
export ETCDCTL_CERT=/etc/kubernetes/pki/etcd/server.crt
export ETCDCTL_KEY=/etc/kubernetes/pki/etcd/server.key

# Or pass inline
etcdctl --endpoints=https://127.0.0.1:2379 \
  --cacert=/etc/kubernetes/pki/etcd/ca.crt \
  --cert=/etc/kubernetes/pki/etcd/server.crt \
  --key=/etc/kubernetes/pki/etcd/server.key \
  endpoint health
```

### Health and Status

```bash
# Endpoint health
etcdctl endpoint health
# https://127.0.0.1:2379 is healthy: committed proposal: took = 1.5ms

# Endpoint status (detailed)
etcdctl endpoint status --write-out=table
# +------------------+------------------+---------+---------+-----------+
# |     ENDPOINT     |        ID        | VERSION | DB SIZE | IS LEADER |
# +------------------+------------------+---------+---------+-----------+
# | https://cp1:2379 | 8e9e05c52164694d | 3.5.12  | 45 MB   |    true   |
# | https://cp2:2379 | 91bc3c398fb3c146 | 3.5.12  | 45 MB   |   false   |
# | https://cp3:2379 | fd422379fda50e48 | 3.5.12  | 45 MB   |   false   |
# +------------------+------------------+---------+---------+-----------+

# Member list
etcdctl member list --write-out=table
```

### Backup

```bash
# Snapshot backup
etcdctl snapshot save /backup/etcd-$(date +%Y%m%d-%H%M%S).db

# Verify backup
etcdctl snapshot status /backup/etcd-20260502-120000.db --write-out=table
# +----------+----------+------------+------------+
# |   HASH   | REVISION | TOTAL KEYS | TOTAL SIZE |
# +----------+----------+------------+------------+
# | 4f23b7e8 |  1284567 |       3542 |    45 MB   |
# +----------+----------+------------+------------+

# Automated backup CronJob
cat <<EOF | kubectl apply -f -
apiVersion: batch/v1
kind: CronJob
metadata:
  name: etcd-backup
  namespace: kube-system
spec:
  schedule: "0 */6 * * *"       # Every 6 hours
  jobTemplate:
    spec:
      template:
        spec:
          hostNetwork: true
          nodeSelector:
            node-role.kubernetes.io/control-plane: ""
          tolerations:
          - effect: NoSchedule
            operator: Exists
          containers:
          - name: backup
            image: registry.k8s.io/etcd:3.5.12-0
            command:
            - sh
            - -c
            - |
              etcdctl snapshot save /backup/etcd-\$(date +%Y%m%d-%H%M%S).db
              # Keep last 7 days
              find /backup -name "etcd-*.db" -mtime +7 -delete
            env:
            - name: ETCDCTL_API
              value: "3"
            - name: ETCDCTL_ENDPOINTS
              value: "https://127.0.0.1:2379"
            - name: ETCDCTL_CACERT
              value: "/etc/kubernetes/pki/etcd/ca.crt"
            - name: ETCDCTL_CERT
              value: "/etc/kubernetes/pki/etcd/server.crt"
            - name: ETCDCTL_KEY
              value: "/etc/kubernetes/pki/etcd/server.key"
            volumeMounts:
            - name: etcd-certs
              mountPath: /etc/kubernetes/pki/etcd
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
EOF
```

### Restore

```bash
# ⚠️ STOP kube-apiserver first
# Move existing data
mv /var/lib/etcd /var/lib/etcd.bak

# Restore snapshot
etcdctl snapshot restore /backup/etcd-20260502-120000.db \
  --data-dir=/var/lib/etcd \
  --name=cp1 \
  --initial-cluster=cp1=https://10.0.0.1:2380 \
  --initial-advertise-peer-urls=https://10.0.0.1:2380

# Fix ownership
chown -R etcd:etcd /var/lib/etcd

# Restart etcd and kube-apiserver
systemctl restart etcd
# Or if running as static pod, kubelet auto-restarts it

# Verify
etcdctl endpoint health
kubectl get nodes
```

### Compaction and Defragmentation

```bash
# Check DB size
etcdctl endpoint status --write-out=table | grep "DB SIZE"

# Compact old revisions (frees logical space)
# Get current revision
REV=$(etcdctl endpoint status --write-out=json | python3 -c "import json,sys; print(json.load(sys.stdin)[0]['Status']['header']['revision'])")
etcdctl compact $REV

# Defragment (reclaims disk space)
etcdctl defrag --endpoints=https://cp1:2379
etcdctl defrag --endpoints=https://cp2:2379
etcdctl defrag --endpoints=https://cp3:2379
# ⚠️ Defrag one member at a time — it briefly locks the member

# Alarm management
etcdctl alarm list        # Check for alarms
etcdctl alarm disarm      # Clear alarms (after fixing cause)
# NOSPACE alarm triggers when DB exceeds quota (default 2GB)
```

### Browse etcd Data

```bash
# List all keys (careful — lots of output!)
etcdctl get / --prefix --keys-only | head -20
# /registry/pods/default/nginx-abc123
# /registry/services/specs/default/kubernetes
# /registry/deployments/default/my-app

# Get specific resource
etcdctl get /registry/pods/default/nginx-abc123

# Count keys by type
etcdctl get / --prefix --keys-only | cut -d'/' -f3 | sort | uniq -c | sort -rn
#  1234 pods
#   567 configmaps
#   432 secrets
#   321 events
```

### Performance Tuning

```bash
# etcd performance checklist:
# 1. SSD storage (NVMe preferred) — etcd is write-heavy
# 2. Dedicated disk for etcd data dir
# 3. Low-latency network between members (<10ms RTT)
# 4. 8GB+ RAM for large clusters
# 5. Increase quota for large clusters

# Increase DB quota (default 2GB)
# In etcd static pod manifest:
# --quota-backend-bytes=8589934592   # 8GB

# Monitor with Prometheus
# Key metrics:
# etcd_server_has_leader             (should always be 1)
# etcd_disk_wal_fsync_duration       (should be < 10ms)
# etcd_disk_backend_commit_duration  (should be < 25ms)
# etcd_network_peer_round_trip_time  (should be < 10ms)
# etcd_server_proposals_failed_total (should be 0)
```

### Member Management

```bash
# Add new member
etcdctl member add cp4 --peer-urls=https://10.0.0.4:2380

# Remove member
etcdctl member remove <member-id>

# Update member peer URLs
etcdctl member update <member-id> --peer-urls=https://new-ip:2380

# Force new cluster from single member (disaster recovery)
etcdctl snapshot restore backup.db \
  --data-dir=/var/lib/etcd \
  --name=cp1 \
  --initial-cluster=cp1=https://10.0.0.1:2380 \
  --initial-cluster-token=new-cluster-token \
  --initial-advertise-peer-urls=https://10.0.0.1:2380
```

## Common Issues

**NOSPACE alarm — etcd read-only**

DB exceeded quota. Compact + defrag + `etcdctl alarm disarm`. Increase quota if cluster is large.

**Slow API server — etcd latency**

Check `etcd_disk_wal_fsync_duration`. If >10ms: move etcd to SSD. If network: check member RTT.

**Split brain after network partition**

etcd uses Raft consensus — requires majority (2/3 or 3/5). Minority partition becomes read-only. Fix network, members auto-rejoin.

## Best Practices

- **3 or 5 members** — odd numbers for quorum (never 2 or 4)
- **SSD storage** — etcd performance is disk-bound
- **Automated backups** — every 1-6 hours, test restore regularly
- **Monitor key metrics** — fsync latency, leader status, DB size
- **Defrag regularly** — monthly, one member at a time

## Key Takeaways

- etcd stores ALL Kubernetes state — losing it loses the cluster
- Always use TLS flags (`--cacert`, `--cert`, `--key`) for etcd operations
- Backup: `etcdctl snapshot save`, Restore: `etcdctl snapshot restore`
- Compact + defrag to manage DB size and prevent NOSPACE
- Production: 3+ members on SSD with automated backups
