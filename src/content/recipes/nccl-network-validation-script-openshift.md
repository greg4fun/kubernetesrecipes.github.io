---
title: "NCCL Network Validation Script for OpenShift GPU Clusters"
description: "Build a comprehensive NCCL network validation script for OpenShift GPU clusters with SR-IOV. Configure NCCL_IB_GID_INDEX, NCCL_NET_GDR_LEVEL=SYS, per-rank HCA"
tags:
  - "nccl"
  - "openshift"
  - "sr-iov"
  - "rdma"
  - "validation"
category: "ai"
publishDate: "2026-06-04"
author: "Luca Berton"
difficulty: "advanced"
relatedRecipes:
  - "nccl-roce-validation-mpijob-kubernetes"
  - "nccl-all-reduce-perf-benchmark-multi-node"
  - "shared-rdma-device-plugin-kubernetes"
---

> 💡 **Quick Answer:** Create a `validate_network.sh` script that sets NCCL defaults for SR-IOV environments: don't export `NCCL_IB_HCA` globally (let each MPI rank auto-detect its own HCA via `net1`), set `NCCL_IB_GID_INDEX=3` for RoCEv2, `NCCL_NET_GDR_LEVEL=SYS` (because SR-IOV VF-to-GPU locality is non-deterministic), and `NCCL_SOCKET_IFNAME=net1`. If bandwidth is lower than expected, check: SR-IOV VF allocation, `/dev/infiniband` visibility, RoCE GID index, MTU, PFC/ECN, GPUDirect RDMA, PCIe/NUMA locality, and per-rank HCA selection.

## The Problem

- Multi-node NCCL tests need correct environment variables for SR-IOV RoCE fabrics
- Setting `NCCL_IB_HCA` globally breaks MPI mode (each rank may have different VFs)
- RoCE GID index must match network configuration (wrong index = connection failures)
- GPUDirect RDMA level must account for non-deterministic SR-IOV VF placement
- Need a repeatable validation script with built-in troubleshooting guidance

## The Solution

### validate_network.sh — Complete Script

```bash
#!/bin/bash
# validate_network.sh — NCCL network validation for SR-IOV GPU clusters
#
# Usage: source validate_network.sh
#        (then run all_reduce_perf via MPI)

# ============================================================
# NCCL Defaults
# ============================================================

#
# IMPORTANT:
# Do not set NCCL_IB_HCA globally in MPI mode.
# Each MPI rank will detect the HCA backing its own NCCL_SOCKET_IFNAME/net1.
#
# You may still override NCCL_IB_HCA manually for single-node debugging, but
# mpi-job mode intentionally does NOT export NCCL_IB_HCA through mpirun.
export NCCL_IB_HCA="${NCCL_IB_HCA:-}"

export NCCL_IB_GID_INDEX="${NCCL_IB_GID_INDEX:-3}"
export NCCL_IB_DISABLE="${NCCL_IB_DISABLE:-0}"

# For your SR-IOV Multus interface, this should usually be net1.
export NCCL_SOCKET_IFNAME="${NCCL_SOCKET_IFNAME:-net1}"

# GPUDirect RDMA level.
# SYS is useful when GPU/HCA locality is not deterministic because the generic
# SR-IOV resource may attach different HCAs to different pods.
export NCCL_NET_GDR_LEVEL="${NCCL_NET_GDR_LEVEL:-SYS}"

export NCCL_DEBUG="${NCCL_DEBUG:-INFO}"
export NCCL_DEBUG_SUBSYS="${NCCL_DEBUG_SUBSYS:-INIT,NET,GRAPH}"

# Optional NCCL tuning.
# For initial validation, keep QP usage simple.
export NCCL_IB_OPS_PER_CONNECTION="${NCCL_IB_OPS_PER_CONNECTION:-1}"
export NCCL_IB_SPLIT_DATA_ON_QPS="${NCCL_IB_SPLIT_DATA_ON_QPS:-0}"

echo "=== NCCL Environment ==="
env | grep ^NCCL_ | sort
echo "========================"
```

