---
title: "K3s v1.37.1+k3s1: What's New and How to Upgrade"
description: "K3s v1.37.1+k3s1 bumps Kubernetes to 1.37.1, hardens the supervisor API, and fixes etcd snapshot restore. Upgrade steps and verification included."
publishDate: "2026-10-27"
author: "Luca Berton"
category: "deployments"
difficulty: "intermediate"
timeToComplete: "20 minutes"
kubernetesVersion: "1.37+"
tags:
  - "k3s"
  - "kubernetes-upgrade"
  - "etcd"
  - "lightweight-kubernetes"
  - "release-notes"
  - "security-hardening"
---
> 💡 **Quick Answer:** K3s v1.37.1+k3s1 bumps Kubernetes to v1.37.1 and ships security hardening (anonymous access to the supervisor router is now rejected, CA hash validation improved), plus fixes for etcd snapshot restore, flannel CNI config propagation, and the deploy controller. Upgrade with the install script or `INSTALL_K3S_VERSION=v1.37.1+k3s1`.

## The Problem

Operators running K3s on the v1.37.0+k3s1 line need to know whether this patch release changes cluster behavior, tightens security defaults, or requires action before upgrading nodes. Two changes in particular — rejecting anonymous access to the supervisor router and stricter CA hash validation — can affect automation or custom tooling that previously relied on looser defaults.

## The Solution

Treat v1.37.1+k3s1 as a standard patch upgrade: back up etcd (if using embedded etcd), update the `k3s` binary/agent on each node via the install script or your package manager, and restart the `k3s`/`k3s-agent` services. Then verify node and control-plane health, and confirm nothing in your stack depends on the now-rejected anonymous supervisor access.

## Whats New

- **Kubernetes bumped to v1.37.1** — see the [upstream changelog](https://github.com/kubernetes/kubernetes/blob/master/CHANGELOG/CHANGELOG-1.37.md#changelog-since-v1370) for API/kubelet changes.
- **Security: reject anonymous access to supervisor router** (spegel/pprof/metrics) — [#14701](https://github.com/k3s-io/k3s/pull/14701). Any tooling scraping pprof/metrics anonymously against the supervisor port will now get rejected and needs a valid token/kubeconfig.
- **Improved CA hash validation** — [#14705](https://github.com/k3s-io/k3s/pull/14705). Joining agents with a mismatched/malformed `--token` CA hash will fail faster/clearer; double-check join tokens in automation.
- **Fix restore from compressed etcd snapshot** (#14528) — important if you use `k3s etcd-snapshot save --snapshot-compress` and restore workflows.
- **ServiceLB: multiple lbpools** (#14547) — Klipper LB now supports multiple load balancer pools.
- **Fix `--flannel-cni-conf` not reaching the embedded flannel** (#14598) — custom flannel CNI config flags now apply correctly.
- **Fix deploy controller not re-applying manifests when mtime is pinned to epoch** (#14568) — affects AutoDeploy manifests baked into images with reset timestamps.
- **Enable seccomp in riscv64 builds** (#14529).
- **`check-config`: suppress colors when stdout is not a terminal** (#14595) — cleaner output in CI logs.
- Dependency bumps: etcd → v3.7.1-k3s3 (nonblocking logging), kine → v0.17.1, k3s-io/api → v0.2.0, helm-controller → v0.17.9, cadvisor → v0.60.5-k3s1.

Full embedded component table is in the [release notes](https://github.com/k3s-io/k3s/releases/tag/v1.37.1%2Bk3s1).

## Upgrade Steps

This is the first tracked release for this cluster in this recipe set, so steps cover both fresh install and upgrade from any v1.37.0+k3s1-based install.

**Fresh install (server node):**

```bash
curl -sfL https://get.k3s.io | INSTALL_K3S_VERSION=v1.37.1+k3s1 sh -
```

**Upgrade an existing node (server or agent) in place:**

```bash
# Take an etcd snapshot first if using embedded etcd (HA setups)
sudo k3s etcd-snapshot save --name pre-upgrade-1.37.1

# Re-run the installer pinned to the new version
curl -sfL https://get.k3s.io | INSTALL_K3S_VERSION=v1.37.1+k3s1 sh -

# Restart the service explicitly if the installer doesn't
sudo systemctl restart k3s   # on servers
sudo systemctl restart k3s-agent   # on agents
```

**Upgrade via System Upgrade Controller (recommended for multi-node clusters):**

```yaml
# plan-server.yaml
apiVersion: upgrade.cattle.io/v1
kind: Plan
metadata:
  name: k3s-server-plan
  namespace: system-upgrade
spec:
  concurrency: 1
  version: v1.37.1+k3s1
  nodeSelector:
    matchExpressions:
      - key: node-role.kubernetes.io/control-plane
        operator: In
        values: ["true"]
  serviceAccountName: system-upgrade
  cordon: true
  upgrade:
    image: rancher/k3s-upgrade
```

```bash
kubectl apply -f plan-server.yaml
```

Apply an equivalent `Plan` for agent nodes with `node-role.kubernetes.io/control-plane` excluded and `concurrency` sized to your worker pool.

## Verify

```bash
# Confirm binary/agent version on each node
k3s --version
# Expect: k3s version v1.37.1+k3s1 (go1.xx)

# Confirm the cluster reports the new version
kubectl get nodes -o wide
# Expect KUBELET-VERSION column to show v1.37.1+k3s1

# Confirm core components are Ready
kubectl get pods -A | grep -Ev 'Running|Completed'

# If using embedded etcd, confirm the snapshot was created
sudo k3s etcd-snapshot ls
```

## Common Issues

- **Anonymous scraping of pprof/metrics on the supervisor port (6443) now fails** after #14701. Update monitoring/debug tooling to authenticate with a valid kubeconfig or token instead of relying on anonymous access.
- **Agents failing to join with a token error** after upgrade — stricter CA hash validation (#14705) may surface previously-silent token/hash mismatches. Regenerate the join token with `k3s token create` if agents fail to register.
- **Custom `--flannel-cni-conf` previously ignored** — if you were working around the old bug (#14598) with a manual patch, remove the workaround after upgrading, since it now applies correctly and could conflict.
- **ServiceLB behavior change** if you use multiple LB pools (#14547) — review `svccontroller.k3s.cattle.io/lbpool` annotations on Services to confirm pool assignment still matches expectations.

## Best Practices

- Always take an `k3s etcd-snapshot save` before upgrading HA (embedded etcd) clusters.
- Pin `INSTALL_K3S_VERSION` explicitly in automation/IaC rather than tracking `stable` or `latest`, to control rollout timing.
- Upgrade control-plane (server) nodes one at a time with `cordon: true` via the System Upgrade Controller before rolling agents.
- Audit any external tooling (monitoring, debuggers) that talks to the supervisor port anonymously and switch it to authenticated access ahead of time.
- After upgrade, diff `kubectl get nodes -o wide` and `k3s --version` across all nodes to confirm a consistent fleet version before considering the rollout complete.
