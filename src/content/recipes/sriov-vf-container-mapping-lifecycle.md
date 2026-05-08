---
title: "SR-IOV VF to Container Mapping and Lifecycle"
description: "How SR-IOV Virtual Functions are mapped to containers in Kubernetes. Covers VF allocation flow, link state management (VFs are down when unassigned), device plugin scheduling, and network namespace binding."
tags:
  - "sriov"
  - "virtual-function"
  - "containers"
  - "device-plugin"
  - "networking"
category: "networking"
publishDate: "2026-05-08"
author: "Luca Berton"
difficulty: "intermediate"
relatedRecipes:
  - "openshift-sriov-rdma-infiniband-device-plugin"
  - "nv-ipam-gpu-fabric-ip-allocation"
  - "openshift-sriov-mmio-resources-fix"
  - "dual-fabric-mellanox-gpu-storage-ethernet-infiniband"
---

> 💡 **Quick Answer:** SR-IOV VFs are mapped to containers via the device plugin and Multus CNI. VFs show link state "down" when not assigned to any Pod — this is normal. When a Pod requests a VF, the device plugin assigns it, Multus moves it into the Pod's network namespace, and the link comes up. On Pod deletion, the VF returns to the pool with link state down.

## The Problem

Questions that arise when managing SR-IOV VFs on GPU nodes:

- "Why are VFs showing link state DOWN?" → Normal — they're not assigned to a Pod
- How does a VF get inside a container's network namespace?
- What happens to the VF when the Pod dies?
- How does Kubernetes know which VF to assign to which Pod?

## The Solution

### VF Lifecycle: From Creation to Container

```text
VF Lifecycle:
──────────────────────────────────────────────────────────────────

1. NODE BOOT → SR-IOV Config Daemon creates VFs
   ┌─────────────────────────────────────────┐
   │  PF: mlx5_0 (ens1f0np0)                │
   │  ├── VF0: ens1f0v0  state: DOWN ←─┐    │
   │  ├── VF1: ens1f0v1  state: DOWN   │    │
   │  ├── VF2: ens1f0v2  state: DOWN   │ Normal! │
   │  ├── VF3: ens1f0v3  state: DOWN   │ Not in use │
   │  └── ...                           ←─┘    │
   └─────────────────────────────────────────┘

2. DEVICE PLUGIN registers VFs as allocatable resources
   Node capacity: openshift.io/mellanoxnics: 16

3. POD SCHEDULED → kubelet calls device plugin Allocate()
   Device plugin returns:
   • VF PCI address (e.g., 0000:ca:00.7)
   • Device mounts (/dev/infiniband/uverbs31, rdma_cm)
   • Environment (PCIDEVICE_OPENSHIFT_IO_MELLANOXNICS_INFO)

4. MULTUS CNI moves VF into Pod network namespace
   ┌──────────────────────┐
   │  Pod netns           │
   │  ├── eth0 (default)  │  ← OVN/Calico veth
   │  ├── rdma0 (VF)      │  ← SR-IOV VF moved here
   │  │   state: UP ✅    │
   │  │   IP: 10.100.0.17 │  ← Assigned by nv-ipam
   │  └── /dev/infiniband/ │  ← RDMA devices mounted
   └──────────────────────┘

5. POD DELETED → CNI DEL moves VF back to host namespace
   VF returns to state: DOWN (available for next Pod)
```

### VF Link State Explained

```bash
# On the host — checking VF states
ip link show ens1f0np0
# Output:
#   ens1f0np0: <BROADCAST,MULTICAST,UP> ... state UP
#     vf 0 ... link-state auto (state: down)    ← Not assigned
#     vf 1 ... link-state auto (state: down)    ← Not assigned
#     vf 2 ... link-state auto (state: up)      ← In use by Pod
#     vf 3 ... link-state auto (state: down)    ← Not assigned

# This is NORMAL:
#   DOWN = VF is idle, not assigned to any Pod
#   UP   = VF is inside a Pod's network namespace
#   AUTO = link state follows actual link (up when connected)
```