### Why NOT Set NCCL_IB_HCA Globally

```text
Problem: In SR-IOV mode, each pod gets a different Virtual Function (VF).

Node 1, Pod A:  gets mlx5_2 (VF from PF mlx5_0)
Node 1, Pod B:  gets mlx5_5 (VF from PF mlx5_1)
Node 2, Pod C:  gets mlx5_3 (VF from different PF)

If you set NCCL_IB_HCA=mlx5_0 globally:
  → Rank in Pod B tries to use mlx5_0 (doesn't have access!) → FAIL

Solution: Leave NCCL_IB_HCA empty.
  NCCL auto-detects which HCA backs the NCCL_SOCKET_IFNAME (net1) interface.
  Each rank independently finds its own VF.

For single-node debugging ONLY, you may temporarily set:
  export NCCL_IB_HCA=mlx5_0,mlx5_3
  (when you know all GPUs on that node share those HCAs)
```

### NCCL_IB_GID_INDEX Explained

```text
GID Index │ Type        │ Use Case
──────────┼─────────────┼──────────────────────────────────
    0     │ RoCEv1 GID  │ Legacy, link-local only
    1     │ RoCEv2 IPv6 │ IPv6 link-local
    2     │ RoCEv2 IPv4 │ If IPv4 mapped to GID index 2
    3     │ RoCEv2 IPv4 │ Standard routable IPv4 GID ✅
──────────┴─────────────┴──────────────────────────────────

To check your GID table:
  show_gids (from ibverbs-utils)
  
  DEV     PORT  INDEX  GID                                   IPv4            VER   DEV
  mlx5_0  1     0      fe80:0000:...                         ---             v1    net1
  mlx5_0  1     1      fe80:0000:...                         ---             v2    net1
  mlx5_0  1     2      0000:0000:...                         10.10.0.5       v1    net1
  mlx5_0  1     3      0000:0000:...                         10.10.0.5       v2    net1  ← Use this

Default: NCCL_IB_GID_INDEX=3 (RoCEv2 with routable IPv4)
If your fabric uses different indexing, check show_gids and adjust.
```

### NCCL_NET_GDR_LEVEL=SYS for SR-IOV

```text
Why SYS instead of PIX or PHB?

With SR-IOV, the device plugin assigns VFs from a pool.
GPU 0 might get VF from mlx5_0 (same PCIe switch = PIX)
GPU 0 might get VF from mlx5_3 (different socket = SYS)

The assignment is non-deterministic — depends on which VFs are available.

If NCCL_NET_GDR_LEVEL=PIX:
  → NCCL only uses GDRDMA when GPU and HCA share PCIe switch
  → Some ranks fall back to host staging (inconsistent performance)

If NCCL_NET_GDR_LEVEL=SYS:
  → NCCL uses GDRDMA even when GPU and HCA are on different sockets
  → Consistent behavior regardless of VF assignment
  → Small bandwidth penalty for cross-socket GDRDMA, but still better than no GDRDMA

Recommendation for SR-IOV: NCCL_NET_GDR_LEVEL=SYS (or 4/5)
Recommendation for dedicated NICs: NCCL_NET_GDR_LEVEL=PIX (optimal)
```

### MPIJob YAML (nccl_prod.yaml)

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
              image: nvcr.io/nvidia/pytorch:24.04-py3
              command: ["/bin/bash", "-c"]
              args:
                - |
                  source /workspace/validate_network.sh
                  mpirun --allow-run-as-root \
                    -np ${MPI_NP:-4} \
                    --bind-to none \
                    -x NCCL_IB_GID_INDEX \
                    -x NCCL_IB_DISABLE \
                    -x NCCL_SOCKET_IFNAME \
                    -x NCCL_NET_GDR_LEVEL \
                    -x NCCL_DEBUG \
                    -x NCCL_DEBUG_SUBSYS \
                    -x NCCL_IB_OPS_PER_CONNECTION \
                    -x NCCL_IB_SPLIT_DATA_ON_QPS \
                    -x NCCL_DMABUF_ENABLE=1 \
                    /opt/nccl-tests/build/all_reduce_perf \
                    -b 8 -e 8G -f 2 -g 1
              env:
                - name: MPI_NP
                  value: "4"
                - name: GPUS_PER_MPI_PROCESS
                  value: "1"
                - name: MPI_HOSTFILE
                  value: /etc/mpi/hostfile
                - name: MPI_DNS_WAIT_SECONDS
                  value: "120"
                - name: MPI_DNS_WAIT_INTERVAL
                  value: "3"
    Worker:
      replicas: 2
      template:
        metadata:
          annotations:
            k8s.v1.cni.cncf.io/networks: sriov-rdma-net
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

