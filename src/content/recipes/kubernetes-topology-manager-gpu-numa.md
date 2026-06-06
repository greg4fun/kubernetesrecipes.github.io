---
title: "Kubernetes Topology Manager for GPU and NUMA Alignment"
description: "Configure Kubernetes Topology Manager to align CPU, GPU, and NIC allocations on the same NUMA node. Covers policies, kubelet config, and GPU performance tuning."
tags:
  - "topology-manager"
  - "numa"
  - "gpu"
  - "performance"
  - "kubelet"
category: "ai"
publishDate: "2026-06-04"
author: "Luca Berton"
difficulty: "advanced"
relatedRecipes:
  - "nvidia-gpu-topology-matrix-kubernetes"
  - "nvlink-bridge-architecture-gpu-kubernetes"
  - "nvidia-gpu-operator-setup"
---

> 💡 **Quick Answer:** Topology Manager is a kubelet component that coordinates CPU Manager, Device Manager (GPUs), and Memory Manager to allocate resources from the same NUMA node. Set `topologyManagerPolicy: single-numa-node` in kubelet config to ensure GPUs, CPUs, and NICs are all co-located on one NUMA node — critical for GPU workloads where cross-NUMA memory access adds 30-50% latency penalty.

## The Problem

- GPU allocated from NUMA 0 but CPUs from NUMA 1 — cross-NUMA memory access kills performance
- NIC on different NUMA node than GPU — GPUDirect RDMA crosses QPI/UPI interconnect
- Data loading from CPU to GPU traverses extra hop when NUMA-misaligned
- Default Kubernetes scheduling ignores hardware topology entirely
- Multi-GPU pods get GPUs from different NUMA nodes unnecessarily

## The Solution

### Topology Manager Policies

```text
Policy              │ Behavior                                    │ Use Case
────────────────────┼─────────────────────────────────────────────┼──────────────────
none                │ No topology alignment (default)             │ General workloads
best-effort         │ Try to align, admit pod anyway if can't     │ Mixed clusters
restricted          │ Align or reject pod (fail admission)        │ GPU/HPC nodes
single-numa-node    │ ALL resources must come from ONE NUMA node  │ Strict GPU/RDMA
────────────────────┴─────────────────────────────────────────────┴──────────────────
```

### Configure Kubelet

```yaml
# /var/lib/kubelet/config.yaml
apiVersion: kubelet.config.k8s.io/v1beta1
kind: KubeletConfiguration
topologyManagerPolicy: "single-numa-node"
topologyManagerScope: "pod"          # or "container" (per-container alignment)
cpuManagerPolicy: "static"            # Required for CPU pinning
memoryManagerPolicy: "Static"         # NUMA-aware memory allocation
reservedSystemCPUs: "0-3"             # Reserve CPUs for system
```

```bash
# Restart kubelet after config change
systemctl restart kubelet

# Verify
kubectl describe node gpu-node-1 | grep -A5 "Topology Manager"
```

### Topology Manager Scope

```text
Scope      │ Alignment Granularity
───────────┼──────────────────────────────────────────────────
pod        │ All containers in the pod must fit one NUMA node
           │ (stricter — pod rejected if any container can't align)
───────────┼──────────────────────────────────────────────────
container  │ Each container independently aligned to a NUMA node
           │ (more flexible — different containers can use different NUMA)
───────────┴──────────────────────────────────────────────────
```

### Full Configuration for GPU Nodes

