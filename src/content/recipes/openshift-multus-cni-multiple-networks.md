---
title: "OpenShift Multus CNI Multiple Network Interfaces"
description: "Attach multiple network interfaces to Pods using Multus CNI on OpenShift. Covers NetworkAttachmentDefinitions, SR-IOV, macvlan, IPVLAN, traffic separation for GPU fabric, storage, and management networks."
tags:
  - "multus"
  - "cni"
  - "openshift"
  - "networking"
  - "sriov"
category: "networking"
publishDate: "2026-05-09"
author: "Luca Berton"
difficulty: "intermediate"
relatedRecipes:
  - "dual-fabric-mellanox-gpu-storage-ethernet-infiniband"
  - "openshift-sriov-rdma-infiniband-device-plugin"
  - "sriov-vf-container-mapping-lifecycle"
  - "nv-ipam-gpu-fabric-ip-allocation"
---

> 💡 **Quick Answer:** Multus CNI is a meta-plugin that attaches multiple network interfaces to Kubernetes Pods. On OpenShift it's installed by default. Define additional networks via `NetworkAttachmentDefinition` CRDs, then reference them in Pod annotations to get `net1`, `net2`, etc. alongside the default `eth0`.

## The Problem

Pods get a single network interface (eth0) by default, but GPU and HPC workloads need multiple:

- GPU fabric (InfiniBand/RDMA) for NCCL inter-node communication
- Storage network for NFS/Lustre/Ceph access
- Management network (default Pod network) for API, monitoring, SSH
- Each network must be isolated — GPU traffic must not cross storage fabric

## The Solution

### How Multus Works

```text
Without Multus:
  Pod → eth0 (OVN/Calico) → one network only

With Multus:
  Pod → eth0  (OVN/Calico — default, always present)
       → net1 (SR-IOV VF — GPU RDMA fabric)
       → net2 (macvlan — storage network)
       → net3 (IPVLAN — management VLAN)
```

### NetworkAttachmentDefinition (NAD) Examples

```yaml
# SR-IOV RDMA network (GPU fabric)
apiVersion: k8s.cni.cncf.io/v1
kind: NetworkAttachmentDefinition
metadata:
  name: gpu-rdma
  namespace: ai-training
  annotations:
    k8s.v1.cni.cncf.io/resourceName: openshift.io/mellanoxnics
spec:
  config: |
    {
      "cniVersion": "0.3.1",
      "name": "gpu-rdma",
      "type": "sriov",
      "spoofchk": "off",
      "trust": "on",
      "rdma": true,
      "ipam": {
        "type": "nv-ipam",
        "poolName": "gpu-fabric"
      }
    }
---
# macvlan for storage network
apiVersion: k8s.cni.cncf.io/v1
kind: NetworkAttachmentDefinition
metadata:
  name: storage-net
  namespace: ai-training
spec:
  config: |
    {
      "cniVersion": "0.3.1",
      "name": "storage-net",
      "type": "macvlan",
      "master": "ens3f0np0",
      "mode": "bridge",
      "ipam": {
        "type": "whereabouts",
        "range": "10.200.0.0/24",
        "exclude": ["10.200.0.0/30"]
      }
    }
---
# IPVLAN for management VLAN
apiVersion: k8s.cni.cncf.io/v1
kind: NetworkAttachmentDefinition
metadata:
  name: mgmt-vlan100
  namespace: ai-training
spec:
  config: |
    {
      "cniVersion": "0.3.1",
      "name": "mgmt-vlan100",
      "type": "ipvlan",
      "master": "ens4f0np0.100",
      "mode": "l2",
      "ipam": {
        "type": "host-local",
        "subnet": "192.168.100.0/24",
        "rangeStart": "192.168.100.100",
        "rangeEnd": "192.168.100.200"
      }
    }
```

### Pod with Multiple Networks

```yaml
apiVersion: v1
kind: Pod
metadata:
  name: gpu-training
  namespace: ai-training
  annotations:
    k8s.v1.cni.cncf.io/networks: |
      [
        {
          "name": "gpu-rdma",
          "interface": "rdma0"
        },
        {
          "name": "storage-net",
          "interface": "stor0"
        }
      ]
spec:
  containers:
    - name: training
      image: nvcr.io/nvidia/pytorch:24.07-py3
      env:
        - name: NCCL_SOCKET_IFNAME
          value: "rdma0"
      resources:
        requests:
          nvidia.com/gpu: "8"
          openshift.io/mellanoxnics: "1"
```