### Headless Service for MPI DNS

```yaml
# nccl-roce-validation-headless-svc.yaml
apiVersion: v1
kind: Service
metadata:
  name: nccl-roce-validation-worker
  namespace: gpu-workloads
spec:
  clusterIP: None
  selector:
    app: nccl-roce-validation
    training.kubeflow.org/replica-type: worker
  ports:
    - port: 22
      targetPort: 22
```

### Troubleshooting Checklist

```text
If observed bandwidth is much lower than expected, investigate:

┌─────────────────────────────────────────────────────────────────┐
│ CHECKLIST                                                        │
├─────────────────────────────────────────────────────────────────┤
│ □ SR-IOV VF allocation                                           │
│   → oc get sriovnetworknodestates -o yaml                       │
│   → Verify VFs created and available                             │
│                                                                  │
│ □ /dev/infiniband visibility                                     │
│   → oc exec worker-0 -- ls /dev/infiniband/                     │
│   → Must show uverbs0, rdma_cm                                  │
│                                                                  │
│ □ RoCE GID index                                                 │
│   → oc exec worker-0 -- show_gids                               │
│   → Verify NCCL_IB_GID_INDEX matches routable IP GID            │
│                                                                  │
│ □ MTU                                                            │
│   → ip link show net1 | grep mtu                                │
│   → Should be 9000 (jumbo) for optimal RDMA throughput          │
│                                                                  │
│ □ PFC / ECN                                                      │
│   → ethtool -S mlx5_0 | grep pause                             │
│   → PFC must be enabled on RDMA priority (typically TC3)        │
│                                                                  │
│ □ GPUDirect RDMA                                                 │
│   → Check NCCL logs for /GDRDMA suffix                          │
│   → lsmod | grep nvidia_peermem on host                         │
│                                                                  │
│ □ NCCL_SOCKET_IFNAME                                             │
│   → Must point to SR-IOV secondary network interface (net1)     │
│   → NOT eth0 (pod network) or lo                                │
│                                                                  │
│ □ PCIe / NUMA locality                                           │
│   → nvidia-smi topo -m                                          │
│   → Check if GPU and assigned HCA are on same NUMA node         │
│                                                                  │
│ □ Whether each MPI rank selected the HCA backing its own net1   │
│   → NCCL INFO logs show "Using network IB" + device name        │
│   → Each rank should use the VF attached to its pod             │
└─────────────────────────────────────────────────────────────────┘
```

### Verify Pod Placement

```bash
# Check where pods landed
oc get pods -o wide -n gpu-workloads
# NAME                                  READY  STATUS     AGE  IP            NODE
# nccl-roce-validation-launcher-9br76   0/1    Completed  2m   10.128.2.255  worker-w01
# nccl-roce-validation-worker-0         1/1    Running    2m   10.131.0.149  worker-w02
# nccl-roce-validation-worker-1         1/1    Running    2m   10.128.2.254  worker-w01

# Workers on different nodes = tests cross-node network ✅
# Workers on same node = only tests NVLink/SHM (not useful for network validation)

# Force different nodes with anti-affinity:
# spec.template.spec.affinity.podAntiAffinity...
```

### NCCL_IB_OPS_PER_CONNECTION and NCCL_IB_SPLIT_DATA_ON_QPS

