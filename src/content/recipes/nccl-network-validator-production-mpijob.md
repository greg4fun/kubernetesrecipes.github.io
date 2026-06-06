---
title: "Production NCCL Network Validator for Kubeflow MPIJob"
description: "Deploy a production-ready NCCL network validation framework using Kubeflow MPIJob on OpenShift. Complete validate_network.sh script"
tags:
  - "nccl"
  - "mpi"
  - "rdma"
  - "openshift"
  - "validation"
category: "ai"
publishDate: "2026-06-04"
author: "Luca Berton"
difficulty: "advanced"
relatedRecipes:
  - "nccl-gpudirect-rdma-distance-pix-sys"
  - "nccl-network-validation-script-openshift"
  - "nccl-roce-validation-mpijob-complete-reference"
---

> 💡 **Quick Answer:** Build a production NCCL network validation framework with three modes: `single-node` (NVLink test, expect ~700-800 GB/s busbw on 2 GPUs), `mpi-job` (multi-node RoCE test, expect ~120-160 GB/s busbw across 2 nodes), and `shell` (interactive debugging with SSHD). The script handles DNS resolution, hostfile rewriting, RDMA diagnostics, OpenMPI control plane separation, and produces a clear "Validation complete. Read the busbw column." output with a troubleshooting checklist.

## The Problem

- Need a single, reusable validation tool for both single-node and multi-node GPU tests
- MPI worker pods need SSH daemon for launcher communication
- DNS resolution for worker hostnames can timeout in Kubernetes
- Must separate OpenMPI control plane (eth0) from NCCL data path (net1/RDMA)
- Need clear pass/fail criteria and troubleshooting guidance
- Must work across multiple OpenShift projects/namespaces with Run:ai scheduling

## The Solution

### validate_network.sh — Complete Production Script

