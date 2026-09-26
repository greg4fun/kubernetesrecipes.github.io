---
title: "NCCL Environment Variables Complete Reference"
description: "NCCL environment variables reference for Kubernetes: NCCL_SOCKET_IFNAME, NCCL_IB_HCA, GID index, GDR level, socket tuning, algorithms, and NCCL_DEBUG."
tags:
  - "nccl"
  - "gpu"
  - "rdma"
  - "infiniband"
  - "distributed-training"
  - "environment-variables"
category: "ai"
publishDate: "2026-06-01"
author: "Luca Berton"
difficulty: "advanced"
relatedRecipes:
  - "tune-nccl-env-rdma-ethernet"
  - "nccl-socket-ifname-environment-variable"
  - "nccl-ib-disable-environment-variable"
  - "nccl-gdr-level-tuning-pix-pxb-phb-sys"
  - "nccl-debug-subsystems-gpu-troubleshooting"
  - "run-nccl-tests-kubernetes"
  - "nccl-rccl-networking-performance-kubernetes"
  - "nccl-topology-dump-tuning-kubernetes"
  - "nccl-pxn-cross-nic-nvlink-topology"
  - "gpudirect-storage-gds-kubernetes"
---

> 💡 **Quick Answer:** NCCL environment variables control network transport selection, InfiniBand configuration, GPUDirect RDMA, TCP socket tuning, algorithm selection, and debugging output. Set them in your Pod spec `env` section. Key variables: `NCCL_SOCKET_IFNAME` (network interface), `NCCL_IB_HCA` (IB devices), `NCCL_NET_GDR_LEVEL` (GPUDirect RDMA), `NCCL_DEBUG` (logging), `NCCL_IB_DISABLE` (disable IB).
>
> **To force InfiniBand/RoCE with GPUDirect RDMA** (and fail fast instead of silently falling back to TCP), see [NCCL env vars: force InfiniBand/RoCE and GDR](/recipes/configuration/tune-nccl-env-rdma-ethernet/).

## The Problem

- NCCL has 50+ environment variables with no single reference page
- Wrong network configuration silently degrades performance by 10-100x
- Debugging distributed training failures requires knowing which debug variables to set
- Kubernetes pods need explicit env vars — NCCL can't auto-detect across containers
- InfiniBand, RoCE, and TCP each need different tuning variables

## The Solution

### Network Interface Selection

```yaml
env:
  # NCCL_SOCKET_IFNAME — Select network interface for TCP/socket communication
  # Prefix with = for exact match, ^ for exclusion
  # Used for bootstrap/out-of-band traffic and for the Socket transport.
  # It does NOT pick the RDMA devices when IB/RoCE is used — NCCL_IB_HCA does.
  - name: NCCL_SOCKET_IFNAME
    value: "=eth0"           # Use exactly eth0
    # value: "eth"           # Any interface starting with "eth"
    # value: "^docker0,lo"   # Exclude docker0 and loopback
    # value: "=ib0"          # Use InfiniBand interface

  # NCCL_NET — Force network transport type
  - name: NCCL_NET
    value: "IB"              # Force InfiniBand (IB | Socket)
    # value: "Socket"        # Force TCP sockets (disable IB/RDMA)
```

### InfiniBand Configuration

