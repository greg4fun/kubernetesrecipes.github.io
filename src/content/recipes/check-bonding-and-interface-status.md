---
draft: false
title: "Check Bonding and Interface Status for SR-IOV"
description: "Inspect bond membership, interface state, and link aggregation to confirm which NICs can be correctly targeted by SR-IOV network policies on Kubernetes."
category: "troubleshooting"
difficulty: "intermediate"
timeToComplete: "15 minutes"
kubernetesVersion: "Any"
prerequisites:
  - "Node shell access"
  - "iproute2 and /proc access"
relatedRecipes:
  - "kubernetes-network-troubleshooting"
  - "kubernetes-gateway-api"
  - "identify-mellanox-nic-models"
  - "troubleshoot-no-supported-nic-selected"
  - "verify-ovn-underlay-interface"
  - "debug-imagepullbackoff"
  - "debug-oom-killed"
  - "debug-scheduling-failures"
  - "ephemeral-containers-debugging"
  - "imagepullbackoff-troubleshooting"
  - "kind-local-kubernetes"
  - "kubectl-debugging-commands"
  - "kubectl-plugins-extensions"
  - "stuck-resources-finalizers"
tags:
  - "bonding"
  - "networking"
  - "sriov"
  - "linux"
  - "troubleshooting"
publishDate: "2026-02-16"
author: "Luca Berton"
---

> 💡 **Quick Answer:** Use `ip -o link show | grep master` and `cat /proc/net/bonding/<bond>` to identify which interfaces are bond slaves and avoid selecting those PFs in SR-IOV policies.


Before targeting PFs in SR-IOV policies, verify each interface’s relationship to host networking.

## List Bonds and Slaves

```bash
ip -o link show | grep -E "master|bond"
```

## Inspect Each Bond

```bash
cat /proc/net/bonding/bond0
cat /proc/net/bonding/bond1
```

Look for:

- Slave interfaces
- LACP mode and partner state
- Link speed and status

## Check Single Interface State

```bash
ip link show eno17095np0
```

If output contains `master bondX`, the interface is a bond slave.

## SR-IOV Policy Safety Checklist

- Selector points to intended PFs.
- Target PFs are not accidentally selected via broad filters.
- Node selectors constrain policies to intended workers.

## Useful Companion Checks

```bash
nmcli connection show
ovs-vsctl show
```

Use these to understand how host networking is wired before applying SR-IOV changes.
