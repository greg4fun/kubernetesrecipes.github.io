---
title: "SR-IOV Multus Network Attachment for GPU RDMA Pods"
description: "Configure Multus CNI NetworkAttachmentDefinition for SR-IOV RDMA in Kubernetes GPU workloads. Covers k8s.v1.cni.cncf.io/networks annotation, IPAM"
tags:
  - "networking"
  - "sriov"
  - "rdma"
  - "openshift"
  - "gpu"
category: "networking"
publishDate: "2026-06-04"
author: "Luca Berton"
difficulty: "advanced"
relatedRecipes:
  - "openshift-sriov-network-nv-ipam-gpu-fabric"
  - "nvidia-network-operator-rdma-kubernetes"
  - "nccl-network-validator-production-mpijob"
---

> 💡 **Quick Answer:** Add `k8s.v1.cni.cncf.io/networks: <network-name>` annotation to worker pods requesting SR-IOV RDMA interfaces. Combined with `openshift.io/mellanoxnics: 1` in resource limits, this gives the pod a `net1` interface backed by a Mellanox VF with RDMA capabilities and `/dev/infiniband` device access.

## The Problem

- GPU pods need a secondary RDMA-capable network interface for NCCL data plane
- Default pod network (eth0) doesn't support RDMA
- Must coordinate between Multus annotation and SR-IOV device plugin resource
- IPAM must assign IPs on the correct subnet for inter-node RDMA communication
- Need to verify end-to-end: annotation → VF allocation → net1 → RDMA functionality

## The Solution

### NetworkAttachmentDefinition

```yaml
apiVersion: k8s.cni.cncf.io/v1
kind: NetworkAttachmentDefinition
metadata:
  name: sriov-rdma-net
  namespace: gpu-benchmark
  annotations:
    k8s.v1.cni.cncf.io/resourceName: openshift.io/mellanoxnics
spec:
  config: |
    {
      "cniVersion": "0.3.1",
      "name": "sriov-rdma-net",
      "type": "sriov",
      "vlan": 0,
      "ipam": {
        "type": "whereabouts",
        "range": "192.168.100.0/24",
        "exclude": ["192.168.100.0/32", "192.168.100.255/32"]
      }
    }
```

### Pod Annotation

```yaml
metadata:
  annotations:
    # Request one SR-IOV interface from the named network
    k8s.v1.cni.cncf.io/networks: sriov-rdma-net

    # Multiple interfaces (if needed):
    # k8s.v1.cni.cncf.io/networks: sriov-rdma-net, sriov-rdma-net

    # With explicit interface name:
    # k8s.v1.cni.cncf.io/networks: |
    #   [{"name": "sriov-rdma-net", "interface": "net1"}]
```

### Resource Request

```yaml
resources:
  requests:
    nvidia.com/gpu: 2
    openshift.io/mellanoxnics: 1    # Allocates 1 SR-IOV VF
  limits:
    nvidia.com/gpu: 2
    openshift.io/mellanoxnics: 1
```

### What Gets Injected Into the Pod

```text
When both annotation AND resource are present:

1. Multus reads the annotation → calls SR-IOV CNI plugin
2. SR-IOV device plugin allocates a VF from the pool
3. CNI plugin:
   - Moves VF netdev into pod network namespace
   - Names it "net1" (second interface after eth0)
   - Applies IPAM (assigns IP from whereabouts range)
4. Device plugin provides:
   - /dev/infiniband/uverbs0 (RDMA user verbs)
   - /dev/infiniband/rdma_cm (connection manager)

Result inside pod:
  eth0: 10.128.4.15/23  (Kubernetes pod network, DNS)
  net1: 192.168.100.5/24 (SR-IOV VF, RDMA-capable)
  /dev/infiniband/uverbs0 (RDMA device)
```

### Namespace-Scoped Network Names

```yaml
# The annotation references a NetworkAttachmentDefinition in the SAME namespace:
annotations:
  k8s.v1.cni.cncf.io/networks: sriov-rdma-net
# Looks for: NetworkAttachmentDefinition "sriov-rdma-net" in pod's namespace

# Cross-namespace reference (if allowed by policy):
annotations:
  k8s.v1.cni.cncf.io/networks: gpu-infra/sriov-rdma-net
# Looks for: NetworkAttachmentDefinition "sriov-rdma-net" in namespace "gpu-infra"
```

### Verification Commands

```bash
# Inside the pod:

# Check net1 exists with IP
ip addr show net1
# Expected: inet 192.168.100.X/24

# Check RDMA device
ibv_devinfo
# Expected: port_state PORT_ACTIVE, transport InfiniBand or Ethernet

# Check /dev/infiniband
ls -la /dev/infiniband/
# Expected: uverbs0, rdma_cm

# Verify VF driver
ethtool -i net1
# Expected: driver: mlx5_core

# Ping another worker's net1 (RDMA subnet)
ping -I net1 192.168.100.6 -c 3
```

### Common IPAM Options

```yaml
# Option 1: Whereabouts (distributed IPAM)
"ipam": {
  "type": "whereabouts",
  "range": "192.168.100.0/24"
}

# Option 2: NVIDIA nv-ipam (GPU-fabric aware)
"ipam": {
  "type": "nv-ipam",
  "poolName": "gpu-rdma-pool"
}

# Option 3: Static (for testing)
"ipam": {
  "type": "static",
  "addresses": [{"address": "192.168.100.10/24"}]
}

# Option 4: Host-local (single-node only)
"ipam": {
  "type": "host-local",
  "subnet": "192.168.100.0/24"
}
```

## Common Issues

### net1 not appearing in pod
- **Cause**: Annotation name doesn't match NetworkAttachmentDefinition name
- **Fix**: Verify NAD exists in same namespace; check spelling exactly

### net1 exists but no IP assigned
- **Cause**: IPAM exhausted or misconfigured
- **Fix**: Check whereabouts IP pool; verify range has available addresses

### /dev/infiniband missing despite net1 present
- **Cause**: `openshift.io/mellanoxnics` not in resource request, or VF not RDMA-capable
- **Fix**: Add resource request; verify SriovNetworkNodePolicy has `isRdma: true`

### "Failed to allocate SR-IOV VF" in events
- **Cause**: All VFs on the node are in use
- **Fix**: Check `kubectl get node -o json | jq '.status.allocatable'` for available VFs

### Multiple pods get same IP
- **Cause**: Whereabouts leader election failure or stale IP leases
- **Fix**: Delete stale whereabouts IP allocations; restart whereabouts pods

## Best Practices

1. **Match annotation name to NAD name exactly** — case-sensitive
2. **Always request the device plugin resource** — annotation alone is insufficient
3. **Use whereabouts or nv-ipam** for multi-node — host-local causes IP conflicts
4. **One VF per pod is typical** — `openshift.io/mellanoxnics: 1`
5. **Verify with `ibv_devinfo`** inside pod — confirms RDMA device is functional
6. **Size IP pool for maximum concurrent pods** — each worker needs one IP
7. **Use VLAN 0** unless switch requires tagged frames for RDMA traffic

## Key Takeaways

- Two pieces needed: Multus annotation (which network) + resource request (which device)
- Pod gets `net1` (RDMA interface) + `/dev/infiniband` (verbs device) + IP from IPAM
- `eth0` = pod network (DNS, SSH, MPI control) | `net1` = RDMA (NCCL data)
- NetworkAttachmentDefinition must exist in the pod's namespace
- SR-IOV device plugin manages VF pool; Multus/CNI handles network namespace moves
- IPAM choice matters: whereabouts for multi-node, nv-ipam for GPU-fabric awareness
