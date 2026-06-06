---
title: "NCCL Topology Dump and Tuning on Kubernetes"
description: "Use NCCL_TOPO_DUMP_FILE to export and inject GPU topology on Kubernetes for reproducible distributed training performance. Topology XML caching, environment"
tags:
  - "nccl"
  - "gpu"
  - "nvidia"
  - "distributed-training"
  - "topology"
  - "performance"
category: "ai"
publishDate: "2026-05-26"
author: "Luca Berton"
difficulty: "advanced"
relatedRecipes:
  - "nccl-pxn-cross-nic-nvlink-topology"
  - "dual-fabric-mellanox-gpu-storage-ethernet-infiniband"
  - "nvidia-gpu-operator-setup"
---

> 💡 **Quick Answer:** `NCCL_TOPO_DUMP_FILE=/path/topology.xml` makes NCCL export its auto-detected GPU/NIC/NVLink/PCIe topology to an XML file on first run, then reuses it on subsequent runs. On Kubernetes, inject a pre-generated topology file via ConfigMap to skip expensive runtime detection, ensure consistent topology across pods, and enable offline tuning of NCCL transport selection.

## The Problem

- NCCL auto-detects GPU topology at every container start — adds 10-30s to job startup
- Topology detection can produce inconsistent results in containerized environments
- Can't verify what NCCL "sees" without dumping the topology
- Multi-node jobs need matching topology awareness for optimal ring/tree algorithm selection
- Debugging slow collectives requires understanding the detected PCIe/NVLink/NIC layout

## The Solution

### Dump GPU Topology from a Node

```yaml
# One-shot Job to dump NCCL topology from a GPU node
apiVersion: batch/v1
kind: Job
metadata:
  name: nccl-topo-dump
  namespace: gpu-workloads
spec:
  template:
    spec:
      nodeSelector:
        nvidia.com/gpu.product: "NVIDIA-H100-80GB-HBM3"
      containers:
        - name: topo-dump
          image: nvcr.io/nvidia/pytorch:24.05-py3
          command:
            - bash
            - -c
            - |
              # Dump topology to file
              export NCCL_TOPO_DUMP_FILE=/output/topology.xml
              export NCCL_DEBUG=INFO
              # Run minimal NCCL operation to trigger topology detection
              python3 -c "
              import torch
              import torch.distributed as dist
              import os
              os.environ['MASTER_ADDR'] = 'localhost'
              os.environ['MASTER_PORT'] = '29500'
              os.environ['RANK'] = '0'
              os.environ['WORLD_SIZE'] = '1'
              dist.init_process_group('nccl')
              t = torch.zeros(1).cuda()
              dist.all_reduce(t)
              dist.destroy_process_group()
              "
              echo "=== Topology dumped ==="
              cat /output/topology.xml
          volumMounts:
            - name: output
              mountPath: /output
          resources:
            limits:
              nvidia.com/gpu: "8"
      volumes:
        - name: output
          hostPath:
            path: /var/lib/nccl-topology
            type: DirectoryOrCreate
      restartPolicy: Never
```

### Example Topology XML (8x H100 DGX)

```xml
<!-- Dumped by NCCL_TOPO_DUMP_FILE -->
<system version="1">
  <cpu numaid="0" affinity="0-63" arch="x86_64" vendor="GenuineIntel">
    <pci busid="0000:18:00.0" class="0x030200" vendor="0x10de" device="0x2330"
         subsystem_vendor="0x10de" subsystem_device="0x16c1" link_speed="32 GT/s" link_width="16">
      <gpu dev="0" sm="90" mem="81559" gdr="1">
        <nvlink target="0000:3b:00.0" count="18" tclass="0x030200"/>
        <nvlink target="0000:86:00.0" count="18" tclass="0x030200"/>
        <nvlink target="0000:a1:00.0" count="18" tclass="0x030200"/>
      </gpu>
    </pci>
    <pci busid="0000:3b:00.0" class="0x030200" vendor="0x10de" device="0x2330">
      <gpu dev="1" sm="90" mem="81559" gdr="1">
        <nvlink target="0000:18:00.0" count="18" tclass="0x030200"/>
        <!-- ... more NVLink connections ... -->
      </gpu>
    </pci>
    <!-- NIC close to GPU 0-3 -->
    <pci busid="0000:51:00.0" class="0x020700" vendor="0x15b3" device="0x101b">
      <nic>
        <net name="mlx5_0" port="1" gid_index="3" speed="400000" latency="0"
             guid="0x0c42a103004b3d26" maxconn="131072" gdr="1"/>
      </nic>
    </pci>
  </cpu>
  <cpu numaid="1" affinity="64-127">
    <!-- GPU 4-7 + their NICs on NUMA node 1 -->
    <!-- ... -->
  </cpu>
</system>
```

