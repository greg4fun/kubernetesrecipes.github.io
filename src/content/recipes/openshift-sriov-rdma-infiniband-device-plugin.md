---
title: "OpenShift SR-IOV RDMA InfiniBand Device Plugin"
description: "Configure and troubleshoot SR-IOV Network Operator with Mellanox ConnectX RDMA InfiniBand devices on OpenShift. Covers SriovNetworkNodePolicy, device"
tags:
  - "sriov"
  - "rdma"
  - "infiniband"
  - "mellanox"
  - "openshift"
category: "networking"
publishDate: "2026-05-07"
author: "Luca Berton"
difficulty: "advanced"
relatedRecipes:
  - "nvidia-gpu-operator-setup"
  - "kubernetes-ai-infrastructure-scaling"
  - "openshift-machineconfig-mcp-guide"
  - "virtualization-vt-x-vs-vt-d-vs-sriov"
---

> 💡 **Quick Answer:** The SR-IOV Network Operator on OpenShift manages Mellanox ConnectX RDMA/InfiniBand devices via `SriovNetworkNodePolicy`. When the device plugin logs "no devices in device pool, skipping creating resource server for mellanoxnics," it means the policy's selector doesn't match available VFs — verify PCI addresses, numVfs, and node labels.

## The Problem

Setting up SR-IOV with RDMA/InfiniBand for GPU workloads (NCCL, tensor parallelism) requires:

- Correct SriovNetworkNodePolicy targeting Mellanox ConnectX NICs
- Virtual Functions (VFs) created and bound to the correct driver
- Device plugin exposing `/dev/infiniband/uverbs*` and `/dev/infiniband/rdma_cm` to Pods
- Troubleshooting when devices aren't registered in the resource pool

## The Solution

### SriovNetworkNodePolicy for Mellanox RDMA

```yaml
apiVersion: sriovnetwork.openshift.io/v1
kind: SriovNetworkNodePolicy
metadata:
  name: mellanox-rdma-policy
  namespace: openshift-sriov-network-operator
spec:
  nodeSelector:
    feature.node.kubernetes.io/pci-15b3.present: "true"
  numVfs: 16
  priority: 98
  resourceName: mellanoxnics
  vendor: "15b3"
  deviceType: netdevice
  isRdma: true
  nicSelector:
    vendor: "15b3"
    # Optional: target specific PF by PCI address
    # rootDevices:
    #   - "0000:ca:00.0"
    #   - "0001:c8:00.0"
    # Or by pfNames:
    # pfNames:
    #   - "ens1f0np0"
    #   - "ens2f0np0"
```

### Verify SR-IOV Operator Components

```bash
# Check all SR-IOV operator Pods are running
oc get pods -n openshift-sriov-network-operator -o wide

# Expected Pods:
# - sriov-network-operator (1 replica)
# - sriov-device-plugin (DaemonSet, per GPU node)
# - sriov-network-config-daemon (DaemonSet, per GPU node)
# - network-resources-injector (3 replicas)
# - operator-webhook (3 replicas)

# Check node state
oc get sriovnetworknodestates -n openshift-sriov-network-operator

# Detailed node state (shows discovered devices)
oc get sriovnetworknodestates <node-name> -o yaml
```

### Verify Device Discovery

```bash
# Check what the device plugin discovers
oc logs sriov-device-plugin-<hash> -n openshift-sriov-network-operator

# Successful discovery shows:
# auxNetDeviceProvider AddTargetDevices(): device found: 0000:c8:00.0  02
#   Mellanox Technology  MT2894 Family [ConnectX-6 Lx]
# auxNetDeviceProvider AddTargetDevices(): device found: 0000:ca:00.0  02
#   Mellanox Technology  MT2910 Family [ConnectX-7]

# Check network config daemon for VF creation
oc logs sriov-network-config-daemon-<hash> -n openshift-sriov-network-operator
```

### Understand Device Allocation Flow