```text
VF Link States:
──────────────────────────────────────────────────────────────────
State         Meaning                    Action Needed?
──────────────────────────────────────────────────────────────────
down          Not assigned to Pod        ✅ Normal — idle VF
up            Assigned to running Pod    ✅ Normal — in use
auto (down)   Auto mode, no Pod          ✅ Normal — waiting
disable       Administratively disabled  ⚠️ Check policy
error         Hardware/driver issue      ❌ Investigate

Key insight: VFs SHOULD be down when not in use.
An "up" VF without a Pod means something leaked.
```

### The Full Allocation Flow

```text
Pod Request → Device Plugin → Multus → Container
──────────────────────────────────────────────────────────────────

Step 1: Pod spec requests SR-IOV resource
  resources:
    requests:
      openshift.io/mellanoxnics: "1"

Step 2: Scheduler finds node with available VF
  Node gpu-worker-01:
    Allocatable: openshift.io/mellanoxnics: 16
    Allocated:   openshift.io/mellanoxnics: 3
    Available:   13

Step 3: kubelet calls device plugin gRPC Allocate()
  → Device plugin picks next free VF: 0000:ca:00.7
  → Returns AllocateResponse:
    {
      envs: {
        "PCIDEVICE_OPENSHIFT_IO_MELLANOXNICS": "0000:ca:00.7"
      },
      mounts: [
        {containerPath: "/dev/infiniband/uverbs31", hostPath: "..."},
        {containerPath: "/dev/infiniband/rdma_cm", hostPath: "..."}
      ]
    }

Step 4: Container runtime creates Pod sandbox

Step 5: Multus CNI is called (ADD)
  → Reads network annotation: k8s.v1.cni.cncf.io/networks: gpu-rdma
  → Calls SR-IOV CNI plugin
  → SR-IOV CNI:
    a) Finds VF by PCI address (0000:ca:00.7)
    b) Gets VF netdev name (ens1f0v7)
    c) Moves VF to Pod network namespace
    d) Renames to requested interface (rdma0)
    e) Sets link UP
    f) Calls IPAM (nv-ipam) → assigns 10.100.0.X
    g) Configures IP on interface

Step 6: Pod is running with VF
  → VF is in Pod's netns, state UP, IP assigned
  → RDMA devices mounted at /dev/infiniband/
  → NCCL can use it for GPU-Direct RDMA

Step 7: Pod terminates
  → Multus CNI DEL called
  → SR-IOV CNI moves VF back to host namespace
  → VF state returns to DOWN
  → Device plugin marks VF as available
  → IP returned to nv-ipam pool
```

### Inspect VF-to-Pod Mapping

```bash
# Which Pods are using which VFs?

# Method 1: Check device plugin allocation
kubectl get pods -n ai-training -o json | jq -r '
  .items[] | select(.spec.containers[].resources.requests["openshift.io/mellanoxnics"]) |
  "\(.metadata.name): \(.metadata.annotations["k8s.v1.cni.cncf.io/network-status"])"'

# Method 2: From the node — find VFs in non-default namespaces
ip netns list
# Each Pod has a netns; VFs moved there are "missing" from host

# Method 3: Check PCI device assignment
ls /sys/bus/pci/devices/0000:ca:00.7/net/
# Empty = VF is in a Pod's netns
# Shows interface name = VF is on host (available)

# Method 4: SR-IOV device plugin socket
kubectl exec -n openshift-sriov-network-operator sriov-device-plugin-<hash> -- \
  cat /var/lib/kubelet/device-plugins/kubelet_internal_checkpoint
# Shows allocated devices per Pod

# Method 5: Check from inside the Pod
kubectl exec -it nccl-training -- ip link show rdma0
# Shows the VF interface with its state and MAC
```

### VF Configuration by Device Plugin

```bash
# What the device plugin configures on the VF before assignment:
# (Based on SriovNetworkNodePolicy settings)

# Spoofcheck — usually disabled for RDMA
ip link set ens1f0np0 vf 7 spoofchk off

# Trust — required for RDMA QP operations
ip link set ens1f0np0 vf 7 trust on

# VLAN (if configured in policy)
ip link set ens1f0np0 vf 7 vlan 100

# MAC (if specified, otherwise auto)
ip link set ens1f0np0 vf 7 mac 00:11:22:33:44:55

# Link state auto (comes up when moved to netns)
ip link set ens1f0np0 vf 7 state auto

# Rate limiting (if QoS configured)
ip link set ens1f0np0 vf 7 max_tx_rate 50000  # 50Gbps
```

