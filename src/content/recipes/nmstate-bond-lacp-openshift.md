---
title: "NMState Bond LACP Configuration OpenShift"
description: "Configure LACP bonding with NMState on OpenShift nodes. NodeNetworkConfigurationPolicy for 802.3ad bonds, storage network bonds, VLAN tagging, and bond monitoring with NMState operator."
publishDate: "2026-04-30"
author: "Luca Berton"
category: "networking"
difficulty: "advanced"
timeToComplete: "20 minutes"
kubernetesVersion: "1.28+"
tags:
  - "nmstate"
  - "bonding"
  - "lacp"
  - "openshift"
  - "networking"
  - "storage"
relatedRecipes:
  - "lacp-storage-switch-kubernetes"
  - "nmstate-nncp-configuration-openshift"
  - "nfs-tenant-segregation-kubernetes"
  - "configure-gpudirect-rdma-gpu-operator"
---

> 💡 **Quick Answer:** Use NMState's `NodeNetworkConfigurationPolicy` (NNCP) to configure LACP bonds on OpenShift nodes declaratively. Set `mode: 802.3ad`, `options.xmit_hash_policy: layer3+4` (critical for NFS/storage traffic distribution), and `options.miimon: 100` for link monitoring. NMState applies the config via NetworkManager and reconciles drift automatically.

## The Problem

Bare-metal OpenShift nodes need link aggregation for:

- Storage network bandwidth (NFS, iSCSI, Ceph)
- Redundancy — survive single link failure
- GPU/RDMA traffic distribution across multiple NICs
- Separation of management, storage, and compute networks

Manual bonding with `nmcli` or MachineConfig is fragile and doesn't reconcile drift. NMState makes it declarative.

## The Solution

### Basic LACP Bond

```yaml
apiVersion: nmstate.io/v1
kind: NodeNetworkConfigurationPolicy
metadata:
  name: bond-storage
spec:
  nodeSelector:
    node-role.kubernetes.io/worker: ""
  desiredState:
    interfaces:
    - name: bond0
      type: bond
      state: up
      ipv4:
        address:
        - ip: 10.30.0.0
          prefix-length: 24
        dhcp: false
        enabled: true
      ipv6:
        enabled: false
      link-aggregation:
        mode: 802.3ad
        port:
        - ens3f0
        - ens3f1
        options:
          xmit_hash_policy: layer3+4    # Distributes NFS traffic across links
          lacp_rate: fast               # LACPDU every 1s (vs 30s for slow)
          miimon: "100"                 # Link check every 100ms
          ad_select: bandwidth          # Select active aggregator by bandwidth
```

**Why `layer3+4` is critical for storage:**

| Hash Policy | Distributes By | NFS Problem |
|-------------|---------------|-------------|
| `layer2` | MAC address | Single TCP connection = single link |
| `layer2+3` | MAC + IP | Same problem for single server |
| **`layer3+4`** | **IP + port** | **Each NFS mount uses different source port → distributes** |

### LACP Bond with VLAN

```yaml
apiVersion: nmstate.io/v1
kind: NodeNetworkConfigurationPolicy
metadata:
  name: bond-storage-vlan
spec:
  nodeSelector:
    node-role.kubernetes.io/worker: ""
  desiredState:
    interfaces:
    # Bond interface (no IP)
    - name: bond0
      type: bond
      state: up
      ipv4:
        enabled: false
      link-aggregation:
        mode: 802.3ad
        port:
        - ens3f0
        - ens3f1
        options:
          xmit_hash_policy: layer3+4
          miimon: "100"
    
    # VLAN on top of bond
    - name: bond0.100
      type: vlan
      state: up
      vlan:
        base-iface: bond0
        id: 100
      ipv4:
        address:
        - ip: 10.30.0.0
          prefix-length: 24
        dhcp: false
        enabled: true
```

### Per-Node IP Assignment