```text
NCCL_IB_OPS_PER_CONNECTION (default: 1)
  Number of outstanding RDMA operations per QP connection.
  Higher = more pipelining = better bandwidth (but more QP memory).
  For validation: keep at 1 (simple, predictable).
  For production: try 4-8 for better throughput.

NCCL_IB_SPLIT_DATA_ON_QPS (default: 0)
  0 = send all data on one QP per connection
  1 = split data across multiple QPs (requires multiple QPs per connection)
  For validation: keep at 0.
  For production with multiple rails: set to 1 with NCCL_IB_QPS_PER_CONNECTION>1.
```

### Project File Structure

```text
ocp_validate_nccl/
├── validate_network.sh              # NCCL environment setup script
├── validate_network_v4.sh           # Version 4 with latest tuning
├── mpijob.yaml                      # Generic MPIJob template
├── nccl_prod.yaml                   # Production validation config
├── nccl-roce-validation.yaml        # RoCE multi-node test
├── nccl-roce-validation-headless-svc.yaml  # DNS service for MPI
├── shell-nccl-roce-validation.yaml  # Interactive debug shell
├── single-nccl-roce-validation.yaml # Single-node variant
├── single.log                       # Single-node results
├── nv5.log                          # NVLink 5-way test
├── sys_v5.log                       # SYS-level GDR test
├── pix.log                          # PIX-level GDR test
├── phb_v5.log                       # PHB-level test
├── phb_v5_1805.log                  # PHB test variant
├── 4q_phb.log                       # 4-QP PHB test
├── Dockerfile                       # Custom NCCL test image
└── .dockerignore
```

## Common Issues

### Wrong GID index — "Connection refused" or timeout
- **Cause**: `NCCL_IB_GID_INDEX` doesn't match routable GID in switch fabric
- **Fix**: Run `show_gids` in worker pod; find RoCEv2 index with routable IP; set accordingly

### Rank uses wrong HCA (not backing net1)
- **Cause**: NCCL picks first available HCA instead of one behind net1
- **Fix**: Ensure `NCCL_SOCKET_IFNAME=net1`; NCCL resolves which HCA owns that interface

### Inconsistent bandwidth across runs
- **Cause**: SR-IOV VF assignment varies; some VFs closer to GPU than others
- **Fix**: Use `NCCL_NET_GDR_LEVEL=SYS` to ensure GDRDMA regardless of topology; or pin VFs with topology-aware scheduling

### Workers placed on same node (no network test)
- **Cause**: Scheduler placed both workers on same node
- **Fix**: Add pod anti-affinity on hostname; or use topology spread constraints

## Best Practices

1. **Never set `NCCL_IB_HCA` globally in MPI mode** — let each rank auto-detect
2. **Use `NCCL_IB_GID_INDEX=3`** for standard RoCEv2 with IPv4
3. **Use `NCCL_NET_GDR_LEVEL=SYS`** with SR-IOV (non-deterministic VF placement)
4. **Source validate_network.sh** — consistent environment across all test variants
5. **Export NCCL vars through mpirun `-x`** — ensures workers inherit settings
6. **Keep OPS_PER_CONNECTION=1 for validation** — increase for production tuning
7. **Save all log variants** — compare PIX vs PHB vs SYS to quantify topology impact
8. **Check pod placement** — workers must be on different nodes for network tests

## Key Takeaways

- `validate_network.sh`: standardized NCCL environment for SR-IOV GPU clusters
- **Don't set NCCL_IB_HCA globally** — each MPI rank auto-detects its own VF
- `NCCL_IB_GID_INDEX=3`: RoCEv2 routable IPv4 GID (verify with `show_gids`)
- `NCCL_NET_GDR_LEVEL=SYS`: use GDRDMA even when VF is on different socket than GPU
- `NCCL_SOCKET_IFNAME=net1`: point NCCL to SR-IOV Multus secondary interface
- Bandwidth troubleshooting: systematic checklist from VF allocation → HCA selection
- File multiple test variants (single/pix/phb/sys) to characterize cluster topology impact
- MPI launcher doesn't need GPUs or RDMA — only worker pods need resources
