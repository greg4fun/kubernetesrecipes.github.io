---
title: "NCCL RoCE Validation with Kubeflow MPIJob on Kubernetes"
description: "Validate NCCL over RoCE with a Kubeflow MPIJob: launcher/worker YAML, OpenMPI vs NCCL network planes, RDMA device requests, IB logs, and expected busbw."
tags:
  - "nccl"
  - "mpi"
  - "rdma"
  - "roce"
  - "distributed-training"
  - "openshift"
  - "validation"
category: "ai"
publishDate: "2026-06-04"
author: "Luca Berton"
difficulty: "advanced"
relatedRecipes:
  - "run-nccl-tests-kubernetes"
  - "nccl-network-validation-script-openshift"
  - "nccl-gpudirect-rdma-distance-pix-sys"
  - "nccl-environment-variables-reference-kubernetes"
  - "tune-nccl-env-rdma-ethernet"
  - "nccl-channel-routing-transport-analysis"
  - "nvidia-network-operator-rdma-kubernetes"
---

> 💡 **Quick Answer:** Use Kubeflow's MPIJob (v2beta1) to run NCCL `all_reduce_perf` validation across GPU nodes. The MPIJob creates a launcher pod and worker pods, orchestrates MPI rank placement, and runs collective tests. Single-node 8× H200 NVL achieves ~68 GB/s busbw (pure NVLink). Multi-node 2×2 GPU falling back to TCP sockets (no `/dev/infiniband` in the pods) gets ~13-35 GB/s; with RoCE + GPUDirect RDMA the same test reaches ~32 GB/s at 1 GB messages and ~48-50 GB/s peak. Keep MPI control traffic on `eth0` and NCCL data on the SR-IOV `net1`, and give workers `rdma/rdma_shared_device_a` + `IPC_LOCK`.

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
                  value: none           # Don't load an external net plugin (built-in IB/Socket only)
                - name: NCCL_SHM_DISABLE
                  value: "1"            # Force network path (no SHM shortcut)
                # OpenMPI control plane: pod network, not the RDMA interface
                - name: OMPI_MCA_btl_tcp_if_include
                  value: eth0
                - name: OMPI_MCA_plm_rsh_agent
                  value: "ssh -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null"
                - name: OMPI_MCA_orte_abort_timeout
                  value: "60"
                - name: OMPI_MCA_coll_ucc_enable
                  value: "0"
                - name: OMPI_MCA_coll_hcoll_enable
                  value: "0"
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
# When /dev/infiniband is missing in the pods, NCCL finds 0 HCAs and
# falls back to TCP sockets over the secondary network (net1)

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
# With proper RDMA (/dev/infiniband + built-in IB transport): expect 2-3× better
```

### Results: Multi-Node With RoCE + GPUDirect RDMA

```text
# NCCL_NET_GDR_LEVEL=PIX, GDRDMA active for close GPU/NIC pairs:
# GPU Direct RDMA Enabled for GPU 0 / HCA 0 (distance 9 <= 9), read 1 mode Default
# IB connection: MTU 5, GID 3, ECE supported, 4 QPs per connection
# NCCL INFO Connected all trees

  1073741824  268435456  float  sum  -1  50047.0  21.45  32.11  0  50156.6  21.41  32.11  0

# ~32 GB/s busbw at 1 GB with GDRDMA
# vs ~13 GB/s average socket fallback, ~68 GB/s NVLink intra-node
```

### NCCL Environment Variables Explained

```text
Variable                  │ Value  │ Purpose
──────────────────────────┼────────┼─────────────────────────────────────
NCCL_SOCKET_IFNAME        │ net1   │ Use secondary network (Multus) for NCCL
NCCL_DMABUF_ENABLE        │ 1      │ Allow DMA-BUF for GPUDirect RDMA
NCCL_NET_PLUGIN           │ none   │ Skip external libnccl-net plugin loading
NCCL_SHM_DISABLE          │ 1      │ Disable shared memory (force network path)
MPI_NP                    │ 4      │ Total MPI processes (ranks)
GPUS_PER_MPI_PROCESS      │ 1      │ Each rank gets 1 GPU
MPI_DNS_WAIT_SECONDS      │ 120    │ Wait for worker DNS resolution
MPI_DNS_WAIT_INTERVAL     │ 3      │ DNS retry interval (seconds)
REWRITE_MPI_HOSTFILE_FQDN │ false  │ Don't rewrite hostfile with FQDNs
──────────────────────────┴────────┴─────────────────────────────────────