```yaml
env:
  # NCCL_IB_DISABLE — Completely disable InfiniBand
  - name: NCCL_IB_DISABLE
    value: "0"               # 0=enable (default), 1=disable IB entirely
    # Set to "1" to force TCP even when IB is available

  # NCCL_IB_HCA — Select specific InfiniBand HCA devices
  - name: NCCL_IB_HCA
    value: "=mlx5_0,mlx5_1,mlx5_2,mlx5_3"
    # = prefix: exact device names
    # ^ prefix: exclude devices
    # No prefix: match prefix (mlx5 matches all mlx5_*)
    # value: "^mlx5_bond0"   # Exclude bonded device

  # NCCL_IB_GID_INDEX — GID index for RoCE v2
  - name: NCCL_IB_GID_INDEX
    value: "3"               # Often 3 for RoCE v2 (IPv4) — VERIFY with show_gids
    # Typical mlx5 layout with one IPv4 address (not guaranteed):
    # 0 = RoCE v1 link-local, 1 = RoCE v2 link-local,
    # 2 = RoCE v1 IPv4,       3 = RoCE v2 IPv4
    # Native InfiniBand ignores this. NCCL 2.21+ auto-selects a RoCE v2
    # GID when unset (tune with NCCL_IB_ROCE_VERSION_NUM / NCCL_IB_ADDR_FAMILY)

  # NCCL_IB_TIMEOUT — IB transport timeout
  - name: NCCL_IB_TIMEOUT
    value: "23"              # Timeout = 4.096µs × 2^value
    # 20 = ~4.3s (default in recent NCCL; older releases used 18 or 14 = ~67ms)
    # 22 = ~17s
    # 23 = ~34s (recommended for large clusters)

  # NCCL_IB_RETRY_CNT — IB retry count
  - name: NCCL_IB_RETRY_CNT
    value: "7"               # Max retries (default: 7, max: 7)

  # NCCL_IB_SL — InfiniBand Service Level (QoS)
  - name: NCCL_IB_SL
    value: "0"               # Service Level 0-15 (maps to VL)

  # NCCL_IB_TC — Traffic Class (for DSCP/ECN marking)
  - name: NCCL_IB_TC
    value: "106"             # Traffic class value
    # 106 = DSCP 26 (AF31) — common for GPU traffic with PFC

  # NCCL_IB_QPS_PER_CONNECTION — Queue Pairs per connection
  - name: NCCL_IB_QPS_PER_CONNECTION
    value: "4"               # Default: 1. Higher = more IB bandwidth per peer

  # NCCL_IB_ADAPTIVE_ROUTING — Enable IB adaptive routing
  - name: NCCL_IB_ADAPTIVE_ROUTING
    value: "1"               # Default: 1 on InfiniBand, 0 on RoCE (requires switch support)

  # NCCL_IB_AR_THRESHOLD — Adaptive routing message size threshold
  - name: NCCL_IB_AR_THRESHOLD
    value: "8192"            # Only use AR for messages > this size (bytes)
```

### GPUDirect RDMA

```yaml
env:
  # NCCL_NET_GDR_LEVEL — GPUDirect RDMA topology level
  - name: NCCL_NET_GDR_LEVEL
    value: "PHB"
    # Max GPU<->NIC topology distance at which GDR is used (string form preferred):
    # LOC  = never use GDR
    # PIX  = same PCIe switch
    # PXB  = across multiple PCIe switches (no CPU root complex hop)
    # PHB  = same PCIe host bridge / CPU socket
    # NODE = same NUMA node, across host bridges
    # SYS  = anywhere, including across the SMP interconnect (cross-socket)
    # Legacy integers: 0=LOC 1=PIX 2=PXB 3=PHB 4=SYS

  # NCCL_NET_GDR_READ — Enable GPUDirect RDMA for read operations
  - name: NCCL_NET_GDR_READ
    value: "1"               # 0=disable, 1=enable
    # Allows NIC to read directly from GPU memory
    # GDR needs nvidia_peermem, or DMA-BUF (NCCL 2.19+, kernel 5.12+, open GPU driver)

  # NCCL_P2P_DISABLE — Disable PCIe peer-to-peer
  - name: NCCL_P2P_DISABLE
    value: "0"               # 0=enable P2P (default), 1=disable
    # Disable if seeing GPU errors on some PCIe topologies

  # NCCL_P2P_LEVEL — PCIe P2P topology level
  - name: NCCL_P2P_LEVEL
    value: "SYS"             # LOC | NVL | PIX | PXB | PHB | SYS
    # Max distance for intra-node GPU-to-GPU P2P (NVL = NVLink only)

  # NCCL_SHM_DISABLE — Disable shared memory transport
  - name: NCCL_SHM_DISABLE
    value: "0"               # 0=enable (default), 1=disable
    # SHM used for intra-node when P2P not available
```

### TCP/Socket Tuning

