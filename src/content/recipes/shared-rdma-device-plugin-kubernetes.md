---
title: "Shared RDMA Device Plugin for Kubernetes GPU Pods"
description: "Configure the RDMA shared device plugin to allow multiple pods to share RDMA-capable NICs on Kubernetes. K8s-rdma-shared-dev-plugin setup, resource allocation, multi-tenant GPU clusters, and combining with SR-IOV for GPUDirect RDMA workloads."
tags:
  - "rdma"
  - "device-plugin"
  - "shared"
  - "gpu"
  - "networking"
category: "networking"
publishDate: "2026-06-04"
author: "Luca Berton"
difficulty: "advanced"
relatedRecipes:
  - "gpudirect-rdma-setup-verification-kubernetes"
  - "openshift-sriov-network-nv-ipam-gpu-fabric"
  - "nvidia-gpu-topology-matrix-kubernetes"
---

> 💡 **Quick Answer:** The RDMA shared device plugin (`k8s-rdma-shared-dev-plugin`) exposes RDMA-capable NICs as shared Kubernetes resources that multiple pods can use simultaneously. Unlike SR-IOV (exclusive VF per pod), shared RDMA gives all pods access to the same physical NIC's RDMA capabilities via `/dev/infiniband/` devices. Configure with a ConfigMap specifying resource name and device selectors, then pods request `rdma/rdma_shared_device_a: 1`.

## The Problem

- SR-IOV gives exclusive VF per pod — limited by number of VFs (typically 8-128)
- Many GPU training pods need RDMA but don't need exclusive NIC access
- Running out of SR-IOV VFs on large multi-tenant GPU clusters
- Need GPUDirect RDMA for all pods without dedicating a VF to each
- Simple shared access to InfiniBand/RoCE NICs for NCCL multi-node training

## The Solution

### Deploy RDMA Shared Device Plugin

```yaml
# ConfigMap defining shared RDMA resources
apiVersion: v1
kind: ConfigMap
metadata:
  name: rdma-devices
  namespace: kube-system
data:
  config.json: |
    {
      "periodicUpdateInterval": 300,
      "configList": [
        {
          "resourceName": "rdma_shared_device_a",
          "rdmaHcaMax": 100,
          "selectors": {
            "vendors": ["15b3"],
            "deviceIDs": ["101d", "101e"],
            "ifNames": ["ens8f0", "ens8f1", "ens9f0", "ens9f1"]
          }
        },
        {
          "resourceName": "rdma_shared_device_b",
          "rdmaHcaMax": 100,
          "selectors": {
            "vendors": ["15b3"],
            "ifNames": ["ens10f0", "ens10f1"]
          }
        }
      ]
    }
---
# DaemonSet deploying the plugin
apiVersion: apps/v1
kind: DaemonSet
metadata:
  name: rdma-shared-dp
  namespace: kube-system
spec:
  selector:
    matchLabels:
      app: rdma-shared-dp
  template:
    metadata:
      labels:
        app: rdma-shared-dp
    spec:
      hostNetwork: true
      nodeSelector:
        node-role.kubernetes.io/gpu-worker: ""
      containers:
        - name: rdma-shared-dp
          image: ghcr.io/mellanox/k8s-rdma-shared-dev-plugin:latest
          imagePullPolicy: IfNotPresent
          securityContext:
            privileged: true
          volumeMounts:
            - name: device-plugin
              mountPath: /var/lib/kubelet/device-plugins
            - name: config
              mountPath: /k8s-rdma-shared-dev-plugin
            - name: devinfiniband
              mountPath: /dev/infiniband
      volumes:
        - name: device-plugin
          hostPath:
            path: /var/lib/kubelet/device-plugins
        - name: config
          configMap:
            name: rdma-devices
        - name: devinfiniband
          hostPath:
            path: /dev/infiniband
```

### Via NVIDIA Network Operator (Recommended)

