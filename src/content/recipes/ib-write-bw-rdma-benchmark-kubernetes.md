---
title: "ib_write_bw RDMA Bandwidth Testing"
description: "Run ib_write_bw from perftest on Kubernetes GPU nodes: SR-IOV device selection, GPUDirect RDMA, multi-QP scaling, full CLI reference, and RoCE tuning."
publishDate: "2026-04-23"
author: "Luca Berton"
category: "networking"
difficulty: "advanced"
timeToComplete: "18 minutes"
kubernetesVersion: "1.28+"
tags:
  - ib-write-bw
  - perftest
  - rdma
  - infiniband
  - roce
  - bandwidth
  - gpu
  - sriov
relatedRecipes:
  - "doca-perftest-rdma-benchmark-kubernetes"
  - "verify-nccl-rdma-traffic-debug"
  - "sriov-network-node-policy-rdma-openshift"
  - "pfc-nmstate-roce-lossless-kubernetes"
  - "mlnx-qos-mofed-container-kubernetes"
  - "nvidia-doca-bench-dpu-performance-kubernetes"
  - "run-nccl-tests-kubernetes"
  - "nccl-network-validation-troubleshooting-checklist"
---

> 💡 **Quick Answer:** `ib_write_bw` is the classic RDMA bandwidth benchmark from the perftest package. Run a server pod (`ib_write_bw`) and client pod (`ib_write_bw <server-ip>`) to measure point-to-point RDMA write throughput. Use `-a` for all message sizes, `-b` for bidirectional, `-D 10` for duration mode, and `--report_gbits` for Gb/s output.

## The Problem

You need a quick, reliable point-to-point RDMA bandwidth measurement between two Kubernetes nodes to:
- Validate NIC-to-NIC throughput (expecting 100/200/400 Gb/s)
- Compare before/after a network change (PFC, MTU, firmware update)
- Verify GPUDirect RDMA with `--use_cuda` (GPU-direct data path) vs. the CPU-bounce fallback
- Isolate fabric issues before running NCCL or DOCA perftest
- Measure the impact of multiple QPs, inline size, or rate limiting
- Select the correct RDMA device when a node exposes many SR-IOV VFs (`mlx5_0` … `mlx5_25`)

While DOCA perftest handles multi-node orchestration, `ib_write_bw` remains the go-to quick diagnostic — it's pre-installed in most RDMA-capable containers and requires zero configuration files.

> **Note:** `--use_hugepages` (below) is a separate, unrelated flag — it backs the test's memory-registration buffer with HugePages to reduce TLB overhead at large message sizes. It doesn't touch GPU memory; for GPU-to-NIC testing use `--use_cuda` instead.

## The Solution

### Quick Two-Pod Test

```yaml
apiVersion: v1
kind: Pod
metadata:
  name: rdma-server
  namespace: ai-infra
  annotations:
    k8s.v1.cni.cncf.io/networks: rdma-net
spec:
  containers:
    - name: perftest
      image: nvcr.io/nvidia/mellanox/mofed-container:24.07-0.7.0.0
      command:
        - ib_write_bw
        - -d
        - mlx5_2
        - -D
        - "30"
        - --report_gbits
      resources:
        requests:
          openshift.io/mlxrdma: "1"
        limits:
          openshift.io/mlxrdma: "1"
      securityContext:
        capabilities:
          add: ["IPC_LOCK"]
---
apiVersion: v1
kind: Pod
metadata:
  name: rdma-client
  namespace: ai-infra
  annotations:
    k8s.v1.cni.cncf.io/networks: rdma-net
spec:
  containers:
    - name: perftest
      image: nvcr.io/nvidia/mellanox/mofed-container:24.07-0.7.0.0
      command:
        - bash
        - -c
        - |
          # Wait for server to be ready
          sleep 10
          # Get server's RDMA IP
          SERVER_IP=$(getent hosts rdma-server | awk '{print $1}')
          ib_write_bw -d mlx5_2 -D 30 --report_gbits $SERVER_IP
      resources:
        requests:
          openshift.io/mlxrdma: "1"
        limits:
          openshift.io/mlxrdma: "1"
      securityContext:
        capabilities:
          add: ["IPC_LOCK"]
```

