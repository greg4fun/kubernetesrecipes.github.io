---
title: "Cilium v1.20.2: What's New and How to Upgrade"
description: "Cilium v1.20.2 patch release: Gateway API hostNetwork node selector plus 30+ bugfixes for IPAM, BGP, ClusterMesh, and more."
publishDate: "2026-10-12"
author: "Luca Berton"
category: "networking"
difficulty: "intermediate"
timeToComplete: "15 minutes"
kubernetesVersion: "1.28+"
tags:
  - "cilium"
  - "ebpf"
  - "cni"
  - "gateway-api"
  - "clustermesh"
  - "upgrade"
  - "patch-release"
---
> 💡 **Quick Answer:** Cilium v1.20.2 is a patch release with one minor feature (node label selector for Gateway API when `hostNetwork` is enabled) and over 30 bugfixes covering AWS ENI IPAM, BGP, ClusterMesh, LocalRedirectPolicy, and agent stability. No breaking changes; upgrade is routine via Helm.

## The Problem

Running Cilium 1.20.x (or earlier 1.19/1.15 clusters) exposes several known issues fixed in this release: ENI IPAM operators mishandling prefix-delegated IPs, agent crashes from concurrent map iteration/write, BGP default-gateway auto-discovery picking the wrong routing table, L2 announcement traffic drops with `externalTrafficPolicy: Local`, stale network policy revisions after pod creation, and CRD version loss (`CiliumNodeConfig v2alpha1`) breaking upgrades from clusters originally created on v1.15 or earlier.

## The Solution

Upgrade to v1.20.2. It is a drop-in patch release for the 1.20 branch — no CRD schema changes, no Helm value renames, no agent config flag removals noted in the release.

## What's New

**Minor change:**
- Gateway API: node label selector support for when `hostNetwork` is enabled (cilium/cilium#48636, upstream #47463).

**Notable bugfixes (non-exhaustive, see release notes for full list):**
- `aws/ipam`: fixed prefix-IP release and allocation bugs in ENI prefix-delegation mode (#48418, #48125, #48193).
- `bpf`: fixed agent crash when dumping map events (#48378); fixed missing drop metrics when `policy-deny-response: icmp` is enabled (#48550/#48407).
- Fixed `fatal error: concurrent map iteration and map write` crash during policy recompute under pod churn, especially with named-port policies (#48735/#48098).
- Cluster Mesh: fixed rare race condition where a removed remote cluster wasn't disconnected cleanly (#48262); fixed etcd user role cleanup on config change (#47915, no impact if using the Helm-provided config).
- BGP: fixed `defaultGateway` peer auto-discovery picking a route from a non-main table instead of the node's real default gateway (#47971).
- Fixed L2Announcement traffic drops with `externalTrafficPolicy: Local` (#46399).
- Fixed stale policy revision (up to 2 minutes) reported by pods created right after a network policy change (#47642).
- Fixed upgrade failure for clusters originally created in v1.15 or earlier due to dropped `CiliumNodeConfig` v2alpha1 CRD version (#48087).
- Fixed five silently-ignored config options: `vtep-sync-interval`, `enable-xt-socket-fallback`, `eni-delete-on-termination` with custom CNI config, `enableIdentityMark` Helm value outside chaining mode, and `lb-retry-backoff-max` (#47635).
- Multiple regressions fixed in LocalRedirectPolicy (#46638).
- Fixed IPv6 Router Solicitation/Advertisement drops ("Unsupported protocol for NAT masquerade") on link-local BPF masquerade addresses (#48094).
- Fixed node-init startup failure on recent GKE node images by detecting GKE from the kubelet path (#47945).

## Upgrade Steps

Check current version first:

```bash
cilium version
helm list -n kube-system | grep cilium
```

Upgrade via Helm (adjust values file/flags to match your existing install):

```bash
helm repo update cilium
helm upgrade cilium cilium/cilium \
 --version 1.20.2 \
 --namespace kube-system \
 --reuse-values
```

Or with the `cilium` CLI:

```bash
cilium upgrade --version 1.20.2
```

Roll the agent DaemonSet and operator if Helm doesn't trigger it automatically:

```bash
kubectl -n kube-system rollout restart daemonset/cilium
kubectl -n kube-system rollout restart deployment/cilium-operator
```

## Verify

```bash
cilium status --wait
kubectl -n kube-system get pods -l k8s-app=cilium -o jsonpath='{.items[*].spec.containers[0].image}'
cilium connectivity test
```

Confirm the agent image reports `v1.20.2` and `cilium status` shows all components healthy (KVStore, Controllers, Cluster health all OK).

## Common Issues

- **Upgrading from v1.15 or earlier clusters**: this release specifically fixes a CRD-dropping bug (`CiliumNodeConfig v2alpha1`) that could break such upgrades — apply CRDs explicitly if `helm upgrade` skips them (`--skip-crds=false`, the Helm default).
- **AWS ENI with prefix delegation**: if nodes were stuck failing to allocate IPs on exhausted-prefix subnets before upgrading, expect the operator to recover automatically after the upgrade; watch `cilium-operator` logs for ENI allocation errors clearing.
- **BGP defaultGateway peering**: if BGP sessions were previously established via the wrong routing table, re-verify peer state after upgrade with `cilium bgp peers`.

## Best Practices

- Pin the Helm chart version explicitly (`--version 1.20.2`) rather than relying on `latest` to keep rollouts reproducible.
- Run `cilium connectivity test` in a staging cluster before rolling to production, given the number of datapath-level fixes (NAT, masquerade, L2Announcement) in this release.
- Review the full release notes for the complete bugfix list before upgrading large ClusterMesh or BGP deployments: https://github.com/cilium/cilium/releases/tag/v1.20.2