```text
Allocation Request Flow:
─────────────────────────────────────────────────────────────────

1. Pod requests: resources.requests["openshift.io/mellanoxnics"]: "1"

2. Device Plugin receives AllocateRequest
   → server.go:127  Allocate() called with &AllocateRequest
   → pool_stub.go:108 GetEnvs(): for devices: [0000:ca:00.7]

3. Device Plugin resolves device specs
   → netResourcePool.go:89 GetDeviceSpecs(): for devices: [0000:ca:00.7]
   → rdmaInfoProvider.go:57 GetRdmaDeviceSpec() returned:
     • ContainerPath: /dev/infiniband/uverbs31
     • HostPath: /dev/infiniband/uverbs31
     • ContainerPath: /dev/infiniband/rdma_cm
     • HostPath: /dev/infiniband/rdma_cm

4. AllocateResponse sent back with:
   • PCIDEVICE_OPENSHIFT_IO_MELLANOXNICS_INFO env var (JSON)
   • Device mounts: /dev/infiniband/uverbs*, /dev/infiniband/rdma_cm
   • CDI devices (if CDI mode enabled)

5. Pod starts with RDMA devices mounted
```

### Device Info Environment Variable

```json
// PCIDEVICE_OPENSHIFT_IO_MELLANOXNICS_INFO (injected into Pod)
{
  "0000:ca:00.7": {
    "generic": {
      "deviceID": "0000:ca:00.7"
    },
    "rdma": {
      "rdma_cm": "/dev/infiniband/rdma_cm"
    }
  }
}
```

### SriovNetwork for Pod Attachment

```yaml
apiVersion: sriovnetwork.openshift.io/v1
kind: SriovNetwork
metadata:
  name: rdma-network
  namespace: openshift-sriov-network-operator
spec:
  networkNamespace: ai-training
  resourceName: mellanoxnics
  ipam: |
    {
      "type": "whereabouts",
      "range": "192.168.100.0/24"
    }
  capabilities: '{"rdma": true}'
---
# Pod requesting SR-IOV RDMA device
apiVersion: v1
kind: Pod
metadata:
  name: nccl-test
  namespace: ai-training
  annotations:
    k8s.v1.cni.cncf.io/networks: rdma-network
spec:
  containers:
    - name: nccl
      image: nvcr.io/nvidia/pytorch:24.07-py3
      resources:
        requests:
          nvidia.com/gpu: "1"
          openshift.io/mellanoxnics: "1"
        limits:
          nvidia.com/gpu: "1"
          openshift.io/mellanoxnics: "1"
      env:
        - name: NCCL_IB_HCA
          value: "mlx5"
        - name: NCCL_DEBUG
          value: "INFO"
```

### Troubleshooting: "no devices in device pool"

```bash
# Error in device plugin logs:
# "no devices in device pool, skipping creating resource server for mellanoxnics"

# Root Causes:

# 1. VFs not created yet
# Check if numVfs are configured on the PF
oc debug node/<gpu-node> -- chroot /host cat /sys/class/net/ens1f0np0/device/sriov_numvfs
# Should show: 16 (matching your policy)

# 2. Node doesn't match nodeSelector
oc get nodes --show-labels | grep "pci-15b3"
# Verify: feature.node.kubernetes.io/pci-15b3.present=true

# 3. PCI vendor/device mismatch
# Check actual PCI devices on node
oc debug node/<gpu-node> -- chroot /host lspci -nn | grep Mellanox
# Look for vendor 15b3

# 4. Driver binding issue (VFs exist but not bound)
oc debug node/<gpu-node> -- chroot /host ls /sys/class/infiniband/
# Should show: mlx5_0, mlx5_1, ... mlx5_N

# 5. Config daemon hasn't applied yet
oc get sriovnetworknodestates <node> -n openshift-sriov-network-operator -o yaml
# Check: status.syncStatus should be "Succeeded"

# 6. Selector too restrictive (rootDevices/pfNames don't match)
# Remove rootDevices/pfNames from policy to use all 15b3 devices
```

### Troubleshooting: Device Plugin Allocation Errors

```bash
# Check device plugin detailed logs
oc logs -n openshift-sriov-network-operator \
  $(oc get pods -n openshift-sriov-network-operator -l app=sriov-device-plugin \
    --field-selector spec.nodeName=<gpu-node> -o name) -f

# Verify allocatable resources on node
oc describe node <gpu-node> | grep -A5 "Allocatable"
# Should show: openshift.io/mellanoxnics: 16

# Check if resources are already consumed
oc describe node <gpu-node> | grep -A5 "Allocated resources"

# Verify RDMA device files exist on node
oc debug node/<gpu-node> -- chroot /host ls -la /dev/infiniband/
# Should show: rdma_cm, uverbs0, uverbs1, ... uverbsN
```

