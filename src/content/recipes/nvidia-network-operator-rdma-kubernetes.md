---
title: "RDMA Configuration with NVIDIA Network Operator"
description: "Deploy and configure RDMA for GPU clusters using the NVIDIA Network Operator. NicClusterPolicy setup, MLNX_OFED driver container, shared and SR-IOV RDMA device"
tags:
  - "rdma"
  - "nvidia"
  - "network-operator"
  - "mellanox"
  - "gpu"
category: "networking"
publishDate: "2026-06-04"
author: "Luca Berton"
difficulty: "advanced"
relatedRecipes:
  - "shared-rdma-device-plugin-kubernetes"
  - "gpudirect-rdma-setup-verification-kubernetes"
  - "openshift-sriov-network-nv-ipam-gpu-fabric"
---

> 💡 **Quick Answer:** The NVIDIA Network Operator deploys the full RDMA stack on Kubernetes via `NicClusterPolicy`: MLNX_OFED driver container (or host MOFED), RDMA shared device plugin, SR-IOV device plugin, secondary network (Multus + Whereabouts/nv-ipam), and nv-peer-mem for GPUDirect. Install via Helm (`network-operator` chart), configure `NicClusterPolicy` with your NIC selectors, and pods automatically get RDMA access with `rdma/rdma_shared_device_a: 1`.

## The Problem

- Need full RDMA stack (driver, device plugin, IPAM, CNI) deployed consistently across GPU nodes
- Manual MLNX_OFED installation is fragile and version-specific
- Must coordinate RDMA device plugin, secondary networks, and GPUDirect integration
- SR-IOV and shared RDMA modes need different plugin configurations
- RDMA setup must integrate with GPU Operator for GPUDirect RDMA

## The Solution

### Install NVIDIA Network Operator

```bash
# Add Helm repo
helm repo add nvidia https://helm.ngc.nvidia.com/nvidia
helm repo update

# Install Network Operator
helm install network-operator nvidia/network-operator \
  --namespace nvidia-network-operator \
  --create-namespace \
  --version 25.1.0 \
  --set deployCR=false    # Deploy NicClusterPolicy separately
```

### NicClusterPolicy: Full RDMA Stack

```yaml
apiVersion: mellanox.com/v1alpha1
kind: NicClusterPolicy
metadata:
  name: nic-cluster-policy
spec:
  # MLNX_OFED Driver Container (containerized OFED)
  ofedDriver:
    image: doca-driver
    repository: nvcr.io/nvidia/mellanox
    version: "25.04-0.7.0.0-0"
    startupProbe:
      initialDelaySeconds: 10
      periodSeconds: 20
    livenessProbe:
      initialDelaySeconds: 30
      periodSeconds: 30
    rdmaSubsystemNamespace: "shared"   # Enable shared RDMA namespace mode

  # RDMA Shared Device Plugin
  rdmaSharedDevicePlugin:
    image: k8s-rdma-shared-dev-plugin
    repository: ghcr.io/mellanox
    version: "1.5.1"
    config: |
      {
        "configList": [
          {
            "resourceName": "rdma_shared_device_a",
            "rdmaHcaMax": 63,
            "selectors": {
              "vendors": ["15b3"],
              "deviceIDs": ["101d", "101e", "a2dc"],
              "drivers": ["mlx5_core"]
            }
          }
        ]
      }

  # Secondary Network (Multus + IPAM + CNI)
  secondaryNetwork:
    cniPlugins:
      image: plugins
      repository: ghcr.io/k8snetworkplumbingwg
      version: "v1.5.0"
    multus:
      image: multus-cni
      repository: ghcr.io/k8snetworkplumbingwg
      version: "v4.1.0"
    ipamPlugin:
      image: whereabouts
      repository: ghcr.io/k8snetworkplumbingwg
      version: "v0.7.0"

  # nv-ipam (NVIDIA IPAM for GPU fabric — alternative to whereabouts)
  nvIpam:
    image: nvidia-k8s-ipam
    repository: ghcr.io/mellanox
    version: "0.2.0"
    enableWebhook: true
```

### NicClusterPolicy: With SR-IOV (Exclusive RDMA)

```yaml
apiVersion: mellanox.com/v1alpha1
kind: NicClusterPolicy
metadata:
  name: nic-cluster-policy
spec:
  ofedDriver:
    image: doca-driver
    repository: nvcr.io/nvidia/mellanox
    version: "25.04-0.7.0.0-0"

  # SR-IOV Device Plugin (exclusive VF per pod)
  sriovDevicePlugin:
    image: sriov-network-device-plugin
    repository: ghcr.io/k8snetworkplumbingwg
    version: "v3.7.0"
    config: |
      {
        "resourceList": [
          {
            "resourcePrefix": "nvidia.com",
            "resourceName": "rdma_vf",
            "selectors": {
              "vendors": ["15b3"],
              "devices": ["101e"],
              "drivers": ["mlx5_core"],
              "isRdma": true
            }
          }
        ]
      }

  # SR-IOV Network Operator integration
  sriovNetworkOperator:
    enabled: true

  secondaryNetwork:
    cniPlugins:
      image: plugins
      repository: ghcr.io/k8snetworkplumbingwg
      version: "v1.5.0"
    multus:
      image: multus-cni
      repository: ghcr.io/k8snetworkplumbingwg
      version: "v4.1.0"
```