NCCL_NET_PLUGIN=none does NOT disable InfiniBand/RoCE — the built-in IB
transport is used whenever HCAs are visible. For a deliberate socket
baseline use NCCL_NET=Socket (or NCCL_IB_DISABLE=1); to fail instead of
falling back, set NCCL_NET=IB.
```

### OpenMPI Control Plane vs NCCL Data Plane

MPI uses `eth0` (pod network) for launch, signals and barriers; NCCL moves GPU data over `net1` (SR-IOV VF via Multus). Keep them separate:

| Variable | Value | Purpose |
|---|---|---|
| `OMPI_MCA_btl_tcp_if_include` | `eth0` | MPI TCP traffic on the pod network, not the RDMA VF |
| `OMPI_MCA_plm_rsh_agent` | `ssh -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null` | No host-key prompts for ephemeral pods |
| `OMPI_MCA_orte_abort_timeout` | `60` | Give ranks time to flush logs before being killed |
| `OMPI_MCA_coll_ucc_enable` / `coll_hcoll_enable` | `0` | Don't let UCC/HCOLL take collectives — NCCL handles GPU collectives |

On OpenShift, the pod interface shows as `eth0@ifNNN` in `ip link`; the name to use is still `eth0`.

### MPI Hostfile and DNS

The MPI Operator generates `/etc/mpi/hostfile` with worker FQDNs from the job's headless Service. The launcher must wait until they resolve:

```text
nccl-roce-validation-worker-0.nccl-roce-validation.gpu-workloads.svc slots=2
nccl-roce-validation-worker-1.nccl-roce-validation.gpu-workloads.svc slots=2

DNS WAIT: nccl-roce-validation-worker-0.nccl-roce-validation.gpu-workloads.svc not resolvable yet
...  (retries every MPI_DNS_WAIT_INTERVAL until MPI_DNS_WAIT_SECONDS)
```

Format: `<pod>.<headless-svc>.<namespace>.svc`; `slots` = GPUs (ranks) per worker.

### Decode the IB Connection Logs

```text
NCCL INFO NET/IB: NCCL Dev 0 IBDev 0 Port 1 qpn 364 mtu 5 GID 3 (0/B9D4E80AFFFF0000) fifoRKey=0x41200 fifoLKey=0x41200
NCCL INFO NET/IB: IBDev 0 Port 1 qpn 364 query_ece={supported=1, vendor_id=0x15b3, options=0x30000002, comp_mask=0x0}
NCCL INFO NET/IB: IBDev 0 Port 1 qpn 236 set_ece={supported=1, vendor_id=0x15b3, options=0x30000002, comp_mask=0x0}
```

| Field | Meaning |
|---|---|
| `IBDev 0 Port 1` | First RDMA device, port 1 |
| `qpn 364/236/...` | Queue pair numbers — several per connection (`NCCL_IB_QPS_PER_CONNECTION`) |
| `mtu 5` | IB MTU enum 5 = 4096 bytes |
| `GID 3` | GID index 3 — typically RoCE v2 IPv4 |
| `vendor_id=0x15b3` | NVIDIA/Mellanox NIC |
| `query_ece`/`set_ece supported=1` | Enhanced Connection Establishment negotiated |

`NCCL INFO Connected all trees` confirms the ring/tree topology is established.

### NCCL_NET_GDR_READ

`NCCL_NET_GDR_READ=1` lets the NIC read send buffers directly from GPU memory; `0` stages sends through host memory (one extra copy, receives can still use GDR). With SR-IOV VFs whose GPU/NIC placement isn't guaranteed to be PCIe-close, `0` avoids cross-socket read penalties; with rail-aligned GPU/NIC pairs, `1` is faster.

### Fix: Enable RDMA in Multi-Node Test

```yaml
# The 2x2gpu test showed "0 HCAs found" because the pods
# didn't request rdma/rdma_shared_device_a (no /dev/infiniband)