```yaml
env:
  # NCCL_SOCKET_NTHREADS — Number of threads per socket connection
  - name: NCCL_SOCKET_NTHREADS
    value: "4"               # Default: 1. Range: 1-16
    # More threads = higher TCP bandwidth (at CPU cost)

  # NCCL_NSOCKS_PERTHREAD — Sockets per thread
  - name: NCCL_NSOCKS_PERTHREAD
    value: "4"               # Default: 1. Range: 1-16
    # Total sockets = NTHREADS × NSOCKS_PERTHREAD (max 64)
    # 4 × 4 = 16 sockets per peer connection

  # NCCL_BUFFSIZE — Communication buffer size
  - name: NCCL_BUFFSIZE
    value: "8388608"         # 8MB (default: 4MB)
    # Larger = better bandwidth for large messages
    # Uses GPU memory, so don't set too high

  # NCCL_SOCKET_FAMILY — IP version for socket connections
  - name: NCCL_SOCKET_FAMILY
    value: "AF_INET"         # AF_INET (IPv4) or AF_INET6 (IPv6)
```

### Algorithm and Protocol Selection

```yaml
env:
  # NCCL_ALGO — Collective algorithm (usually let NCCL auto-select)
  - name: NCCL_ALGO
    value: "Ring,Tree"       # Comma-separated allowed algorithms
    # Ring — good for large messages, predictable bandwidth
    # Tree — good for small messages, lower latency
    # CollnetDirect — InfiniBand SHARP (requires switch support)
    # CollnetChain — InfiniBand SHARP chained
    # NVLS — NVLink SHARP (H100+ NVSwitch)
    # ⚠️ Usually best to NOT set this (auto-select is optimal)

  # NCCL_PROTO — Wire protocol
  - name: NCCL_PROTO
    value: "Simple,LL,LL128" # Comma-separated allowed protocols
    # LL — Low Latency (8-byte packets, good for <256KB)
    # LL128 — Low Latency 128-byte (good for <1MB)
    # Simple — High bandwidth (good for >1MB)
    # ⚠️ Usually best to NOT set this

  # NCCL_MIN_NCHANNELS — Minimum communication channels
  - name: NCCL_MIN_NCHANNELS
    value: "4"               # Default varies by GPU
    # More channels = more parallelism = more GPU memory

  # NCCL_MAX_NCHANNELS — Maximum communication channels
  - name: NCCL_MAX_NCHANNELS
    value: "32"              # Default varies by GPU arch and NCCL version

  # NCCL_NTHREADS — GPU threads per channel
  - name: NCCL_NTHREADS
    value: "512"             # Default: 512. Allowed: 64, 128, 256, 512
    # Higher = more GPU resources for communication

  # NCCL_CROSS_NIC — Allow cross-NIC (non-rail) communication
  - name: NCCL_CROSS_NIC
    value: "0"               # 0=same rail only, 1=cross-NIC allowed, 2=auto
    # Rail-optimized networks: set to 0
    # Full-mesh networks: set to 1 or 2
```

### Topology and Tuning

```yaml
env:
  # NCCL_TOPO_FILE — Custom topology XML file
  - name: NCCL_TOPO_FILE
    value: "/etc/nccl/topo.xml"
    # Override auto-detected topology
    # Useful when running in containers with limited /sys access

  # NCCL_TOPO_DUMP_FILE — Dump detected topology to file
  - name: NCCL_TOPO_DUMP_FILE
    value: "/tmp/nccl-topo.xml"
    # Saves detected topology on first run
    # Use as NCCL_TOPO_FILE for subsequent runs (skips detection)

  # NCCL_GRAPH_FILE — Communication graph file
  - name: NCCL_GRAPH_FILE
    value: "/etc/nccl/graph.xml"
    # Custom channel/ring configuration

  # NCCL_GRAPH_DUMP_FILE — Dump communication graph
  - name: NCCL_GRAPH_DUMP_FILE
    value: "/tmp/nccl-graph.xml"

  # NCCL_COLLNET_ENABLE — Enable collective network offload (SHARP)
  - name: NCCL_COLLNET_ENABLE
    value: "0"               # 0=disable (default), 1=enable
    # Requires InfiniBand SHARP support on switches

  # NCCL_LAUNCH_MODE — Process launch mode
  - name: NCCL_LAUNCH_MODE
    value: "PARALLEL"        # PARALLEL (default) | GROUP
    # Only matters when one process drives several GPUs; leave default
```