### Device Selection with SR-IOV

On GPU nodes with SR-IOV, a pod can see dozens of VFs (`mlx5_0` through `mlx5_25` or more from a shared RDMA device plugin). Pick the wrong one and you benchmark an idle VF instead of the one carrying traffic:

```bash
# List available RDMA devices in the pod
ibv_devinfo -l
# Expected:
#   device                 node GUID
#   ------              ----------------
#   mlx5_0              b8cef6030042a1c6
#   mlx5_1              b8cef6030042a1c7
#   ...
#   mlx5_25             b8cef6030042a1df

# Map each RDMA device to its net interface:
ibdev2netdev
# mlx5_0 port 1 ==> net1 (Up)
# mlx5_3 port 1 ==> net2 (Up)

# Select the device backing your SR-IOV network attachment:
ib_write_bw -d mlx5_0 -x 3 --report_gbits    # Uses net1's VF
ib_write_bw -d mlx5_25 -x 3 --report_gbits   # Uses mlx5_25 specifically
```

Also prefer the VF whose PCIe path is NUMA-local to the pod's CPU/GPU — see [Common Issues](#common-issues) for the symptom of that being wrong.

### Common Test Scenarios

```bash
# Basic bandwidth (default: 64KB messages, 5000 iterations, RC)
ib_write_bw -d mlx5_0                         # Server
ib_write_bw -d mlx5_0 <server-ip>             # Client

# All message sizes (2B → 8MB) — shows bandwidth curve
ib_write_bw -d mlx5_0 -a --report_gbits       # Server
ib_write_bw -d mlx5_0 -a --report_gbits <ip>  # Client

# Duration mode (10 seconds per size)
ib_write_bw -d mlx5_0 -D 10 --report_gbits
ib_write_bw -d mlx5_0 -D 10 --report_gbits <ip>

# Bidirectional bandwidth
ib_write_bw -d mlx5_0 -b -D 10 --report_gbits
ib_write_bw -d mlx5_0 -b -D 10 --report_gbits <ip>

# Multiple QPs (saturate NIC)
ib_write_bw -d mlx5_0 -q 4 -D 10 --report_gbits
ib_write_bw -d mlx5_0 -q 4 -D 10 --report_gbits <ip>

# RoCE with GID index (Ethernet)
ib_write_bw -d mlx5_0 -x 3 -D 10 --report_gbits
ib_write_bw -d mlx5_0 -x 3 -D 10 --report_gbits <ip>

# Specific message size
ib_write_bw -d mlx5_0 -s 1048576 -D 10 --report_gbits
ib_write_bw -d mlx5_0 -s 1048576 -D 10 --report_gbits <ip>

# HugePages for large transfers
ib_write_bw -d mlx5_0 --use_hugepages -D 10 --report_gbits
ib_write_bw -d mlx5_0 --use_hugepages -D 10 --report_gbits <ip>

# Run infinitely with periodic reports
ib_write_bw -d mlx5_0 --run_infinitely -D 5 --report_gbits
ib_write_bw -d mlx5_0 --run_infinitely -D 5 --report_gbits <ip>

# With CPU utilization reporting
ib_write_bw -d mlx5_0 -D 10 --cpu_util --report_gbits
ib_write_bw -d mlx5_0 -D 10 --cpu_util --report_gbits <ip>
```

### Full CLI Reference

