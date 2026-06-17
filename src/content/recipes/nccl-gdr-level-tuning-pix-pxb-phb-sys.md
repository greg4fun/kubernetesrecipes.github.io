---
title: "NCCL_NET_GDR_LEVEL Environment Variable Guide"
description: "NCCL_NET_GDR_LEVEL environment variable explained: compare PIX, PXB, PHB, and SYS GPUDirect RDMA distance thresholds and pick the fastest safe level."
tags:
  - "nccl"
  - "rdma"
  - "gpu"
  - "performance"
  - "tuning"
category: "ai"
publishDate: "2026-06-04"
author: "Luca Berton"
difficulty: "advanced"
relatedRecipes:
  - "nccl-all-reduce-perf-benchmark-multi-node"
  - "nccl-network-validator-production-mpijob"
  - "nccl-gpudirect-rdma-distance-pix-sys"
  - "nccl-dmabuf-gpudirect-rdma-kubernetes"
  - "nccl-ib-hca-qps-tuning-roce"
---

> 💡 **Quick Answer:** `NCCL_NET_GDR_LEVEL` controls the maximum PCIe distance at which NCCL enables GPUDirect RDMA (GPU memory → NIC without CPU copy). Values from most restrictive to least: `LOC` (same device) → `PIX` (same PCIe switch) → `PXB` (same root complex) → `PHB` (same NUMA/host bridge) → `SYS` (any distance, crosses sockets). Start with `PHB` for safety, test `SYS` for maximum bandwidth, fall back to `PXB` if you see errors.

## The Problem

- GPUDirect RDMA performance depends on PCIe topology between GPU and NIC
- Wrong GDR level either disables RDMA for valid pairs or enables it for unstable paths
- SR-IOV VFs may have different effective PCIe distances than physical functions
- No clear guidance on which level works best for specific hardware configurations
- Need systematic testing methodology to find optimal setting

## The Solution

### Understanding GDR Levels

```text
Level │ PCIe Distance │ Meaning                           │ Risk
──────┼───────────────┼───────────────────────────────────┼──────────
LOC   │ ≤ 3           │ Same device (loopback only)       │ None
PIX   │ ≤ 4           │ Same PCIe switch                  │ None
PXB   │ ≤ 5           │ Same PCIe root complex            │ Low
PHB   │ ≤ 6           │ Same CPU socket / host bridge     │ Low
SYS   │ ≤ 9           │ Cross-socket, any path            │ Medium
──────┴───────────────┴───────────────────────────────────┴──────────

Higher level = more GPU-NIC pairs can use RDMA = more bandwidth potential
But: cross-socket RDMA may add latency or cause stability issues on some platforms
```

### PCIe Topology Example

```text
Socket 0                              Socket 1
┌─────────────────────────────┐      ┌─────────────────────────────┐
│  Root Complex 0             │      │  Root Complex 1             │
│  ├── PCIe Switch A          │      │  ├── PCIe Switch C          │
│  │   ├── GPU 0 [0000:42:00] │      │  │   ├── GPU 2 [0000:8c:00] │
│  │   └── NIC 0 (mlx5_0)    │      │  │   └── NIC 2 (mlx5_5)    │
│  └── PCIe Switch B          │      │  └── PCIe Switch D          │
│      ├── GPU 1 [0000:5e:00] │      │      ├── GPU 3 [0000:c7:00] │
│      └── NIC 1 (mlx5_3)    │      │      └── NIC 3 (mlx5_6)    │
└─────────────────────────────┘      └─────────────────────────────┘

GPU 0 → NIC 0: PIX  (same switch)     ← Always works
GPU 0 → NIC 1: PXB  (same root complex) ← Works with PXB+
GPU 0 → NIC 2: SYS  (cross-socket)    ← Only works with SYS
```

### Testing Each Level with MPIJob