### Debugging and Logging

```yaml
env:
  # NCCL_DEBUG — Debug output verbosity
  - name: NCCL_DEBUG
    value: "INFO"
    # WARN — warnings only (production)
    # INFO — initialization + transport selection
    # TRACE — all operations (very verbose, impacts performance)
    # VERSION — just print NCCL version

  # NCCL_DEBUG_SUBSYS — Filter debug by subsystem
  - name: NCCL_DEBUG_SUBSYS
    value: "INIT,NET,GRAPH"
    # INIT — initialization
    # NET — network operations
    # GRAPH — topology graph
    # COLL — collectives
    # P2P — peer-to-peer
    # SHM — shared memory
    # NVLS — NVLink SHARP
    # ALL — everything

  # NCCL_DEBUG_FILE — Redirect debug to file (per-rank)
  - name: NCCL_DEBUG_FILE
    value: "/tmp/nccl-debug-%h-%p.log"
    # %h = hostname, %p = PID
    # Useful for multi-GPU debugging without interleaved output
```

### Complete Pod Example

```yaml
apiVersion: v1
kind: Pod
metadata:
  name: distributed-training
  namespace: ml-workloads
spec:
  hostNetwork: true
  dnsPolicy: ClusterFirstWithHostNet
  containers:
    - name: trainer
      image: nvcr.io/nvidia/pytorch:24.05-py3
      env:
        # === Network Selection ===
        - name: NCCL_SOCKET_IFNAME
          value: "=eth0"
        - name: NCCL_NET
          value: "IB"
        - name: NCCL_IB_DISABLE
          value: "0"

        # === InfiniBand ===
        - name: NCCL_IB_HCA
          value: "=mlx5_0,mlx5_1,mlx5_2,mlx5_3"
        - name: NCCL_IB_GID_INDEX
          value: "3"
        - name: NCCL_IB_TIMEOUT
          value: "23"
        - name: NCCL_IB_RETRY_CNT
          value: "7"
        - name: NCCL_IB_QPS_PER_CONNECTION
          value: "4"

        # === GPUDirect RDMA ===
        - name: NCCL_NET_GDR_LEVEL
          value: "PHB"
        - name: NCCL_NET_GDR_READ
          value: "1"

        # === Topology ===
        - name: NCCL_TOPO_FILE
          value: "/etc/nccl/topo.xml"
        - name: NCCL_CROSS_NIC
          value: "0"

        # === Performance ===
        - name: NCCL_BUFFSIZE
          value: "8388608"
        - name: NCCL_MIN_NCHANNELS
          value: "4"

        # === Debugging (remove in production) ===
        - name: NCCL_DEBUG
          value: "INFO"
        - name: NCCL_DEBUG_SUBSYS
          value: "INIT,NET"

      resources:
        limits:
          nvidia.com/gpu: "8"
          rdma/rdma_shared_device_a: "1"
      volumeMounts:
        - name: shm
          mountPath: /dev/shm
        - name: nccl-topo
          mountPath: /etc/nccl
  volumes:
    - name: shm
      emptyDir:
        medium: Memory
        sizeLimit: 64Gi
    - name: nccl-topo
      configMap:
        name: nccl-topology
```

### Quick Reference Table

