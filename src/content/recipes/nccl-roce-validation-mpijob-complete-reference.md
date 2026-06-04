---
title: "NCCL RoCE Validation MPIJob Complete Reference"
description: "Complete nccl-roce-validation.yaml MPIJob reference for OpenShift GPU clusters. Full launcher environment variables, OpenMPI control plane settings, NCCL tuning parameters, DNS resolution, IB device tree connection, and validation workflow with troubleshooting checklist."
tags:
  - "nccl"
  - "mpi"
  - "roce"
  - "openshift"
  - "validation"
category: "ai"
publishDate: "2026-06-04"
author: "Luca Berton"
difficulty: "advanced"
relatedRecipes:
  - "nccl-network-validation-script-openshift"
  - "nccl-gpudirect-rdma-distance-pix-sys"
  - "nccl-roce-validation-mpijob-kubernetes"
---

> 💡 **Quick Answer:** The complete `nccl-roce-validation.yaml` MPIJob configures: NCCL env vars (GDR level, DMA-BUF, socket interface, debug), OpenMPI control plane (`OMPI_MCA_btl_tcp_if_include=eth0`, SSH with no host key checking, 60s abort timeout), test bounds (`NCCL_TEST_MIN_BYTES=1G`, `NCCL_TEST_MAX_BYTES=16G`), `NCCL_NET_GDR_READ=0`, `CUDA_VISIBLE_DEVICES=2`, and launcher resources (2 CPU/4Gi). The IB device tree shows multiple QP numbers with ECE negotiation (`query_ece`, `set_ece`) confirming RoCEv2 enhanced connection establishment.

## The Problem

- Need a complete, production-ready MPIJob YAML for NCCL RoCE validation
- OpenMPI control plane must use pod network (eth0) while NCCL data uses SR-IOV (net1)
- DNS resolution for MPI worker hostnames can fail or timeout
- Need to understand IB device tree connection logs (QPN, ECE, MTU, GID)
- Workers stuck in Terminating state after job completes

## The Solution

### Complete nccl-roce-validation.yaml

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
      template:
        spec:
          containers:
            - name: launcher
              image: registry.example.com/nccl-tests:latest
              env:
                # === NCCL Network Settings ===
                - name: NCCL_IB_DISABLE
                  value: "0"
                - name: NCCL_COLLNET_ENABLE
                  value: "0"
                # GDR Level: PIX (commented out) or SYS (from validate_network.sh)
                # - name: NCCL_NET_GDR_LEVEL
                # - value: "PIX"
                - name: NCCL_NET_GDR_LEVEL
                  value: "PIX"
                - name: NCCL_DMABUF_ENABLE
                  value: "1"
                - name: NCCL_NET_PLUGIN
                  value: "none"         # Socket fallback (remove for IB plugin)
                - name: NCCL_DEBUG
                  value: "INFO"
                - name: NCCL_SHM_DISABLE
                  value: "0"
                - name: NCCL_DEBUG_SUBSYS
                  value: "INIT,NET,GRAPH"

                # === Test Bounds ===
                - name: NCCL_TEST_MIN_BYTES
                  value: "1G"
                - name: NCCL_TEST_MAX_BYTES
                  value: "16G"

                # === GPUDirect Read ===
                - name: NCCL_NET_GDR_READ
                  value: "0"            # Disable GDR for reads (use for debugging)

                # === OpenMPI Control Plane ===
                # MPI control traffic on eth0 (pod network), NOT on net1 (RDMA)
                - name: OMPI_MCA_btl_tcp_if_include
                  value: "eth0"
                - name: OMPI_MCA_plm_rsh_agent
                  value: "ssh -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null"
                - name: OMPI_MCA_orte_abort_timeout
                  value: "60"
                - name: OMPI_MCA_coll_ucc_enable
                  value: "0"
                - name: OMPI_MCA_coll_hcoll_enable
                  value: "0"

                # === GPU Visibility ===
                # - name: CUDA_VISIBLE_DEVICES
                # - value: "2"          # Uncomment to limit GPU selection

              resources:
                requests:
                  cpu: "1"
                  memory: "2Gi"
                limits:
                  cpu: "2"
                  memory: "4Gi"

    Worker:
      replicas: 2
      template:
        metadata:
          annotations:
            k8s.v1.cni.cncf.io/networks: sriov-rdma-net
        spec:
          containers:
            - name: worker
              image: registry.example.com/nccl-tests:latest
              env:
                - name: START_SSHD
                  value: "true"
                - name: NCCL_SOCKET_IFNAME
                  value: net1
                - name: NCCL_NET_GDR_LEVEL
                  value: SYS
                - name: NCCL_DMABUF_ENABLE
                  value: "1"
                - name: NCCL_SHM_DISABLE
                  value: "0"
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
                sizeLimit: "64Gi"