```yaml
apiVersion: kubeflow.org/v2beta1
kind: MPIJob
metadata:
  name: nccl-gdr-level-test
  namespace: gpu-benchmark
spec:
  slotsPerWorker: 2
  runPolicy:
    cleanPodPolicy: None
    backoffLimit: 0
  mpiReplicaSpecs:
    Launcher:
      replicas: 1
      restartPolicy: Never
      template:
        spec:
          containers:
            - name: launcher
              image: registry.example.com/nccl-validator:v6
              args: ["mpi-job"]
              env:
                - name: MPI_NP
                  value: "4"
                - name: GPUS_PER_MPI_PROCESS
                  value: "1"
                - name: NCCL_SOCKET_IFNAME
                  value: "net1"
                - name: NCCL_NET_GDR_LEVEL
                  value: "PXB"          # Change per test run
                - name: NCCL_DMABUF_ENABLE
                  value: "1"
                - name: NCCL_DEBUG
                  value: "INFO"
                - name: NCCL_DEBUG_SUBSYS
                  value: "INIT,NET,GRAPH"
                - name: NCCL_TEST_MIN_BYTES
                  value: "1G"
                - name: NCCL_TEST_MAX_BYTES
                  value: "16G"
                - name: OMPI_MCA_btl_tcp_if_include
                  value: "eth0"
              resources:
                requests:
                  cpu: "1"
                  memory: "2Gi"
    Worker:
      replicas: 2
      restartPolicy: Never
      template:
        metadata:
          annotations:
            k8s.v1.cni.cncf.io/networks: sriov-rdma-net
        spec:
          subdomain: nccl-gdr-level-test
          containers:
            - name: worker
              image: registry.example.com/nccl-validator:v6
              args: ["shell"]
              env:
                - name: START_SSHD
                  value: "true"
                - name: NCCL_NET_GDR_LEVEL
                  value: "PXB"    # Must match launcher
                - name: NCCL_DMABUF_ENABLE
                  value: "1"
              resources:
                requests:
                  nvidia.com/gpu: 2
                  openshift.io/mellanoxnics: 1
                limits:
                  nvidia.com/gpu: 2
                  openshift.io/mellanoxnics: 1
```

### Automated Comparison Script

```bash
#!/bin/bash
# Run GDR level comparison across all levels
NAMESPACE="gpu-benchmark"
LEVELS=("PIX" "PXB" "PHB" "SYS")
RESULTS_FILE="/tmp/gdr-comparison.csv"

echo "level,min_busbw,max_busbw,avg_busbw" > "${RESULTS_FILE}"

for level in "${LEVELS[@]}"; do
  echo "=== Testing NCCL_NET_GDR_LEVEL=${level} ==="

  # Update the MPIJob YAML
  sed "s/value: \".*\"  # Change per test run/value: \"${level}\"  # Change per test run/" \
    nccl-gdr-test.yaml | kubectl apply -n "${NAMESPACE}" -f -

  # Wait for completion
  kubectl wait --for=condition=Succeeded mpijob/nccl-gdr-level-test \
    -n "${NAMESPACE}" --timeout=600s

  # Extract busbw from launcher logs
  BUSBW=$(kubectl logs -n "${NAMESPACE}" \
    nccl-gdr-level-test-launcher -- 2>/dev/null | \
    grep -E "^\s+[0-9]" | awk '{print $NF}' | \
    sort -n | tail -1)

  echo "${level},${BUSBW}" >> "${RESULTS_FILE}"

  # Cleanup
  kubectl delete mpijob nccl-gdr-level-test -n "${NAMESPACE}"
  sleep 30  # Wait for pods to terminate
done

echo ""
echo "=== Results ==="
cat "${RESULTS_FILE}"
```

### Interpreting NCCL Logs for GDR Status

