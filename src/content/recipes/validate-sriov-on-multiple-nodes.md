---
draft: false
title: "Validate SR-IOV Operator Health Across Multiple Worker Nodes"
description: "Run a full checklist to confirm SR-IOV discovery, VF creation, scheduler resources, and pod attachment on multiple nodes."
category: "troubleshooting"
difficulty: "intermediate"
timeToComplete: "30 minutes"
kubernetesVersion: "1.28+"
prerequisites:
  - "At least two worker nodes"
  - "SR-IOV Network Operator installed"
  - "A working SriovNetworkNodePolicy"
relatedRecipes:
  - "openshift-sriov-vf-creation"
  - "configure-sriovnetwork-nv-ipam"
  - "troubleshoot-no-supported-nic-selected"
tags:
  - "sriov"
  - "validation"
  - "multinode"
  - "openshift"
  - "operator"
publishDate: "2026-02-16"
author: "Luca Berton"
---

> 💡 **Quick Answer:** Validate daemon pods, node states, VF counts, and allocatable resources on each worker; then schedule one SR-IOV test pod per node and confirm secondary interface attachment.

# Validate SR-IOV Operator Health Across Multiple Worker Nodes

Use this checklist for nodes such as `worker-a` and `worker-b`.

## 1) Config Daemon on Each Worker

```bash
oc get pods -n openshift-sriov-network-operator -o wide | grep sriov-network-config-daemon
```

## 2) NodeState for Each Worker

```bash
oc get sriovnetworknodestate -n openshift-sriov-network-operator
```

## 3) Verify Target Interfaces in NodeState

```bash
oc get sriovnetworknodestate worker-a -n openshift-sriov-network-operator -o json | jq '.status.interfaces[] | {name,pciAddress,numVfs}'
oc get sriovnetworknodestate worker-b -n openshift-sriov-network-operator -o json | jq '.status.interfaces[] | {name,pciAddress,numVfs}'
```

## 4) Verify Scheduler Resources on Both Nodes

```bash
oc get node worker-a -o json | jq '.status.allocatable'
oc get node worker-b -o json | jq '.status.allocatable'
```

## 5) Run One Pod Per Node

Pin test pods with `nodeSelector` and request the SR-IOV resource (for example `openshift.io/mellanoxnics: 1`).

## 6) Confirm Secondary Interface in Pod

```bash
oc exec -n <ns> <pod-name> -- ip a
```

You should see an extra interface (for example `net1`) from the SR-IOV network attachment.

## Success Criteria

- Both nodes expose expected SR-IOV allocatable resources.
- Pod networking succeeds on both nodes.
- No repeated CNI/IPAM errors in pod events.