### Inject Topology via ConfigMap

```bash
# Create ConfigMap from dumped topology
kubectl create configmap nccl-topology \
  --from-file=topology.xml=/var/lib/nccl-topology/topology.xml \
  -n gpu-workloads
```

```yaml
# Training Job using pre-cached topology
apiVersion: batch/v1
kind: Job
metadata:
  name: distributed-training
  namespace: gpu-workloads
spec:
  parallelism: 4
  completions: 4
  template:
    spec:
      containers:
        - name: trainer
          image: registry.example.com/ml/trainer:v1.0
          env:
            # Load topology instead of detecting at runtime
            - name: NCCL_TOPO_DUMP_FILE
              value: "/etc/nccl/topology.xml"

            # System configuration (production-safe)
            - name: NCCL_SOCKET_IFNAME
              value: "=eth0"
            - name: NCCL_IB_HCA
              value: "=mlx5_0,mlx5_1,mlx5_2,mlx5_3"
            - name: NCCL_CROSS_NIC
              value: "0"               # Rail-optimized network
            - name: NCCL_SOCKET_NTHREADS
              value: "4"               # For 100G+ networks
            - name: NCCL_NSOCKS_PERTHREAD
              value: "4"               # 4×4=16 sockets total

            # Debugging (remove in production)
            # - name: NCCL_DEBUG
            #   value: "INFO"
            # - name: NCCL_DEBUG_SUBSYS
            #   value: "INIT,NET,GRAPH"

          volumeMounts:
            - name: topology
              mountPath: /etc/nccl
              readOnly: true
            - name: shm
              mountPath: /dev/shm
          resources:
            limits:
              nvidia.com/gpu: "8"
              rdma/rdma_shared_device_a: "1"
      volumes:
        - name: topology
          configMap:
            name: nccl-topology
        - name: shm
          emptyDir:
            medium: Memory
            sizeLimit: 64Gi
```

### Key NCCL Environment Variables Reference

```yaml
# ConfigMap with NCCL tuning for different network topologies
apiVersion: v1
kind: ConfigMap
metadata:
  name: nccl-env-config
  namespace: gpu-workloads
data:
  nccl.conf: |
    # === System Configuration (safe for production) ===

    # Network interface selection
    NCCL_SOCKET_IFNAME==eth0           # Exact interface match
    # NCCL_SOCKET_IFNAME=^docker,^veth  # Exclude docker/veth

    # InfiniBand / RDMA HCA selection
    NCCL_IB_HCA==mlx5_0,mlx5_1,mlx5_2,mlx5_3
    # NCCL_IB_HCA=^mlx5_bond0          # Exclude bonded interface

    # Multi-NIC / Rail topology
    NCCL_CROSS_NIC=0                   # 0=same rail, 1=cross-rail, 2=auto

    # Socket transport performance (100G+ networks)
    NCCL_SOCKET_NTHREADS=4             # CPU threads per connection (1-16)
    NCCL_NSOCKS_PERTHREAD=4            # Sockets per thread (max: threads×socks≤64)

    # Socket reliability
    NCCL_SOCKET_RETRY_CNT=34           # Retries on connection failure
    NCCL_SOCKET_RETRY_SLEEP_MSEC=100   # Backoff between retries

    # Topology caching
    NCCL_TOPO_DUMP_FILE=/etc/nccl/topology.xml  # Load/dump topology

    # === Debugging (REMOVE in production) ===
    # NCCL_DEBUG=INFO                  # WARN|INFO|TRACE
    # NCCL_DEBUG_SUBSYS=INIT,NET,GRAPH # Subsystems to debug
    # NCCL_DEBUG_FILE=/tmp/nccl-%h-%p.log  # Per-rank log files

    # === DO NOT use in production (may cause hangs/perf issues) ===
    # NCCL_ALGO=Ring                   # Force algorithm (Ring|Tree|CollnetDirect)
    # NCCL_PROTO=Simple                # Force protocol (LL|LL128|Simple)
    # NCCL_P2P_DISABLE=1              # Disable GPU peer-to-peer
    # NCCL_SHM_DISABLE=1              # Disable shared memory transport
    # NCCL_NET_GDR_LEVEL=5            # Force GPUDirect RDMA level
```

