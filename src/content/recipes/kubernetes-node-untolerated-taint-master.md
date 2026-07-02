---
title: "Fix Untolerated Taint node-role master"
description: "Fix 'node untolerated taint node-role.kubernetes.io/master' scheduling error. Remove or tolerate control plane taints to schedule pods on master nodes."
publishDate: "2026-05-02"
author: "Luca Berton"
category: "troubleshooting"
difficulty: "beginner"
timeToComplete: "5 minutes"
kubernetesVersion: "1.28+"
tags:
  - "taints"
  - "tolerations"
  - "scheduling"
  - "control-plane"
  - "troubleshooting"
relatedRecipes:
  - "kubernetes-taints-tolerations-guide"
  - "kubernetes-taint-toleration-guide"
  - "debug-scheduling-failures"
---

> 💡 **Quick Answer:** The error `0/3 nodes are available: 1 node(s) had untolerated taint {node-role.kubernetes.io/master: }` means your pod can't schedule because all/some nodes are control plane nodes with the `master` taint. Fix it by either: (1) adding a toleration to your pod: `tolerations: [{key: "node-role.kubernetes.io/master", effect: "NoSchedule"}]`, or (2) removing the taint from the node: `kubectl taint nodes <node> node-role.kubernetes.io/master:NoSchedule-`.

## The Problem

Pods stay in `Pending` with this event:

```
Warning  FailedScheduling  0/3 nodes are available: 
  1 node(s) had untolerated taint {node-role.kubernetes.io/master: }, 
  2 node(s) had untolerated taint {node-role.kubernetes.io/control-plane: }
```

This happens because:

- Kubernetes taints control-plane nodes to prevent workloads from scheduling there
- Single-node clusters (dev/test) have only the control-plane node
- K8s 1.24+ uses `control-plane` taint, older versions use `master`

## The Solution

### Option 1: Add Toleration to Pod

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: my-app
spec:
  template:
    spec:
      tolerations:
      # Tolerate both old and new taint names
      - key: "node-role.kubernetes.io/master"
        operator: "Exists"
        effect: "NoSchedule"
      - key: "node-role.kubernetes.io/control-plane"
        operator: "Exists"
        effect: "NoSchedule"
      containers:
      - name: app
        image: nginx
```

### Option 2: Remove Taint from Node

```bash
# Remove master taint (note the trailing minus -)
kubectl taint nodes my-node node-role.kubernetes.io/master:NoSchedule-
# node/my-node untainted

# Remove control-plane taint (K8s 1.24+)
kubectl taint nodes my-node node-role.kubernetes.io/control-plane:NoSchedule-

# Remove from ALL control-plane nodes
kubectl taint nodes --all node-role.kubernetes.io/control-plane:NoSchedule-
kubectl taint nodes --all node-role.kubernetes.io/master:NoSchedule-
```

### Option 3: kubeadm Single-Node Setup

```bash
# During cluster init — allow scheduling on control plane
kubeadm init --config kubeadm-config.yaml

# Then untaint
kubectl taint nodes --all node-role.kubernetes.io/control-plane-

# For k3s — no taint by default (single-node friendly)
# For minikube — no taint by default
# For kind — remove taint:
kubectl taint nodes kind-control-plane node-role.kubernetes.io/control-plane:NoSchedule-
```

### Check Current Taints

```bash
# View taints on all nodes
kubectl get nodes -o custom-columns=NAME:.metadata.name,TAINTS:.spec.taints

# Detailed view
kubectl describe node my-node | grep -A5 Taints
# Taints:    node-role.kubernetes.io/control-plane:NoSchedule

# JSON query
kubectl get nodes -o jsonpath='{range .items[*]}{.metadata.name}{"\t"}{.spec.taints}{"\n"}{end}'
```

### Taint Names by K8s Version

| K8s Version | Taint Key | Status |
|-------------|-----------|--------|
| < 1.20 | `node-role.kubernetes.io/master` | Only taint |
| 1.20-1.24 | Both `master` and `control-plane` | Transition |
| ≥ 1.25 | `node-role.kubernetes.io/control-plane` | `master` removed |

## Common Issues

**Both taints present on same node**

Clusters upgraded from old versions may have both. Remove both:
```bash
kubectl taint nodes my-node node-role.kubernetes.io/master:NoSchedule- 2>/dev/null
kubectl taint nodes my-node node-role.kubernetes.io/control-plane:NoSchedule- 2>/dev/null
```

**Taint comes back after reboot**

kubeadm re-applies taints. Add `--control-plane-taint=""` to kubeadm config or use a post-boot script.

**Should I run workloads on control-plane nodes?**

For dev/test/single-node: yes, remove the taint. For production: keep the taint — control-plane needs resources for etcd/apiserver.

## Best Practices

- **Production:** Keep control-plane taints — protect etcd and kube-apiserver stability
- **Dev/single-node:** Remove taints to use all available resources
- **Tolerate both names** in pod specs for cross-version compatibility
- **Use `operator: Exists`** — matches the taint regardless of value

## Key Takeaways

- `node-role.kubernetes.io/master` is the old taint (pre-1.25), `control-plane` is the new one
- Remove taint with trailing `-`: `kubectl taint nodes <node> <key>:NoSchedule-`
- Add `tolerations` to pods if you want them on control-plane nodes
- Single-node clusters must either remove the taint or add tolerations to all workloads