| Flag | Long Option | Description | Default |
|------|-------------|-------------|---------|
| `-a` | `--all` | Test all sizes 2B → 8MB | Single size |
| `-b` | `--bidirectional` | Bidirectional bandwidth | Unidirectional |
| `-c` | `--connection=<type>` | RC, XRC, UC, or DC | RC |
| `-d` | `--ib-dev=<dev>` | RDMA device name | First found |
| `-D` | `--duration=<sec>` | Run for N seconds (per size) | Iteration-based |
| `-i` | `--ib-port=<port>` | IB device port | 1 |
| `-I` | `--inline_size=<bytes>` | Max inline message size | 0 |
| `-l` | `--post_list=<size>` | Post list of WQEs | 1 (single post) |
| `-m` | `--mtu=<mtu>` | MTU: 256-4096 | Port MTU |
| `-n` | `--iters=<n>` | Number of exchanges | 5000 |
| `-N` | `--noPeak` | Disable peak BW calculation | Peak enabled |
| `-O` | `--dualport` | Dual-port mode | Off |
| `-p` | `--port=<port>` | TCP control port | 18515 |
| `-q` | `--qp=<num>` | Number of Queue Pairs | 1 |
| `-Q` | `--cq-mod=<n>` | CQE generation frequency | Every completion |
| `-R` | `--rdma_cm` | Use rdma_cm for connection | IB verbs |
| `-s` | `--size=<bytes>` | Message size | 65536 |
| `-S` | `--sl=<sl>` | Service Level (priority) | 0 |
| `-t` | `--tx-depth=<n>` | TX queue depth | 128 |
| `-T` | `--tos=<value>` | Type of Service (DSCP) | Off |
| `-x` | `--gid-index=<idx>` | GID index (RoCE) | IB: none, ETH: 0 |
| | `--report_gbits` | Report in Gbit/s | MB/s |
| | `--use_hugepages` | Use HugePages | Regular allocation |
| | `--run_infinitely` | Run forever, print per `-D` | Single run |
| | `--cpu_util` | Report CPU utilization | Off (duration only) |
| | `--perform_warm_up` | Warmup before measuring | Off |
| | `--odp` | On Demand Paging | Memory registration |
| | `--reversed` | Server sends to client | Client sends |
| | `--report-both` | Report RX & TX separately | Combined |
| | `--mr_per_qp` | Separate MR per QP | Shared MR |

### Message Size Sweep

