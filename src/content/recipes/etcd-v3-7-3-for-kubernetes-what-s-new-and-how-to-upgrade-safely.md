---
title: "etcd v3.7.3 for Kubernetes: What's New and How to Upgrade Safely"
description: "Patch release etcd v3.7.3 for Kubernetes' control-plane datastore: upgrade steps, backup commands, and verification for operators."
publishDate: "2026-10-25"
author: "Luca Berton"
category: "storage"
difficulty: "advanced"
timeToComplete: "30 minutes"
kubernetesVersion: "1.28+"
tags:
  - "etcd"
  - "control-plane"
  - "upgrade"
  - "backup"
  - "kubeadm"
  - "datastore"
  - "disaster-recovery"
---
> 💡 **Quick Answer:** etcd v3.7.3 is a patch release in the 3.7 line (the Kubernetes control-plane datastore); the upstream release notes for this tag don't list specific itemized fixes, so operators should check the [CHANGELOG-3.7.md](https://github.com/etcd-io/etcd/blob/main/CHANGELOG/CHANGELOG-3.7.md) and the [official upgrade guide](https://etcd.io/docs/v3.7/upgrades/upgrade_3_7/) before touching a cluster backing live Kubernetes API servers.

## The Problem

etcd is the single source of truth for every Kubernetes object. An etcd upgrade done carelessly can corrupt data, break API server connectivity, or cause quorum loss. Unlike a normal workload rollout, there's no "just re-apply the deployment" fallback if something goes wrong mid-upgrade.

## The Solution

Treat etcd upgrades as a controlled, backed-up, one-member-at-a-time operation, and only move one minor version at a time (e.g. 3.6 → 3.7, not 3.5 → 3.7). Verify cluster health after each step before touching the next member.

## What's New

The v3.7.3 release page uses etcd's standard generic template and does **not** enumerate specific fixes, flags, or breaking changes for this tag. There is nothing to report beyond:

- It's a patch release in the **3.7.x** line.
- Full itemized changes live in [CHANGELOG-3.7.md](https://github.com/etcd-io/etcd/blob/main/CHANGELOG/CHANGELOG-3.7.md) — check it directly for the entries between 3.7.2 and 3.7.3.
- Before upgrading from 3.6.x to any 3.7.x release, read the [3.7 upgrade guide](https://etcd.io/docs/v3.7/upgrades/upgrade_3_7/) — etcd minor releases can carry storage-format or flag-compatibility changes that aren't summarized in the tag notes.

Do not assume feature changes that aren't documented; if you need specifics for compliance/audit purposes, cite the CHANGELOG link above rather than this recipe.

## Upgrade Steps

### 1. Snapshot a backup first (non-negotiable)

```bash
ETCDCTL_API=3 etcdctl snapshot save /backup/etcd-snapshot-$(date +%Y%m%d%H%M).db \
  --endpoints=https://127.0.0.1:2379 \
  --cacert=/etc/kubernetes/pki/etcd/ca.crt \
  --cert=/etc/kubernetes/pki/etcd/server.crt \
  --key=/etc/kubernetes/pki/etcd/server.key
```

### 2. Check current cluster health and member versions

```bash
ETCDCTL_API=3 etcdctl endpoint status --cluster -w table \
  --endpoints=https://127.0.0.1:2379 \
  --cacert=/etc/kubernetes/pki/etcd/ca.crt \
  --cert=/etc/kubernetes/pki/etcd/server.crt \
  --key=/etc/kubernetes/pki/etcd/server.key
```

### 3a. Static-pod (kubeadm-managed) clusters

kubeadm pins the etcd image per Kubernetes version — don't hand-swap the tag unless you're running an external/self-managed etcd. If you do manage it yourself, edit the manifest on **one control-plane node at a time**:

```bash
sudo sed -i 's#image: .*etcd:.*#image: registry.k8s.io/etcd:3.7.3-0#' \
  /etc/kubernetes/manifests/etcd.yaml
```

The kubelet will restart the static pod automatically. Wait for it to report healthy before moving to the next node:

```bash
kubectl -n kube-system get pods -l component=etcd -o wide
```

### 3b. External/standalone etcd cluster

Download and swap the binary on each member sequentially (rolling, one node at a time):

```bash
ETCD_VER=v3.7.3
curl -L https://github.com/etcd-io/etcd/releases/download/${ETCD_VER}/etcd-${ETCD_VER}-linux-amd64.tar.gz \
  -o /tmp/etcd-${ETCD_VER}-linux-amd64.tar.gz
tar xzvf /tmp/etcd-${ETCD_VER}-linux-amd64.tar.gz -C /usr/local/bin --strip-components=1 \
  etcd-${ETCD_VER}-linux-amd64/etcd etcd-${ETCD_VER}-linux-amd64/etcdctl
sudo systemctl restart etcd
```

Confirm the restarted member rejoins and the cluster still has quorum before restarting the next one.

## Verify

```bash
# Binary / client version
etcd --version
ETCDCTL_API=3 etcdctl version

# Cluster health across all members
ETCDCTL_API=3 etcdctl endpoint health --cluster \
  --endpoints=https://127.0.0.1:2379 \
  --cacert=/etc/kubernetes/pki/etcd/ca.crt \
  --cert=/etc/kubernetes/pki/etcd/server.crt \
  --key=/etc/kubernetes/pki/etcd/server.key

# Kubernetes API still functioning against the datastore
kubectl get nodes
kubectl get events -A --sort-by=.lastTimestamp | tail -20
```

All members should report `healthy: true`, versions should show `3.7.3` on upgraded nodes, and `kubectl get nodes` should return normally with no API server timeouts.

## Common Issues

- **Version skew errors**: mixing etcd major.minor versions across members longer than necessary can cause raft issues — complete the rolling upgrade promptly.
- **kubeadm image mismatch**: manually bumping the etcd tag in a kubeadm cluster can drift from what `kubeadm upgrade plan` expects; prefer letting kubeadm manage etcd versioning unless running fully external etcd.
- **TLS cert paths**: `etcdctl` commands fail silently with connection errors if `--cacert/--cert/--key` don't match the actual PKI directory (commonly `/etc/kubernetes/pki/etcd/` on kubeadm clusters).
- **Skipping a minor version**: upgrading 3.5 → 3.7 directly is unsupported; go through 3.6 first per the upgrade guide.

## Best Practices

- Always take a `snapshot save` immediately before any etcd version change, and store it off-node.
- Upgrade one etcd member at a time; check `endpoint health --cluster` between each.
- Test the upgrade path in staging against a restored snapshot before touching production control planes.
- Pin and track etcd version alongside your Kubernetes version in your IaC/config management rather than upgrading etcd ad hoc.
- Monitor `etcd_disk_wal_fsync_duration_seconds` and `etcd_server_quota_backend_bytes` after upgrade to catch performance regressions early.
