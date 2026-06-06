---
title: "Kubernetes etcd Operations and Maintenance"
description: "Manage etcd for Kubernetes: backup, restore, compaction, defragmentation, member management, and disaster recovery procedures."
category: "configuration"
difficulty: "advanced"
publishDate: "2026-04-02"
tags: ["etcd", "backup", "restore", "disaster-recovery", "maintenance", "kubernetes"]
author: "Luca Berton"
relatedRecipes:
  - "kubernetes-backup-restore"
  - "kubernetes-disaster-recovery-plan"
  - "clusterpolicy-mofed-upgrade"
  - "kubectl-cheat-sheet"
---

> 💡 **Quick Answer:** Manage etcd for Kubernetes: backup, restore, compaction, defragmentation, member management, and disaster recovery procedures.

## The Problem

This is a critical skill for managing production Kubernetes clusters at scale. Without it, teams face operational complexity, security risks, and reliability issues.

## The Solution

etcd is the single source of truth for cluster state, so snapshot it on a schedule and keep copies off-node. Take and verify a snapshot with `etcdctl`:

```bash
ETCDCTL_API=3 etcdctl snapshot save /backup/etcd-$(date +%F).db \
  --endpoints=https://127.0.0.1:2379 \
  --cacert=/etc/kubernetes/pki/etcd/ca.crt \
  --cert=/etc/kubernetes/pki/etcd/server.crt \
  --key=/etc/kubernetes/pki/etcd/server.key

# Verify the snapshot is consistent
etcdutl snapshot status /backup/etcd-$(date +%F).db --write-out=table
```

Compact old revisions and defragment to reclaim disk after large deletes, then check member health:

```bash
# Defragment every member, then confirm the cluster is healthy
etcdctl defrag --cluster \
  --endpoints=https://127.0.0.1:2379 \
  --cacert=/etc/kubernetes/pki/etcd/ca.crt \
  --cert=/etc/kubernetes/pki/etcd/server.crt \
  --key=/etc/kubernetes/pki/etcd/server.key

etcdctl endpoint status --cluster -w table
```

To restore, stop the API server, run `etcdutl snapshot restore` into a fresh data directory, and point the etcd static pod at it before restarting the control plane.

## Common Issues

### Troubleshooting
Check logs and events first. Most issues have clear error messages pointing to the root cause.

## Best Practices

- **Follow the principle of least privilege** for all configurations
- **Test in staging** before applying to production
- **Monitor and alert** on key metrics
- **Document your runbooks** for the team

## Key Takeaways

- Essential knowledge for Kubernetes operations at scale
- Start simple and evolve your approach as needed
- Automation reduces human error and operational toil
- Share learnings across your team
