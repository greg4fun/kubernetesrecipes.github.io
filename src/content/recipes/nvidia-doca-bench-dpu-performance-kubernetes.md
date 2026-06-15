---
title: "NVIDIA DOCA Bench for DPU Performance Testing on Kubernetes"
description: "Use NVIDIA DOCA Bench to benchmark BlueField DPU accelerators in Kubernetes GPU clusters. Covers throughput and latency modes, pipeline configuration, multi-core scaling, RDMA benchmarks, compression offload, and DPU-accelerated networking validation for AI infrastructure."
tags:
  - "networking"
  - "performance"
  - "rdma"
  - "nvidia"
  - "benchmarking"
category: "networking"
publishDate: "2026-06-15"
author: "Luca Berton"
difficulty: "advanced"
relatedRecipes:
  - "nvidia-doca-telemetry-network-monitoring"
  - "nccl-all-reduce-perf-benchmark-multi-node"
  - "nvidia-network-operator-rdma-kubernetes"
---

> 💡 **Quick Answer:** DOCA Bench is NVIDIA's unified benchmarking tool for BlueField DPU/SuperNIC accelerators. It measures throughput (operations/s, Gib/s) and latency (precision or bulk mode) across DPU-offloaded operations: RDMA, compression, DMA, SHA, AES-GCM encryption, and Ethernet. Run it from x86 hosts targeting BlueField over PCIe, or on BlueField Arm cores directly. Essential for validating DPU performance in Kubernetes AI infrastructure before production deployment.

## The Problem

- BlueField DPUs offload networking, storage, and security — but how fast are they in YOUR environment?
- Need to validate DPU throughput before deploying AI training workloads
- PCIe placement, NUMA distance, and core isolation all affect DPU performance
- Must benchmark individual DPU features (RDMA, compression, encryption) independently
- No standardized tool existed for testing all BlueField accelerators in a unified way

## The Solution

### What DOCA Bench Tests

```text
Feature                │ Operations                    │ Use Case in K8s
───────────────────────┼───────────────────────────────┼──────────────────────────────
doca_rdma              │ send / receive                │ GPUDirect RDMA for NCCL
doca_compress          │ compress / decompress         │ Storage compression offload
doca_dma               │ host ↔ BlueField memory       │ Zero-copy data movement
doca_sha               │ SHA hash generation           │ Data integrity verification
doca_aes_gcm           │ encrypt / decrypt             │ IPsec / storage encryption
doca_ec                │ create / recover / update     │ Erasure coding (storage)
doca_eth               │ rx / tx                       │ Raw Ethernet throughput
doca_comch             │ client producer / consumer    │ DPU ↔ host communication
───────────────────────┴───────────────────────────────┴──────────────────────────────
```

### Running DOCA Bench on Kubernetes Nodes

```bash
# DOCA Bench is installed at /opt/mellanox/doca/tools on hosts with DOCA SDK
# Run from a privileged debug pod or directly on the node

# Basic throughput test — RDMA send
/opt/mellanox/doca/tools/doca_bench \
  --device mlx5_0 \
  --pipeline "doca_rdma::send" \
  --duration 30 \
  --core-list 1-4 \
  --threads-per-core 1

# Basic throughput test — compression
/opt/mellanox/doca/tools/doca_bench \
  --device mlx5_0 \
  --pipeline "doca_compress::compress" \
  --duration 30 \
  --core-list 1-4 \
  --buffer-size 64K
```

### Throughput Mode

```bash
# Measure maximum operations per second
/opt/mellanox/doca/tools/doca_bench \
  --device mlx5_0 \
  --pipeline "doca_rdma::send" \
  --mode throughput \
  --duration 10 \
  --core-list 2-5 \
  --threads-per-core 2

# Expected output:
# Aggregate stats
#     Duration:      10000123 micro seconds
#     Enqueued jobs: 57135128
#     Dequeued jobs: 57135128
#     Throughput:    5712042 Operations/s
#     Ingress rate:  063.832 Gib/s
#     Egress rate:   063.832 Gib/s
```

### Latency Mode — Precision

```bash
# Measure minimum single-operation latency
/opt/mellanox/doca/tools/doca_bench \
  --device mlx5_0 \
  --pipeline "doca_dma" \
  --mode precision-latency \
  --duration 10 \
  --core-list 2 \
  --buffer-size 4K

# Expected output:
# Aggregate stats
#     min:           1878 ns
#     max:           4956 ns
#     median:        2134 ns
#     mean:          2145 ns
#     90th %ile:     2243 ns
#     95th %ile:     2285 ns
#     99th %ile:     2465 ns
#     99.9th %ile:   3193 ns
#     99.99th %ile:  4487 ns
```