### Topology-Aware Scheduling

```yaml
# Ensure training pods land on nodes with matching topology
apiVersion: v1
kind: Pod
metadata:
  name: nccl-worker
  labels:
    nccl-topology: "dgx-h100-8gpu"
spec:
  nodeSelector:
    nvidia.com/gpu.product: "NVIDIA-H100-80GB-HBM3"
    nvidia.com/gpu.count: "8"
  affinity:
    # Co-locate workers on same switch fabric
    podAffinity:
      preferredDuringSchedulingIgnoredDuringExecution:
        - weight: 100
          podAffinityTerm:
            labelSelector:
              matchLabels:
                job-name: distributed-training
            topologyKey: topology.kubernetes.io/zone
```

### Validate Topology Detection

```bash
# Inside a GPU pod — verify NCCL sees correct topology
export NCCL_DEBUG=INFO
export NCCL_DEBUG_SUBSYS=INIT,GRAPH

# Run NCCL test
/usr/local/bin/all_reduce_perf -b 8 -e 128M -f 2 -g 8 2>&1 | grep -E "NCCL|Topo|Ring|Tree"

# Expected output shows:
# NCCL INFO Topology detection: found 8 GPUs, 4 NICs, 2 NUMA nodes
# NCCL INFO Channel 00/08 : 0 1 2 3 4 5 6 7    ← ring order
# NCCL INFO Trees [0] 1/-1/-1->0->-1 ...        ← tree structure
# NCCL INFO Using network IB                     ← transport selected

# Compare with topology file
cat /etc/nccl/topology.xml | grep -E "gpu dev|nvlink|net name"
```

### Per-Node Topology with DaemonSet

```yaml
# Generate topology on every GPU node and store locally
apiVersion: apps/v1
kind: DaemonSet
metadata:
  name: nccl-topo-generator
  namespace: gpu-workloads
spec:
  selector:
    matchLabels:
      app: nccl-topo-gen
  template:
    metadata:
      labels:
        app: nccl-topo-gen
    spec:
      nodeSelector:
        nvidia.com/gpu.present: "true"
      initContainers:
        - name: gen-topo
          image: nvcr.io/nvidia/pytorch:24.05-py3
          command:
            - bash
            - -c
            - |
              if [ ! -f /topo/topology.xml ]; then
                export NCCL_TOPO_DUMP_FILE=/topo/topology.xml
                python3 -c "
              import torch, os
              os.environ.update({'MASTER_ADDR':'localhost','MASTER_PORT':'29500','RANK':'0','WORLD_SIZE':'1'})
              import torch.distributed as dist
              dist.init_process_group('nccl')
              torch.zeros(1).cuda()
              dist.all_reduce(torch.zeros(1).cuda())
              dist.destroy_process_group()
              "
                echo 'Topology generated'
              else
                echo 'Topology already exists'
              fi
          volumeMounts:
            - name: topo
              mountPath: /topo
          resources:
            limits:
              nvidia.com/gpu: "1"    # Only need 1 GPU to detect topology
      containers:
        - name: pause
          image: registry.k8s.io/pause:3.9
          volumeMounts:
            - name: topo
              mountPath: /topo
      volumes:
        - name: topo
          hostPath:
            path: /var/lib/nccl-topology
            type: DirectoryOrCreate
```

### System-Wide Configuration with /etc/nccl.conf

