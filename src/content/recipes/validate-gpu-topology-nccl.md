---
title: "Validate GPU & NIC Topology Before NCCL Ben..."
description: "Inspect node-level GPU, NIC, and PCI topology on Kubernetes workers to predict and explain NCCL benchmark performance before running tests."
category: "troubleshooting"
difficulty: "intermediate"
timeToComplete: "15 minutes"
kubernetesVersion: "1.28+"
prerequisites:
  - "Access to GPU workload pods"
  - "nvidia-smi and lspci available"
relatedRecipes:
  - "nccl-p2p-latency-diagnostics"
  - "nccl-allreduce-benchmark-profile"
  - "run-nccl-tests-kubernetes"
tags:
  - nccl
  - topology
  - pci
  - gpu
  - troubleshooting
publishDate: "2026-02-17"
author: "Luca Berton"
---

> 💡 **Quick Answer:** Run `nvidia-smi topo -m` and `lspci` mapping checks first; poor physical topology often explains low NCCL bandwidth without any software bug.


Topology awareness prevents false conclusions during NCCL troubleshooting.

## Commands to Run

```bash
nvidia-smi topo -m
lspci | grep -Ei 'NVIDIA|Mellanox|Ethernet|Infiniband'
```

## What to Confirm

- GPUs used by your pod are local to the expected PCI root complex.
- High-speed NICs are attached to suitable CPU/PCI paths.
- Node hardware is homogeneous across benchmark participants.

## Practical Outcome

Use topology results to define realistic performance targets for intra-node and inter-node NCCL tests.

## Validate GPU Topology for NCCL

Verify GPU topology and NVLink connectivity before running distributed training to ensure optimal NCCL performance.

### Check GPU Topology

```bash
# Run nvidia-smi topo in a K8s pod
kubectl exec -it gpu-worker -- nvidia-smi topo -m

# Expected output for 8×H100 with NVSwitch:
#        GPU0 GPU1 GPU2 GPU3 GPU4 GPU5 GPU6 GPU7
# GPU0    X   NV18 NV18 NV18 NV18 NV18 NV18 NV18
# GPU1   NV18  X   NV18 NV18 NV18 NV18 NV18 NV18
# ...
# NV18 = NVLink (18 links, full mesh via NVSwitch)
# SYS  = PCIe + QPI (cross-socket, worst case)
# PHB  = PCIe (same host bridge)
```

### Validate NVLink Bandwidth

```yaml
apiVersion: batch/v1
kind: Job
metadata:
  name: nvlink-bandwidth-test
spec:
  template:
    spec:
      containers:
      - name: test
        image: nvcr.io/nvidia/pytorch:25.11-py3
        command: ["bash", "-c"]
        args:
        - |
          # P2P bandwidth test between all GPU pairs
          /usr/local/cuda/extras/demo_suite/p2pBandwidthLatencyTest

          # NCCL all_reduce test (measures collective bandwidth)
          cd /opt/nccl-tests && ./build/all_reduce_perf -b 1M -e 1G -f 2 -g 8
        resources:
          limits:
            nvidia.com/gpu: 8
      restartPolicy: Never
```

### Interpret NCCL Test Results

```bash
# Good result (H100 NVSwitch): ~450 GB/s bus bandwidth
#  size    time   algbw   busbw
# 1073741824  2.56  419.43  733.00

# Bad result (PCIe fallback): ~25 GB/s
# Check: is NVLink actually connected? Run nvidia-smi nvlink -s
kubectl exec gpu-worker -- nvidia-smi nvlink -s
```

### Topology Validation DaemonSet

```yaml
apiVersion: apps/v1
kind: DaemonSet
metadata:
  name: gpu-topology-validator
spec:
  selector:
    matchLabels:
      app: gpu-topology-validator
  template:
    spec:
      nodeSelector:
        nvidia.com/gpu.present: "true"
      containers:
      - name: validator
        image: nvcr.io/nvidia/pytorch:25.11-py3
        command: ["bash", "-c"]
        args:
        - |
          TOPO=$(nvidia-smi topo -m)
          if echo "$TOPO" | grep -q "SYS"; then
            echo "WARNING: Cross-socket GPU communication detected"
            echo "$TOPO"
            exit 1
          fi
          echo "GPU topology OK — all NVLink connected"
          sleep infinity
        resources:
          limits:
            nvidia.com/gpu: 1
```