```yaml
# NicClusterPolicy with shared RDMA device plugin
apiVersion: mellanox.com/v1alpha1
kind: NicClusterPolicy
metadata:
  name: nic-cluster-policy
spec:
  rdmaSharedDevicePlugin:
    image: k8s-rdma-shared-dev-plugin
    repository: ghcr.io/mellanox
    version: latest
    config: |
      {
        "configList": [
          {
            "resourceName": "rdma_shared_device_a",
            "rdmaHcaMax": 100,
            "selectors": {
              "vendors": ["15b3"],
              "deviceIDs": ["101d"]
            }
          }
        ]
      }
```

### Verify Resources on Nodes

```bash
# Check node allocatable resources
kubectl describe node gpu-worker-0 | grep rdma
#   rdma/rdma_shared_device_a:  100
#   rdma/rdma_shared_device_b:  100

# The "100" is rdmaHcaMax — max concurrent pods sharing this resource
# Not actual hardware count — it's a soft limit

kubectl get node gpu-worker-0 -o json | jq '.status.allocatable' | grep rdma
# "rdma/rdma_shared_device_a": "100"
```

### Pod Using Shared RDMA

```yaml
apiVersion: v1
kind: Pod
metadata:
  name: nccl-training
  namespace: gpu-workloads
spec:
  containers:
    - name: trainer
      image: nvcr.io/nvidia/pytorch:24.04-py3
      resources:
        limits:
          nvidia.com/gpu: "8"
          rdma/rdma_shared_device_a: "1"    # Request shared RDMA access
      securityContext:
        capabilities:
          add: ["IPC_LOCK"]     # Required for RDMA memory registration
      env:
        - name: NCCL_IB_HCA
          value: "mlx5_0,mlx5_3,mlx5_5,mlx5_6"
        - name: NCCL_NET_GDR_LEVEL
          value: "5"
      volumeMounts:
        - name: shm
          mountPath: /dev/shm
  volumes:
    - name: shm
      emptyDir:
        medium: Memory
        sizeLimit: "64Gi"
```

### Shared vs Exclusive RDMA

```text
Approach          │ Plugin                    │ Pods/NIC │ Isolation │ Use Case
──────────────────┼───────────────────────────┼──────────┼───────────┼──────────────
Shared RDMA       │ k8s-rdma-shared-dev-plugin│ Up to 100│ None      │ Training clusters
SR-IOV (exclusive)│ sriov-device-plugin       │ 1 per VF │ Full      │ Multi-tenant
Host device       │ None (hostNetwork)        │ All pods │ None      │ Simple/testing
──────────────────┴───────────────────────────┴──────────┴───────────┴──────────────

Shared RDMA advantages:
  ✅ No VF limit (100+ pods per NIC)
  ✅ Simpler config (no SR-IOV policy, no VF creation)
  ✅ GPUDirect RDMA works (nvidia-peermem + /dev/infiniband)
  ✅ Lower overhead (no virtual function management)
  
Shared RDMA limitations:
  ❌ No network isolation between pods (shared PF)
  ❌ No per-pod bandwidth guarantee
  ❌ No separate IP per pod (use overlay + secondary network)
  ❌ All pods see all RDMA traffic on the interface
```

### ConfigMap Selectors

```json
{
  "configList": [
    {
      "resourceName": "rdma_shared_device_a",
      "rdmaHcaMax": 100,
      "selectors": {
        "vendors": ["15b3"],           // Mellanox/NVIDIA
        "deviceIDs": ["101d", "101e"], // ConnectX-7, ConnectX-7 VF
        "drivers": ["mlx5_core"],      // Driver name
        "ifNames": ["ens8f0"],         // Interface name (exact match)
        "linkTypes": ["IB", "ETH"]     // InfiniBand or Ethernet (RoCE)
      }
    }
  ]
}
```

### Multiple Resource Pools (Fabric Separation)

```json
{
  "configList": [
    {
      "resourceName": "rdma_gpu_fabric",
      "rdmaHcaMax": 50,
      "selectors": {
        "ifNames": ["ens8f0", "ens8f1", "ens9f0", "ens9f1"]
      }
    },
    {
      "resourceName": "rdma_storage_fabric",
      "rdmaHcaMax": 50,
      "selectors": {
        "ifNames": ["ens10f0", "ens10f1"]
      }
    }
  ]
}
```