```text
Variable                     │ Default  │ Values           │ Purpose
─────────────────────────────┼──────────┼──────────────────┼────────────────────────
NCCL_SOCKET_IFNAME           │ auto     │ =eth0, ^lo       │ Network interface
NCCL_NET                     │ auto     │ IB, Socket       │ Force transport
NCCL_IB_DISABLE              │ 0        │ 0, 1             │ Disable InfiniBand
NCCL_IB_HCA                  │ auto     │ =mlx5_0,...      │ Select IB devices
NCCL_IB_GID_INDEX            │ auto*    │ 0-N              │ RoCE GID index
NCCL_IB_TIMEOUT              │ 20       │ 1-31             │ IB timeout exponent
NCCL_IB_RETRY_CNT            │ 7        │ 0-7              │ IB retries
NCCL_IB_SL                   │ 0        │ 0-15             │ Service level
NCCL_IB_TC                   │ 0        │ 0-255            │ Traffic class
NCCL_IB_QPS_PER_CONNECTION   │ 1        │ 1-128            │ QPs per conn
NCCL_IB_ADAPTIVE_ROUTING     │ 1 IB/0 RoCE │ 0, 1          │ Adaptive routing
NCCL_NET_GDR_LEVEL           │ auto     │ LOC..SYS         │ GPUDirect RDMA distance
NCCL_NET_GDR_READ            │ 0        │ 0, 1             │ GDR read enable
NCCL_P2P_DISABLE             │ 0        │ 0, 1             │ Disable PCIe P2P
NCCL_P2P_LEVEL               │ auto     │ LOC,NVL..SYS     │ P2P topology level
NCCL_SHM_DISABLE             │ 0        │ 0, 1             │ Disable shared mem
NCCL_SOCKET_NTHREADS         │ 1        │ 1-16             │ TCP threads
NCCL_NSOCKS_PERTHREAD        │ 1        │ 1-16             │ Sockets per thread
NCCL_BUFFSIZE                │ 4194304  │ bytes            │ Buffer size
NCCL_ALGO                    │ auto     │ Ring,Tree,...     │ Algorithm
NCCL_PROTO                   │ auto     │ LL,LL128,Simple  │ Protocol
NCCL_MIN_NCHANNELS           │ varies   │ 1-32             │ Min channels
NCCL_MAX_NCHANNELS           │ varies   │ 1-32             │ Max channels
NCCL_NTHREADS                │ 512      │ 64,128,256,512   │ GPU threads/channel
NCCL_CROSS_NIC               │ 2        │ 0, 1, 2          │ Cross-NIC policy
NCCL_TOPO_FILE               │ none     │ path             │ Topology XML
NCCL_TOPO_DUMP_FILE          │ none     │ path             │ Dump topology
NCCL_COLLNET_ENABLE          │ 0        │ 0, 1             │ SHARP offload
NCCL_DEBUG                   │ WARN     │ WARN,INFO,TRACE  │ Log level
NCCL_DEBUG_SUBSYS            │ INIT,BOOTSTRAP,ENV │ INIT,NET,... │ Log filter
NCCL_DEBUG_FILE              │ stderr   │ path (%h,%p)     │ Log file
─────────────────────────────┴──────────┴──────────────────┴────────────────────────
* NCCL 2.21+ auto-selects a RoCE v2 GID; older versions default to 0.
```

## Common Issues

### NCCL_IB_DISABLE=1 but performance is bad
- **Cause**: Forcing TCP when IB hardware is available
- **Fix**: Only disable IB if hardware is broken; set `NCCL_SOCKET_NTHREADS=8` and `NCCL_NSOCKS_PERTHREAD=4` for TCP

### "Invalid argument" on modprobe nvidia_peermem
- **Cause**: Driver version mismatch between nvidia.ko and nvidia_peermem.ko
- **Fix**: Ensure GPU Operator installs matching driver + peermem versions and that MOFED/`ib_core` loads first; check `dmesg`. With NCCL 2.19+ and the open kernel driver, DMA-BUF GDR avoids nvidia_peermem entirely

### NCCL_NET_GDR_LEVEL set but GDR not active
- **Cause**: `nvidia_peermem` module not loaded, or NIC not RDMA-capable
- **Fix**: Verify `lsmod | grep nvidia_peermem`; check `ibv_devinfo` shows active port

### NCCL_SOCKET_IFNAME wrong interface selected
- **Cause**: Multiple interfaces match prefix pattern
- **Fix**: Use `=` prefix for exact match: `NCCL_SOCKET_IFNAME==eth0`

### High latency despite IB being enabled
- **Cause**: `NCCL_IB_GID_INDEX` wrong for RoCE setup (using IB native on RoCE fabric)
- **Fix**: Point `NCCL_IB_GID_INDEX` at the RoCE v2 IPv4 GID; list them with `show_gids` (MOFED) or `ibv_devinfo -d mlx5_0 -v | grep GID`