```

### OpenMPI Control Plane Settings Explained

```text
Variable                        │ Value                              │ Purpose
────────────────────────────────┼────────────────────────────────────┼──────────────────────────────
OMPI_MCA_btl_tcp_if_include     │ eth0                               │ MPI control on pod network
                                │                                    │ (NOT net1/RDMA interface)
────────────────────────────────┼────────────────────────────────────┼──────────────────────────────
OMPI_MCA_plm_rsh_agent          │ ssh -o StrictHostKeyChecking=no    │ SSH without host key prompts
                                │ -o UserKnownHostsFile=/dev/null    │ (pods are ephemeral)
────────────────────────────────┼────────────────────────────────────┼──────────────────────────────
OMPI_MCA_orte_abort_timeout     │ 60                                 │ Wait 60s before killing ranks
                                │                                    │ on error (allows log flush)
────────────────────────────────┼────────────────────────────────────┼──────────────────────────────
OMPI_MCA_coll_ucc_enable        │ 0                                  │ Disable UCC collectives
                                │                                    │ (use NCCL instead)
────────────────────────────────┼────────────────────────────────────┼──────────────────────────────
OMPI_MCA_coll_hcoll_enable      │ 0                                  │ Disable HPC-X HCOLL
                                │                                    │ (let NCCL handle collectives)
────────────────────────────────┴────────────────────────────────────┴──────────────────────────────

Key insight: MPI uses eth0 for process management (launch, signal, barrier).
NCCL uses net1 (SR-IOV) for actual GPU data transfer.
These are separate planes — don't mix them!
```

### MPI DNS Resolution and Hostfile

```text
=== MPI hostfile ===
nccl-roce-validation-worker-0.nccl-roce-validation.runai-benchmark.svc slots=2
nccl-roce-validation-worker-1.nccl-roce-validation.runai-benchmark.svc slots=2

Waiting for MPI worker DNS records to resolve...
Hostfile: /etc/mpi/hostfile
Timeout: 120s

DNS WAIT: nccl-roce-validation-worker-0.nccl-roce-validation.runai-benchmark.svc not resolvable yet
DNS WAIT: nccl-roce-validation-worker-1.nccl-roce-validation.runai-benchmark.svc not resolvable yet
...
(retries until workers are Running and headless Service has endpoints)

DNS format: <pod-name>.<headless-svc>.<namespace>.svc
slots=2 → 2 GPUs per worker (matches CUDA_VISIBLE_DEVICES count)
```

### IB Device Tree Connection Logs

```text
# These logs show RoCE connection establishment:

NCCL INFO NET/IB: NCCL Dev 0 IBDev 0 Port 1 qpn 364 mtu 5 GID 3
  (0/B9D4E80AFFFF0000) fifoRKey=0x41200 fifoLKey=0x41200
NCCL INFO NET/IB: IBDev 0 Port 1 qpn 364 query_ece={supported=1,
  vendor_id=0x15b3, options=0x30000002, comp_mask=0x0}
NCCL INFO NET/IB: IBDev 0 Port 1 qpn 236 set_ece={supported=1,
  vendor_id=0x15b3, options=0x30000002, comp_mask=0x0}

Decoded:
  Dev 0 IBDev 0 Port 1  → First RDMA device, port 1
  qpn 364/236/367/241   → Queue Pair Numbers (multiple QPs for parallel transfer)
  mtu 5                 → MTU index 5 = 4096 bytes (RoCE maximum)
  GID 3                 → GID index 3 (RoCEv2 IPv4 routable) ✅
  0/B9D4E80AFFFF0000    → GID value (IPv6 mapped)
  fifoRKey/fifoLKey     → Remote/Local memory registration keys for RDMA FIFO
  vendor_id=0x15b3      → Mellanox/NVIDIA NIC
  options=0x30000002    → ECE options (Enhanced Connection Establishment)
  supported=1           → ECE negotiation successful

# Multiple QPN lines = NCCL opening multiple QPs per connection:
  qpn 364 → QP 1
  qpn 236 → QP 2
  qpn 367 → QP 3
  qpn 241 → QP 4
  → 4 QPs for this connection (parallel RDMA operations)

# "Connected all trees" confirms ring/tree topology fully established:
NCCL INFO Connected all trees
```

### NCCL_NET_GDR_READ Setting

```text
NCCL_NET_GDR_READ=0 (disabled — your current setting)
  → NIC does NOT read directly from GPU memory for SEND operations
  → Data path: GPU → host buffer → NIC → wire
  → Lower CPU load but one extra copy

NCCL_NET_GDR_READ=1 (enabled)
  → NIC reads directly from GPU memory (GPUDirect RDMA read)
  → Data path: GPU → NIC → wire (zero-copy)
  → Better bandwidth but requires close GPU-NIC topology
  → Can cause issues if GPU and NIC are on different NUMA nodes

For SR-IOV with non-deterministic placement:
  NCCL_NET_GDR_READ=0 is safer (avoids cross-socket read penalties)
  NCCL_NET_GDR_READ=1 with NCCL_NET_GDR_LEVEL=SYS works but may be slower
