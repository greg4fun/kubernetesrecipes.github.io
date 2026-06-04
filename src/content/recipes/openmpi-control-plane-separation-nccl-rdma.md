---
title: "OpenMPI Control Plane Separation for NCCL RDMA"
description: "Configure OpenMPI to use eth0 for MPI control traffic while NCCL uses net1 SR-IOV for data. Covers btl_tcp_if_include, pml, routed direct, plm_rsh_agent SSH options, and UCC/HCOLL disabling for clean NCCL-only collectives."
tags:
  - "mpi"
  - "nccl"
  - "networking"
  - "rdma"
  - "openshift"
category: "ai"
publishDate: "2026-06-04"
author: "Luca Berton"
difficulty: "advanced"
relatedRecipes:
  - "nccl-network-validator-production-mpijob"
  - "nccl-all-reduce-perf-benchmark-multi-node"
  - "runai-distributed-inference-vllm-nccl"
---

> 💡 **Quick Answer:** In Kubeflow MPIJob with SR-IOV RDMA, you must separate control and data planes: OpenMPI uses `eth0` (pod network) for SSH, process management, and barrier synchronization via `--mca btl_tcp_if_include eth0`, while NCCL uses `net1` (SR-IOV VF) for GPU collective operations via `NCCL_SOCKET_IFNAME=net1`. This prevents MPI from attempting to route control traffic over the RDMA interface which lacks pod DNS resolution.

## The Problem

- MPI control traffic (SSH, process spawn, barriers) needs pod-to-pod DNS resolution
- SR-IOV `net1` interface only provides L2/L3 connectivity for RDMA — no Kubernetes DNS
- If OpenMPI tries to use `net1` for control traffic, SSH connections and DNS lookups fail
- MPI collective libraries (UCC, HCOLL) can conflict with NCCL's own collective implementation
- Need clean separation: MPI manages processes, NCCL manages GPU data

## The Solution

### Complete MPI Environment Configuration

```yaml
env:
  # === OpenMPI Control Plane (process management) ===

  # Force TCP byte transfer layer on eth0 only
  - name: OMPI_MCA_btl
    value: "self,tcp"           # self (loopback) + tcp (no openib)
  - name: OMPI_MCA_btl_tcp_if_include
    value: "eth0"              # Pod network interface

  # Point-to-point messaging layer
  - name: OMPI_MCA_pml
    value: "ob1"               # Use ob1 (not ucx) for simplicity

  # SSH agent for launching remote processes
  - name: OMPI_MCA_plm_rsh_agent
    value: >-
      ssh -o StrictHostKeyChecking=no
      -o UserKnownHostsFile=/dev/null
      -o GlobalKnownHostsFile=/dev/null

  # Direct routing (no tree/ring for process management)
  # Set via mpirun --mca routed direct

  # Abort timeout for hung processes
  - name: OMPI_MCA_orte_abort_timeout
    value: "60"

  # === Disable MPI Collectives (use NCCL instead) ===

  # Disable UCX collective component
  - name: OMPI_MCA_coll_ucc_enable
    value: "0"

  # Disable Mellanox HCOLL (hardware collectives)
  - name: OMPI_MCA_coll_hcoll_enable
    value: "0"

  # === NCCL Data Plane (GPU collectives) ===

  # NCCL bootstrap and socket operations on SR-IOV interface
  - name: NCCL_SOCKET_IFNAME
    value: "net1"

  # Allow running as root in containers
  - name: OMPI_ALLOW_RUN_AS_ROOT
    value: "1"
  - name: OMPI_ALLOW_RUN_AS_ROOT_CONFIRM
    value: "1"
```

### The mpirun Command

```bash
mpirun \
  -np 4 \
  --hostfile /etc/mpi/hostfile \
  --bind-to none \                    # Don't bind to cores (GPU workload)
  --map-by slot \                     # One rank per slot (GPU)
  --mca routed direct \               # Direct process routing
  --mca btl "self,tcp" \              # TCP only (no openib BTL)
  --mca pml ob1 \                     # ob1 PML (not UCX)
  --mca btl_tcp_if_include eth0 \     # Control on pod network
  -x NCCL_IB_HCA \                    # Forward NCCL vars to workers
  -x NCCL_IB_GID_INDEX \
  -x NCCL_IB_DISABLE \
  -x NCCL_SOCKET_IFNAME \
  -x NCCL_NET_GDR_LEVEL \
  -x NCCL_DMABUF_ENABLE \
  -x NCCL_COLLNET_ENABLE \
  -x NCCL_DEBUG \
  -x NCCL_DEBUG_SUBSYS \
  -x NCCL_IB_QPS_PER_CONNECTION \
  -x NCCL_IB_SPLIT_DATA_ON_QPS \
  -x NCCL_SHM_DISABLE \
  -x NCCL_NET_PLUGIN \
  -x OMPI_MCA_coll_ucc_enable \
  -x OMPI_MCA_coll_hcoll_enable \
  -x LD_LIBRARY_PATH \
  -x PATH \
  /opt/nccl-tests/build/all_reduce_perf \
    -b 1G -e 16G -f 2 -g 1
```

