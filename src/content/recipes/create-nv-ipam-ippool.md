---
draft: false
title: "Create an NVIDIA nv-ipam IPPool for SR-IOV Networks"
description: "Define a valid nv-ipam IPPool and sizing strategy so SR-IOV workloads can get secondary interface IPs."
category: "networking"
difficulty: "advanced"
timeToComplete: "15 minutes"
kubernetesVersion: "1.28+"
prerequisites:
  - "NVIDIA nv-ipam controller deployed"
  - "Target workload namespace created"
  - "SriovNetwork using nv-ipam"
relatedRecipes:
  - "configure-sriovnetwork-nv-ipam"
  - "troubleshoot-nv-ipam-pool-not-found"
  - "validate-sriov-on-multiple-nodes"
tags:
  - "nv-ipam"
  - "ippool"
  - "sriov"
  - "ipam"
  - "multus"
publishDate: "2026-02-16"
author: "Luca Berton"
---

> 💡 **Quick Answer:** Create one `IPPool` in the same namespace as workloads and NAD, set `poolType: ippool`, and choose a subnet/block size combination that fits your node and pod scale.

# Create an NVIDIA nv-ipam IPPool for SR-IOV Networks

`nv-ipam` allocates addresses from `IPPool` resources. Namespace and sizing must be consistent with your workload.

## Example IPPool

```yaml
apiVersion: nv-ipam.nvidia.com/v1alpha1
kind: IPPool
metadata:
  name: tenant-a
  namespace: tenant-a
spec:
  poolType: ippool
  subnet: 10.233.215.96/28
  gateway: 10.233.215.97
  perNodeBlockSize: 8
```

Apply:

```bash
oc apply -f ippool.yaml
```

## Validate

```bash
oc get ippool -n tenant-a
```

## Sizing Guidance

- `/28` has 16 addresses total; use small block sizes.
- `perNodeBlockSize` must fit available addresses after gateway/network reservations.
- Use larger subnets for larger node counts or high SR-IOV density.

## Namespace Rule

Create the pool in the same namespace used by workloads and generated NAD (for example `tenant-a`).
