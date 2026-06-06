---
title: "Kubernetes Disaster Recovery Planning"
description: "Build a Kubernetes disaster recovery plan with etcd backups, Velero, cross-region replication, and RTO/RPO targets for production clusters."
category: "configuration"
difficulty: "advanced"
publishDate: "2026-04-02"
tags: ["disaster-recovery", "backup", "velero", "etcd", "rto-rpo", "kubernetes"]
author: "Luca Berton"
relatedRecipes:
  - "kubernetes-backup-restore"
  - "kubernetes-etcd-operations-guide"
  - "kubectl-cheat-sheet"
  - "kubernetes-affinity-guide"
---

> 💡 **Quick Answer:** Build a Kubernetes disaster recovery plan with etcd backups, Velero, cross-region replication, and RTO/RPO targets for production clusters.

## The Problem

This is a critical skill for managing production Kubernetes clusters at scale. Without it, teams face operational complexity, security risks, and reliability issues.

## The Solution

A DR plan sets RTO/RPO targets and the mechanics to hit them: regular etcd snapshots for control-plane state, plus Velero for namespaced workloads and PV data. Schedule daily Velero backups with retention:

```bash
velero schedule create daily-backup \
  --schedule="0 2 * * *" \
  --ttl 168h0m0s \
  --include-namespaces '*'
```

Snapshot etcd on each control-plane node and copy the file off-cluster:

```bash
ETCDCTL_API=3 etcdctl snapshot save /backup/etcd-$(date +%F).db \
  --endpoints=https://127.0.0.1:2379 \
  --cacert=/etc/kubernetes/pki/etcd/ca.crt \
  --cert=/etc/kubernetes/pki/etcd/server.crt \
  --key=/etc/kubernetes/pki/etcd/server.key
```

Rehearse restores on a schedule — a backup you have never restored is not a backup. Record target RTO (time to recover) and RPO (acceptable data loss) in the runbook, and store backups in a different region from the cluster.

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
