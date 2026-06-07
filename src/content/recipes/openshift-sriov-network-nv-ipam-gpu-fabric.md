---
title: "OpenShift SR-IOV Network with NVIDIA IPAM for GPU Fabric"
description: "Configure SriovNetwork resources on OpenShift with nv-ipam for GPU fabric IP allocation. SR-IOV Network Operator setup, Mellanox NIC resource targeting, IPAM"
tags:
  - "sriov"
  - "openshift"
  - "nv-ipam"
  - "nvidia"
  - "rdma"
category: "networking"
publishDate: "2026-06-04"
author: "Luca Berton"
difficulty: "advanced"
relatedRecipes:
  - "sriov-vf-container-mapping-lifecycle"
  - "nvidia-gpu-topology-matrix-kubernetes"
  - "sriov-multus-network-attachment-gpu-rdma"
---

> 💡 **Quick Answer:** Create a `SriovNetwork` CR in the `openshift-sriov-network-operator` namespace to define a GPU fabric network that uses `nv-ipam` for IP allocation. The CR specifies the SR-IOV resource name (Mellanox NICs), IPAM configuration with pool name, and target namespace. The operator automatically generates a `NetworkAttachmentDefinition` that pods reference via `k8s.v1.cni.cncf.io/networks` annotation.

## The Problem

- GPU nodes have dedicated Mellanox NICs for RDMA fabric but need automated IP management
- Manual IP assignment doesn't scale across hundreds of GPU pods
- Need SR-IOV VFs attached to pods for GPUDirect RDMA with proper IPAM
- Standard DHCP doesn't integrate with GPU topology awareness
- Must align network resources with GPU NUMA locality

## The Solution

### SriovNetwork with nv-ipam

```yaml
apiVersion: sriovnetwork.openshift.io/v1
kind: SriovNetwork
metadata:
  name: gpu-fabric
  namespace: openshift-sriov-network-operator
  finalizers:
    - netattdef.finalizers.sriovnetwork.openshift.io
spec:
  ipam: |
    {
      "type": "nv-ipam",
      "poolName": "gpu-fabric"
    }
  logLevel: info
  networkNamespace: gpu-workloads
  resourceName: mellanoxnics
```

### Prerequisites: SriovNetworkNodePolicy

```yaml
# First define which NICs to use and how many VFs
apiVersion: sriovnetwork.openshift.io/v1
kind: SriovNetworkNodePolicy
metadata:
  name: mellanox-gpu-fabric
  namespace: openshift-sriov-network-operator
spec:
  resourceName: mellanoxnics
  nodeSelector:
    node-role.kubernetes.io/gpu-worker: ""
  numVfs: 8
  nicSelector:
    vendor: "15b3"              # Mellanox
    deviceID: "101d"            # ConnectX-7
    pfNames: ["ens8f0", "ens8f1"]
  deviceType: netdevice         # or vfio-pci for DPDK
  isRdma: true                  # Enable RDMA on VFs
  linkType: IB                  # InfiniBand (or eth for RoCE)
```

### nv-ipam IPPool Configuration

```yaml
# Define IP pool for the GPU fabric
apiVersion: nv-ipam.nvidia.com/v1alpha1
kind: IPPool
metadata:
  name: gpu-fabric
  namespace: nvidia-network-operator
spec:
  subnet: "10.10.0.0/16"
  perNodeBlockSize: 64          # 64 IPs per node
  gateway: "10.10.0.1"
  nodeSelector:
    nodeSelectorTerms:
      - matchExpressions:
          - key: node-role.kubernetes.io/gpu-worker
            operator: Exists
```

### Pod Using the SR-IOV Network

```yaml
apiVersion: v1
kind: Pod
metadata:
  name: distributed-training
  namespace: gpu-workloads
  annotations:
    k8s.v1.cni.cncf.io/networks: gpu-fabric
spec:
  containers:
    - name: trainer
      image: registry.example.com/training:v1
      resources:
        requests:
          nvidia.com/gpu: "4"
          openshift.io/mellanoxnics: "1"    # Request one SR-IOV VF
        limits:
          nvidia.com/gpu: "4"
          openshift.io/mellanoxnics: "1"
      env:
        - name: NCCL_IB_HCA
          value: "mlx5"
        - name: NCCL_NET_GDR_LEVEL
          value: "PIX"
```

### Multiple Networks (Storage + GPU Fabric)