`-a` runs the full 2B → 8MB curve in one pass. Small messages are message-rate bound; large messages are bandwidth bound. Example capture on a ConnectX-7 400G port, single QP (see [Interpreting Results](#interpreting-results) for why single-QP absolute numbers vary by NIC generation):

```text
#bytes     BW peak[Gbps]   BW average[Gbps]
2          0.14            0.13
4          0.28            0.27
64         4.21            4.18
1024       42.15           41.89
4096       48.92           48.76
65536      49.12           49.07
1048576    49.15           49.12
8388608    49.16           49.14
```

Bandwidth plateaus once the message size amortizes per-message overhead (here, above ~4KB) — sizes beyond that mostly confirm the plateau, not new information.

### Multi-QP Scaling

A single QP is often CPU/PCIe bound before it's link-rate bound — this is especially visible on 400G ports. Scale `-q` to approach line rate:

```bash
# Server:
ib_write_bw -d mlx5_0 -x 3 --report_gbits -q 8

# Client:
ib_write_bw -d mlx5_0 -x 3 --report_gbits -q 8 <server-ip>
```

Expected scaling on a ConnectX-7 400G port:

| QPs (`-q`) | Expected BW |
|------|-------------|
| 1 | ~49 Gbps |
| 2 | ~98 Gbps |
| 4 | ~196 Gbps |
| 8 | ~380-395 Gbps (approaching 400G line rate) |

### Rate Limiting

```bash
# Hardware rate limiting at 50 Gbps
ib_write_bw -d mlx5_0 --rate_limit=50 --rate_limit_type=HW -D 10 --report_gbits
ib_write_bw -d mlx5_0 --rate_limit=50 --rate_limit_type=HW -D 10 --report_gbits <ip>

# Software rate limiting with burst
ib_write_bw -d mlx5_0 --rate_limit=25 --rate_limit_type=SW --burst_size=64 -D 10
ib_write_bw -d mlx5_0 --rate_limit=25 --rate_limit_type=SW --burst_size=64 -D 10 <ip>
```

| Rate Option | Description |
|-------------|-------------|
| `--rate_limit=<rate>` | Max send rate (default unit: Gbps) |
| `--rate_units=<M\|g\|p>` | MBps, Gbps, or packets/sec |
| `--rate_limit_type=<HW\|SW\|PP>` | Hardware, software, or packet-pacing |
| `--burst_size=<n>` | Messages per burst with rate limiter |

### Connection Types

```bash
# Reliable Connection (default — retransmits on loss)
ib_write_bw -d mlx5_0 -c RC <ip>

# Unreliable Connection (no retransmits — tests raw fabric)
ib_write_bw -d mlx5_0 -c UC <ip>

# Extended Reliable Connection (shared QP resources)
ib_write_bw -d mlx5_0 -c XRC <ip>

# Dynamic Connection (scalable, on-demand QP creation)
ib_write_bw -d mlx5_0 -c DC <ip>
```

### Latency Test (ib_write_lat)

Bandwidth and latency are separate concerns — `ib_write_lat` complements `ib_write_bw` to give the full picture, especially for collective-communication workloads sensitive to small-message latency:

```bash
# Server:
ib_write_lat -d mlx5_0 -x 3

# Client:
ib_write_lat -d mlx5_0 -x 3 <server-ip>
```

Expected (ConnectX-7 RoCE, same switch):

```text
#bytes    t_avg[usec]    t_median[usec]
2         1.45           1.42
64        1.48           1.45
1024      1.62           1.59
65536     4.21           4.18
```

### GPUDirect RDMA Test (GPU Memory)

`--use_cuda=<gpu-index>` sources the RDMA buffers from GPU memory instead of host memory, validating the actual GPUDirect RDMA path (GPU → NIC without a CPU bounce) that NCCL relies on:

```bash
# Server:
ib_write_bw -d mlx5_0 -x 3 --report_gbits --use_cuda=0

# Client:
ib_write_bw -d mlx5_0 -x 3 --report_gbits --use_cuda=0 <server-ip>
```

- GPUDirect working: ~45-49 Gbps (slightly less than host-memory single-QP throughput, due to BAR mapping overhead)
- GPUDirect **not** working (silently falls back to a CPU bounce buffer): ~25-30 Gbps — a visible, diagnosable gap

Run this before NCCL: if `ib_write_bw --use_cuda` shows the expected bandwidth but NCCL is still slow, the problem is NCCL/topology configuration, not the RDMA data plane.

### Interpreting Results

```
---------------------------------------------------------------------------------------
                    RDMA_Write BW Test
 Dual-port       : OFF          Device         : mlx5_0
 Number of qps   : 1            Transport type : IB
 Connection type  : RC           Using SRQ      : OFF
 PCIe relaxed order enabled
 ibv_wr* API used
 TX depth         : 128
 CQ Moderation    : 128
 Mtu              : 4096[B]
 Link type        : Ethernet
 GID index        : 3
 Max inline data  : 0[B]
 rdma_cm QPs      : OFF
 Data ex. method  : Ethernet
---------------------------------------------------------------------------------------
 local address: LID 0000 QPN 0x0107 PSN 0x3bc140 RKey 0x080528 VAddr 0x7f5a98200000
 GID: 00:00:00:00:00:00:00:00:00:00:255:255:10:56:01:05
 remote address: LID 0000 QPN 0x0107 PSN 0xd7a5c0 RKey 0x080528 VAddr 0x7f1b58200000
 GID: 00:00:00:00:00:00:00:00:00:00:255:255:10:56:02:05
---------------------------------------------------------------------------------------
 #bytes     #iterations    BW peak[Gb/sec]    BW average[Gb/sec]   MsgRate[Mpps]
 65536      5000           196.42             195.87               0.373512
---------------------------------------------------------------------------------------
```

| Field | What to Check |
|-------|---------------|
| BW peak | Should be close to line rate (200/400 Gb/s) |
| BW average | Should be >95% of peak for healthy fabric |
| MsgRate | Messages per second — important for small payloads |
| Link type | Ethernet (RoCE) or InfiniBand |
| GID | Verify correct RDMA interface IP |
| Mtu | Should be 4096 for maximum throughput |

**Why single-QP numbers differ by hardware:** the capture above shows a single QP reaching 196 Gb/s peak — consistent with a 200 Gb/s-class port (e.g. ConnectX-6) or a ConnectX-7 port running in 200G mode, where one QP can nearly saturate the link. The [Message Size Sweep](#message-size-sweep) and [Multi-QP Scaling](#multi-qp-scaling) sections above show single-QP throughput plateauing around ~49 Gbps on a **400 Gb/s** ConnectX-7 port — that's not a fabric problem, it's a single QP being CPU/PCIe-bound before it's link-bound at that speed. Reaching 400G line rate needs 4-8 QPs. Always match your expectation to the actual port speed (`ethtool <iface> | grep Speed`), not just the flags used.

### Kubernetes Benchmark Job (All Sizes)

```yaml
apiVersion: batch/v1
kind: Job
metadata:
  name: ib-write-bw-all
  namespace: ai-infra
spec:
  parallelism: 2
  completions: 2
  completionMode: Indexed
  template:
    metadata:
      annotations:
        k8s.v1.cni.cncf.io/networks: rdma-net
    spec:
      restartPolicy: Never
      subdomain: perftest-svc
      setHostnameAsFQDN: true
      containers:
        - name: perftest
          image: nvcr.io/nvidia/mellanox/mofed-container:24.07-0.7.0.0
          command:
            - bash
            - -c
            - |
              if [ "$JOB_COMPLETION_INDEX" = "0" ]; then
                echo "Starting server..."
                ib_write_bw -d mlx5_2 -a -D 10 --report_gbits --perform_warm_up
              else
                echo "Waiting for server..."
                while ! getent hosts ib-write-bw-all-0.perftest-svc; do sleep 2; done
                sleep 5
                SERVER=$(getent hosts ib-write-bw-all-0.perftest-svc | awk '{print $1}')
                echo "Connecting to $SERVER"
                ib_write_bw -d mlx5_2 -a -D 10 --report_gbits --perform_warm_up $SERVER
              fi
          resources:
            requests:
              openshift.io/mlxrdma: "1"
            limits:
              openshift.io/mlxrdma: "1"
          securityContext:
            capabilities:
              add: ["IPC_LOCK"]
---
apiVersion: v1
kind: Service
metadata:
  name: perftest-svc
  namespace: ai-infra
spec:
  clusterIP: None
  selector:
    job-name: ib-write-bw-all
  ports:
    - port: 18515
      name: perftest
```

```mermaid
sequenceDiagram
    participant C as Client Pod
    participant S as Server Pod
    
    S->>S: ib_write_bw -d mlx5_2 (listen on :18515)
    C->>S: TCP handshake (exchange QP info)
    Note over C,S: Exchange: LID, QPN, PSN, RKey, VAddr, GID
    C->>S: RDMA Write (65536B × 5000 iterations)
    Note over C,S: Zero-copy: no CPU involvement on server
    S-->>C: Completion (CQE)
    C->>C: Report: BW peak, BW avg, MsgRate
```

## Common Issues

**`Unable to init the socket connection`**

Server isn't listening yet. Add a sleep or retry loop on the client:
```bash
while ! nc -z $SERVER_IP 18515; do sleep 1; done
```

**Timeout waiting for client to connect (server and client both up)**

Server and client aren't on the same L2/L3 network — a routing or VLAN problem, not a timing problem. Verify both pods attach to the same SR-IOV subnet and check switch VLAN config.

**`Unable to find GID with index 3`**

No IPv4 address on the RDMA interface. Verify `ip addr show net1` (or your RDMA interface) has an IPv4 address, and check IPAM on the NetworkAttachmentDefinition.

**Low bandwidth with RoCE**

Check GID index — wrong GID maps to wrong interface:
```bash
# List GID table
ibv_devinfo -d mlx5_0 -v | grep GID
# Use the index matching your RDMA network
ib_write_bw -d mlx5_0 -x 3 <ip>
```

Also verify PFC is enabled: `mlnx_qos -i eth0 | grep -A2 "PFC"`

**BW average much lower than peak**

Possible causes:
- Congestion (check PFC counters: `ethtool -S mlx5_0 | grep prio3_pause`)
- MTU mismatch (use `-m 4096`)
- Single QP can't saturate the link — try `-q 4` (see [Multi-QP Scaling](#multi-qp-scaling))
- PCIe Gen4 instead of Gen5, or wrong NUMA zone — check link speed with `lspci -vvv` and locality with `numactl`

**Different BW on different `mlx5_X` devices**

VFs from different physical NICs have different PCIe paths. Use `ibdev2netdev` to map device → interface, and pick the VF that's NUMA-local to the pod (see [Device Selection with SR-IOV](#device-selection-with-sr-iov)).

**`Couldn't allocate MR` error**

Either the pod is missing the `IPC_LOCK` capability, or the memlock ulimit is too low for RDMA memory registration:
```bash
ulimit -l  # Should be "unlimited"
# Fix 1: add IPC_LOCK to the container's securityContext.capabilities
# Fix 2: CRI-O 99-ulimits.conf with memlock=-1:-1
```

**Inconsistent results between runs**

Use `--perform_warm_up` to eliminate cold-cache effects. Use `-D 10` (duration mode) instead of iteration-based for more stable measurements.

**`cpufreq_ondemand` warning**

CPU frequency scaling causes variable results. Suppress with `-F` or fix properly:
```bash
# Set CPU governor to performance
cpupower frequency-set -g performance
```

## Best Practices

- Always use `--report_gbits` for network engineers (default MB/s is confusing)
- Use `-D 10` (duration mode) for stable measurements — iteration mode can finish too fast
- Use `-a` (all sizes) for the first test to see the full bandwidth curve
- Use `--perform_warm_up` to eliminate cold-start variance
- Match MTU on both sides: `-m 4096` for maximum throughput
- Use `-x 3` for RoCE (GID index 3 = RoCEv2 with IPv4)
- Use `ibdev2netdev` to map RDMA device → net interface before picking `-d` on a node with many SR-IOV VFs
- Test single QP first to establish a baseline, then scale `-q` (4 or 8) to saturate high-speed links (200G+/400G)
- Set Service Level (`-S`) to match your PFC priority (e.g., `-S 3` for priority 3)
- Server and client must use the same flags (size, connection type, QPs)
- Use `--use_cuda` to validate the GPUDirect RDMA path specifically, not just host-memory bandwidth
- Run `ib_write_bw` before NCCL tests — it isolates NIC/switch issues from GPU topology/config issues
- Compare against DOCA perftest for production benchmarking — `ib_write_bw` is for quick diagnostics
- Use `--run_infinitely -D 5` for continuous monitoring during maintenance windows

## Key Takeaways

- `ib_write_bw` is the standard quick RDMA bandwidth diagnostic — pre-installed in most RDMA containers
- Server/client model: server listens on TCP 18515, exchanges QP info, then RDMA writes bypass TCP entirely
- RDMA write = zero-copy, zero-CPU on the server side — only the client drives the operation
- `-a` shows the full bandwidth curve: small messages test message rate, large messages test throughput
- For RoCE, always specify `-x <gid-index>` — wrong GID = wrong interface = zero bandwidth
- `-d mlx5_X` selects a specific SR-IOV VF — use `ibdev2netdev` to map device to interface, and prefer NUMA-local VFs
- A single QP is often CPU/PCIe-bound, not link-bound: expect ~49 Gbps/QP on a 400G ConnectX-7 port vs. near-line-rate on a 200G port; scale `-q` (4-8) to reach 400G line rate (~395 Gbps)
- Rate limiting (`--rate_limit`) tests behavior under throttled conditions (QoS validation)
- Connection types: RC (reliable, production), UC (unreliable, raw fabric test), DC (scalable)
- `--use_cuda=<gpu>` validates the GPUDirect RDMA path end-to-end (GPU memory → NIC, no CPU bounce)
- Use alongside `ib_read_bw`, `ib_send_bw`, `ib_write_lat`, `ib_read_lat` for complete RDMA profiling
- Run before NCCL: if `ib_write_bw` hits full bandwidth but NCCL is still slow, the problem is GPU topology/config, not the network
- For multi-node, orchestrated benchmarking → migrate to DOCA perftest
