---
title: "NVIDIA IPAM for GPU Fabric IP Address Allocation"
description: "Configure nv-ipam (NVIDIA IPAM) to assign IP addresses on GPU fabric SR-IOV networks in Kubernetes. Covers IPPool CRDs, per-node allocation, InfiniBand IPoIB addressing, and integration with SR-IOV Network Operator."
tags:
  - "nv-ipam"
  - "ipam"
  - "gpu-fabric"
  - "sriov"
  - "rdma"
category: "networking"
publishDate: "2026-05-08"
author: "Luca Berton"
difficulty: "advanced"
relatedRecipes:
  - "dual-fabric-mellanox-gpu-storage-ethernet-infiniband"
  - "openshift-sriov-rdma-infiniband-device-plugin"
  - "nccl-pxn-cross-nic-nvlink-topology"
  - "iommu-bios-kernel-nccl-gpu-direct"
---

> 💡 **Quick Answer:** NVIDIA IPAM (nv-ipam) is a Kubernetes-native IPAM plugin that assigns IP addresses to GPU fabric SR-IOV interfaces. It uses IPPool and CIDRPool CRDs for deterministic, per-node IP allocation — ensuring each GPU worker gets a consistent, predictable address range on the InfiniBand/RoCE fabric.

## The Problem

GPU fabric networking needs IP assignment for RDMA interfaces:

- SR-IOV VFs on InfiniBand need IPoIB addresses for NCCL bootstrap
- Standard IPAM plugins (host-local, whereabouts) don't understand GPU topology
- Need deterministic IPs per node (same IP after Pod restart for NCCL rank mapping)
- Multi-subnet support for separate GPU fabric and storage fabric
- Per-node IP ranges prevent conflicts in large clusters (100+ GPU nodes)

## The Solution

### Install nv-ipam

```bash
# Deploy NVIDIA IPAM CNI plugin
helm repo add nvidia https://helm.ngc.nvidia.com/nvidia
helm repo update

helm install nv-ipam nvidia/nvidia-ipam \
  --namespace kube-system \
  --set image.repository=nvcr.io/nvidia/cloud-native/nvidia-k8s-ipam \
  --set image.tag=v0.2.0

# Or via manifest:
kubectl apply -f https://raw.githubusercontent.com/Mellanox/nvidia-k8s-ipam/main/deploy/nv-ipam.yaml
```

### IPPool for GPU Fabric

```yaml
# Define IP pool for InfiniBand GPU fabric
apiVersion: nv-ipam.nvidia.com/v1alpha1
kind: IPPool
metadata:
  name: gpu-fabric-pool
  namespace: kube-system
spec:
  subnet: "10.0.100.0/24"
  perNodeBlockSize: 16          # 16 IPs per node (matches max VFs)
  gateway: "10.0.100.1"
  nodeSelector:
    matchLabels:
      node-role.kubernetes.io/gpu-worker: ""

# Result: Each GPU worker gets a /28 block:
#   gpu-worker-01: 10.0.100.16 - 10.0.100.31
#   gpu-worker-02: 10.0.100.32 - 10.0.100.47
#   gpu-worker-03: 10.0.100.48 - 10.0.100.63
#   ...
```

### CIDRPool for Larger Deployments

```yaml
# For large clusters needing bigger ranges
apiVersion: nv-ipam.nvidia.com/v1alpha1
kind: CIDRPool
metadata:
  name: gpu-fabric-cidr
  namespace: kube-system
spec:
  cidr: "10.0.0.0/16"
  perNodeNetworkPrefix: 24       # Each node gets a /24 (256 IPs)
  gatewayIndex: 1                # .1 is gateway on each /24
  nodeSelector:
    matchLabels:
      nvidia.com/gpu.present: "true"

# Result:
#   gpu-worker-01: 10.0.1.0/24  (gateway 10.0.1.1)
#   gpu-worker-02: 10.0.2.0/24  (gateway 10.0.2.1)
#   gpu-worker-03: 10.0.3.0/24  (gateway 10.0.3.1)
```

### Separate Pools Per Fabric

```yaml
# GPU Fabric (InfiniBand) — high-bandwidth NCCL traffic
apiVersion: nv-ipam.nvidia.com/v1alpha1
kind: IPPool
metadata:
  name: gpu-ib-fabric
  namespace: kube-system
spec:
  subnet: "10.100.0.0/16"
  perNodeBlockSize: 8
  gateway: ""                    # No gateway needed for L2 IB fabric
  nodeSelector:
    matchLabels:
      nvidia.com/gpu.present: "true"
---
# Storage Fabric (Ethernet/RoCE) — NFS, Ceph, Lustre
apiVersion: nv-ipam.nvidia.com/v1alpha1
kind: IPPool
metadata:
  name: storage-fabric
  namespace: kube-system
spec:
  subnet: "10.200.0.0/16"
  perNodeBlockSize: 4
  gateway: "10.200.0.1"
  nodeSelector:
    matchLabels:
      node-role.kubernetes.io/gpu-worker: ""
```