```yaml
# MachineConfig (OpenShift) to set NCCL defaults on all GPU nodes
apiVersion: machineconfiguration.openshift.io/v1
kind: MachineConfig
metadata:
  name: 99-nccl-config
  labels:
    machineconfiguration.openshift.io/role: gpu-worker
spec:
  config:
    ignition:
      version: 3.4.0
    storage:
      files:
        - path: /etc/nccl.conf
          mode: 0644
          contents:
            source: data:text/plain;charset=utf-8;base64,IyBOQ0NMIFByb2R1Y3Rpb24gQ29uZmlnCk5DQ0xfU09DS0VUX0lGTkFNRT09ZXRoMApOQ0NMX0lCX0hDQT09bWx4NV8wLG1seDVfMSxtbHg1XzIsbWx4NV8zCk5DQ0xfQ1JPU1NfTklDPTAKTkNDTF9TT0NLRVRfTlRIUkVBRFM9NApOQ0NMX05TT0NLU19QRVJUSFJFQUQ9NAo=
            # Decoded:
            # # NCCL Production Config
            # NCCL_SOCKET_IFNAME==eth0
            # NCCL_IB_HCA==mlx5_0,mlx5_1,mlx5_2,mlx5_3
            # NCCL_CROSS_NIC=0
            # NCCL_SOCKET_NTHREADS=4
            # NCCL_NSOCKS_PERTHREAD=4
```

## Common Issues

### Topology mismatch across nodes (different GPU/NIC layout)
- **Cause**: Heterogeneous hardware — different PCIe slot assignments per server model
- **Fix**: Generate per-node topology (DaemonSet approach); or ensure homogeneous hardware

### NCCL hangs during init with injected topology
- **Cause**: Topology XML references NICs/GPUs not present in pod (device plugin allocation)
- **Fix**: Ensure all GPUs and NICs in topology.xml are allocated to the pod

### Slow all_reduce despite correct topology
- **Cause**: NCCL_CROSS_NIC=1 on rail-optimized network (traffic crosses switches)
- **Fix**: Set `NCCL_CROSS_NIC=0` for rail-optimized fabrics; verify with `NCCL_DEBUG=INFO`

### "NET/IB: no RDMA device found" after topology injection
- **Cause**: RDMA device not exposed to container (missing device plugin or SR-IOV VF)
- **Fix**: Verify `rdma/rdma_shared_device_a` in resource limits; check device plugin pods

## Best Practices

1. **Dump topology once per node type** — cache as ConfigMap or hostPath
2. **Never use NCCL_ALGO/NCCL_PROTO in production** — these override NCCL's optimized auto-selection
3. **Match NCCL_CROSS_NIC to your fabric** — 0 for rail-optimized, 1 for fat-tree
4. **NCCL_SOCKET_NTHREADS × NCCL_NSOCKS_PERTHREAD ≤ 64** — hard limit
5. **Use /etc/nccl.conf for cluster-wide defaults** — avoids per-job env var sprawl
6. **Remove NCCL_DEBUG in production** — verbose logging causes 5-15% performance overhead
7. **Validate with nccl-tests** — run `all_reduce_perf` after any topology/config change
8. **Homogeneous nodes** — same GPU model + NIC placement = one topology file for all

## Key Takeaways

- `NCCL_TOPO_DUMP_FILE` exports GPU/NIC/NVLink/PCIe topology to XML on first run, loads on subsequent runs
- Inject pre-generated topology via ConfigMap to skip 10-30s runtime detection and ensure consistency
- Two categories of NCCL vars: system config (safe for production) vs debugging (remove after use)
- `NCCL_CROSS_NIC=0` for rail-optimized networks (one switch per NIC); `=1` for fat-tree
- `NCCL_IB_HCA` selects specific RDMA NICs; `NCCL_SOCKET_IFNAME` selects TCP interfaces
- `/etc/nccl.conf` sets system-wide defaults (MachineConfig on OpenShift)
- Topology XML contains full PCIe tree: GPU positions, NVLink counts, NIC placement, NUMA affinity
- Always validate with `all_reduce_perf` after topology or env var changes
