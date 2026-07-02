---
title: "Kubernetes 1.36 Topology-Aware Scheduling"
description: "Use topology-aware workload scheduling in Kubernetes 1.36 to place Pods on nodes with optimal GPU, NUMA, and network topology for ML training."
tags:
  - "kubernetes-1.36"
  - "scheduling"
  - "topology"
  - "gpu"
  - "numa"
category: "ai"
publishDate: "2026-05-03"
author: "Luca Berton"
difficulty: "advanced"
relatedRecipes:
  - "kubernetes-1-36-gang-scheduling"
  - "kubernetes-1-36-dra-gpu-management"
  - "validate-gpu-topology-nccl"
  - "gpu-node-affinity-scheduling"
---

> 💡 **Quick Answer:** Kubernetes 1.36 introduces **Topology-Aware Workload Scheduling** (KEP-5732). The scheduler considers GPU interconnect topology, NUMA zones, and network fabric when placing distributed workloads — reducing cross-node communication overhead by up to 10x.

## The Problem

Distributed ML training performance depends heavily on how Pods are placed relative to each other:

- **NVLink vs PCIe**: GPUs on the same NVLink domain communicate at 900 GB/s; across PCIe it drops to 32 GB/s
- **Same switch vs cross-switch**: Network latency doubles when Pods land on nodes connected through different top-of-rack switches
- **NUMA distance**: Memory access latency varies 2-3x across NUMA zones
- **Default scheduler ignores topology** — it optimizes for resource utilization, not communication patterns

## The Solution

Topology-aware scheduling places workload Pods on nodes that minimize communication latency based on the cluster's physical topology.

### Define Topology Domains

```yaml
# Node labels define the topology hierarchy
# Level 0: GPU domain (NVLink)
# Level 1: Node (PCIe bus)
# Level 2: Rack (top-of-rack switch)
# Level 3: Cluster (spine switch)

apiVersion: v1
kind: Node
metadata:
  name: gpu-node-01
  labels:
    topology.kubernetes.io/zone: "us-east-1a"
    topology.kubernetes.io/rack: "rack-a1"
    topology.kubernetes.io/switch: "tor-a1"
    nvidia.com/gpu-fabric: "nvswitch-domain-1"
```

### Topology-Aware Training Job

```yaml
apiVersion: scheduling.k8s.io/v1alpha1
kind: TopologyPolicy
metadata:
  name: ml-training-topology
spec:
  levels:
    - name: gpu-domain
      labelKey: nvidia.com/gpu-fabric
      weight: 100    # Highest priority: same NVLink domain
    - name: rack
      labelKey: topology.kubernetes.io/rack
      weight: 50     # Second priority: same rack
    - name: zone
      labelKey: topology.kubernetes.io/zone
      weight: 10     # Third priority: same zone
  optimization: MinimizeSpread    # Pack Pods as close as possible
---
apiVersion: batch/v1
kind: Job
metadata:
  name: llm-training
  annotations:
    scheduling.k8s.io/topology-policy: ml-training-topology
spec:
  parallelism: 8
  completions: 8
  template:
    spec:
      containers:
        - name: trainer
          image: registry.example.com/training:v2.0
          resources:
            limits:
              nvidia.com/gpu: 8
```

### Pod Topology Spread with GPU Awareness

```yaml
apiVersion: v1
kind: Pod
metadata:
  name: training-worker
  labels:
    app: llm-training
    training-group: "finetune-llama"
spec:
  topologySpreadConstraints:
    - maxSkew: 1
      topologyKey: nvidia.com/gpu-fabric
      whenUnsatisfiable: DoNotSchedule
      labelSelector:
        matchLabels:
          training-group: "finetune-llama"
    - maxSkew: 2
      topologyKey: topology.kubernetes.io/rack
      whenUnsatisfiable: ScheduleAnyway
      labelSelector:
        matchLabels:
          training-group: "finetune-llama"
  containers:
    - name: trainer
      image: registry.example.com/training:v2.0
      resources:
        limits:
          nvidia.com/gpu: 8
```

### Verify Topology Placement

```bash
# Check which nodes training Pods landed on
kubectl get pods -l training-group=finetune-llama \
  -o custom-columns=\
'POD:metadata.name,NODE:spec.nodeName,RACK:status.hostIP'

# Verify GPU topology awareness
kubectl get pods -l training-group=finetune-llama -o json | \
  jq -r '.items[] | "\(.metadata.name) → \(.spec.nodeName)"'

# Check node labels for topology
kubectl get nodes -l nvidia.com/gpu-fabric=nvswitch-domain-1 \
  --show-labels | grep topology
```

### Impact on NCCL Performance

```bash
# Without topology-aware scheduling:
# Pods scattered across racks
# NCCL all-reduce: ~15 GB/s effective bandwidth

# With topology-aware scheduling:
# Pods packed on same NVLink domain
# NCCL all-reduce: ~150 GB/s effective bandwidth

# 10x improvement in collective communication!
```

### Alternative Available Today: KAI Scheduler

Kubernetes 1.36's native `TopologyPolicy` is new; if you're not yet on 1.36 or want topology awareness now, NVIDIA's KAI Scheduler provides the same capability via its own PodGroup CRD:

```bash
helm upgrade -i kai-scheduler oci://ghcr.io/nvidia/kai-scheduler/kai-scheduler \
  -n kai-scheduler --version v0.12.10 \
  --set topologyAwareScheduling.enabled=true \
  --set topologyAwareScheduling.nvlinkAware=true
```

```yaml
apiVersion: scheduling.run.ai/v2
kind: PodGroup
metadata:
  name: ddp-training-tas
spec:
  minMember: 4
  queue: training
  topologyPolicy:
    scope: nvlink-domain   # pack all pods onto GPUs sharing NVLink
```

KAI reads the same kind of topology signal — NVLink domain, NVSwitch presence, rack — from node labels, and supports the same scope levels (`gpu`, `nvlink-domain`, `node`, `rack`, `zone`). It's a good fit for disaggregated serving pipelines too: pin a prefill worker and a decode worker to the same node via `scope: node` so they share fast local interconnect instead of crossing the network.

## Common Issues

### Pods stuck in Pending with topology constraints
- **Cause**: Not enough nodes in the preferred topology domain
- **Fix**: Use `whenUnsatisfiable: ScheduleAnyway` for soft constraints

### Training performance not improving
- **Cause**: Network bottleneck is not the topology — could be NCCL config
- **Fix**: Verify NCCL_SOCKET_IFNAME and NCCL_IB_HCA settings match your network

### Topology labels missing on nodes
- **Cause**: Node Feature Discovery not deployed or configured
- **Fix**: Deploy NFD and GPU Feature Discovery to auto-label nodes

## Best Practices

1. **Label all nodes with topology hierarchy** — rack, switch, zone, GPU fabric
2. **Deploy GPU Feature Discovery** — auto-detects NVLink domains and GPU topology
3. **Use hard constraints for NVLink** — `DoNotSchedule` for GPU domain matching
4. **Use soft constraints for rack** — `ScheduleAnyway` to avoid blocking
5. **Monitor NCCL bandwidth** — verify topology placement improves training speed

## Key Takeaways

- Topology-aware scheduling is **new in Kubernetes 1.36** (KEP-5732)
- Places distributed workloads considering GPU, NUMA, and network topology
- Up to 10x improvement in collective communication bandwidth
- Essential for large-scale ML training with NVLink/NVSwitch clusters
- Combines with gang scheduling for optimal distributed workload placement