```bash
#!/usr/bin/env bash
# =============================================================================
# validate_network.sh — NCCL bandwidth validation for OpenShift/Kubeflow MPIJob
#
# Modes:
#   single-node : run all_reduce_perf inside one pod
#   mpi-job     : run all_reduce_perf using Kubeflow MPIJob launcher/worker pods
#   shell       : start SSHD and keep pod alive for interactive debugging
#
# Expected:
#   Single-node, 2 GPUs over NVLink:    ~700–800 GB/s busbw
#   Multi-node, 4 GPUs over RoCE:       ~120–160 GB/s busbw
# =============================================================================

set -euo pipefail

MODE="${1:-single-node}"

log() {
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*"
}

fail() {
  echo "ERROR: $*" >&2
  exit 1
}

need_cmd() {
  command -v "$1" >/dev/null 2>&1 || fail "Missing required command: $1"
}

# -----------------------------------------------------------------------------
# Container/OpenShift-safe defaults
# -----------------------------------------------------------------------------

export HOME="${HOME:-/tmp}"

# NCCL defaults
export NCCL_IB_HCA="${NCCL_IB_HCA:-mlx5}"
export NCCL_IB_GID_INDEX="${NCCL_IB_GID_INDEX:-3}"
export NCCL_IB_DISABLE="${NCCL_IB_DISABLE:-0}"

# For your SR-IOV Multus interface, this should usually be net1.
export NCCL_SOCKET_IFNAME="${NCCL_SOCKET_IFNAME:-net1}"

# GPUDirect RDMA level.
export NCCL_NET_GDR_LEVEL="${NCCL_NET_GDR_LEVEL:-PHB}"

export NCCL_DEBUG="${NCCL_DEBUG:-INFO}"
export NCCL_DEBUG_SUBSYS="${NCCL_DEBUG_SUBSYS:-INIT,NET,GRAPH}"

# Optional NCCL tuning
export NCCL_IB_QPS_PER_CONNECTION="${NCCL_IB_QPS_PER_CONNECTION:-1}"
export NCCL_IB_SPLIT_DATA_ON_QPS="${NCCL_IB_SPLIT_DATA_ON_QPS:-1}"

# Keep SHM enabled unless you see shared-memory related failures.
export NCCL_SHM_DISABLE="${NCCL_SHM_DISABLE:-0}"

# OpenMPI defaults
export OMPI_ALLOW_RUN_AS_ROOT="${OMPI_ALLOW_RUN_AS_ROOT:-1}"
export OMPI_ALLOW_RUN_AS_ROOT_CONFIRM="${OMPI_ALLOW_RUN_AS_ROOT_CONFIRM:-1}"

# In MPIJob, OpenMPI normally uses the generated hostfile.
export MPI_HOSTFILE="${MPI_HOSTFILE:-/etc/mpi/hostfile}"

# Test sizing
export NCCL_TEST_MIN_BYTES="${NCCL_TEST_MIN_BYTES:-8}"
export NCCL_TEST_MAX_BYTES="${NCCL_TEST_MAX_BYTES:-8G}"
export NCCL_TEST_FACTOR="${NCCL_TEST_FACTOR:-2}"

# GPU layout
export SINGLE_NODE_GPUS="${SINGLE_NODE_GPUS:-2}"

# For 2 workers × 2 GPUs each, use NP=4 and -g 1.
export MPI_NP="${MPI_NP:-4}"
export GPUS_PER_MPI_PROCESS="${GPUS_PER_MPI_PROCESS:-1}"

# Network transport for OpenMPI control plane.
export OMPI_MCA_btl="${OMPI_MCA_btl:-self,tcp}"
export OMPI_MCA_pml="${OMPI_MCA_pml:-ob1}"

# Use Kubernetes pod network for MPI control (eth0, not net1).
export OMPI_MCA_btl_tcp_if_include="${OMPI_MCA_btl_tcp_if_include:-eth0}"

# DNS wait settings
export MPI_DNS_WAIT_SECONDS="${MPI_DNS_WAIT_SECONDS:-120}"
export MPI_DNS_WAIT_INTERVAL="${MPI_DNS_WAIT_INTERVAL:-3}"

# If true, converts ".svc" hostfile entries to ".svc.cluster.local"
export REWRITE_MPI_HOSTFILE_FQDN="${REWRITE_MPI_HOSTFILE_FQDN:-false}"

# -----------------------------------------------------------------------------
# Basic diagnostics
# -----------------------------------------------------------------------------

log "Mode: ${MODE}"
log "Hostname: $(hostname)"
log "UID=$(id -u), GID=$(id -g), USER=$(id -un 2>/dev/null || echo unknown)"

need_cmd bash
need_cmd find
need_cmd awk
need_cmd grep
need_cmd ip

echo ""
echo "================ System diagnostics ================"
echo "Hostname: $(hostname)"
echo "Date: $(date)"
echo "User: $(id)"
echo ""

echo "Interfaces:"
ip -br addr || true
echo ""

if command -v nvidia-smi >/dev/null 2>&1; then
  echo "NVIDIA GPUs:"
  nvidia-smi -L || true
else
  echo "WARNING: nvidia-smi not found."
fi
echo ""

if command -v ibv_devinfo >/dev/null 2>&1; then
  echo "RDMA devices:"
  ibv_devinfo -l || true
else
  echo "WARNING: ibv_devinfo not found."
fi
echo ""

if [[ -d /dev/infiniband ]]; then
  echo "/dev/infiniband:"
  ls -l /dev/infiniband || true
else
  echo "WARNING: /dev/infiniband is missing. RDMA will not work."
fi

echo "===================================================="
echo ""

# -----------------------------------------------------------------------------
# Locate nccl-tests
# -----------------------------------------------------------------------------

if [[ -n "${NCCL_TESTS_DIR:-}" && -x "${NCCL_TESTS_DIR}/all_reduce_perf" ]]; then
  NCCL_TESTS_BIN="${NCCL_TESTS_DIR}"
elif [[ -x "/opt/nccl-tests/build/all_reduce_perf" ]]; then
  NCCL_TESTS_BIN="/opt/nccl-tests/build"
else
  log "Searching for nccl-tests binaries..."
  NCCL_TESTS_BIN="$(dirname "$(find / -name 'all_reduce_perf' \
    -type f 2>/dev/null | head -n1 || true)")"

  if [[ -z "${NCCL_TESTS_BIN}" || \
        ! -x "${NCCL_TESTS_BIN}/all_reduce_perf" ]]; then
    fail "nccl-tests all_reduce_perf not found. \
Build it into the image or set NCCL_TESTS_DIR."
  fi
fi

log "Using nccl-tests from: ${NCCL_TESTS_BIN}"

print_env() {
  echo ""
  echo "================ NCCL / MPI environment ================"
  env | sort | grep -E \
    '^(NCCL|OMPI|PMIX|UCX|CUDA|LD_LIBRARY_PATH|PATH|MPI_|GPUS_|SINGLE_)' \
    || true
  echo "========================================================="
  echo ""
}

print_env

# -----------------------------------------------------------------------------
# Helpers
# -----------------------------------------------------------------------------

start_sshd_if_requested() {
  if [[ "${START_SSHD:-false}" != "true" ]]; then
    echo "START_SSHD is not true; sshd will not be started."
    return 0
  fi

  echo "START_SSHD=true, starting sshd for MPI worker access..."

  if ! command -v sshd >/dev/null 2>&1; then
    fail "START_SSHD=true but sshd is not installed in the image."
  fi

  mkdir -p /run/sshd /var/run/sshd /tmp/sshd
  chmod 755 /run/sshd /var/run/sshd /tmp/sshd || true

  # MPI Operator normally mounts SSH keys under /root/.ssh.
  if [[ -d /root/.ssh ]]; then
    chmod 700 /root/.ssh || true
    chmod 600 /root/.ssh/* 2>/dev/null || true
  fi

  # Some images require host keys.
  if [[ ! -f /etc/ssh/ssh_host_rsa_key ]]; then
    echo "Generating missing ssh host keys..."
    ssh-keygen -A || true
  fi

  cat > /tmp/sshd_config <<EOF
Port 22
ListenAddress 0.0.0.0
Protocol 2
PermitRootLogin prohibit-password
PubkeyAuthentication yes
PasswordAuthentication no
ChallengeResponseAuthentication no
UsePAM no
X11Forwarding no
AllowTcpForwarding yes
PermitTunnel no
PrintMotd no
StrictModes no
PidFile /tmp/sshd/sshd.pid
AuthorizedKeysFile .ssh/authorized_keys /root/.ssh/authorized_keys
Subsystem sftp internal-sftp
EOF

  echo "Validating sshd config..."
  /usr/sbin/sshd -t -f /tmp/sshd_config

  echo "Starting sshd..."
  /usr/sbin/sshd -D -e -f /tmp/sshd_config &
  SSHD_PID=$!

  sleep 2

  if ps -p "${SSHD_PID}" >/dev/null 2>&1; then
    echo "sshd started with PID ${SSHD_PID}"
  else
    fail "sshd failed to start."
  fi

  if command -v ss >/dev/null 2>&1; then
    ss -lntp | grep ':22' || true
  elif command -v netstat >/dev/null 2>&1; then
    netstat -lntp | grep ':22' || true
  fi
}

rewrite_hostfile_if_requested() {
  if [[ "${REWRITE_MPI_HOSTFILE_FQDN}" != "true" ]]; then
    return 0
  fi

  echo "REWRITE_MPI_HOSTFILE_FQDN=true; rewriting hostfile..."
  cp "${MPI_HOSTFILE}" /tmp/mpi-hostfile.original
  sed 's/\.svc /.svc.cluster.local /g' \
    /tmp/mpi-hostfile.original > /tmp/mpi-hostfile
  MPI_HOSTFILE="/tmp/mpi-hostfile"
  export MPI_HOSTFILE
  echo "Rewritten MPI hostfile:"
  cat "${MPI_HOSTFILE}"
}

wait_for_mpi_dns() {
  local hostfile="$1"
  local timeout="${MPI_DNS_WAIT_SECONDS}"
  local interval="${MPI_DNS_WAIT_INTERVAL}"
  local elapsed=0

  need_cmd getent

  echo ""
  echo "Waiting for MPI worker DNS records to resolve..."
  echo "Hostfile: ${hostfile}"
  echo "Timeout: ${timeout}s"
  echo ""

  while true; do
    local failed=0

    while read -r host rest; do
      [[ -z "${host}" ]] && continue
      [[ "${host}" =~ ^# ]] && continue

      if getent hosts "${host}" >/dev/null 2>&1; then
        echo "DNS OK: ${host} -> $(getent hosts "${host}" | \
          awk '{print $1}' | paste -sd ',' -)"
      else
        echo "DNS WAIT: ${host} not resolvable yet"
        failed=1
      fi
    done < "${hostfile}"

    if [[ "${failed}" -eq 0 ]]; then
      echo "All MPI worker DNS records resolved."
      return 0
    fi

    if [[ "${elapsed}" -ge "${timeout}" ]]; then
      echo "ERROR: Timed out waiting for MPI worker DNS."
      echo "Hostfile:"
      cat "${hostfile}" || true
      echo "Resolver config:"
      cat /etc/resolv.conf || true
      exit 1
    fi

    sleep "${interval}"
    elapsed=$((elapsed + interval))
  done
}

# -----------------------------------------------------------------------------
# Run modes
# -----------------------------------------------------------------------------

case "${MODE}" in
  single-node)
    echo ""
    echo "================================================================"
    echo "Single-node NCCL test"
    echo "Expected busbw on 2 GPUs over NVLink: ~700–800 GB/s"
    echo "GPUs used by all_reduce_perf: ${SINGLE_NODE_GPUS}"
    echo "================================================================"
    echo ""

    "${NCCL_TESTS_BIN}/all_reduce_perf" \
      -b "${NCCL_TEST_MIN_BYTES}" \
      -e "${NCCL_TEST_MAX_BYTES}" \
      -f "${NCCL_TEST_FACTOR}" \
      -g "${SINGLE_NODE_GPUS}"
    ;;

  mpi-job)
    need_cmd mpirun

    [[ -f "${MPI_HOSTFILE}" ]] || fail \
      "MPI hostfile not found at ${MPI_HOSTFILE}. \
Are you running inside a Kubeflow MPIJob launcher pod?"

    echo ""
    echo "================ MPI hostfile ================"
    cat "${MPI_HOSTFILE}"
    echo "=============================================="
    echo ""

    rewrite_hostfile_if_requested
    wait_for_mpi_dns "${MPI_HOSTFILE}"

    echo ""
    echo "================================================================"
    echo "Kubeflow MPIJob multi-node NCCL test"
    echo "Expected busbw across 2 nodes over RoCE: ~120–160 GB/s"
    echo "MPI_NP: ${MPI_NP}"
    echo "GPUS_PER_MPI_PROCESS: ${GPUS_PER_MPI_PROCESS}"
    echo "NCCL_SOCKET_IFNAME: ${NCCL_SOCKET_IFNAME}"
    echo "OpenMPI control interface: ${OMPI_MCA_btl_tcp_if_include}"
    echo "Hostfile: ${MPI_HOSTFILE}"
    echo "================================================================"
    echo ""

    mpirun \
      -np "${MPI_NP}" \
      --hostfile "${MPI_HOSTFILE}" \
      --bind-to none \
      --map-by slot \
      --mca routed direct \
      --mca btl "${OMPI_MCA_btl}" \
      --mca pml "${OMPI_MCA_pml}" \
      --mca btl_tcp_if_include "${OMPI_MCA_btl_tcp_if_include}" \
      -x NCCL_IB_HCA \
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
      "${NCCL_TESTS_BIN}/all_reduce_perf" \
        -b "${NCCL_TEST_MIN_BYTES}" \
        -e "${NCCL_TEST_MAX_BYTES}" \
        -f "${NCCL_TEST_FACTOR}" \
        -g "${GPUS_PER_MPI_PROCESS}"
    ;;

  shell)
    echo "Shell mode requested on $(hostname)"
    echo "Interfaces:"
    ip -br addr || true
    echo "GPUs:"
    nvidia-smi -L || true
    echo "RDMA:"
    ls -l /dev/infiniband || true
    ibv_devinfo -l || true

    start_sshd_if_requested

    if [[ -t 0 ]]; then
      echo "Interactive TTY detected. Starting bash."
      exec /bin/bash
    else
      echo "No interactive TTY. Keeping pod alive."
      echo "Use: oc exec -it \$(hostname) -- bash"
      exec sleep infinity
    fi
    ;;

  *)
    cat <<EOF
Usage:
  validate_network.sh single-node
  validate_network.sh mpi-job
  validate_network.sh shell

Important env vars:
  NCCL_SOCKET_IFNAME=net1
  NCCL_IB_HCA=mlx5
  NCCL_IB_GID_INDEX=3
  MPI_NP=4
  GPUS_PER_MPI_PROCESS=1
  MPI_HOSTFILE=/etc/mpi/hostfile
EOF
    exit 1
    ;;
esac

echo ""
echo "================================================================"
echo "Validation complete."
echo "Read the busbw column."
echo ""
echo "If observed bandwidth is much lower than expected, investigate:"
echo "  - SR-IOV VF allocation"
echo "  - /dev/infiniband visibility"
echo "  - RoCE GID index"
echo "  - MTU"
echo "  - PFC / ECN"
echo "  - GPUDirect RDMA"
echo "  - NCCL_SOCKET_IFNAME"
echo "  - PCIe / NUMA locality"
echo "  - Whether each MPI rank selected the HCA backing its own net1"
echo "================================================================"
```

