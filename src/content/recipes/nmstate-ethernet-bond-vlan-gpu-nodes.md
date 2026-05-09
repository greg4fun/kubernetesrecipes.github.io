---
title: "NMState Network Config for GPU Worker Nodes"
description: "Declaratively configure Ethernet bonding, VLANs, MTU, and static routes on GPU worker nodes using NMState on OpenShift. Covers bonding modes, LACP for storage, jumbo frames for RDMA, and NodeNetworkConfigurationPolicy CRDs."
tags:
  - "nmstate"
  - "bonding"
  - "vlan"
  - "openshift"
  - "networking"
category: "networking"
publishDate: "2026-05-09"
author: "Luca Berton"
difficulty: "intermediate"
relatedRecipes:
  - "openshift-multus-cni-multiple-networks"
  - "dual-fabric-mellanox-gpu-storage-ethernet-infiniband"
  - "roce-pfc-ecn-lossless-ethernet-gpu"
  - "openshift-machineconfig-kernel-gpu"
---

> 💡 **Quick Answer:** NMState (`NodeNetworkConfigurationPolicy`) declaratively manages host networking on OpenShift nodes — bonding, VLANs, MTU, static routes — without SSH. For GPU nodes, use it to configure jumbo frames (MTU 9000) on RDMA interfaces, bonding for storage networks, and VLAN tags for traffic isolation.

## The Problem

GPU worker nodes need complex networking:

- Jumbo frames (MTU 9000) on RDMA-capable interfaces for maximum throughput
- Bonding on storage NICs for redundancy and bandwidth aggregation
- VLANs to separate GPU fabric, storage, and management traffic
- Static routes for non-default networks
- All of this needs to survive reboots and be consistent across nodes
- Manual `nmcli` via SSH doesn't scale and isn't GitOps-friendly

## The Solution

### Jumbo Frames for RDMA NICs

```yaml
apiVersion: nmstate.io/v1
kind: NodeNetworkConfigurationPolicy
metadata:
  name: gpu-rdma-mtu9000
spec:
  nodeSelector:
    node-role.kubernetes.io/gpu-worker: ""
  desiredState:
    interfaces:
      - name: ens1f0np0
        type: ethernet
        state: up
        mtu: 9000               # Jumbo frames for RDMA
        ipv4:
          enabled: false        # IP managed by SR-IOV/Multus
        ipv6:
          enabled: false
      - name: ens1f1np1
        type: ethernet
        state: up
        mtu: 9000
        ipv4:
          enabled: false
        ipv6:
          enabled: false
```

### Bonding for Storage Network

```yaml
apiVersion: nmstate.io/v1
kind: NodeNetworkConfigurationPolicy
metadata:
  name: gpu-storage-bond
spec:
  nodeSelector:
    node-role.kubernetes.io/gpu-worker: ""
  desiredState:
    interfaces:
      # Bond interface for storage
      - name: bond-storage
        type: bond
        state: up
        mtu: 9000
        ipv4:
          enabled: true
          dhcp: false
          address:
            - ip: 10.200.0.0      # Placeholder — use per-node config
              prefix-length: 24
        link-aggregation:
          mode: 802.3ad           # LACP
          options:
            miimon: "100"
            lacp_rate: "fast"
            xmit_hash_policy: "layer3+4"
          port:
            - ens3f0np0
            - ens3f1np1
      # Slave interfaces
      - name: ens3f0np0
        type: ethernet
        state: up
        mtu: 9000
      - name: ens3f1np1
        type: ethernet
        state: up
        mtu: 9000
```

### VLAN on Bond for Traffic Separation

```yaml
apiVersion: nmstate.io/v1
kind: NodeNetworkConfigurationPolicy
metadata:
  name: gpu-storage-vlan
spec:
  nodeSelector:
    node-role.kubernetes.io/gpu-worker: ""
  desiredState:
    interfaces:
      # VLAN 200 on bond for NFS storage
      - name: bond-storage.200
        type: vlan
        state: up
        mtu: 9000
        vlan:
          base-iface: bond-storage
          id: 200
        ipv4:
          enabled: true
          dhcp: false
          address:
            - ip: 10.200.0.101
              prefix-length: 24
      # VLAN 300 on bond for backup
      - name: bond-storage.300
        type: vlan
        state: up
        vlan:
          base-iface: bond-storage
          id: 300
        ipv4:
          enabled: true
          dhcp: true
    routes:
      config:
        # Static route to NFS servers via storage VLAN
        - destination: 10.200.0.0/16
          next-hop-address: 10.200.0.1
          next-hop-interface: bond-storage.200
```

