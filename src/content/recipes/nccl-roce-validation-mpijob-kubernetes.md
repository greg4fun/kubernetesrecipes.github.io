---
title: "NCCL RoCE Validation with Kubeflow MPIJob on Kubernetes"
description: "Run NCCL all_reduce_perf validation tests using Kubeflow MPIJob on GPU clusters. Configure MPI launcher and workers, NCCL environment variables, test"
tags:
  - "nccl"
  - "mpi"
  - "rdma"
  - "roce"
  - "distributed-training"
category: "ai"
publishDate: "2026-06-04"
author: "Luca Berton"
difficulty: "advanced"
relatedRecipes:
  - "nccl-all-reduce-perf-benchmark-multi-node"
  - "nccl-channel-routing-transport-analysis"
  - "nvidia-network-operator-rdma-kubernetes"
---

> 💡 **Quick Answer:** Use Kubeflow's MPIJob (v2beta1) to run NCCL `all_reduce_perf` validation across GPU nodes. The MPIJob creates a launcher pod and worker pods, orchestrates MPI rank placement, and runs collective tests. Single-node 8× H200 NVL achieves ~68 GB/s busbw (pure NVLink). Multi-node 2×2 GPU over RoCE with `NCCL_NET_PLUGIN=none` (socket fallback) gets ~13-35 GB/s. For full RDMA performance, ensure pods have `/dev/infiniband` access via the shared RDMA device plugin.

## The Problem

- Need to validate GPU interconnect performance before running production training
- Must test both intra-node (NVLink) and inter-node (RoCE/IB) paths independently
- NCCL multi-node tests require MPI coordination across pods
- RDMA devices may be missing in pods if device plugin not configured
- Need standardized, repeatable benchmark jobs for cluster acceptance

## The Solution

### MPIJob for Single-Node 8-GPU Validation (NVLink)

```yaml
apiVersion: kubeflow.org/v2beta1
kind: MPIJob
metadata:
  name: nccl-single-node-validation
  namespace: gpu-workloads
spec:
  launcherCreationPolicy: AtStartup
  mpiImplementation: OpenMPI
  mpiReplicaSpecs:
    Launcher:
      replicas: 1
      restartPolicy: Never
      template:
        metadata:
          labels:
            app: nccl-single-node-validation
        spec:
          containers:
            - name: mpi-job
              image: nvcr.io/nvidia/pytorch:24.04-py3
              env:
                - name: REWRITE_MPI_HOSTFILE_FQDN
                  value: "false"
                - name: MPI_DNS_WAIT_SECONDS
                  value: "120"
                - name: MPI_DNS_WAIT_INTERVAL
                  value: "3"
              command:
                - mpirun
              args:
                - --allow-run-as-root
                - -np
                - "8"
                - --bind-to
                - none
                - -x
                - NCCL_DEBUG=INFO
                - /opt/nccl-tests/build/all_reduce_perf
                - -b
                - "32G"
                - -e
                - "32G"
                - -f
                - "2"
                - -g
                - "1"
                - -w
                - "1"
                - -n
                - "20"
    Worker:
      replicas: 1
      template:
        spec:
          containers:
            - name: worker
              image: nvcr.io/nvidia/pytorch:24.04-py3
              resources:
                limits:
                  nvidia.com/gpu: "8"
              volumeMounts:
                - name: shm
                  mountPath: /dev/shm
          volumes:
            - name: shm
              emptyDir:
                medium: Memory
                sizeLimit: "64Gi"
```

### Expected Results: Single-Node 8× H200 NVL

```text
# nccl-tests version 2.17.6 nccl-headers=22808 nccl-library=22808
# Collective test starting: all_reduce_perf
# nThread 1 nGpus 8 minBytes 34359738368 maxBytes 34359738368 step: 2(factor)
#
# Using devices
#   Rank 0 Group 0 Pid 52 on nccl-single-node-validation device 0 [0000:18:00] NVIDIA H200 NVL
#   Rank 1 Group 0 Pid 52 on nccl-single-node-validation device 1 [0000:67:00] NVIDIA H200 NVL
#   Rank 2 Group 0 Pid 52 on nccl-single-node-validation device 2 [0000:b2:00] NVIDIA H200 NVL
#   Rank 3 Group 0 Pid 52 on nccl-single-node-validation device 3 [0000:d8:00] NVIDIA H200 NVL
#   Rank 4 Group 0 Pid 52 on nccl-single-node-validation device 4 [0001:18:00] NVIDIA H200 NVL
#   Rank 5 Group 0 Pid 52 on nccl-single-node-validation device 5 [0001:69:00] NVIDIA H200 NVL
#   Rank 6 Group 0 Pid 52 on nccl-single-node-validation device 6 [0001:8f:00] NVIDIA H200 NVL
#   Rank 7 Group 0 Pid 52 on nccl-single-node-validation device 7 [0001:b3:00] NVIDIA H200 NVL
#
#       size    count   type  redop  root   time   algbw   busbw  #wrong
#        (B)  (elements)                    (us)  (GB/s)  (GB/s)
  34359738368 8589934592  float   sum    -1  875713  39.24   68.66       0
# Avg bus bandwidth    : 68.6248
# Collective test concluded: all_reduce_perf

# ✅ 68.66 GB/s busbw = excellent (near H200 NVL theoretical max)
# This confirms NVLink fabric is healthy across all 8 GPUs
```