### MPIJob YAML — Production Template

```yaml
apiVersion: kubeflow.org/v2beta1
kind: MPIJob
metadata:
  name: nccl-roce-validation
  namespace: gpu-workloads
spec:
  slotsPerWorker: 2
  launcherCreationPolicy: AtStartup
  mpiImplementation: OpenMPI

  runPolicy:
    cleanPodPolicy: None    # Keep pods for log inspection
    backoffLimit: 0         # Don't retry on failure

  mpiReplicaSpecs:
    Launcher:
      replicas: 1
      restartPolicy: Never
      template:
        metadata:
          labels:
            app: nccl-roce-validation
        spec:
          volumes:
            - name: dshm
              emptyDir:
                medium: Memory
                sizeLimit: 16Gi
          containers:
            - name: launcher
              image: registry.example.com/nccl-network-validator:pytorch-25.11-v6
              imagePullPolicy: Always
              securityContext:
                runAsUser: 0
              args:
                - mpi-job
              volumeMounts:
                - name: dshm
                  mountPath: /dev/shm
              env:
                # MPI Configuration
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
                  value: "/etc/mpi/hostfile"

                # NCCL data path over SR-IOV/RDMA
                - name: NCCL_SOCKET_IFNAME
                  value: "net1"
                - name: NCCL_DMABUF_ENABLE
                  value: "1"
                - name: NCCL_NET_PLUGIN
                  value: "none"          # Remove for IB plugin
                - name: NCCL_DEBUG
                  value: "INFO"
                - name: NCCL_SHM_DISABLE
                  value: "0"
                - name: NCCL_DEBUG_SUBSYS
                  value: "INIT,NET,GRAPH"

                # Test bounds
                - name: NCCL_TEST_MIN_BYTES
                  value: "1G"
                - name: NCCL_TEST_MAX_BYTES
                  value: "16G"

                # OpenMPI control plane on pod network
                - name: OMPI_MCA_btl_tcp_if_include
                  value: "eth0"
                - name: OMPI_MCA_plm_rsh_agent
                  value: >-
                    ssh -o StrictHostKeyChecking=no
                    -o UserKnownHostsFile=/dev/null
                    -o GlobalKnownHostsFile=/dev/null
                - name: OMPI_MCA_orte_abort_timeout
                  value: "60"
                - name: OMPI_MCA_coll_ucc_enable
                  value: "0"
                - name: OMPI_MCA_coll_hcoll_enable
                  value: "0"

              resources:
                requests:
                  cpu: "1"
                  memory: "2Gi"
                limits:
                  cpu: "2"
                  memory: "4Gi"

    Worker:
      replicas: 2
      restartPolicy: Never
      template:
        metadata:
          labels:
            app: nccl-roce-validation
            mpi-role: worker
          annotations:
            k8s.v1.cni.cncf.io/networks: sriov-rdma-net
        spec:
          subdomain: nccl-roce-validation
          volumes:
            - name: dshm
              emptyDir:
                medium: Memory
                sizeLimit: 16Gi
          containers:
            - name: worker
              image: registry.example.com/nccl-network-validator:pytorch-25.11-v6
              imagePullPolicy: Always
              securityContext:
                runAsUser: 0
                capabilities:
                  add:
                    - SYS_CHROOT
                    - NET_RAW
              args:
                - shell
              volumeMounts:
                - name: dshm
                  mountPath: /dev/shm
              env:
                - name: START_SSHD
                  value: "true"
                - name: NCCL_SOCKET_IFNAME
                  value: "net1"
                - name: NCCL_NET_GDR_LEVEL
                  value: "SYS"
                - name: NCCL_DMABUF_ENABLE
                  value: "1"
                - name: NCCL_SHM_DISABLE
                  value: "0"
                - name: NCCL_DEBUG
                  value: "INFO"
                - name: OMPI_MCA_btl_tcp_if_include
                  value: "eth0"
                - name: OMPI_MCA_coll_ucc_enable
                  value: "0"
                - name: OMPI_MCA_coll_hcoll_enable
                  value: "0"
              resources:
                requests:
                  cpu: "4"
                  memory: "16Gi"
                  nvidia.com/gpu: 2
                  openshift.io/mellanoxnics: 1
                limits:
                  cpu: "8"
                  memory: "32Gi"
                  nvidia.com/gpu: 2
                  openshift.io/mellanoxnics: 1
```

