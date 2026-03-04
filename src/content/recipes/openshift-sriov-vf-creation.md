---
draft: false
title: "Create SR-IOV VFs on OpenShift with SriovNetworkNodePolicy"
description: "Use the OpenShift SR-IOV Network Operator to create and manage VFs from selected PFs on worker nodes."
category: "networking"
difficulty: "intermediate"
timeToComplete: "25 minutes"
kubernetesVersion: "1.28+"
prerequisites:
  - "OpenShift cluster with SR-IOV Network Operator installed"
  - "Worker nodes with SR-IOV-capable NICs"
  - "oc CLI access"
relatedRecipes:
  - "enable-nic-feature-discovery"
  - "identify-mellanox-nic-models"
  - "validate-sriov-on-multiple-nodes"
tags:
  - "openshift"
  - "sriov"
  - "vf"
  - "network-operator"
  - "mellanox"
publishDate: "2026-02-16"
author: "Luca Berton"
---

> 💡 **Quick Answer:** Define a `SriovNetworkNodePolicy` with the target PFs and `numVfs`, apply it in `openshift-sriov-network-operator`, and verify VF resources appear in node allocatable.


OpenShift creates and reconciles VFs through `SriovNetworkNodePolicy`. Avoid manual VF creation for production clusters.

## Example Node Policy

```yaml
apiVersion: sriovnetwork.openshift.io/v1
kind: SriovNetworkNodePolicy
metadata:
  name: cx7-policy
  namespace: openshift-sriov-network-operator
spec:
  resourceName: mellanoxnics
  nodeSelector:
    kubernetes.io/hostname: "worker-a"
  priority: 90
  numVfs: 16
  mtu: 1500
  deviceType: netdevice
  isRdma: true
  nicSelector:
    rootDevices:
      - "0000:b5:00.0"
      - "0000:db:00.0"
    vendor: "15b3"
    deviceID: "1021"
```

Apply:

```bash
oc apply -f sriov-node-policy.yaml
```

## Verify Reconciliation

```bash
oc -n openshift-sriov-network-operator get sriovnetworknodestate
oc -n openshift-sriov-network-operator get sriovnetworknodestate worker-a -o yaml
```

## Verify Resources Exposed to Scheduler

```bash
oc get node worker-a -o json | jq '.status.allocatable'
```

Expect an extended resource key like:

- `openshift.io/mellanoxnics`

## Notes

- Use worker nodes only, not control-plane nodes.
- Keep PFs dedicated for SR-IOV workloads.
- Prefer explicit `rootDevices` or `pfNames` to avoid selecting unintended NICs.
