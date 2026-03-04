---
draft: false
title: "Fix 'No Supported NIC Is Selected' in SR-IOV"
description: "Diagnose SR-IOV operator webhook rejections by validating node state, label selectors, PF eligibility, and SriovNetworkNodePolicy configuration."
category: "troubleshooting"
difficulty: "advanced"
timeToComplete: "30 minutes"
kubernetesVersion: "1.28+"
prerequisites:
  - "OpenShift SR-IOV Network Operator installed"
  - "oc CLI and cluster-admin permissions"
relatedRecipes:
  - "openshift-sriov-vf-creation"
  - "identify-mellanox-nic-models"
  - "check-bonding-and-interface-status"
tags:
  - "sriov"
  - "troubleshooting"
  - "webhook"
  - "openshift"
  - "nics"
publishDate: "2026-02-16"
author: "Luca Berton"
---

> 💡 **Quick Answer:** When `SriovNetworkNodePolicy` is denied with `no supported NIC is selected`, check `SriovNetworkNodeState`, ensure your selector matches real PFs, and confirm selected interfaces are eligible (not consumed by host networking rules).


This admission error means the operator cannot map your policy selector to eligible interfaces in node state.

## 1) Verify Node State Exists

```bash
oc -n openshift-sriov-network-operator get sriovnetworknodestate
```

If no node states exist, inspect operator config and config-daemon health.

## 2) Validate Selected Interfaces

```bash
oc -n openshift-sriov-network-operator get sriovnetworknodestate <node> -o json \
  | jq '.status.interfaces[] | {name,pciAddress,vendor,deviceID}'
```

Confirm policy selectors (`pfNames`, `rootDevices`, `vendor`, `deviceID`) match these values.

## 3) Check Webhook-Relevant Eligibility

```bash
oc -n openshift-sriov-network-operator get sriovnetworknodestate <node> -o yaml
```

Inspect fields related to support or eligibility and verify chosen PFs are suitable.

## 4) Review Config Daemon Logs

```bash
oc -n openshift-sriov-network-operator logs ds/sriov-network-config-daemon --tail=300
```

Look for discovery errors, permission issues, or selector mismatch indicators.

## Common Causes

- Typo in `rootDevices` PCI address.
- Selector too broad (`vendor` only) captures unsupported or undesired interfaces.
- Node not matched by policy `nodeSelector`.
- Node state not created because operator/controller config is wrong.

## Recovery Pattern

1. Narrow selector to explicit `rootDevices`.
2. Reapply node policy.
3. Confirm `openshift.io/<resourceName>` appears in node allocatable.