# Fixed version with RDMA:
env:
  - name: NCCL_SOCKET_IFNAME
    value: net1
  - name: NCCL_DMABUF_ENABLE
    value: "1"
  - name: NCCL_NET
    value: IB                         # fail instead of silently using sockets
  - name: NCCL_IB_HCA
    value: "mlx5_0,mlx5_3,mlx5_5,mlx5_6"
  - name: NCCL_NET_GDR_LEVEL
    value: "SYS"
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
CUDA_DRIVER_VERSION=580.95.05
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
- **Cause**: NCCL fell back to TCP sockets — no `/dev/infiniband` in workers, wrong `NCCL_IB_HCA`, or GDR disabled. Check for `NET/Socket` instead of `NET/IB` in `NCCL_DEBUG=INFO` output
- **Fix**: Request `rdma/rdma_shared_device_a` + `IPC_LOCK` on workers; set `NCCL_IB_HCA`; set `NCCL_NET=IB` to fail fast

### MPI launcher times out waiting for workers
- **Cause**: DNS not resolving worker hostnames; or workers not ready
- **Fix**: Increase `MPI_DNS_WAIT_SECONDS`; verify worker pods are Running and the job's headless Service has endpoints

### "OMPI_MCA_btl_tcp_if_include: eth0 not found"
- **Cause**: The pod's primary interface has a different name
- **Fix**: Run `ip link` in a worker and use the actual name (ignore the `@ifNNN` suffix)

### Workers stay Terminating for minutes after the job
- **Cause**: SR-IOV VF release, GPU deallocation and large `/dev/shm` teardown take time
- **Fix**: Normal up to a few minutes; delete the MPIJob (not pods). Beyond ~5 minutes: `kubectl delete pod <worker> --force --grace-period=0` and check the SR-IOV device plugin logs

### "NCCL WARN Connect to ... failed"
- **Cause**: Network policy blocking inter-pod traffic; or wrong `NCCL_SOCKET_IFNAME`
- **Fix**: Allow all traffic between NCCL pods; set `NCCL_SOCKET_IFNAME` to correct interface (net1 for Multus secondary)

## Frequently Asked Questions

### How do I run NCCL tests with a Kubeflow MPIJob?
Create an `MPIJob` (`kubeflow.org/v2beta1`) with one launcher running `all_reduce_perf` and N workers requesting GPUs, the RDMA resource and `IPC_LOCK`. The MPI Operator generates the hostfile and SSH setup; read the `busbw` column in the launcher logs.

### Does NCCL_NET_PLUGIN=none disable RDMA?
No. It only stops NCCL from loading an external network plugin (`libnccl-net.so`). The built-in IB/RoCE transport is still used when HCAs are visible. Use `NCCL_NET=Socket` or `NCCL_IB_DISABLE=1` to force TCP.

### What busbw should I expect for RoCE validation?
On the H200 NVL nodes here: ~68 GB/s intra-node over NVLink, ~13-35 GB/s multi-node over TCP sockets, and ~32 GB/s at 1 GB messages rising to ~48-50 GB/s peak with RoCE + GPUDirect RDMA. Compare against your NIC line rate (e.g. 400 Gb/s ≈ 50 GB/s per rail).

## Best Practices

1. **Test NVLink first (1x8)** — validate intra-node before adding network complexity
2. **Then test network (2x2)** — isolates network performance from NVLink
3. **Save logs and describe output** — create test evidence for cluster acceptance
4. **Compare socket vs RDMA** — run once with `NCCL_NET=Socket` and once with `NCCL_NET=IB` to measure RDMA gain
5. **Separate control and data planes** — MPI on `eth0`, NCCL on `net1`; disable UCC/HCOLL
6. **Use large messages for peak bandwidth** — 32GB messages show true fabric capacity
7. **Run regularly** — detect hardware degradation early
8. **Pin NCCL test image version** — reproducible results across test runs

## Key Takeaways

- MPIJob (kubeflow.org/v2beta1): standard way to run multi-node NCCL tests on Kubernetes
- **1x8 H200 NVL: ~68 GB/s busbw** = healthy NVLink (near theoretical max)
- **2x2 socket fallback: ~13-35 GB/s** = works but suboptimal (no RDMA)
- **2x2 with RDMA: ~48-50 GB/s** expected with GDRDMA + IB plugin
- `NCCL_NET_PLUGIN=none` only skips external plugins — use `NCCL_NET=Socket` for a socket baseline
- MPI control on `eth0`, NCCL data on `net1`; decode `NET/IB` logs for GID, MTU and QPs
- Launcher pod has no GPUs and no RDMA (expected) — only workers need resources
- Run:ai tracks GPU allocation and node placement via annotations
- Missing `/dev/infiniband` = need `rdma/rdma_shared_device_a` resource in pod spec