### Architecture Overview

```text
┌──────────────────────────────────────────────────────────────┐
│                    MPIJob Controller                          │
│  (creates launcher pod + worker pods + headless service)      │
└─────────────────────────┬────────────────────────────────────┘
                          │
            ┌─────────────┼─────────────┐
            │             │             │
     ┌──────▼──────┐ ┌───▼────┐ ┌──────▼──────┐
     │   Launcher  │ │Worker-0│ │  Worker-1   │
     │  (mpi-job)  │ │(shell) │ │  (shell)    │
     │  2 CPU/4Gi  │ │2 GPU   │ │  2 GPU      │
     │  No GPU     │ │1 VF    │ │  1 VF       │
     │  No RDMA    │ │SSHD ✓  │ │  SSHD ✓     │
     └──────┬──────┘ └───┬────┘ └──────┬──────┘
            │             │             │
            │   SSH (eth0/pod network)  │
            ├─────────────┼─────────────┤
            │             │             │
            │    NCCL data (net1/RDMA)  │
            └─────────────┴─────────────┘

Control Plane: eth0 (pod network) — MPI process management, SSH
Data Plane:   net1 (SR-IOV VF)   — NCCL collectives, RDMA transfers
```

### Worker Security Context

```yaml
securityContext:
  runAsUser: 0              # Root required for SSHD and RDMA
  capabilities:
    add:
      - SYS_CHROOT          # Required by SSHD
      - NET_RAW             # Required for RDMA verbs
      # Note: IPC_LOCK NOT needed with openshift.io/mellanoxnics
      # (device plugin handles memory locking)
```