### Use Host MOFED Instead of Container

```yaml
apiVersion: mellanox.com/v1alpha1
kind: NicClusterPolicy
metadata:
  name: nic-cluster-policy
spec:
  ofedDriver:
    image: doca-driver
    repository: nvcr.io/nvidia/mellanox
    version: "25.04-0.7.0.0-0"
    ofedDriverParams:
      # Use host-installed MLNX_OFED instead of containerized
      useHostOfed: true    # ← Skips driver container, uses host MOFED

  rdmaSharedDevicePlugin:
    image: k8s-rdma-shared-dev-plugin
    repository: ghcr.io/mellanox
    version: "1.5.1"
    config: |
      {
        "configList": [
          {
            "resourceName": "rdma_shared_device_a",
            "rdmaHcaMax": 63,
            "selectors": {
              "vendors": ["15b3"]
            }
          }
        ]
      }
```

### GPU Operator + Network Operator Integration

```yaml
# GPU Operator ClusterPolicy — reference Network Operator for RDMA
apiVersion: nvidia.com/v1
kind: ClusterPolicy
metadata:
  name: cluster-policy
spec:
  driver:
    enabled: true
    rdma:
      enabled: true           # GPU Operator loads nvidia-peermem
      useHostMofed: true      # Uses MOFED from Network Operator

# Network Operator manages:
#   - MLNX_OFED driver (containerized or host)
#   - RDMA device plugins (shared or SR-IOV)
#   - Secondary networks (Multus, IPAM, CNI)
#
# GPU Operator manages:
#   - nvidia-peermem (GPUDirect RDMA bridge between GPU and NIC)
#   - GPU driver, device-plugin, toolkit, DCGM
#
# Together: full GPUDirect RDMA stack
```

### Secondary Network for RDMA Pods

```yaml
# MacvlanNetwork — automatic NetworkAttachmentDefinition creation
apiVersion: mellanox.com/v1alpha1
kind: MacvlanNetwork
metadata:
  name: gpu-rdma-net
spec:
  networkNamespace: "default"
  master: "ens8f0"           # RDMA-capable interface
  mode: "bridge"
  mtu: 9000                  # Jumbo frames for RDMA
  ipam: |
    {
      "type": "nv-ipam",
      "poolName": "gpu-fabric-pool"
    }
---
# IPPool for nv-ipam
apiVersion: nv-ipam.nvidia.com/v1alpha1
kind: IPPool
metadata:
  name: gpu-fabric-pool
  namespace: nvidia-network-operator
spec:
  subnet: "10.10.0.0/16"
  perNodeBlockSize: 64
  gateway: "10.10.0.1"
```

### Pod Consuming RDMA via Network Operator

```yaml
apiVersion: v1
kind: Pod
metadata:
  name: gpu-training
  annotations:
    k8s.v1.cni.cncf.io/networks: gpu-rdma-net
spec:
  containers:
    - name: trainer
      image: nvcr.io/nvidia/pytorch:24.04-py3
      resources:
        limits:
          nvidia.com/gpu: "8"
          rdma/rdma_shared_device_a: "1"
      securityContext:
        capabilities:
          add: ["IPC_LOCK"]
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

### Verify Network Operator Deployment

```bash
# Check operator pod
kubectl get pods -n nvidia-network-operator
# NAME                                        READY   STATUS    
# network-operator-controller-manager-xxx     1/1     Running
# mofed-ubuntu22.04-ds-xxxxx                  1/1     Running   (per node)
# rdma-shared-dp-ds-xxxxx                     1/1     Running   (per node)
# multus-ds-xxxxx                             1/1     Running   (per node)
# whereabouts-ds-xxxxx                        1/1     Running   (per node)

# Check NicClusterPolicy status
kubectl get nicclusterpolicy -o yaml | grep -A20 "status:"
# status:
#   appliedStates:
#     - name: state-OFED
#       state: ready
#     - name: state-RDMA-device-plugin
#       state: ready
#     - name: state-Multus
#       state: ready

# Check RDMA resources on nodes
kubectl get nodes -o json | jq '.items[].status.allocatable | with_entries(select(.key | startswith("rdma")))'
# { "rdma/rdma_shared_device_a": "63" }