```yaml
apiVersion: sriovnetwork.openshift.io/v1
kind: SriovNetwork
metadata:
  name: gpu-rdma-fabric
  namespace: openshift-sriov-network-operator
spec:
  ipam: |
    {
      "type": "nv-ipam",
      "poolName": "rdma-fabric"
    }
  logLevel: info
  networkNamespace: gpu-workloads
  resourceName: mellanoxnics-ib
---
apiVersion: sriovnetwork.openshift.io/v1
kind: SriovNetwork
metadata:
  name: storage-network
  namespace: openshift-sriov-network-operator
spec:
  ipam: |
    {
      "type": "nv-ipam",
      "poolName": "storage-net"
    }
  networkNamespace: gpu-workloads
  resourceName: mellanoxnics-eth
```

```yaml
# Pod with dual networks
metadata:
  annotations:
    k8s.v1.cni.cncf.io/networks: |
      [
        {"name": "gpu-rdma-fabric", "namespace": "gpu-workloads"},
        {"name": "storage-network", "namespace": "gpu-workloads"}
      ]
```

### Verify the Generated NetworkAttachmentDefinition

```bash
# SriovNetwork operator auto-creates NAD in target namespace
oc get net-attach-def -n gpu-workloads
# NAME          AGE
# gpu-fabric    5d

oc get net-attach-def gpu-fabric -n gpu-workloads -o yaml
# Shows the generated CNI config with SR-IOV device plugin + nv-ipam

# Check SR-IOV VF allocation
oc get sriovnetworknodestates -n openshift-sriov-network-operator
oc describe sriovnetworknodestate gpu-worker-0 -n openshift-sriov-network-operator
```

### ArgoCD Integration

```yaml
# The SriovNetwork CR works with ArgoCD GitOps
# Annotations show tracking:
metadata:
  annotations:
    argocd.argoproj.io/tracking-id: "openshift-sriov-network:sriovnetwork.openshift.io/SriovNetwork:openshift-sriov-network-operator/gpu-fabric"
```

### Verify RDMA Connectivity in Pod

```bash
# Inside the pod — check SR-IOV interface
ip addr show    # net1 = SR-IOV VF with nv-ipam assigned IP

# Test RDMA
ibv_devinfo     # Should show VF device
ib_write_bw -d mlx5_0 --report_gbits    # Server
ib_write_bw -d mlx5_0 --report_gbits <peer-ip>    # Client

# Verify GPUDirect RDMA path
nvidia-smi topo -m | grep -E "NIC|mlx5"
# NIC should show PIX to local GPUs
```

## Common Issues

### NetworkAttachmentDefinition not created in target namespace
- **Cause**: `networkNamespace` doesn't exist; or operator lacks permissions
- **Fix**: Create target namespace first; verify operator ClusterRole includes target namespace

### Pod stuck Pending — "insufficient SR-IOV resources"
- **Cause**: All VFs allocated; or SriovNetworkNodePolicy not applied yet
- **Fix**: Check `oc get sriovnetworknodestates`; increase `numVfs`; wait for node drain/reboot after policy change

### nv-ipam not assigning IPs
- **Cause**: IPPool not created; or pool name mismatch; or nv-ipam controller not running
- **Fix**: Verify IPPool CR exists with matching `poolName`; check nv-ipam-controller logs

### RDMA not working on VF
- **Cause**: `isRdma: true` not set in SriovNetworkNodePolicy; or wrong deviceType
- **Fix**: Set `isRdma: true`; use `deviceType: netdevice` for RDMA (not `vfio-pci`)

## Best Practices

1. **Use `nv-ipam` over DHCP** — purpose-built for GPU fabric, topology-aware pools
2. **Set `isRdma: true`** — required for GPUDirect RDMA on SR-IOV VFs
3. **Match `resourceName`** across SriovNetworkNodePolicy and SriovNetwork
4. **Separate InfiniBand and Ethernet** — different SriovNetworkNodePolicies per link type
5. **`perNodeBlockSize` in IPPool** — allocate enough IPs for max pods per node
6. **Finalizers protect cleanup** — don't force-delete SriovNetwork CRs
7. **GitOps-friendly** — SriovNetwork CRs work well with ArgoCD tracking

## Key Takeaways

- `SriovNetwork` CR defines the network; operator auto-generates `NetworkAttachmentDefinition`
- `nv-ipam` provides GPU-fabric-aware IP allocation with per-node pools
- `resourceName` links SriovNetwork to SriovNetworkNodePolicy (defines VFs)
- `networkNamespace` determines where the NAD is created (where pods consume it)
- Pods request VFs via resource limits (`openshift.io/<resourceName>: "1"`)
- `isRdma: true` + `deviceType: netdevice` = RDMA-capable SR-IOV VFs
- Finalizer `netattdef.finalizers.sriovnetwork.openshift.io` ensures clean NAD deletion