### SriovNetwork with nv-ipam

```yaml
# GPU RDMA network using nv-ipam for addressing
apiVersion: sriovnetwork.openshift.io/v1
kind: SriovNetwork
metadata:
  name: gpu-rdma-network
  namespace: openshift-sriov-network-operator
spec:
  networkNamespace: ai-training
  resourceName: gpu-rdma
  capabilities: '{"rdma": true}'
  ipam: |
    {
      "type": "nv-ipam",
      "poolName": "gpu-ib-fabric"
    }
---
# Storage network using nv-ipam
apiVersion: sriovnetwork.openshift.io/v1
kind: SriovNetwork
metadata:
  name: storage-network
  namespace: openshift-sriov-network-operator
spec:
  networkNamespace: ai-training
  resourceName: storage-net
  ipam: |
    {
      "type": "nv-ipam",
      "poolName": "storage-fabric"
    }
```

### NetworkAttachmentDefinition (Non-OpenShift)

```yaml
# For vanilla Kubernetes with Multus
apiVersion: k8s.cni.cncf.io/v1
kind: NetworkAttachmentDefinition
metadata:
  name: gpu-rdma-net
  namespace: ai-training
spec:
  config: |
    {
      "cniVersion": "0.3.1",
      "name": "gpu-rdma-net",
      "type": "sriov",
      "vlan": 0,
      "spoofchk": "off",
      "trust": "on",
      "rdma": true,
      "ipam": {
        "type": "nv-ipam",
        "poolName": "gpu-ib-fabric"
      }
    }
```

### Pod with nv-ipam Assigned Addresses

```yaml
apiVersion: v1
kind: Pod
metadata:
  name: nccl-training
  namespace: ai-training
  annotations:
    k8s.v1.cni.cncf.io/networks: |
      [
        {"name": "gpu-rdma-network", "interface": "rdma0"},
        {"name": "gpu-rdma-network", "interface": "rdma1"},
        {"name": "storage-network", "interface": "stor0"}
      ]
spec:
  containers:
    - name: training
      image: nvcr.io/nvidia/pytorch:24.07-py3
      env:
        - name: NCCL_IB_HCA
          value: "mlx5_0,mlx5_1"
        - name: NCCL_NET_GDR_LEVEL
          value: "5"
        # NCCL bootstrap uses the GPU fabric IPs assigned by nv-ipam
        - name: MASTER_ADDR
          value: "10.100.0.8"        # Rank 0 GPU fabric IP
        - name: NCCL_SOCKET_IFNAME
          value: "eth0"              # Bootstrap over default interface
      resources:
        requests:
          nvidia.com/gpu: "8"
          openshift.io/gpu-rdma: "2"
          openshift.io/storage-net: "1"
```

### Verify IP Allocation

```bash
# Check nv-ipam node allocation status
kubectl get ippools -n kube-system -o wide
kubectl describe ippool gpu-ib-fabric -n kube-system

# Check per-node allocations
kubectl get nodes -o jsonpath='{range .items[*]}{.metadata.name}{"\t"}{.metadata.annotations.nv-ipam\.nvidia\.com/ip-blocks}{"\n"}{end}'

# Inside a Pod, verify assigned IPs
kubectl exec -it nccl-training -- ip addr show rdma0
# Should show: inet 10.100.0.X/16 (from gpu-ib-fabric pool)

kubectl exec -it nccl-training -- ip addr show stor0
# Should show: inet 10.200.0.X/16 (from storage-fabric pool)

# Check nv-ipam daemon logs
kubectl logs -n kube-system -l app=nv-ipam-node

# Verify IP allocation state (stored as node annotations)
kubectl get node gpu-worker-01 -o yaml | grep -A5 "nv-ipam"
```

### IPPool Status and Troubleshooting