### Resource Requests Explained

```text
Resource                      │ Request │ Limit │ Purpose
──────────────────────────────┼─────────┼───────┼─────────────────────────
nvidia.com/gpu                │ 2       │ 2     │ GPU allocation (Run:ai)
openshift.io/mellanoxnics     │ 1       │ 1     │ SR-IOV VF from device plugin
cpu                           │ 4       │ 8     │ MPI + NCCL proxy threads
memory                        │ 16Gi    │ 32Gi  │ NCCL buffers + test data
/dev/shm (emptyDir Memory)   │ —       │ 16Gi  │ NCCL shared memory transport
──────────────────────────────┴─────────┴───────┴─────────────────────────

openshift.io/mellanoxnics: provides:
  - /dev/infiniband/uverbs0 device
  - net1 interface (SR-IOV VF via Multus)
  - Memory locking capability (no explicit IPC_LOCK needed)
```

### Run:ai Integration

```yaml
# Run:ai automatically adds these annotations to track GPU allocation:
metadata:
  annotations:
    runai-calculated-status: Running
    runai-current-allocated-gpus: "4"
    runai-current-allocated-gpus-memory: "301509"  # ~294 GB (4× H200)
    runai-running-pods: "2"
    runai-used-nodes: gpu-worker-01, gpu-worker-02

# Run:ai scheduler handles:
# - GPU quota enforcement per project
# - Node selection based on GPU availability
# - Fair-share scheduling across projects
# - GPU memory tracking (301509 MB = 4× ~75 GB H200)
```