```bash
# Resulting interfaces inside the Pod:
# eth0  — default OVN Pod network (10.244.x.x)
# rdma0 — SR-IOV VF for GPU RDMA (10.100.x.x)
# stor0 — macvlan for storage (10.200.x.x)
```

### Simplified Annotation (Comma-Separated)

```yaml
# Simple format — Multus assigns net1, net2, net3 automatically
metadata:
  annotations:
    k8s.v1.cni.cncf.io/networks: gpu-rdma, storage-net, mgmt-vlan100

# Results in: eth0, net1 (gpu-rdma), net2 (storage-net), net3 (mgmt-vlan100)
```

### Check Network Status

```bash
# View assigned networks and IPs
kubectl get pod gpu-training -o jsonpath='{.metadata.annotations.k8s\.v1\.cni\.cncf\.io/network-status}' | jq .

# Output:
# [
#   {
#     "name": "ovn-kubernetes",
#     "interface": "eth0",
#     "ips": ["10.244.1.15"],
#     "default": true
#   },
#   {
#     "name": "ai-training/gpu-rdma",
#     "interface": "rdma0",
#     "ips": ["10.100.0.17"]
#   },
#   {
#     "name": "ai-training/storage-net",
#     "interface": "stor0",
#     "ips": ["10.200.0.105"]
#   }
# ]
```

### OpenShift: Cluster-Wide NADs

```yaml
# Available to all namespaces (OpenShift only)
apiVersion: k8s.cni.cncf.io/v1
kind: NetworkAttachmentDefinition
metadata:
  name: gpu-rdma
  namespace: default            # cluster-scoped when in 'default' namespace
  annotations:
    k8s.v1.cni.cncf.io/resourceName: openshift.io/mellanoxnics
spec:
  config: |
    {
      "cniVersion": "0.3.1",
      "name": "gpu-rdma",
      "type": "sriov",
      "rdma": true,
      "ipam": { "type": "nv-ipam", "poolName": "gpu-fabric" }
    }
```

### CNI Plugin Comparison

```text
Plugin     Use Case                Layer   Performance   IPAM
──────────────────────────────────────────────────────────────────
sriov      GPU RDMA, HPC           L2      Best          nv-ipam/whereabouts
macvlan    Storage, external LAN   L2      Good          whereabouts/host-local
ipvlan     VLANs, L3 routing       L2/L3   Good          host-local
bridge     VM bridging, testing    L2      Moderate      host-local
host-device  Passthrough entire NIC L2     Best          static
```

## Common Issues

### "network not found" in Pod events
- **Cause**: NAD is in different namespace than Pod
- **Fix**: Create NAD in same namespace, or use `default` namespace for cluster-wide

### Pod stuck Pending — "insufficient SR-IOV resources"
- **Cause**: All VFs allocated; NAD has `resourceName` annotation
- **Fix**: Check node capacity: `kubectl describe node | grep mellanoxnics`

### net1 has no IP address
- **Cause**: IPAM plugin failed or pool exhausted
- **Fix**: Check IPAM logs; verify pool range has free IPs

## Best Practices

1. **Use JSON annotation format** for custom interface names (`rdma0`, `stor0`)
2. **Separate NADs per fabric** — don't mix GPU and storage in one NAD
3. **SR-IOV for RDMA** — only CNI type that provides hardware-level isolation
4. **macvlan for storage** — simple, no VF overhead, good throughput
5. **Always check network-status annotation** — verifies interfaces were created
6. **Namespace-scope NADs** unless truly cluster-wide

## Key Takeaways

- Multus attaches multiple network interfaces to Pods (eth0 + net1, net2, ...)
- NetworkAttachmentDefinition (NAD) defines each additional network
- SR-IOV NADs need `resourceName` annotation for device plugin integration
- Pod annotation `k8s.v1.cni.cncf.io/networks` selects which NADs to attach
- JSON annotation format allows custom interface names
- `network-status` annotation shows assigned IPs after Pod creation
- OpenShift includes Multus by default; vanilla K8s needs manual install