### Verify NMState Configuration

```bash
# Check policy status
oc get nncp
# NAME                  STATUS      REASON
# gpu-rdma-mtu9000      Available   SuccessfullyConfigured
# gpu-storage-bond      Available   SuccessfullyConfigured

# Check per-node state
oc get nns <node-name> -o yaml | grep -A5 "mtu\|bond\|vlan"

# Check actual interface on node
oc debug node/<node-name> -- chroot /host nmcli conn show
oc debug node/<node-name> -- chroot /host ip link show | grep mtu

# Verify MTU end-to-end
oc debug node/<node-name> -- chroot /host \
  ping -M do -s 8972 10.200.0.1
# 8972 + 28 (IP+ICMP header) = 9000 MTU
# If this fails, MTU not 9000 on all hops
```

### Complete GPU Node Network Layout

```text
GPU Worker Node Network Architecture:
──────────────────────────────────────────────────────────────────
Interface        Purpose          MTU     Config
──────────────────────────────────────────────────────────────────
eno1             Management/API   1500    DHCP (default route)
ens1f0np0        GPU RDMA NIC 1   9000    SR-IOV VFs (no host IP)
ens1f1np1        GPU RDMA NIC 2   9000    SR-IOV VFs (no host IP)
bond-storage     Storage bond     9000    LACP (ens3f0+ens3f1)
bond-storage.200 NFS VLAN         9000    Static IP 10.200.x.x
bond-storage.300 Backup VLAN      1500    DHCP

NMState manages:        eno1, bond-storage, VLANs, MTU, routes
SR-IOV Operator manages: ens1f0np0, ens1f1np1 (VF creation)
Multus manages:          VF → Pod attachment (net1, net2)
```

### Bonding Mode Reference

```text
Mode          Name         Use Case               Switch Needed
──────────────────────────────────────────────────────────────────
0             balance-rr   Testing only            No
1             active-backup Failover, no LACP      No
2             balance-xor  Static LAG              Yes (static)
4             802.3ad      Production storage ✅    Yes (LACP)
5             balance-tlb  No switch support       No
6             balance-alb  No switch support       No

GPU storage: Use mode 4 (802.3ad/LACP) for bandwidth + redundancy
xmit_hash_policy: layer3+4 for best distribution across ports
```

## Common Issues

### NNCP stuck in "Progressing" state
- **Cause**: Interface name doesn't exist on target nodes
- **Fix**: Check `oc get nns <node>` for actual interface names

### Bond fails to come up
- **Cause**: Switch ports not configured for LACP
- **Fix**: Verify switch-side LACP config; try active-backup mode as test

### MTU mismatch causes packet drops
- **Cause**: MTU 9000 on NIC but 1500 on switch port
- **Fix**: Configure MTU 9216 on switch (to allow overhead); verify with ping -s 8972

## Best Practices

1. **MTU 9000 on all RDMA-path interfaces** — NIC, switch, and peer
2. **LACP (802.3ad) for storage bonds** — redundancy + 2x bandwidth
3. **Separate VLANs per traffic type** — GPU fabric, storage, management
4. **NodeSelector for GPU nodes only** — don't apply GPU network config to control plane
5. **Test MTU with `ping -M do -s 8972`** — verifies end-to-end jumbo frames
6. **Use NNCP, not manual nmcli** — declarative, GitOps-compatible, survives reimages

## Key Takeaways

- NMState declaratively manages host networking on OpenShift via NNCP CRDs
- GPU nodes need: MTU 9000 (RDMA), bonding (storage), VLANs (isolation)
- NNCP applies to nodes matching `nodeSelector` — target GPU workers specifically
- Check status with `oc get nncp` — should show "Available"
- Bond mode 802.3ad (LACP) for production storage networks
- SR-IOV interfaces (RDMA NICs) get MTU but no host IP — Multus manages Pod attachment
- Verify jumbo frames end-to-end with `ping -M do -s 8972`
