---
draft: false
title: "Fix nv-ipam 'Pool Not Found' Errors in Multus"
description: "Fix nv-ipam IPPool lookup failures in Multus by aligning SriovNetwork, NetworkAttachmentDefinition, and IPPool names and namespaces correctly."
category: "troubleshooting"
difficulty: "advanced"
timeToComplete: "20 minutes"
kubernetesVersion: "1.28+"
prerequisites:
  - "SR-IOV + Multus networking in use"
  - "NVIDIA nv-ipam configured"
  - "Access to pod events and cluster CRs"
relatedRecipes:
  - "configure-sriovnetwork-nv-ipam"
  - "create-nv-ipam-ippool"
  - "openshift-sriov-vf-creation"
tags:
  - "nv-ipam"
  - "multus"
  - "sriov"
  - "troubleshooting"
  - "ippool"
publishDate: "2026-02-16"
author: "Luca Berton"
---

> 💡 **Quick Answer:** If pod events show `pool ... not found`, verify the `IPPool` exists in the workload namespace, ensure `SriovNetwork` points to the same pool name, and check generated NAD `ipam.poolName`.


Typical event:

```text
failed to set up IPAM plugin type "nv-ipam": configuration for pool "<name>", poolType "ippool" not found
```

## 1) Verify IPPool Existence

```bash
oc get ippool -A
```

Confirm there is exactly one intended pool name per target namespace.

## 2) Verify SriovNetwork Configuration

```bash
oc get sriovnetwork -n openshift-sriov-network-operator <name> -o yaml
```

Check:

- `spec.networkNamespace`
- `spec.ipam.poolName`

## 3) Verify Generated NAD

```bash
oc get network-attachment-definition -n <workload-namespace> <name> -o yaml
```

Check `spec.config` includes matching `poolName`.

## 4) Check nv-ipam Components

```bash
oc get pods -A | grep -i ipam
```

## Common Misconfigurations

- IPPool created in wrong namespace.
- Duplicate pool names across namespaces causing confusion.
- Stale generated NAD after `SriovNetwork` changes.
- Missing or unhealthy nv-ipam controller components.

## Recovery Pattern

1. Fix `IPPool` in the workload namespace.
2. Reconcile `SriovNetwork`.
3. Delete/recreate affected pod so CNI chain re-runs.