```yaml
# Use node-specific NNCPs for different IPs
apiVersion: nmstate.io/v1
kind: NodeNetworkConfigurationPolicy
metadata:
  name: bond-storage-worker-1
spec:
  nodeSelector:
    kubernetes.io/hostname: worker-1
  desiredState:
    interfaces:
    - name: bond0
      type: bond
      state: up
      ipv4:
        address:
        - ip: 10.30.0.11
          prefix-length: 24
        dhcp: false
        enabled: true
      link-aggregation:
        mode: 802.3ad
        port:
        - ens3f0
        - ens3f1
        options:
          xmit_hash_policy: layer3+4
          miimon: "100"

---
apiVersion: nmstate.io/v1
kind: NodeNetworkConfigurationPolicy
metadata:
  name: bond-storage-worker-2
spec:
  nodeSelector:
    kubernetes.io/hostname: worker-2
  desiredState:
    interfaces:
    - name: bond0
      type: bond
      state: up
      ipv4:
        address:
        - ip: 10.30.0.12
          prefix-length: 24
        dhcp: false
        enabled: true
      link-aggregation:
        mode: 802.3ad
        port:
        - ens3f0
        - ens3f1
        options:
          xmit_hash_policy: layer3+4
          miimon: "100"
```

### Verify Bond Status

```bash
# Check NNCP status
oc get nncp
# NAME              STATUS      REASON
# bond-storage      Available   SuccessfullyConfigured

# Check NodeNetworkState
oc get nns worker-1 -o yaml | yq '.status.currentState.interfaces[] | select(.name == "bond0")'

# On the node directly
oc debug node/worker-1 -- chroot /host cat /proc/net/bonding/bond0
# Ethernet Channel Bonding Driver: v6.1.0
# Bonding Mode: IEEE 802.3ad Dynamic link aggregation
# Transmit Hash Policy: layer3+4 (1)
# LACP rate: fast
# 
# Slave Interface: ens3f0
#   MII Status: up
#   Speed: 25000 Mbps
#   Link Failure Count: 0
#   802.3ad info:
#     LACP active: active
#
# Slave Interface: ens3f1
#   MII Status: up
#   Speed: 25000 Mbps

# Verify LACP partner (switch must also be configured)
oc debug node/worker-1 -- chroot /host \
  cat /proc/net/bonding/bond0 | grep "Partner Mac"
# Partner Mac Address: 00:1a:2b:3c:4d:5e  ← Switch MAC
```

### NFS with nconnect on Bond

```bash
# Critical: Use nconnect to utilize bond bandwidth
# Single TCP connection can't exceed one link's speed

# Mount with nconnect=8 (8 TCP connections → distributes across bond)
mount -t nfs -o nconnect=8,vers=4.1 10.30.0.1:/export/data /mnt/data

# In Kubernetes PV:
# mountOptions:
# - nconnect=8
# - vers=4.1
```

Without `nconnect`, a single NFS mount uses one TCP connection → one bond member → 25 Gbps max even with 2×25 Gbps bond.

## Common Issues

**NNCP stuck in "Progressing" forever**

NetworkManager can't apply the config. Check NMState handler logs: `oc logs -n openshift-nmstate ds/nmstate-handler`. Common cause: port interface names don't match actual NIC names on the node.

**Bond created but no LACP partner**

Switch ports not configured for LACP. Verify switch-side: channel-group mode active, LACP rate matches. Check `Partner Mac Address` in `/proc/net/bonding/bond0` — empty means no LACP negotiation.

**Bond falls back to single link**

`lacp_rate: slow` (default 30s) can cause timeouts. Use `fast` for 1s LACPDU interval. Also check `ad_select: bandwidth` to prefer the aggregator with most links.

**NFS throughput not exceeding single link speed**

Missing `nconnect` mount option. Each TCP connection hashes to one bond member. `nconnect=8` creates 8 connections → `layer3+4` distributes them.

## Best Practices

- **`xmit_hash_policy: layer3+4`** — only policy that distributes NFS/storage traffic
- **`nconnect=8` for NFS** — critical for utilizing bond bandwidth
- **`lacp_rate: fast`** — 1s LACPDU for faster failover detection
- **`miimon: 100`** — check link every 100ms
- **Match switch LACP config** — both sides must agree on mode and rate
- **Use NNCP not MachineConfig** — NMState reconciles drift, MC is one-shot

## Key Takeaways

- NMState NNCP makes LACP bonding declarative and drift-resistant on OpenShift
- `802.3ad` mode requires matching LACP configuration on the switch
- `layer3+4` hash policy is mandatory for distributing storage (NFS) traffic across bond members
- `nconnect=8` on NFS mounts is required to actually use the bond bandwidth
- NMState applies config via NetworkManager and continuously reconciles
- Per-node NNCPs with `nodeSelector` handle different IP assignments
