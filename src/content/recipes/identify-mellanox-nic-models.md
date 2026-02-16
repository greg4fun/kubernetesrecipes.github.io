---
draft: false
title: "Identify Mellanox Interface Models from Linux and PCI Data"
description: "Map interface names to PCI addresses and Mellanox model generations to build accurate SR-IOV policies."
category: "troubleshooting"
difficulty: "intermediate"
timeToComplete: "15 minutes"
kubernetesVersion: "Any"
prerequisites:
  - "Shell access on worker nodes"
  - "ethtool and lspci utilities"
relatedRecipes:
  - "openshift-sriov-vf-creation"
  - "troubleshoot-no-supported-nic-selected"
  - "check-bonding-and-interface-status"
tags:
  - "mellanox"
  - "connectx"
  - "pci"
  - "sriov"
  - "troubleshooting"
publishDate: "2026-02-16"
author: "Luca Berton"
---

> 💡 **Quick Answer:** Map each interface with `readlink -f /sys/class/net/<iface>/device`, then run `lspci -nn -s <pci>` and `ethtool -i <iface>` to identify model and firmware before writing SR-IOV selectors.

# Identify Mellanox Interface Models from Linux and PCI Data

Correct NIC model mapping prevents wrong SR-IOV policy selectors.

## Collect Interface-to-PCI Mapping

```bash
for iface in eno16995np0 eno17095np0 eno17195np0; do
  echo "=== $iface ==="
  pci=$(basename "$(readlink -f /sys/class/net/$iface/device)")
  echo "PCI: $pci"
  lspci -nn -s "$pci"
  ethtool -i "$iface" | grep -E 'driver|firmware-version|bus-info'
done
```

## Build a Mapping Table

Capture at least:

- Interface name
- PCI address
- Vendor/device ID (`15b3:xxxx`)
- Driver (`mlx5_core`)
- Firmware version

## Use Mapping in Policies

Prefer `rootDevices` + `deviceID` selectors:

```yaml
nicSelector:
  rootDevices:
    - "0000:b5:00.0"
  vendor: "15b3"
  deviceID: "1021"
```

## Why This Matters

- Prevents selecting bonded or unrelated interfaces.
- Reduces webhook admission errors.
- Makes policy behavior deterministic across reboots and renames.