### Latency Mode — Bulk

```bash
# Measure latency distribution at full throughput
/opt/mellanox/doca/tools/doca_bench \
  --device mlx5_0 \
  --pipeline "doca_compress::compress" \
  --mode bulk-latency \
  --duration 10 \
  --core-list 2-5 \
  --latency-bucket-range 10us,100us \
  --buffer-size 64K

# Output: histogram showing latency distribution
# [25000ns -> 25999ns]: 0
# [26000ns -> 26999ns]: 0
# [27000ns -> 27999ns]: 128
# [28000ns -> 28999ns]: 2176
# [29000ns -> 29999ns]: 1152
# [30000ns -> 30999ns]: 128
```

### Pipeline Composition

```bash
# DOCA Bench supports multi-step pipelines (serial processing)

# Example: Compress then encrypt
/opt/mellanox/doca/tools/doca_bench \
  --device mlx5_0 \
  --pipeline "doca_compress::compress,doca_aes_gcm::encrypt" \
  --duration 10 \
  --core-list 2-5

# Example: Receive Ethernet, compute SHA, send
/opt/mellanox/doca/tools/doca_bench \
  --device mlx5_0 \
  --pipeline "doca_eth::rx,doca_sha,doca_eth::tx" \
  --duration 10 \
  --core-list 2-9

# Pipelines run steps serially — output of step N feeds step N+1
# Measures end-to-end throughput of the complete pipeline
```

### Multi-Core Scaling

```bash
# Scale across multiple CPU cores to find saturation point
for cores in 1 2 4 8 16; do
  echo "=== Testing with $cores cores ==="
  /opt/mellanox/doca/tools/doca_bench \
    --device mlx5_0 \
    --pipeline "doca_rdma::send" \
    --duration 5 \
    --core-count $cores \
    --threads-per-core 1 \
    --output csv >> scaling_results.csv
done

# Typical scaling pattern:
# 1 core:  ~15 Gib/s
# 2 cores: ~30 Gib/s
# 4 cores: ~55 Gib/s  (approaching line rate)
# 8 cores: ~63 Gib/s  (saturated at 400G NIC limit)
```

### RDMA Benchmark with Companion App

```bash
# RDMA tests require a remote endpoint (companion app)

# On remote node (receiver):
/opt/mellanox/doca/tools/doca_bench_companion \
  --device mlx5_0 \
  --listen 0.0.0.0:5555

# On local node (sender):
/opt/mellanox/doca/tools/doca_bench \
  --device mlx5_0 \
  --pipeline "doca_rdma::send" \
  --remote 192.168.100.2:5555 \
  --duration 30 \
  --core-list 2-5 \
  --buffer-size 1M

# For BlueField Arm to Host DMA:
/opt/mellanox/doca/tools/doca_bench \
  --device 03:00.0 \
  --pipeline "doca_dma" \
  --remote-memory host \
  --duration 10
```

### Device Selection

```bash
# Target specific BlueField/ConnectX by PCIe address:
--device 03:00.0

# Or by IB device name:
--device mlx5_0

# Or by interface name:
--device ens4f0

# Query available devices and capabilities:
/opt/mellanox/doca/tools/doca_bench --query

# Shows per-device:
#   - Supported operations (compress, SHA, DMA, etc.)
#   - Hardware generation (BF2, BF3, CX8)
#   - Installed library versions
```

### Kubernetes DaemonSet for Automated Benchmarking

```yaml
apiVersion: apps/v1
kind: DaemonSet
metadata:
  name: doca-bench-validator
  namespace: gpu-infra
spec:
  selector:
    matchLabels:
      app: doca-bench
  template:
    metadata:
      labels:
        app: doca-bench
    spec:
      nodeSelector:
        nvidia.com/gpu.present: "true"
      hostNetwork: true
      hostPID: true
      containers:
        - name: doca-bench
          image: registry.example.com/doca-bench:2.9.0
          securityContext:
            privileged: true
          command:
            - /bin/bash
            - -c
            - |
              # Run throughput validation
              /opt/mellanox/doca/tools/doca_bench \
                --device mlx5_0 \
                --pipeline "doca_rdma::send" \
                --mode throughput \
                --duration 10 \
                --core-list 2-5 \
                --output csv > /results/rdma_throughput.csv

              # Run latency validation
              /opt/mellanox/doca/tools/doca_bench \
                --device mlx5_0 \
                --pipeline "doca_dma" \
                --mode precision-latency \
                --duration 10 \
                --core-list 2 > /results/dma_latency.txt

              echo "Validation complete"
              sleep infinity
          volumeMounts:
            - name: results
              mountPath: /results
            - name: dev
              mountPath: /dev
          resources:
            limits:
              openshift.io/mellanoxnics: 1
      volumes:
        - name: results
          hostPath:
            path: /var/log/doca-bench
        - name: dev
          hostPath:
            path: /dev
```

