---
title: "K8s kubeadm Upgrade: Step-by-Step Guide"
description: "Upgrade Kubernetes clusters with kubeadm from one minor version to the next. Control plane upgrade, worker node drain, kubelet upgrade, and rollback procedures."
publishDate: "2026-05-02"
author: "Luca Berton"
category: "configuration"
difficulty: "advanced"
timeToComplete: "20 minutes"
kubernetesVersion: "1.28+"
tags:
  - "kubeadm"
  - "upgrade"
  - "cluster-management"
  - "administration"
  - "cka"
relatedRecipes:
  - "kubernetes-etcd-backup-guide"
  - "kubernetes-pod-disruption-budget"
  - "kubernetes-taints-tolerations-guide"
  - "kubernetes-kubeadm-init-guide"
---

> 💡 **Quick Answer:** Upgrade kubeadm first: `apt-get install kubeadm=1.30.0-*`. Then `kubeadm upgrade plan` to verify, `kubeadm upgrade apply v1.30.0` on the first control plane node. Drain each node, upgrade kubelet + kubectl, restart kubelet, uncordon. Always upgrade one minor version at a time (1.28→1.29→1.30, never 1.28→1.30). Backup etcd before starting.

## The Problem

Kubernetes releases every 4 months. Staying current means:

- Security patches and CVE fixes
- New features and API versions
- Avoiding unsupported versions (N-3 policy)
- Zero-downtime upgrades for production workloads

## The Solution

### Pre-Upgrade Checklist

```bash
# 1. Check current version
kubectl version
kubeadm version
kubelet --version

# 2. Check upgrade path
kubeadm upgrade plan

# 3. Backup etcd
ETCDCTL_API=3 etcdctl snapshot save /backup/pre-upgrade-$(date +%Y%m%d).db \
  --endpoints=https://127.0.0.1:2379 \
  --cacert=/etc/kubernetes/pki/etcd/ca.crt \
  --cert=/etc/kubernetes/pki/etcd/server.crt \
  --key=/etc/kubernetes/pki/etcd/server.key

# 4. Read release notes for breaking changes
# https://kubernetes.io/releases/

# 5. Check deprecated APIs
kubectl get --raw /metrics | grep apiserver_requested_deprecated_apis
```

### Upgrade Control Plane (First Node)

```bash
# Step 1: Upgrade kubeadm
apt-get update
apt-get install -y --allow-change-held-packages kubeadm=1.30.0-1.1

# Verify
kubeadm version
# kubeadm version: v1.30.0

# Step 2: Check upgrade plan
kubeadm upgrade plan
# Shows: available versions, component versions, warnings

# Step 3: Apply upgrade
kubeadm upgrade apply v1.30.0
# Upgrades: kube-apiserver, kube-controller-manager,
#           kube-scheduler, kube-proxy, CoreDNS, etcd

# Step 4: Drain the control plane node
kubectl drain control-plane-1 --ignore-daemonsets --delete-emptydir-data

# Step 5: Upgrade kubelet and kubectl
apt-get install -y --allow-change-held-packages \
  kubelet=1.30.0-1.1 \
  kubectl=1.30.0-1.1

# Step 6: Restart kubelet
systemctl daemon-reload
systemctl restart kubelet

# Step 7: Uncordon
kubectl uncordon control-plane-1

# Verify
kubectl get nodes
# control-plane-1   Ready   control-plane   v1.30.0
```

### Upgrade Additional Control Plane Nodes

```bash
# On each additional control plane node:

# Step 1: Upgrade kubeadm
apt-get install -y --allow-change-held-packages kubeadm=1.30.0-1.1

# Step 2: Upgrade node (NOT "apply" — only first node uses apply)
kubeadm upgrade node

# Step 3: Drain
kubectl drain control-plane-2 --ignore-daemonsets --delete-emptydir-data

# Step 4: Upgrade kubelet + kubectl
apt-get install -y --allow-change-held-packages \
  kubelet=1.30.0-1.1 \
  kubectl=1.30.0-1.1

systemctl daemon-reload
systemctl restart kubelet

# Step 5: Uncordon
kubectl uncordon control-plane-2
```

### Upgrade Worker Nodes

```bash
# On each worker node:

# Step 1: Upgrade kubeadm
apt-get install -y --allow-change-held-packages kubeadm=1.30.0-1.1

# Step 2: Upgrade node config
kubeadm upgrade node

# Step 3: Drain from control plane
kubectl drain worker-1 --ignore-daemonsets --delete-emptydir-data

# Step 4: Upgrade kubelet + kubectl
apt-get install -y --allow-change-held-packages \
  kubelet=1.30.0-1.1 \
  kubectl=1.30.0-1.1

systemctl daemon-reload
systemctl restart kubelet

# Step 5: Uncordon from control plane
kubectl uncordon worker-1
```

### Verify Upgrade

```bash
# All nodes on new version
kubectl get nodes
# NAME              STATUS   ROLES           VERSION
# control-plane-1   Ready    control-plane   v1.30.0
# control-plane-2   Ready    control-plane   v1.30.0
# worker-1          Ready    <none>          v1.30.0
# worker-2          Ready    <none>          v1.30.0

# All system pods healthy
kubectl get pods -n kube-system

# Check component versions
kubectl get nodes -o jsonpath='{range .items[*]}{.metadata.name}{"\t"}{.status.nodeInfo.kubeletVersion}{"\n"}{end}'
```

### Upgrade Order Summary

```
1. Backup etcd ← CRITICAL
2. Upgrade kubeadm on first control plane
3. kubeadm upgrade apply v1.X.Y ← Only on first CP
4. Drain → upgrade kubelet/kubectl → restart → uncordon (first CP)
5. Repeat steps 2-4 for additional control planes (use "kubeadm upgrade node")
6. Repeat steps 2-4 for each worker node
7. Verify all nodes and pods
```

## Common Issues

**"couldn't upgrade control plane" — etcd not healthy**

Restore etcd from backup, fix the issue, retry. Never force-upgrade past etcd errors.

**Pods stuck Terminating during drain**

Force delete: `kubectl delete pod <name> --grace-period=0 --force`. Or increase drain timeout: `--timeout=300s`.

**API deprecation warnings after upgrade**

Some API versions removed in new releases (e.g., `extensions/v1beta1`). Update manifests to current API versions before upgrading.

**Worker node shows old version after upgrade**

kubelet not restarted. Run: `systemctl daemon-reload && systemctl restart kubelet`.

## Best Practices

- **One minor version at a time** — 1.28→1.29, never skip
- **Backup etcd before every upgrade** — your rollback safety net
- **Drain nodes before upgrading kubelet** — prevents workload disruption
- **Upgrade control plane before workers** — API server must be newest
- **Read release notes** — check for removed APIs and breaking changes
- **Test in staging first** — never upgrade production without validation

## Key Takeaways

- `kubeadm upgrade apply` on first control plane, `kubeadm upgrade node` on all others
- Always: backup etcd → upgrade kubeadm → upgrade node → drain → upgrade kubelet → uncordon
- Only upgrade one minor version at a time
- Control plane nodes first, then workers
- CKA exam frequently tests this procedure — know the exact command order
