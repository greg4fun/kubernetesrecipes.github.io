---
title: "Kubernetes 1.36 L3 Cache Topology in CPU Manager"
description: "Configure L3 cache topology awareness in Kubernetes 1.36 CPU Manager. Allocate CPUs sharing L3 cache for better performance in latency-sensitive workloads."
tags:
  - "kubernetes-1.36"
  - "cpu-manager"
  - "performance"
  - "numa"
  - "topology"
category: "configuration"
publishDate: "2026-05-03"
author: "Luca Berton"
difficulty: "advanced"
relatedRecipes:
  - "kubernetes-1-36-topology-aware-scheduling"
  - "kubernetes-resource-limits-cpu-memory-format"
  - "kubernetes-1-36-memory-qos-cgroups-v2"
---

> 💡 **Quick Answer:** Kubernetes 1.36 adds **L3 Cache Topology Awareness** to CPU Manager (KEP-5109). CPUs allocated to a container can be constrained to share the same L3 cache, reducing cache misses and improving performance for latency-sensitive workloads by 10-30%.

## The Problem

Modern CPUs have complex cache hierarchies:
- **L1/L2**: Private per core (fast, small)
- **L3**: Shared across a group of cores (larger, slower)
- **Cross-L3**: Accessing data cached in a different L3 domain is 2-3x slower

When CPU Manager allocates cores, it considers NUMA zones but ignores L3 boundaries. A container with 4 CPUs might get cores from different L3 cache domains, causing:

- Cache thrashing between L3 domains
- Higher memory access latency
- 10-30% performance degradation for cache-sensitive workloads
- Unpredictable latency spikes in real-time applications

## The Solution

L3 cache topology awareness ensures CPUs allocated to a container share the same L3 cache.

### Enable L3 Cache Topology

```yaml
# Kubelet configuration
apiVersion: kubelet.config.k8s.io/v1beta1
kind: KubeletConfiguration
cpuManagerPolicy: static
cpuManagerPolicyOptions:
  full-pcpus-only: "true"
  distribute-cpus-across-numa: "false"
  align-by-l3-cache: "true"    # NEW in 1.36
topologyManagerPolicy: single-numa-node
featureGates:
  CPUManagerL3CacheAwareness: true
```

### Pod Requesting L3-Aligned CPUs

```yaml
apiVersion: v1
kind: Pod
metadata:
  name: latency-sensitive
spec:
  containers:
    - name: app
      image: registry.example.com/trading:v5.0
      resources:
        requests:
          cpu: "4"
          memory: "8Gi"
        limits:
          cpu: "4"        # Guaranteed QoS → static CPU allocation
          memory: "8Gi"
```

With `align-by-l3-cache: true`, the 4 CPUs will be from cores sharing the same L3 cache.

### Verify L3 Cache Alignment

```bash
# Check CPU topology on the node
lscpu -e=CPU,CORE,SOCKET,NODE,L1d:,L1i:,L2:,L3:
# CPU CORE SOCKET NODE L1d: L1i: L2:  L3:
# 0   0    0      0    0    0    0    0    ← L3 domain 0
# 1   1    0      0    1    1    1    0    ← L3 domain 0
# 2   2    0      0    2    2    2    0    ← L3 domain 0
# 3   3    0      0    3    3    3    0    ← L3 domain 0
# 4   4    0      0    4    4    4    1    ← L3 domain 1
# ...

# Check which CPUs were allocated to the container
kubectl exec latency-sensitive -- cat /sys/fs/cgroup/cpuset.cpus
# 0-3  (all in L3 domain 0 ✓)

# Verify with lstopo (hwloc)
kubectl exec latency-sensitive -- lstopo --of txt
```

### Performance Impact

```bash
# Without L3 alignment (CPUs 0,1,4,5 — crosses L3 boundary):
# Cache miss rate: ~15%
# P99 latency: 450μs

# With L3 alignment (CPUs 0,1,2,3 — same L3 domain):
# Cache miss rate: ~3%
# P99 latency: 180μs

# ~60% latency improvement for cache-heavy workloads
```

## Common Issues

### Pod stuck in Pending
- **Cause**: Not enough free CPUs within a single L3 cache domain
- **Fix**: Reduce CPU request to fit within one L3 domain, or relax the constraint

### No performance improvement
- **Cause**: Workload is memory-bandwidth bound, not cache-bound
- **Fix**: L3 alignment helps cache-sensitive workloads; memory-bound workloads need NUMA alignment instead

### Feature gate not recognized
- **Cause**: Kubernetes version < 1.36
- **Fix**: Upgrade kubelet to 1.36+

## Best Practices

1. **Use for latency-sensitive workloads** — trading systems, real-time analytics, game servers
2. **Combine with NUMA alignment** — `single-numa-node` topology + L3 cache alignment
3. **Set Guaranteed QoS** — requests == limits required for static CPU assignment
4. **Right-size CPU requests** — match L3 domain size (check with `lscpu`)
5. **Benchmark before and after** — measure actual cache miss rates and latency

## Key Takeaways

- L3 Cache Topology Awareness is available in **Kubernetes 1.36** (KEP-5109)
- CPUs allocated to containers share the same L3 cache domain
- 10-30% performance improvement for cache-sensitive workloads
- Requires `static` CPU Manager policy and Guaranteed QoS class
- Complements NUMA alignment for maximum performance