### MPIJob for Multi-Node 2×2 GPU RoCE Validation

```yaml
apiVersion: kubeflow.org/v2beta1
kind: MPIJob
metadata:
  name: nccl-roce-validation
  namespace: gpu-workloads
spec:
  launcherCreationPolicy: AtStartup
  mpiImplementation: OpenMPI
  mpiReplicaSpecs:
    Launcher:
      replicas: 1
      restartPolicy: Never
      template:
        metadata:
          labels:
            app: nccl-roce-validation
        spec:
          containers:
            - name: mpi-job
              env:
                - name: REWRITE_MPI_HOSTFILE_FQDN
                  value: "false"
                - name: MPI_DNS_WAIT_SECONDS
                  value: "120"
                - name: MPI_DNS_WAIT_INTERVAL
                  value: "3"
                - name: MPI_NP
                  value: "4"
                - name: GPUS_PER_MPI_PROCESS
                  value: "1"
                - name: MPI_HOSTFILE
                  value: /etc/mpi/hostfile
                # NCCL configuration
                - name: NCCL_SOCKET_IFNAME
                  value: net1           # Secondary network interface (Multus)
                - name: NCCL_DMABUF_ENABLE
                  value: "1"            # Enable DMA-BUF for GPUDirect
                - name: NCCL_NET_PLUGIN
                  value: none           # Disable IB plugin (use TCP sockets)
                - name: NCCL_SHM_DISABLE
                  value: "1"            # Force network path (no SHM shortcut)
              image: nvcr.io/nvidia/pytorch:24.04-py3
              command:
                - /opt/nccl-tests/build/all_reduce_perf
              args:
                - -b
                - "8"
                - -e
                - "8G"
                - -f
                - "2"
                - -g
                - "1"
    Worker:
      replicas: 2
      template:
        metadata:
          annotations:
            k8s.v1.cni.cncf.io/networks: rdma-net
        spec:
          containers:
            - name: worker
              image: nvcr.io/nvidia/pytorch:24.04-py3
              resources:
                limits:
                  nvidia.com/gpu: "2"
                  rdma/rdma_shared_device_a: "1"
              securityContext:
                capabilities:
                  add: ["IPC_LOCK"]
              volumeMounts:
                - name: shm
                  mountPath: /dev/shm
          volumes:
            - name: shm
              emptyDir:
                medium: Memory
                sizeLimit: "32Gi"
```

### Results: Multi-Node Without RDMA (Socket Fallback)

```text
# When /dev/infiniband is missing and NCCL_NET_PLUGIN=none:
# NCCL falls back to TCP sockets over the secondary network (net1)

=============== System diagnostics ===============
Hostname: nccl-roce-validation-launcher
RDMA devices:
0 HCAs found:

WARNING: /dev/infiniband is missing. RDMA will not work.
=================================================

# Results with socket fallback (2 nodes × 2 GPUs = 4 ranks, 16 ranks in full test):
#       size        count   type  redop  root   time   algbw   busbw  #wrong
  8589934592   2147483648  float   sum    -1  458955  18.72   35.09       0
# Avg bus bandwidth    : 13.4939
#
# Peak: ~35 GB/s busbw (large messages)
# Average: ~13.5 GB/s (across all sizes)
#
# ⚠️ This is WITHOUT RDMA — TCP socket over RoCE NIC
# With proper RDMA (/dev/infiniband + IB plugin): expect 2-3× better
```

### NCCL Environment Variables Explained