```bash
# Check pool utilization
kubectl get ippool gpu-ib-fabric -n kube-system -o yaml
# status:
#   allocations:
#     gpu-worker-01:
#       startIP: "10.100.0.16"
#       endIP: "10.100.0.23"
#     gpu-worker-02:
#       startIP: "10.100.0.24"
#       endIP: "10.100.0.31"

# If IP not assigned — check nv-ipam-node Pod on that node
kubectl logs -n kube-system $(kubectl get pods -n kube-system \
  -l app=nv-ipam-node --field-selector spec.nodeName=gpu-worker-01 \
  -o name)

# Common log messages:
# "allocated IP 10.100.0.16 for pod ai-training/nccl-training" ← success
# "no free IPs in pool" ← perNodeBlockSize exhausted
# "node not matching selector" ← missing label
```

### Static IP Assignment (Predictable Rank Mapping)

```yaml
# For frameworks needing deterministic IPs per rank:
apiVersion: nv-ipam.nvidia.com/v1alpha1
kind: IPPool
metadata:
  name: gpu-fabric-static
  namespace: kube-system
spec:
  subnet: "10.100.0.0/24"
  perNodeBlockSize: 8
  gateway: ""
  nodeSelector:
    matchLabels:
      nvidia.com/gpu.present: "true"
  # Static allocations override dynamic:
  staticAllocations:
    - nodeName: "gpu-worker-01"
      prefix: "10.100.0.0/28"     # .1-.15 for node 1
    - nodeName: "gpu-worker-02"
      prefix: "10.100.0.16/28"    # .16-.31 for node 2
    - nodeName: "gpu-worker-03"
      prefix: "10.100.0.32/28"    # .32-.47 for node 3
```

### nv-ipam vs Other IPAM Plugins

```text
Plugin          Deterministic    Per-Node Blocks    GPU-Aware    CRD-Based
──────────────────────────────────────────────────────────────────────────
nv-ipam         ✅ Yes           ✅ Yes             ✅ Yes       ✅ IPPool/CIDRPool
whereabouts     ❌ No            ❌ No              ❌ No        ❌ Config-based
host-local      ❌ No            ❌ No              ❌ No        ❌ Config-based
Calico IPAM     ✅ Partial       ✅ IPPool per node ❌ No        ✅ IPPool
Cilium IPAM     ✅ Partial       ✅ Per-node CIDR   ❌ No        ✅ CiliumNode

nv-ipam advantages for GPU clusters:
• Per-node block allocation (predictable, no conflicts)
• Multiple pools (GPU fabric vs storage fabric)
• Node selector (only allocate to GPU nodes)
• Lightweight (no etcd dependency like whereabouts)
• Works with SR-IOV + Multus seamlessly
```

## Common Issues

### "no free IPs in pool" for new Pods
- **Cause**: `perNodeBlockSize` too small; all IPs in the node's block used
- **Fix**: Increase `perNodeBlockSize` or delete unused Pods/allocations

### IPs not released after Pod deletion
- **Cause**: nv-ipam GC not running or Multus CNI not calling DEL
- **Fix**: Restart nv-ipam-node DaemonSet; check CNI DEL in Multus logs

### Node gets no IP block (unallocated)
- **Cause**: Node doesn't match `nodeSelector` on IPPool
- **Fix**: Add required label (`nvidia.com/gpu.present: "true"`)

### IP conflict between two Pods
- **Cause**: Multiple IPPools with overlapping subnets
- **Fix**: Use non-overlapping ranges; one pool per fabric

### nv-ipam not found as CNI plugin
- **Cause**: Binary not installed on node at `/opt/cni/bin/nv-ipam`
- **Fix**: Verify nv-ipam DaemonSet is running; check init container copied binary

## Best Practices

1. **One IPPool per fabric** — separate GPU, storage, management pools
2. **Size perNodeBlockSize to max VFs** — 8 or 16 typically
3. **Use nodeSelector** — only allocate GPU fabric IPs to GPU nodes
4. **No gateway for L2 IB fabric** — InfiniBand is flat L2, no routing needed
5. **CIDRPool for 50+ nodes** — automatic /24 per node from a /16
6. **Monitor allocations** — alert when pool utilization > 80%
7. **Label nodes before creating pool** — nv-ipam allocates blocks on first match

## Key Takeaways

- nv-ipam assigns IPs to GPU fabric SR-IOV interfaces via IPPool/CIDRPool CRDs
- `perNodeBlockSize` gives each node a deterministic IP range (no conflicts)
- Separate pools for GPU fabric (IB) and storage fabric (Ethernet)
- Integrates with SR-IOV Network Operator via `"type": "nv-ipam"` in IPAM config
- Lightweight — no etcd/database; state stored as node annotations
- Designed for large GPU clusters (100+ nodes) with predictable addressing
- Static allocations available for frameworks needing fixed rank-to-IP mapping
- Works with both InfiniBand (IPoIB) and Ethernet (RoCE) interfaces