## Frequently Asked Questions

### Does NCCL_SOCKET_IFNAME control InfiniBand or only TCP sockets?
Only IP interfaces. NCCL uses it for bootstrap/out-of-band connections and for the Socket transport. When the IB/RoCE transport is active, data flows over the HCAs chosen by `NCCL_IB_HCA`; `NCCL_SOCKET_IFNAME` still has to point at a reachable interface for bootstrap.

### What is the difference between NCCL_IB_HCA and NCCL_SOCKET_IFNAME?
`NCCL_IB_HCA` selects RDMA devices by verbs name (`mlx5_0`, optionally `:port`) for the IB/RoCE data path. `NCCL_SOCKET_IFNAME` selects Linux network interfaces by name (`eth0`, `net1`) for bootstrap and TCP. On Kubernetes with Multus/SR-IOV, the pod's `net1..netN` interfaces map to the HCAs you pass in `NCCL_IB_HCA`.

### How do I force NCCL to use InfiniBand instead of TCP?
Set `NCCL_IB_DISABLE=0`, `NCCL_NET=IB`, and `NCCL_IB_HCA` to the right devices; `NCCL_NET=IB` makes NCCL fail instead of silently falling back to sockets. The full recipe, including RoCE GID and GDR checks, is in [NCCL env vars: force InfiniBand/RoCE and GDR](/recipes/configuration/tune-nccl-env-rdma-ethernet/).

### How do I see which NCCL environment variables are in effect?
Run with `NCCL_DEBUG=INFO` (and `NCCL_DEBUG_SUBSYS=INIT,ENV,NET`). NCCL logs each `NCCL_*` variable it read and the transport chosen, e.g. `NET/IB : Using [0]mlx5_0:1/RoCE` versus `NET/Socket`.

## Best Practices

1. **Don't set NCCL_ALGO/NCCL_PROTO** — auto-selection is correct 95% of the time
2. **Always set NCCL_SOCKET_IFNAME** — Kubernetes pods may have multiple interfaces
3. **Use NCCL_TOPO_FILE when auto-detection is wrong** — VMs or containers with a restricted `/sys` can hide the real PCIe/NUMA layout
4. **Set NCCL_DEBUG=INFO for initial runs** — verify transport selection, then reduce to WARN
5. **NCCL_IB_TIMEOUT=23 for large clusters** — prevents spurious timeout failures
6. **NCCL_CROSS_NIC=0 for rail-optimized networks** — avoids suboptimal cross-switch paths
7. **Match NCCL_IB_HCA to GPU affinity** — ensure each GPU uses its nearest NIC
8. **NCCL_BUFFSIZE=8388608 for large models** — improves bandwidth for multi-GB transfers
9. **Use NCCL_DEBUG_FILE in multi-GPU jobs** — prevents interleaved log output
10. **Test changes with nccl-tests** — measure `all_reduce_perf` before and after tuning

## Key Takeaways

- NCCL environment variables control all aspects of GPU collective communication
- `NCCL_IB_DISABLE=1` forces TCP — 5-10x slower than IB/RDMA (use only for debugging)
- `NCCL_NET_GDR_LEVEL=SYS` + `NCCL_NET_GDR_READ=1` allows GPUDirect RDMA at any topology distance (use `PHB` to keep it socket-local)
- `NCCL_IB_GID_INDEX` must point at the RoCE v2 GID (often 3) — wrong index = connection failure or RoCE v1 traffic
- TCP tuning: `NCCL_SOCKET_NTHREADS × NCCL_NSOCKS_PERTHREAD` = total sockets (max 64)
- `NCCL_TOPO_FILE` fixes wrong topology detection in VMs and restricted containers
- `NCCL_DEBUG=INFO` + `NCCL_DEBUG_SUBSYS=INIT,NET` shows transport selection without noise
- Don't manually set algorithms/protocols unless benchmarking proves improvement
- All variables set via Pod `env` section — no config files needed