```text
Variable                  │ Value  │ Purpose
──────────────────────────┼────────┼─────────────────────────────────────
NCCL_SOCKET_IFNAME        │ net1   │ Use secondary network (Multus) for NCCL
NCCL_DMABUF_ENABLE        │ 1      │ Allow DMA-BUF for GPUDirect RDMA
NCCL_NET_PLUGIN           │ none   │ Disable IB verbs plugin (force sockets)
NCCL_SHM_DISABLE          │ 1      │ Disable shared memory (force network path)
MPI_NP                    │ 4      │ Total MPI processes (ranks)
GPUS_PER_MPI_PROCESS      │ 1      │ Each rank gets 1 GPU
MPI_DNS_WAIT_SECONDS      │ 120    │ Wait for worker DNS resolution
MPI_DNS_WAIT_INTERVAL     │ 3      │ DNS retry interval (seconds)
REWRITE_MPI_HOSTFILE_FQDN │ false  │ Don't rewrite hostfile with FQDNs
──────────────────────────┴────────┴─────────────────────────────────────

To enable RDMA instead of sockets:
  NCCL_NET_PLUGIN: ""          (or remove — use default IB plugin)
  NCCL_IB_HCA: mlx5_0,mlx5_3  (specify HCAs)
  NCCL_NET_GDR_LEVEL: 5       (enable GPUDirect RDMA)
```

### Fix: Enable RDMA in Multi-Node Test

```yaml
# The 2x2gpu test showed "0 HCAs found" because:
# 1. Pods don't request rdma/rdma_shared_device_a
# 2. NCCL_NET_PLUGIN=none explicitly disables IB

# Fixed version with RDMA:
env:
  - name: NCCL_SOCKET_IFNAME
    value: net1
  - name: NCCL_DMABUF_ENABLE
    value: "1"
  # Remove NCCL_NET_PLUGIN=none (let NCCL use IB plugin)
  - name: NCCL_IB_HCA
    value: "mlx5_0,mlx5_3,mlx5_5,mlx5_6"
  - name: NCCL_NET_GDR_LEVEL
    value: "5"
  # Remove NCCL_SHM_DISABLE (allow SHM for intra-node)

# Worker must request RDMA device:
resources:
  limits:
    nvidia.com/gpu: "2"
    rdma/rdma_shared_device_a: "1"    # ← This gives /dev/infiniband
securityContext:
  capabilities:
    add: ["IPC_LOCK"]                  # ← Required for RDMA
```

### Test Matrix: Recommended Validations

```text
Test Name          │ Config        │ Validates                    │ Expected busbw
───────────────────┼───────────────┼──────────────────────────────┼───────────────
nccl-prod-1x4     │ 1 node, 4 GPU │ NVLink within NVL4 group     │ ~68 GB/s
nccl-prod-1x8     │ 1 node, 8 GPU │ Full NVLink fabric (2×NVL4)  │ ~68 GB/s
nccl-prod-2x2gpu  │ 2 nodes, 2/node│ Cross-node network path     │ ~35 GB/s (socket)
                   │               │                              │ ~50 GB/s (RDMA)
nccl-prod-2x8gpu  │ 2 nodes, 8/node│ Full multi-node scale       │ ~35 GB/s (socket)
                   │               │                              │ ~48 GB/s (RDMA+GDR)
───────────────────┴───────────────┴──────────────────────────────┴───────────────

Naming convention: nccl-prod-{nodes}x{gpus_per_node}
Files generated:
  - nccl-prod-1x8.log          (benchmark output)
  - nccl-prod-1x8.describe.txt (kubectl describe of MPIJob)
```

### Diagnostic Output Interpretation

```text
=============== System diagnostics ===============
Hostname: nccl-roce-validation-launcher
Date: Wed May 28 12:38:32 UTC 2026
User: uid=0(root) gid=0(root) groups=0(root)

Interfaces:
lo         UNKNOWN    127.0.0.1/8 ::1/128
eth0@if257 UP         10.233.8.27/23 fe80::858:aff:fee9:81b/64

WARNING: nvidia-smi not found.     ← Launcher pod has no GPUs (expected)
                                     Workers have GPUs, not the launcher

RDMA devices:
0 HCAs found:                      ← No RDMA in launcher (expected if launcher-only)

WARNING: /dev/infiniband is missing. RDMA will not work.
                                   ← If workers also show this = problem!
=================================================

================ NCCL / MPI environment ================
CUDA_ARCH_LIST=7.5 8.0 8.6 9.0 10.0 12.0
CUDA_DRIVER_VERSION=560.95.05
CUDA_VERSION=13.0.2.006
GPUS_PER_MPI_PROCESS=1
MPI_DNS_WAIT_INTERVAL=3
...
```

### Run:ai Integration