```yaml
# Pod requesting both fabrics
resources:
  limits:
    nvidia.com/gpu: "4"
    rdma/rdma_gpu_fabric: "1"         # GPU interconnect NICs
    rdma/rdma_storage_fabric: "1"     # Storage NICs
```

### What the Plugin Mounts in Pod

```bash
# Inside a pod with rdma/rdma_shared_device_a: 1
ls /dev/infiniband/
# rdma_cm  uverbs0  uverbs1  uverbs2  uverbs3

# These are the RDMA character devices:
# rdma_cm    — connection manager (for RC/UC connections)
# uverbs0-3  — user-space verbs devices (one per HCA port)

# Verify RDMA devices
ibv_devinfo
# hca_id: mlx5_0
#   port: 1
#     state: PORT_ACTIVE
#     link_layer: Ethernet  (RoCE)

# Test bandwidth
ib_write_bw -d mlx5_0 --report_gbits
```

### Combining with Secondary Network (Multus)

```yaml
# NetworkAttachmentDefinition for RDMA pods
apiVersion: k8s.cni.cncf.io/v1
kind: NetworkAttachmentDefinition
metadata:
  name: rdma-net
  namespace: gpu-workloads
spec:
  config: |
    {
      "cniVersion": "0.4.0",
      "type": "macvlan",
      "master": "ens8f0",
      "mode": "bridge",
      "ipam": {
        "type": "nv-ipam",
        "poolName": "gpu-fabric"
      }
    }
---
# Pod with shared RDMA + secondary network IP
apiVersion: v1
kind: Pod
metadata:
  name: training-pod
  annotations:
    k8s.v1.cni.cncf.io/networks: rdma-net
spec:
  containers:
    - name: trainer
      resources:
        limits:
          nvidia.com/gpu: "8"
          rdma/rdma_shared_device_a: "1"
```

## Common Issues

### "insufficient rdma/rdma_shared_device_a" despite rdmaHcaMax=100
- **Cause**: 100 pods already allocated; or device plugin not running on this node
- **Fix**: Increase `rdmaHcaMax`; verify DaemonSet pod is Running; check kubelet logs

### Pod has RDMA devices but GPUDirect RDMA doesn't work
- **Cause**: nvidia-peermem not loaded; or missing IPC_LOCK capability
- **Fix**: `modprobe nvidia-peermem`; add `capabilities: add: ["IPC_LOCK"]` to pod spec

### "Permission denied" accessing /dev/infiniband
- **Cause**: Security context too restrictive; or SELinux blocking
- **Fix**: Add IPC_LOCK capability; or run with `privileged: true` for testing

### Selector matches no devices
- **Cause**: Wrong vendor ID, device ID, or interface name in config
- **Fix**: Check with `ibstat`, `lspci -nn | grep Mellanox`, `ip link` on the node

## Best Practices

1. **Use shared RDMA for training clusters** — simpler than SR-IOV, no VF limit
2. **Set `rdmaHcaMax` to expected max concurrent pods** — acts as admission limit
3. **Separate resource pools per fabric** — GPU interconnect vs storage traffic
4. **Always add `IPC_LOCK` capability** — required for RDMA memory registration
5. **Combine with Multus + IPAM** — gives pods unique IPs on the RDMA fabric
6. **Large `/dev/shm`** — NCCL uses shared memory for intra-node communication
7. **Use Network Operator for lifecycle** — manages plugin DaemonSet + config updates

## Key Takeaways

- Shared RDMA plugin: multiple pods share the same physical NIC's RDMA capabilities
- Resource: `rdma/rdma_shared_device_a: 1` — requests shared access (not exclusive)
- `rdmaHcaMax`: soft limit on concurrent pods (not hardware limit) — set to 50-100
- Mounts `/dev/infiniband/*` into pod — user-space verbs + connection manager
- No isolation between pods — all share PF bandwidth (fine for training clusters)
- Combine with SR-IOV when tenant isolation needed; use shared when not
- Works with GPUDirect RDMA (nvidia-peermem) — GPU memory → shared NIC → wire