### Performance Optimization Checklist

```text
Optimization                         │ Impact     │ How
─────────────────────────────────────┼────────────┼──────────────────────────────
Avoid CPU 0                          │ High       │ --core-list 2-N (skip 0,1)
CPU/IRQ isolation                    │ High       │ isolcpus=2-N in kernel args
NUMA-local cores                     │ Critical   │ Use cores on same NUMA as NIC
Buffer sizing                        │ Medium     │ --buffer-size (match workload)
Thread count per core                │ Medium     │ --threads-per-core 1-2
Warm-up period                       │ Automatic  │ 250 jobs default warm-up
Avoid cross-NUMA memory              │ High       │ numactl --cpubind --membind
─────────────────────────────────────┴────────────┴──────────────────────────────
```

### Supported Hardware Matrix

```text
Operation             │ BlueField-2 │ BlueField-3 │ ConnectX-8 │ Remote Memory
──────────────────────┼─────────────┼─────────────┼────────────┼──────────────
doca_compress         │ ✓           │ ✓           │ —          │ In + Out
doca_decompress       │ ✓           │ ✓           │ —          │ In + Out
doca_dma              │ ✓           │ ✓           │ —          │ In + Out
doca_ec               │ —           │ ✓           │ —          │ In + Out
doca_sha              │ ✓           │ ✓           │ —          │ In only
doca_rdma             │ ✓           │ ✓           │ ✓          │ In + Out
doca_aes_gcm          │ —           │ ✓           │ ✓          │ In + Out
doca_eth              │ ✓           │ ✓           │ ✓          │ —
doca_comch            │ ✓           │ ✓           │ ✓          │ —
──────────────────────┴─────────────┴─────────────┴────────────┴──────────────
```

## Common Issues

### "Device not found" error
- **Cause**: Wrong PCIe address or device not bound to DOCA driver
- **Fix**: Run `--query` to list available devices; verify `mlx5_core` driver loaded

### Low throughput despite multiple cores
- **Cause**: Cores on different NUMA zone from BlueField PCIe slot
- **Fix**: Use `numactl --hardware` to find NUMA-local cores; update `--core-list`

### Precision latency shows high jitter
- **Cause**: OS scheduler moving processes; interrupts on test cores
- **Fix**: Enable `isolcpus`, disable irqbalance, use `--core-list` with isolated cores

### Companion app connection timeout
- **Cause**: Firewall blocking control channel (TCP port)
- **Fix**: Open the specified port; or use DOCA Comch for BF↔host communication

### "Library not installed" for specific operation
- **Cause**: Partial DOCA installation missing that library
- **Fix**: Install full `doca-all` package; run `--query` to verify

## Best Practices

1. **Always skip CPU 0** — OS and IRQ handlers live there
2. **Isolate CPU cores** — `isolcpus` kernel parameter for consistent results
3. **Stay NUMA-local** — cores and memory on same NUMA as the NIC/DPU
4. **Warm up before measuring** — DOCA Bench handles this automatically (250 jobs)
5. **Test individual operations first** — then compose pipelines
6. **Use precision latency for baseline** — bulk latency for production-like load
7. **Export CSV for tracking** — `--output csv` enables regression detection over time
8. **Run before and after cluster changes** — validates no DPU performance regression

## Key Takeaways

- DOCA Bench is the unified tool for all BlueField/ConnectX-8 accelerator benchmarks
- Two modes: throughput (max ops/s, Gib/s) and latency (precision percentiles or bulk histogram)
- Supports pipelines: chain operations (compress → encrypt → send) for real-world modeling
- Multi-core scaling reveals saturation point (typically 4-8 cores for 400G line rate)
- NUMA locality and CPU isolation are the biggest performance factors
- Remote operations (RDMA) need the companion app on the far end
- Run as part of infrastructure validation before deploying AI training workloads
- Installed at `/opt/mellanox/doca/tools/` on DOCA 2.7.0+ hosts