```text
# GDR ENABLED — look for "GPU Direct RDMA Enabled" in logs:
NCCL INFO GPU Direct RDMA Enabled for GPU 0 / HCA 0 (distance 9 <= 9), read 1 mode Default

# The "distance X <= Y" shows:
#   X = actual PCIe distance between GPU and HCA
#   Y = threshold from NCCL_NET_GDR_LEVEL setting
#
# distance 4 = PIX (same switch)
# distance 5 = PXB (same root complex)  
# distance 6 = PHB (same host bridge)
# distance 9 = SYS (cross-socket QPI/UPI)

# GDR DISABLED — you'll see socket transport instead:
NCCL INFO Channel 0/0 : 0[0] -> 2[0] [send] via NET/IB/0  # No GDRDMA suffix
# vs enabled:
NCCL INFO Channel 0/0 : 0[0] -> 2[0] [send] via NET/IB/0/GDRDMA
```

### When to Use Each Level

```yaml
# PIX — Ultra-conservative, only same-switch GPU-NIC pairs
# Use when: Debugging RDMA errors, isolating topology issues
# Expect: Some ranks may fall back to socket transport
env:
  - name: NCCL_NET_GDR_LEVEL
    value: "PIX"

# PXB — Safe for most single-socket configurations
# Use when: GPU and NIC on different switches but same CPU
# Expect: All intra-socket pairs use RDMA
env:
  - name: NCCL_NET_GDR_LEVEL
    value: "PXB"

# PHB — Recommended starting point (script default)
# Use when: Standard dual-socket with NUMA-local NICs
# Expect: All same-NUMA pairs use RDMA
env:
  - name: NCCL_NET_GDR_LEVEL
    value: "PHB"

# SYS — Maximum performance, all pairs use RDMA
# Use when: Platform validated, IOMMU enabled, stable
# Expect: Cross-socket RDMA enabled, highest bandwidth
env:
  - name: NCCL_NET_GDR_LEVEL
    value: "SYS"
```

## Common Issues

### GDR enabled but bandwidth lower than expected
- **Cause**: Cross-socket RDMA adds QPI/UPI hop latency
- **Fix**: Compare SYS vs PHB results. If PHB is faster, cross-socket overhead dominates. Use PHB + topology-aware scheduling.

### "GPU Direct RDMA Enabled" not appearing in logs
- **Cause**: GDR level too restrictive for your topology
- **Fix**: Increase level (PIX → PXB → PHB → SYS) or check `NCCL_DMABUF_ENABLE=1`

### Inconsistent bandwidth across runs
- **Cause**: SR-IOV VF assignment non-deterministic; different VFs have different PCIe distances
- **Fix**: Pin VFs to specific NUMA nodes via SriovNetworkNodePolicy `priority` field

### IOMMU errors with SYS level
- **Cause**: Cross-socket DMA requires IOMMU passthrough or permissive mode
- **Fix**: Verify `intel_iommu=on iommu=pt` in kernel args; check `dmesg | grep -i iommu`

## Best Practices

1. **Always test incrementally**: PIX → PXB → PHB → SYS, comparing busbw at each level
2. **Check IOMMU first**: `SYS` requires proper IOMMU configuration
3. **Match launcher and worker env**: Both must set same `NCCL_NET_GDR_LEVEL`
4. **Use `NCCL_DMABUF_ENABLE=1`**: Required for modern GPUDirect RDMA with DMA-BUF
5. **Log the distance**: `NCCL_DEBUG=INFO` shows actual PCIe distance in "Enabled" messages
6. **Validate per-rank HCA selection**: Each rank should use the NIC closest to its GPU
7. **PHB is the safe production default**: Enables RDMA for all same-NUMA pairs without cross-socket risk

## Key Takeaways

- `NCCL_NET_GDR_LEVEL` is the primary knob for GPUDirect RDMA enable/disable per pair
- Higher levels enable more GPU-NIC pairs but may cross NUMA boundaries
- `PHB` (default) is optimal for most configurations — same-NUMA RDMA without cross-socket
- `SYS` gives maximum bandwidth when platform supports cross-socket DMA reliably
- Always verify with `NCCL_DEBUG=INFO` — look for "GPU Direct RDMA Enabled (distance X <= Y)"
- SR-IOV VF placement affects effective distance — topology-aware scheduling helps
- Test with `NCCL_NET_PLUGIN=none` first (socket baseline) then with IB plugin (RDMA)