```yaml
# /var/lib/kubelet/config.yaml — optimized for 8-GPU dual-socket
apiVersion: kubelet.config.k8s.io/v1beta1
kind: KubeletConfiguration

# Topology alignment
topologyManagerPolicy: "single-numa-node"
topologyManagerScope: "pod"

# CPU pinning (exclusive cores for guaranteed QoS)
cpuManagerPolicy: "static"
cpuManagerPolicyOptions:
  full-pcpus-only: "true"         # Allocate full physical cores only
  distribute-cpus-across-numa: "false"  # Keep CPUs on one NUMA

# Memory management
memoryManagerPolicy: "Static"
reservedMemory:
  - numaNode: 0
    limits:
      memory: "2Gi"               # Reserve for system on NUMA 0
  - numaNode: 1
    limits:
      memory: "2Gi"               # Reserve for system on NUMA 1

# System reservation
reservedSystemCPUs: "0-3,64-67"   # First 4 cores per socket for system
systemReserved:
  cpu: "4000m"
  memory: "8Gi"
kubeReserved:
  cpu: "2000m"
  memory: "4Gi"
```

### Pod Requesting NUMA-Aligned Resources

```yaml
apiVersion: v1
kind: Pod
metadata:
  name: gpu-training
spec:
  containers:
    - name: trainer
      image: registry.example.com/training:v1
      resources:
        # Guaranteed QoS required for topology alignment
        requests:
          cpu: "16"                    # 16 exclusive CPUs
          memory: "64Gi"              # NUMA-local memory
          nvidia.com/gpu: "4"         # 4 GPUs (one NVL4 group)
          rdma/rdma_shared_device_a: "1"  # RDMA NIC
        limits:
          cpu: "16"
          memory: "64Gi"
          nvidia.com/gpu: "4"
          rdma/rdma_shared_device_a: "1"
      # requests == limits → Guaranteed QoS → topology manager applies
```

### Verify NUMA Alignment

```bash
# Check which NUMA node resources came from
kubectl exec gpu-training -- bash -c '
  echo "=== GPU NUMA Affinity ==="
  nvidia-smi topo -m | head -20
  
  echo "=== CPU Affinity ==="
  taskset -p 1
  cat /proc/self/status | grep Cpus_allowed_list
  
  echo "=== Memory NUMA ==="
  numactl --show
  cat /proc/self/numa_maps | head -10
'

# From node: check kubelet topology decisions
journalctl -u kubelet | grep -i "topology"
# "Topology Admit Handler" messages show alignment decisions
```

### What Happens on Admission Failure

```text
Policy: single-numa-node
Pod requests: 4 GPUs + 32 CPUs + 128Gi memory

If NUMA 0 has: 4 GPUs available, 28 CPUs free, 200Gi memory
→ Pod REJECTED (only 28 CPUs on NUMA 0, need 32)
→ Event: "TopologyAffinityError"

kubectl describe pod gpu-training:
  Events:
    Type     Reason            Message
    Warning  TopologyAffinity  Resources cannot be allocated with topology alignment

Fix: reduce CPU request to fit one NUMA node, or use "restricted" policy
```

### Topology Manager with GPU Operator

```yaml
# GPU Operator Helm values for topology-aware deployment
# The GPU Operator automatically integrates with Topology Manager
# when it detects the kubelet policy is set

# ClusterPolicy (GPU Operator)
apiVersion: nvidia.com/v1
kind: ClusterPolicy
metadata:
  name: cluster-policy
spec:
  operator:
    defaultRuntime: containerd
  devicePlugin:
    config:
      name: device-plugin-config
---
# Device plugin ConfigMap for topology awareness
apiVersion: v1
kind: ConfigMap
metadata:
  name: device-plugin-config
  namespace: gpu-operator
data:
  config.yaml: |
    version: v1
    sharing:
      timeSlicing:
        resources:
          - name: nvidia.com/gpu
            replicas: 1    # No time-slicing (full GPU per request)
    flags:
      migStrategy: none
      # Device plugin reports topology hints to Topology Manager
      # automatically when kubelet topologyManagerPolicy != "none"
```

### MachineConfig for OpenShift (Topology Manager)

