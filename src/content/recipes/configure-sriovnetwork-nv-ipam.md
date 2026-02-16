---
draft: false
title: "Configure SriovNetwork with NVIDIA nv-ipam"
description: "Create a SriovNetwork that auto-generates a Multus NAD using nv-ipam for SR-IOV secondary interfaces."
category: "networking"
difficulty: "advanced"
timeToComplete: "20 minutes"
kubernetesVersion: "1.28+"
prerequisites:
  - "OpenShift SR-IOV Network Operator"
  - "NVIDIA nv-ipam components deployed"
  - "SR-IOV resource available on worker nodes"
relatedRecipes:
  - "create-nv-ipam-ippool"
  - "troubleshoot-nv-ipam-pool-not-found"
  - "openshift-sriov-vf-creation"
tags:
  - "sriovnetwork"
  - "nv-ipam"
  - "multus"
  - "openshift"
  - "nvidia"
publishDate: "2026-02-16"
author: "Luca Berton"
---

> 💡 **Quick Answer:** Create `SriovNetwork` in `openshift-sriov-network-operator`, set `networkNamespace` to the workload namespace, and configure `ipam` with `{"type":"nv-ipam","poolName":"<pool>"}`.

# Configure SriovNetwork with NVIDIA nv-ipam

`SriovNetwork` lets the SR-IOV operator generate and maintain the corresponding `NetworkAttachmentDefinition` automatically.

## Example SriovNetwork

```yaml
apiVersion: sriovnetwork.openshift.io/v1
kind: SriovNetwork
metadata:
  name: tenant-a
  namespace: openshift-sriov-network-operator
spec:
  vlan: 0
  networkNamespace: "tenant-a"
  resourceName: "mellanoxnics"
  ipam: |
    {
      "type": "nv-ipam",
      "poolName": "tenant-a"
    }
```

Apply it:

```bash
oc apply -f sriovnetwork.yaml
```

## Verify Generated NAD

```bash
oc get network-attachment-definition -n tenant-a tenant-a -o yaml
```

Confirm NAD includes:

- `type: sriov`
- `resourceName: openshift.io/mellanoxnics` annotation
- `ipam.type: nv-ipam`

## Important Rules

- Keep `SriovNetwork` CR in `openshift-sriov-network-operator` when `networkNamespace` is used.
- Do not hand-edit generated NADs for long-term changes; update the owning `SriovNetwork`.
- Ensure matching `IPPool` exists in the workload namespace.
