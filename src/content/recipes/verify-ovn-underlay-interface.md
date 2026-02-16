---
draft: false
title: "Verify Which Interface Carries OVN Underlay Traffic"
description: "Confirm the actual OVN underlay path by checking ovn-encap-ip, bridge ownership, and route associations."
category: "networking"
difficulty: "intermediate"
timeToComplete: "15 minutes"
kubernetesVersion: "1.28+"
prerequisites:
  - "OpenShift cluster with OVN-Kubernetes"
  - "Node debug access"
  - "ovs-vsctl available on host"
relatedRecipes:
  - "check-bonding-and-interface-status"
  - "troubleshoot-no-supported-nic-selected"
  - "validate-sriov-on-multiple-nodes"
tags:
  - "ovn"
  - "underlay"
  - "openshift"
  - "networking"
  - "debugging"
publishDate: "2026-02-16"
author: "Luca Berton"
---

> 💡 **Quick Answer:** Find OVN encapsulation IP with `ovs-vsctl get Open_vSwitch . external_ids:ovn-encap-ip`, map it to an interface using `ip addr`, then inspect `br-ex` ports to identify the real underlay device.

# Verify Which Interface Carries OVN Underlay Traffic

When troubleshooting SR-IOV and node networking, confirm the interface actually used for OVN underlay instead of guessing by NIC names.

## 1) Get OVN Encapsulation IP

```bash
ovs-vsctl get Open_vSwitch . external_ids:ovn-encap-ip
```

## 2) Map Encapsulation IP to Interface

```bash
ip addr | grep -B2 <encap-ip>
```

## 3) Check External Bridge Ports

```bash
ovs-vsctl list-ports br-ex
```

## 4) Validate Routes

```bash
ip route
```

Correlate default route and subnet routes with the bridge and lower devices.

## Interpretation Pattern

- `ovn-encap-ip` on `br-ex` means overlay tunnel egress is tied to `br-ex`.
- `br-ex` lower port (for example VLAN/bond sub-interface) identifies the practical underlay path.
- Use this mapping before concluding whether a specific PF participates in host network paths.