# Check OFED version in driver container
kubectl exec -n nvidia-network-operator mofed-ubuntu22.04-ds-xxxxx -- ofed_info -s
# MLNX_OFED_LINUX-25.04-0.7.0.0:
```

### Network Operator Components

```text
Component                    │ Deployed By              │ Function
─────────────────────────────┼──────────────────────────┼──────────────────────────────
DOCA/MOFED Driver Container  │ ofedDriver               │ Containerized MLNX_OFED
RDMA Shared Device Plugin    │ rdmaSharedDevicePlugin   │ Shared /dev/infiniband access
SR-IOV Device Plugin         │ sriovDevicePlugin        │ Exclusive VF per pod
Multus CNI                   │ secondaryNetwork.multus  │ Multiple network interfaces
Whereabouts IPAM             │ secondaryNetwork.ipam    │ IP allocation for secondary nets
nv-ipam                      │ nvIpam                   │ NVIDIA IPAM (GPU fabric pools)
CNI Plugins                  │ secondaryNetwork.cni     │ macvlan, ipvlan, bridge CNIs
IB-Kubernetes                │ ibKubernetes             │ InfiniBand partition management
nvidia-peermem               │ GPU Operator (separate)  │ GPUDirect RDMA bridge
─────────────────────────────┴──────────────────────────┴──────────────────────────────
```

### Firmware Configuration via Network Operator

```yaml
apiVersion: mellanox.com/v1alpha1
kind: NicClusterPolicy
metadata:
  name: nic-cluster-policy
spec:
  ofedDriver:
    image: doca-driver
    repository: nvcr.io/nvidia/mellanox
    version: "25.04-0.7.0.0-0"

  # NIC firmware configuration
  nicConfigurationOperator:
    enabled: true

---
# NicConfigurationTemplate — configure NIC firmware settings
apiVersion: configuration.net.nvidia.com/v1alpha1
kind: NicConfigurationTemplate
metadata:
  name: rdma-optimized
spec:
  nodeSelector:
    node-role.kubernetes.io/gpu-worker: ""
  nicSelector:
    vendor: "15b3"
    deviceID: "101d"    # ConnectX-7
  template:
    parameters:
      # Enable RoCE
      ROCE_MODE: "2"
      # Enable GPUDirect
      ATS_ENABLED: "true"
      # PFC (Priority Flow Control)
      PFC_ENABLED: "true"
      PRIO_TC_MAP: "0,0,0,3,0,0,0,0"
```

### RoCE vs InfiniBand Configuration

```yaml
# For RoCE (RDMA over Converged Ethernet):
rdmaSharedDevicePlugin:
  config: |
    {
      "configList": [{
        "resourceName": "rdma_shared_device_a",
        "rdmaHcaMax": 63,
        "selectors": {
          "vendors": ["15b3"],
          "linkTypes": ["ETH"]         # ← Ethernet (RoCE)
        }
      }]
    }

# For InfiniBand:
rdmaSharedDevicePlugin:
  config: |
    {
      "configList": [{
        "resourceName": "rdma_shared_device_ib",
        "rdmaHcaMax": 63,
        "selectors": {
          "vendors": ["15b3"],
          "linkTypes": ["IB"]          # ← InfiniBand
        }
      }]
    }
```

## Common Issues

### MOFED driver container stuck in Init
- **Cause**: Host kernel headers not available; or existing MOFED conflicts
- **Fix**: Install `kernel-devel` matching running kernel; or remove host MOFED and let container manage it

### "No RDMA resources" after NicClusterPolicy applied
- **Cause**: Device plugin selector doesn't match any NICs; or plugin not scheduled on node
- **Fix**: Check `ibstat` on node for actual device IDs; verify node selector matches GPU workers

### Network Operator conflicts with SR-IOV Network Operator
- **Cause**: Both trying to manage SR-IOV; or Multus conflict
- **Fix**: Use one or the other for SR-IOV. Network Operator can embed SR-IOV; don't install both standalone

### OFED driver container version mismatch with host kernel
- **Cause**: Containerized MOFED built for different kernel
- **Fix**: Use `useHostOfed: true` if host already has MOFED; or match container image to kernel version

## Best Practices

1. **Network Operator for NIC stack, GPU Operator for GPU stack** — clear separation
2. **`useHostMofed: true` in GPU Operator** — tells it Network Operator manages MOFED
3. **Pin DOCA/MOFED versions** — avoid surprise driver updates breaking RDMA
4. **Use nv-ipam over whereabouts** — better integration with GPU fabric topology
5. **Separate resource names per fabric** — `rdma_gpu_fabric` vs `rdma_storage_fabric`
6. **Monitor NicClusterPolicy status** — all states should show "ready"
7. **Jumbo frames (MTU 9000)** — significant throughput improvement for RDMA

## Key Takeaways

- NVIDIA Network Operator: single CR (`NicClusterPolicy`) deploys entire RDMA stack
- Components: MOFED driver + device plugins + Multus + IPAM + CNI plugins
- Shared RDMA: `rdmaSharedDevicePlugin` — many pods share one PF (training clusters)
- SR-IOV RDMA: `sriovDevicePlugin` — exclusive VF per pod (multi-tenant)
- GPU Operator handles nvidia-peermem; Network Operator handles everything NIC-side
- `useHostMofed: true` in GPU Operator connects both operators
- Secondary networks (MacvlanNetwork + IPPool) give pods fabric IPs automatically
- RoCE vs IB: use `linkTypes` selector in device plugin config
