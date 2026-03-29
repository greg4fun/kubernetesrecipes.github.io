---
title: "Enable GPUDirect Storage in ClusterPolicy"
description: "Enable NVIDIA GPUDirect Storage (GDS) in the GPU Operator ClusterPolicy for direct GPU-to-NVMe data paths. Driver module configuration and verification."
publishDate: "2026-03-19"
author: "Luca Berton"
category: "ai"
difficulty: "advanced"
timeToComplete: "20 minutes"
kubernetesVersion: "1.28+"
tags:
  - nvidia
  - gds
  - gpu-operator
  - clusterpolicy
  - storage
  - ai
relatedRecipes:
  - "gpu-operator-gds-module"
  - "nvidia-gpu-operator-setup"
  - "gpu-operator-clusterpolicy-reference"
  - "gds-nvme-nfs-rdma"
---

> 💡 **Quick Answer:** Enable GDS by setting `driver.manager.env` with `ENABLE_GPU_DIRECT_STORAGE=true` in your ClusterPolicy, then add `gds.enabled: true` in the GDS section. This loads the `nvidia-fs` kernel module, enabling direct data transfer between GPUs and NVMe storage, bypassing the CPU.

## The Problem

AI training workloads spending 30-40% of time waiting for data I/O from storage to GPU memory. The default path goes: NVMe → CPU → System RAM → PCIe → GPU memory. You need GPUDirect Storage (GDS) to eliminate the CPU bottleneck by transferring data directly from NVMe to GPU via DMA.

## The Solution

### Step 1: Verify Prerequisites

```bash
# Check NVIDIA driver version (GDS requires 525.60+)
oc exec -n gpu-operator $(oc get pod -n gpu-operator -l app=nvidia-driver-daemonset -o name | head -1) -- nvidia-smi --query-gpu=driver_version --format=csv,noheader
# 535.129.03 ✓

# Verify NVMe drives are available on GPU nodes
oc debug node/gpu-worker-1 -- chroot /host nvme list
```

### Step 2: Update ClusterPolicy

```yaml
apiVersion: nvidia.com/v1
kind: ClusterPolicy
metadata:
  name: cluster-policy
spec:
  driver:
    enabled: true
    version: "535.129.03"
    manager:
      env:
        - name: ENABLE_GPU_DIRECT_STORAGE
          value: "true"
  gds:
    enabled: true
    version: "v2.17.5"
    image: nvidia-fs
    repository: nvcr.io/nvidia/cloud-native
```

Apply:

```bash
oc apply -f clusterpolicy.yaml

# Or patch existing policy
oc patch clusterpolicy cluster-policy --type=merge -p '{
  "spec": {
    "driver": {
      "manager": {
        "env": [{"name": "ENABLE_GPU_DIRECT_STORAGE", "value": "true"}]
      }
    },
    "gds": {
      "enabled": true
    }
  }
}'
```

### Step 3: Verify GDS Is Active

```bash
# Check nvidia-fs module is loaded
oc debug node/gpu-worker-1 -- chroot /host lsmod | grep nvidia_fs
# nvidia_fs   282624  0

# Check GDS driver pods are running
oc get pods -n gpu-operator -l app=nvidia-gds
# nvidia-gds-xxxxx   1/1   Running   0   5m

# Verify GDS functionality
oc exec -n gpu-operator $(oc get pod -n gpu-operator -l app=nvidia-driver-daemonset -o name | head -1) -- \
  nvidia-smi --query-gpu=name,gds --format=csv
```

### Step 4: Test GDS Performance

```yaml
apiVersion: v1
kind: Pod
metadata:
  name: gds-benchmark
spec:
  containers:
    - name: benchmark
      image: nvcr.io/nvidia/cuda:12.4.0-devel-ubuntu22.04
      command: ["bash", "-c", "apt-get update && apt-get install -y gds-tools && gdscheck -p"]
      resources:
        limits:
          nvidia.com/gpu: 1
      volumeMounts:
        - name: nvme-data
          mountPath: /data
  volumes:
    - name: nvme-data
      hostPath:
        path: /mnt/nvme
        type: Directory
```

## Common Issues

### nvidia_fs Module Not Loading

```bash
# Check driver container logs for GDS errors
oc logs -n gpu-operator -l app=nvidia-driver-daemonset -c nvidia-driver | grep -i gds

# Common cause: kernel headers mismatch
# Fix: ensure the driver container matches the node's kernel version
```

### GDS Pod CrashLoopBackOff

```bash
# Check GDS DaemonSet logs
oc logs -n gpu-operator -l app=nvidia-gds

# Common: incompatible GDS version with driver version
# Verify compatibility matrix: https://docs.nvidia.com/gpudirect-storage/
```

## Best Practices

- **Use NVMe-backed PVs** — GDS only benefits from direct NVMe access, not network storage
- **Pin GDS version** — match with your NVIDIA driver version per the compatibility matrix
- **Test with `gdscheck`** — verify GDS is working before deploying AI workloads
- **Monitor with DCGM** — track `DCGM_FI_PROF_PCIE_RX_BYTES` and `DCGM_FI_PROF_PCIE_TX_BYTES`

## Key Takeaways

- GDS enables direct NVMe → GPU data transfer, bypassing CPU (up to 3x I/O speedup)
- Enable via ClusterPolicy: `driver.manager.env.ENABLE_GPU_DIRECT_STORAGE=true` + `gds.enabled: true`
- Requires NVIDIA driver 525.60+ and the `nvidia-fs` kernel module
- Only benefits workloads reading from local NVMe — not network storage