```yaml
apiVersion: machineconfiguration.openshift.io/v1
kind: KubeletConfig
metadata:
  name: gpu-topology-config
spec:
  machineConfigPoolSelector:
    matchLabels:
      pools.operator.machineconfiguration.openshift.io/gpu-worker: ""
  kubeletConfig:
    topologyManagerPolicy: "single-numa-node"
    topologyManagerScope: "pod"
    cpuManagerPolicy: "static"
    cpuManagerPolicyOptions:
      full-pcpus-only: "true"
    memoryManagerPolicy: "Static"
    reservedSystemCPUs: "0-3,64-67"
    systemReserved:
      cpu: "4000m"
      memory: "8Gi"
    kubeReserved:
      cpu: "2000m"
      memory: "4Gi"
    reservedMemory:
      - numaNode: 0
        limits:
          memory: "2Gi"
      - numaNode: 1
        limits:
          memory: "2Gi"
```

### Performance Impact

```text
Workload: LLM training (4x H100, 64 CPUs, 256Gi RAM)

Without Topology Manager (NUMA misaligned):
  - GPU memory bandwidth: ~3.2 TB/s (local)
  - CPU→GPU data loading: ~40 GB/s (cross-NUMA via QPI)
  - GPUDirect RDMA: ~35 GB/s (NIC on wrong socket)
  - Training throughput: baseline

With single-numa-node policy (NUMA aligned):
  - GPU memory bandwidth: ~3.2 TB/s (same)
  - CPU→GPU data loading: ~64 GB/s (NUMA-local PCIe)
  - GPUDirect RDMA: ~50 GB/s (NIC co-located with GPU)
  - Training throughput: +15-30% improvement

The gain comes from:
  - Eliminating QPI/UPI hops for memory access (+60% bandwidth)
  - RDMA NIC using shortest PCIe path (+40% RDMA throughput)
  - CPU data preprocessing on NUMA-local memory (reduced latency)
```

## Common Issues

### Pods stuck Pending with TopologyAffinityError
- **Cause**: Resources can't fit on a single NUMA node (too many CPUs/GPUs requested)
- **Fix**: Reduce resource request; use `restricted` instead of `single-numa-node`; or add nodes with larger NUMA domains

### Topology Manager has no effect on pod
- **Cause**: Pod QoS is not Guaranteed (requests != limits)
- **Fix**: Set requests == limits for all containers (Topology Manager only applies to Guaranteed QoS)

### Only one NUMA node utilized (other idle)
- **Cause**: All pods requesting `single-numa-node` fill NUMA 0 first; NUMA 1 resources stranded
- **Fix**: Use `restricted` policy for smaller pods; or request full-node resources (8 GPUs)

### CPU Manager not pinning CPUs
- **Cause**: `cpuManagerPolicy: static` requires Guaranteed QoS AND integer CPU requests
- **Fix**: Request whole CPUs (e.g., `cpu: "16"` not `cpu: "15500m"`)

## Best Practices

1. **`single-numa-node` for GPU nodes** — ensures GPU, CPU, NIC, memory all co-located
2. **Guaranteed QoS required** — set requests == limits for topology alignment to apply
3. **Integer CPU requests** — `cpu: "16"` (not millicores) for CPU pinning
4. **Reserve system CPUs** — `reservedSystemCPUs` prevents workloads from using core 0
5. **`full-pcpus-only`** — allocate complete physical cores (avoids SMT sibling sharing)
6. **Size pods to fit NUMA** — don't request more CPUs than one NUMA node has
7. **Monitor NUMA utilization** — prevent one NUMA filling while other is idle

## Key Takeaways

- Topology Manager coordinates CPU, GPU, memory, and device allocation for NUMA alignment
- `single-numa-node` policy: all resources from ONE NUMA node or pod rejected
- Only applies to Guaranteed QoS pods (requests == limits)
- Eliminates cross-NUMA penalties: +15-30% GPU training throughput improvement
- Requires `cpuManagerPolicy: static` for CPU pinning to work
- GPU Operator automatically provides topology hints to Topology Manager
- OpenShift: configure via KubeletConfig CR targeting GPU worker MachineConfigPool