### Traffic Flow Diagram

```text
┌─────────────────────────────────────────────────────────────────┐
│                        Kubernetes Cluster                        │
│                                                                 │
│  ┌──────────────┐         eth0 (pod network)        ┌──────────┐
│  │   Launcher   │◄────── SSH + MPI control ────────►│ Worker-0 │
│  │              │◄────── SSH + MPI control ────────►│ Worker-1 │
│  └──────────────┘         (DNS resolvable)          └──────────┘
│                                                                 │
│  ┌──────────────┐         net1 (SR-IOV VF)          ┌──────────┐
│  │   Worker-0   │◄────── NCCL RDMA data ───────────►│ Worker-1 │
│  │   GPU 0,1    │         (L2/L3 only)              │ GPU 2,3  │
│  └──────────────┘         (no DNS needed)           └──────────┘
│                                                                 │
└─────────────────────────────────────────────────────────────────┘

eth0: 10.128.x.x (Kubernetes pod CIDR, full DNS, Service discovery)
net1: 192.168.x.x (SR-IOV subnet, RDMA-capable, no K8s services)
```

### Why Disable UCC and HCOLL

```text
Component    │ What it does              │ Why disable
─────────────┼───────────────────────────┼────────────────────────────
coll_ucc     │ UCX-based MPI collectives │ Conflicts with NCCL allreduce
coll_hcoll   │ Mellanox HW collectives   │ Conflicts with NCCL allreduce
─────────────┴───────────────────────────┴────────────────────────────

NCCL handles all GPU collective operations (allreduce, allgather, etc.)
MPI is only used for process management (spawn, barrier, finalize)
Enabling MPI collectives creates confusion about which library handles
the actual GPU data movement — always let NCCL own the data path.
```

### DNS Resolution for MPI Hostfile

```bash
# Kubeflow MPI Operator creates a headless Service and generates hostfile:
# /etc/mpi/hostfile contains:
#   nccl-roce-validation-worker-0.nccl-roce-validation.gpu-benchmark.svc slots=2
#   nccl-roce-validation-worker-1.nccl-roce-validation.gpu-benchmark.svc slots=2

# These DNS names resolve via eth0 (pod network)
# If using net1, getent hosts would fail → MPI cannot SSH to workers

# The validate_network.sh script waits for DNS:
wait_for_mpi_dns() {
  while read -r host rest; do
    if getent hosts "${host}" >/dev/null 2>&1; then
      echo "DNS OK: ${host}"
    else
      echo "DNS WAIT: ${host} not resolvable yet"
    fi
  done < "${MPI_HOSTFILE}"
}
```

### FQDN Rewriting for Stubborn DNS

```bash
# Some clusters need .svc.cluster.local suffix for resolution
# Enable with: REWRITE_MPI_HOSTFILE_FQDN=true

# Converts:
#   worker-0.svc slots=2
# To:
#   worker-0.svc.cluster.local slots=2

sed 's/\.svc /.svc.cluster.local /g' /etc/mpi/hostfile > /tmp/mpi-hostfile
export MPI_HOSTFILE="/tmp/mpi-hostfile"
```

## Common Issues

### "No route to host" on mpirun
- **Cause**: OpenMPI trying to use net1 for SSH
- **Fix**: Ensure `OMPI_MCA_btl_tcp_if_include=eth0` is set on launcher AND forwarded to workers

### NCCL hangs after "Connected to proxy"
- **Cause**: NCCL trying to bootstrap on eth0 instead of net1
- **Fix**: Set `NCCL_SOCKET_IFNAME=net1` — this tells NCCL where to establish connections

### MPI barrier timeout
- **Cause**: Firewall or NetworkPolicy blocking eth0 TCP between pods
- **Fix**: Ensure no NetworkPolicy restricts inter-pod traffic on port ranges used by MPI

### Workers not reachable via SSH
- **Cause**: SSHD not running on workers, or hostfile DNS not resolved
- **Fix**: Workers must run in `shell` mode with `START_SSHD=true`

## Best Practices

1. **Always set `btl_tcp_if_include=eth0`** — never let MPI auto-detect interfaces
2. **Use `pml=ob1`** not UCX — simpler, no interference with NCCL's UCX usage
3. **Disable ALL MPI collectives** — NCCL owns GPU data movement exclusively
4. **Forward all NCCL vars via `-x`** — workers inherit from launcher environment
5. **Set `routed direct`** — flat topology, no MPI routing overhead
6. **Use `--bind-to none`** — GPU workloads manage their own affinity
7. **SSH with no host checking** — pods are ephemeral, strict checking always fails

## Key Takeaways

- Two separate networks: eth0 (MPI control) and net1 (NCCL data)
- OpenMPI only manages processes — SSH, spawn, barriers, finalize
- NCCL exclusively handles GPU collective operations over RDMA
- Disable UCC + HCOLL to prevent MPI from touching GPU data
- `NCCL_SOCKET_IFNAME=net1` is mandatory for NCCL to find SR-IOV interface
- DNS resolution only works on eth0 — MPI hostfile relies on pod network
- Forward all NCCL environment variables from launcher to workers via mpirun `-x`