```yaml
# When running under Run:ai, the MPIJob gets Run:ai annotations:
metadata:
  annotations:
    runai-calculated-status: Running
    runai-current-allocated-gpus: "4"
    runai-current-allocated-gpus-memory: "301509"
    runai-current-requested-gpus: "4"
    runai-running-pods: "2"
    runai-total-requested-gpus: "4"
    runai-used-nodes: gpu-node-0, gpu-node-1
  namespace: project-001   # Run:ai project namespace

# Run:ai scheduler:
# - Places workers on nodes with available GPUs
# - Tracks GPU memory allocation (301509 MB = ~294 GB for 4× H200)
# - Reports used nodes for visibility
```

### Full Validation Script

```bash
#!/bin/bash
# run-nccl-validation.sh — Run all NCCL test variants

NAMESPACE="gpu-workloads"
IMAGE="nvcr.io/nvidia/pytorch:24.04-py3"

# Test 1: Single-node 8 GPU (NVLink validation)
echo "Starting 1x8 NVLink test..."
kubectl apply -f nccl-single-node-1x8.yaml -n $NAMESPACE
kubectl wait --for=condition=succeeded mpijob/nccl-single-node-validation \
  -n $NAMESPACE --timeout=600s
kubectl logs -n $NAMESPACE -l app=nccl-single-node-validation \
  --tail=50 > nccl-prod-1x8.log
kubectl describe mpijob nccl-single-node-validation \
  -n $NAMESPACE > nccl-prod-1x8.describe.txt

# Test 2: Multi-node 2x2 GPU (network validation)
echo "Starting 2x2 RoCE test..."
kubectl apply -f nccl-roce-2x2gpu.yaml -n $NAMESPACE
kubectl wait --for=condition=succeeded mpijob/nccl-roce-validation \
  -n $NAMESPACE --timeout=600s
kubectl logs -n $NAMESPACE -l app=nccl-roce-validation \
  --tail=100 > nccl-prod-2x2gpu.log
kubectl describe mpijob nccl-roce-validation \
  -n $NAMESPACE > nccl-prod-2x2gpu.describe.txt

# Parse results
echo "=== Results ==="
grep "Avg bus bandwidth" nccl-prod-*.log
```

## Common Issues

### "WARNING: /dev/infiniband is missing. RDMA will not work."
- **Cause**: Pod doesn't request `rdma/rdma_shared_device_a`; or RDMA device plugin not deployed
- **Fix**: Add RDMA resource request to worker pods; deploy shared RDMA device plugin

### "WARNING: nvidia-smi not found" in launcher
- **Cause**: Launcher pod doesn't need GPUs — it only coordinates MPI
- **Fix**: This is expected. Only workers need GPU resources. Ignore this warning in launcher logs.

### Low busbw on multi-node (13 GB/s instead of 50 GB/s)
- **Cause**: `NCCL_NET_PLUGIN=none` forces TCP sockets; no RDMA
- **Fix**: Remove `NCCL_NET_PLUGIN=none`; add RDMA device to workers; set `NCCL_IB_HCA`

### MPI launcher times out waiting for workers
- **Cause**: DNS not resolving worker hostnames; or workers not ready
- **Fix**: Increase `MPI_DNS_WAIT_SECONDS`; verify worker pods are Running; check headless Service

### "NCCL WARN Connect to ... failed"
- **Cause**: Network policy blocking inter-pod traffic; or wrong `NCCL_SOCKET_IFNAME`
- **Fix**: Allow all traffic between NCCL pods; set `NCCL_SOCKET_IFNAME` to correct interface (net1 for Multus secondary)

## Best Practices

1. **Test NVLink first (1x8)** — validate intra-node before adding network complexity
2. **Then test network (2x2)** — isolates network performance from NVLink
3. **Save logs and describe output** — create test evidence for cluster acceptance
4. **Compare socket vs RDMA** — run with and without `NCCL_NET_PLUGIN=none` to measure RDMA gain
5. **Use large messages for peak bandwidth** — 32GB messages show true fabric capacity
6. **Run regularly** — detect hardware degradation early
7. **Pin NCCL test image version** — reproducible results across test runs

## Key Takeaways

- MPIJob (kubeflow.org/v2beta1): standard way to run multi-node NCCL tests on Kubernetes
- **1x8 H200 NVL: ~68 GB/s busbw** = healthy NVLink (near theoretical max)
- **2x2 socket fallback: ~13-35 GB/s** = works but suboptimal (no RDMA)
- **2x2 with RDMA: ~48-50 GB/s** expected with GDRDMA + IB plugin
- `NCCL_NET_PLUGIN=none` deliberately disables RDMA — useful for socket baseline testing
- Launcher pod has no GPUs and no RDMA (expected) — only workers need resources
- Run:ai tracks GPU allocation and node placement via annotations
- Missing `/dev/infiniband` = need `rdma/rdma_shared_device_a` resource in pod spec