### Verify VF Health

```bash
# Quick health check: all VFs accounted for
TOTAL_VFS=$(cat /sys/class/net/ens1f0np0/device/sriov_numvfs)
IN_USE=$(ip link show ens1f0np0 | grep -c "state up")
AVAILABLE=$((TOTAL_VFS - IN_USE))

echo "Total VFs: $TOTAL_VFS"
echo "In use (UP): $IN_USE"
echo "Available (DOWN): $AVAILABLE"

# Check for stuck VFs (UP but no Pod)
for i in $(seq 0 $((TOTAL_VFS-1))); do
  vf_dir="/sys/bus/pci/devices/$(readlink /sys/class/net/ens1f0np0/device/virtfn${i} | sed 's|../||')"
  if [ -z "$(ls ${vf_dir}/net/ 2>/dev/null)" ]; then
    echo "VF $i: in Pod netns (IN USE)"
  else
    vf_name=$(ls ${vf_dir}/net/)
    state=$(cat ${vf_dir}/net/${vf_name}/operstate)
    echo "VF $i: on host as ${vf_name} (state: ${state})"
  fi
done
```

### What Happens on Pod Crash/Eviction

```text
Scenario                    VF Behavior
──────────────────────────────────────────────────────────────────
Normal Pod delete           CNI DEL → VF back to host → DOWN → available
Pod crash (OOM/segfault)    CRI cleanup → CNI DEL → VF back → available
Node reboot                 All VFs recreated by config daemon → DOWN
kubelet restart             Existing Pods keep VFs; no change
Pod eviction                Same as normal delete (graceful)
Force delete (no grace)     CNI DEL still called by CRI → VF recovered

Edge case: CNI DEL fails
  → VF stuck in dead netns
  → Fix: restart sriov-device-plugin Pod on that node
  → Or: reboot node (nuclear option)
```

## Common Issues

### All VFs showing "down" — is something broken?
- **Cause**: No Pods requesting SR-IOV resources on this node
- **Fix**: This is normal! VFs are down when not assigned. They come up when a Pod uses them.

### VF stuck "up" but Pod is gone
- **Cause**: CNI DEL failed during Pod cleanup (rare race condition)
- **Fix**: Restart sriov-device-plugin Pod; it re-syncs state

### Pod can't get VF — "insufficient resources"
- **Cause**: All VFs allocated to other Pods (or stuck)
- **Fix**: Check `kubectl describe node | grep mellanox`; free leaked VFs

### VF in Pod shows "NO-CARRIER"
- **Cause**: Physical link on PF is down (cable, switch port)
- **Fix**: Check `ip link show ens1f0np0` on host — PF must be UP first

## Best Practices

1. **Don't panic at DOWN VFs** — idle VFs should be down
2. **Monitor allocated vs total** — alert at >80% utilization
3. **One VF per GPU** for RDMA workloads — matches traffic pattern
4. **Set `trust on` + `spoofchk off`** for RDMA VFs
5. **Check `sriov_numvfs`** after reboot — config daemon should restore
6. **Label nodes with VF count** for scheduler awareness
7. **Test VF recovery** — delete Pods and verify VFs return to pool

## Key Takeaways

- VFs are **supposed to be DOWN when not in use** — this is healthy idle state
- Device plugin assigns VFs → Multus/SR-IOV CNI moves VF into Pod netns → link goes UP
- On Pod delete: VF returns to host namespace → link goes DOWN → available for next Pod
- The full chain: Pod spec → scheduler → device plugin → CRI → Multus → SR-IOV CNI → IPAM
- Stuck VFs (up without Pod) are rare — restart device plugin to re-sync
- Each VF gets: network namespace move, IP from IPAM, RDMA device mounts, trust/spoofchk config
- Monitor `Allocatable` vs `Allocated` on nodes to track VF pool health