### ConnectX NIC Family Reference

```text
Device ID    Family           Speed        Common Use
─────────────────────────────────────────────────────────
MT27800     ConnectX-5       100Gb/s      InfiniBand EDR
MT28800     ConnectX-5 Ex    100Gb/s      InfiniBand EDR
MT2892      ConnectX-6       200Gb/s      InfiniBand HDR
MT2894      ConnectX-6 Lx    100Gb/s      Ethernet only
MT2910      ConnectX-7       400Gb/s      InfiniBand NDR
MT2920      ConnectX-7       400Gb/s      InfiniBand NDR

Vendor ID: 15b3 (Mellanox Technologies / NVIDIA Networking)
```

### Multi-Device Allocation (Multiple RDMA VFs per Pod)

```yaml
# For multi-GPU Pods needing multiple RDMA paths
apiVersion: v1
kind: Pod
metadata:
  name: distributed-training
  annotations:
    k8s.v1.cni.cncf.io/networks: |
      [
        {"name": "rdma-network", "interface": "net1"},
        {"name": "rdma-network", "interface": "net2"}
      ]
spec:
  containers:
    - name: training
      image: nvcr.io/nvidia/pytorch:24.07-py3
      resources:
        requests:
          nvidia.com/gpu: "4"
          openshift.io/mellanoxnics: "4"
        limits:
          nvidia.com/gpu: "4"
          openshift.io/mellanoxnics: "4"
      env:
        - name: NCCL_IB_HCA
          value: "mlx5"
        - name: NCCL_NET_GDR_LEVEL
          value: "5"
        - name: NCCL_IB_GID_INDEX
          value: "3"
```

## Common Issues

### VFs created but not visible to device plugin
- **Cause**: Config daemon applied VFs but device plugin started before
- **Fix**: Restart device plugin Pod: `oc delete pod sriov-device-plugin-<hash> -n openshift-sriov-network-operator`

### RDMA devices missing after node reboot
- **Cause**: VF configuration not persisted in MachineConfig
- **Fix**: SR-IOV operator should persist via config daemon; check `syncStatus`

### Mixed ConnectX-6 and ConnectX-7 — policy applies to wrong NICs
- **Cause**: Vendor-only selector matches all Mellanox NICs
- **Fix**: Use `pfNames` or `rootDevices` in nicSelector to target specific PFs

### NCCL fails with "No RDMA device found"
- **Cause**: Pod doesn't have RDMA devices mounted or wrong HCA name
- **Fix**: Verify `openshift.io/mellanoxnics` in Pod spec; check `/dev/infiniband/` inside Pod

## Best Practices

1. **Use `feature.node.kubernetes.io/pci-15b3.present`** as nodeSelector — auto-detected by NFD
2. **Start with numVfs: 16** — enough for most GPU training workloads
3. **Set priority: 98** — below default (99) to not conflict with other policies
4. **Enable `isRdma: true`** — mounts uverbs + rdma_cm into Pods
5. **One policy per NIC type** — separate ConnectX-6 Lx (Ethernet) from ConnectX-7 (IB)
6. **Monitor with `oc get sriovnetworknodestates`** — shows sync status per node
7. **Match RDMA VFs to GPUs** — 1 VF per GPU for optimal NCCL topology

## Key Takeaways

- SR-IOV device plugin allocates RDMA devices (/dev/infiniband/uverbs*, rdma_cm) to Pods
- "No devices in device pool" = VFs not created, node label missing, or selector mismatch
- Device allocation injects PCIDEVICE env var with device-to-RDMA mapping
- ConnectX-6/6Lx/7 all use vendor 15b3; differentiate by pfNames or rootDevices
- NCCL needs `NCCL_IB_HCA=mlx5` + SR-IOV VF for GPU-Direct RDMA
- Check `sriovnetworknodestates` for sync status; device plugin logs for allocation flow
- Multi-GPU Pods request multiple VFs (1:1 GPU-to-RDMA for optimal topology)