### Commented-Out Options (Tuning Knobs)

```yaml
# These are intentionally commented in the YAML for iterative testing:

# - name: NCCL_IB_HCA
#   value: "mlx5"          # Wildcard: use all mlx5 devices
                            # Uncomment to filter specific HCAs

# - name: NCCL_IB_GID_INDEX
#   value: "3"             # RoCEv2 IPv4 GID
                            # Change to 1 for link-local testing

# - name: NCCL_NET_GDR_LEVEL
#   value: "PHB"           # Default from validate_network.sh
                            # Worker overrides to SYS

# - name: NCCL_NET_GDR_READ
#   value: "0"             # Disable GDR reads (safer for SR-IOV)
                            # Enable for maximum bandwidth

# affinity:                 # Anti-affinity to force cross-node
#   podAntiAffinity:        # Uncomment when you need guaranteed
#     requiredDuring...     # multi-node placement
```

### Dockerfile for Custom Image

```dockerfile
FROM nvcr.io/nvidia/pytorch:25.11-py3

# Install SSH server for MPI worker communication
RUN apt-get update && apt-get install -y --no-install-recommends \
    openssh-server \
    openssh-client \
    && rm -rf /var/lib/apt/lists/*

# Build nccl-tests
RUN cd /opt && \
    git clone https://github.com/NVIDIA/nccl-tests.git && \
    cd nccl-tests && \
    make MPI=1 MPI_HOME=/usr/local/mpi \
      CUDA_HOME=/usr/local/cuda \
      NCCL_HOME=/usr/local

# Copy validation script
COPY validate_network.sh /opt/nccl-tests/
RUN chmod +x /opt/nccl-tests/validate_network.sh

ENTRYPOINT ["/opt/nccl-tests/validate_network.sh"]
CMD ["single-node"]
```