```

### Validation Workflow

```bash
# 1. Apply the MPIJob
oc apply -f nccl-roce-validation.yaml

# 2. Watch pods come up
oc get pods -w
# nccl-roce-validation-launcher-xxx   0/1  Pending → Running
# nccl-roce-validation-worker-0       1/1  Running
# nccl-roce-validation-worker-1       1/1  Running

# 3. Follow launcher logs (real-time)
oc logs -f nccl-roce-validation-launcher-xxx

# 4. Wait for "Validation complete." message
# Look for: "Read the busbw column."

# 5. Check results
# Closing env plugin ncclEnvDefault  ← cleanup
# Look for final bandwidth line

# 6. Cleanup
oc delete -f nccl-roce-validation.yaml mpijob.kubeflow.org "nccl-roce-validation" deleted
oc get pods  # Workers will be Terminating for a few minutes (grace period)
```

### Workers Stuck Terminating

```text
From screenshots:
  nccl-roce-validation-worker-0  1/1  Terminating  0  3m55s
  nccl-roce-validation-worker-1  1/1  Terminating  0  3m55s
  ... still Terminating at 4m2s, 4m5s, 4m12s

This is NORMAL for:
  - SR-IOV VF cleanup (VF must be released back to pool)
  - GPU resource deallocation
  - Shared memory cleanup (64Gi tmpfs)
  - RDMA connection teardown

If stuck > 5 minutes:
  oc delete pod nccl-roce-validation-worker-0 --force --grace-period=0
```

### Key Results from PIX Test (with GDRDMA enabled for close pairs)

```text
# With NCCL_NET_GDR_LEVEL=PIX, GDRDMA active (distance 9 <= 9 in SYS test):
# GPU Direct RDMA Enabled for GPU 0 / HCA 0 (distance 9 <= 9), read 1 mode Default

# IB connection: MTU 5, GID 3, ECE supported, 4 QPs per connection
# "Connected all trees" — full topology established

# Result at 1073741824 bytes (1 GB):
  1073741824  268435456  float  sum  -1  50047.0  21.45  [busbw] 0  50156.6  21.41  32.11  0

# ~32 GB/s busbw at 1GB message size with GDRDMA
# Compare to: ~13 GB/s without RDMA (NCCL_NET_PLUGIN=none)
# Compare to: ~68 GB/s NVLink intra-node
```

## Common Issues

### "DNS WAIT: ... not resolvable yet" (loops indefinitely)
- **Cause**: Headless Service not created; or worker pods not yet Running
- **Fix**: Ensure `nccl-roce-validation-headless-svc.yaml` is applied; increase `MPI_DNS_WAIT_SECONDS`

### "Closing env plugin ncclEnvDefault" but no results shown
- **Cause**: Test completed but terminal scrolled past results
- **Fix**: Check full logs: `oc logs nccl-roce-validation-launcher-xxx --tail=100`

### Workers Terminating for > 5 minutes
- **Cause**: SR-IOV VF finalizer stuck; or GPU resource not released
- **Fix**: Force delete: `oc delete pod <name> --force --grace-period=0`

### "OMPI_MCA_btl_tcp_if_include: eth0 not found"
- **Cause**: Pod network interface named differently (e.g., `eth0@ifXXX`)
- **Fix**: Check `ip link` in pod; use actual interface name

## Best Practices

1. **Separate control and data planes** — MPI on eth0, NCCL on net1
2. **Disable UCC and HCOLL** — let NCCL handle GPU collectives exclusively
3. **Set abort timeout = 60** — gives time to flush logs before cleanup
4. **Use SSH without host key checking** — pods are ephemeral, keys change
5. **NCCL_TEST_MIN_BYTES=1G** — skip small messages for production validation (only large matters)
6. **NCCL_NET_GDR_READ=0 for SR-IOV** — safer with non-deterministic VF placement
7. **Save all log files** — compare pix/phb/sys variants to quantify topology impact
8. **Delete MPIJob (not pods)** — proper cleanup of all resources

## Key Takeaways

- Complete MPIJob: launcher (control) + workers (GPU + RDMA) with separate network planes
- MPI control on `eth0` (pod network), NCCL data on `net1` (SR-IOV RDMA)
- OpenMPI settings: no host key check, 60s abort timeout, UCC/HCOLL disabled
- IB device tree: QPN allocation, GID 3 (RoCEv2), ECE negotiation, MTU 5 (4096)
- `NCCL_NET_GDR_READ=0`: disable GPU-direct read (safer for SR-IOV)
- `NCCL_TEST_MIN_BYTES/MAX_BYTES`: bound test range (1G-16G for production)
- DNS resolution: headless Service → pod FQDN → MPI SSH connection
- Workers terminate slowly (VF cleanup, GPU release) — normal up to 5 minutes
- "Validation complete. Read the busbw column." = success