### Expected Results Matrix

```text
Test Config           │ NCCL_NET_GDR_LEVEL │ Expected busbw  │ Notes
──────────────────────┼────────────────────┼─────────────────┼──────────────
1×2 GPU (NVLink)      │ N/A (local)        │ ~700-800 GB/s   │ NVLink 4
1×8 GPU (NVLink)      │ N/A (local)        │ ~68 GB/s        │ Ring allreduce
2×2 GPU (socket)      │ N/A (no plugin)    │ ~13-35 GB/s     │ TCP fallback
2×2 GPU (PIX)         │ PIX                │ ~32 GB/s        │ Some disabled
2×2 GPU (PXB)         │ PXB                │ ~35-40 GB/s     │ Cross-switch OK
2×2 GPU (PHB)         │ PHB                │ ~38-42 GB/s     │ Same NUMA OK
2×2 GPU (SYS)         │ SYS                │ ~40-45 GB/s     │ All enabled
2×4 GPU (full RDMA)   │ SYS + IB plugin    │ ~120-160 GB/s   │ Production target
──────────────────────┴────────────────────┴─────────────────┴──────────────
```

## Common Issues

### "Could not find: libnccl-env.so"
- **Cause**: NCCL looking for optional environment plugin — informational only
- **Fix**: Ignore. Test proceeds normally. Not an error.

### DNS WAIT timeout (120s exceeded)
- **Cause**: Headless Service not created or worker pods not Running
- **Fix**: Verify MPIJob created the headless service; check worker pod events

### Workers see 26 mlx5 devices (mlx5_0 through mlx5_25)
- **Cause**: Shared RDMA device plugin exposes all VFs to all pods
- **Fix**: Normal with `openshift.io/mellanoxnics`. NCCL_IB_HCA=mlx5 filters correctly.

### `runAsUser: 0` required
- **Cause**: SSHD needs root; RDMA verbs need root for some operations
- **Fix**: Use OpenShift SCC that allows runAsUser 0 (e.g., `privileged` or custom)

### Pod anti-affinity not enforced
- **Cause**: Anti-affinity section is commented out in template
- **Fix**: Uncomment when you need guaranteed cross-node placement

## Best Practices

1. **Use `cleanPodPolicy: None`** — keeps pods for log inspection after completion
2. **Worker args: `shell`** — harmless if started directly; SSHD keeps it alive for MPI
3. **Launcher args: `mpi-job`** — orchestrates the test via mpirun
4. **Version your image** — `pytorch-25.11-v6` not `:latest` for reproducibility
5. **Start with `NCCL_NET_PLUGIN=none`** — baseline socket performance first
6. **Then remove `NCCL_NET_PLUGIN`** — enable IB verbs for RDMA comparison
7. **Test GDR levels incrementally** — PIX → PXB → PHB → SYS
8. **Keep commented-out options in YAML** — easy to uncomment for iteration
9. **Use `subdomain: nccl-roce-validation`** — enables headless service DNS

## Key Takeaways

- Three modes: `single-node` (NVLink), `mpi-job` (multi-node RoCE), `shell` (debug)
- Script is the container entrypoint — mode selected via args in YAML
- Workers run in `shell` mode (SSHD + sleep infinity); launcher runs in `mpi-job` mode
- All NCCL variables exported with defaults; override via MPIJob env
- DNS resolution with timeout + retry; hostfile rewriting for FQDN issues
- OpenMPI control on eth0; NCCL data on net1 (SR-IOV)
- `openshift.io/mellanoxnics: 1` provides VF + /dev/infiniband + net1
- Run:ai tracks GPU allocation (301 GB across 4× H200)
- Troubleshooting checklist printed after every run
- Production target: ~120-160 GB/s busbw with full RDMA enabled
