---
title: "GPU Operator ClusterPolicy RDMA and GDS Configuration"
description: "Configure NVIDIA GPU Operator ClusterPolicy to disable RDMA and enable GPUDirect Storage (GDS). Control nvidia-peermem, nvidia-fs modules, driver settings, and IOMMU integration for different GPU cluster topologies."
tags:
  - "gpu-operator"
  - "rdma"
  - "gds"
  - "cluster-policy"
  - "nvidia"
category: "ai"
publishDate: "2026-06-04"
author: "Luca Berton"
difficulty: "advanced"
relatedRecipes:
  - "gpudirect-rdma-setup-verification-kubernetes"
  - "disable-gds-enable-iommu-passthrough-kubernetes"
  - "iommu-kernel-parameters-gpu-nodes-kubernetes"
---

> 💡 **Quick Answer:** In the GPU Operator `ClusterPolicy`, set `driver.rdma.enabled: false` to skip nvidia-peermem (no GPUDirect RDMA), and `gds.enabled: true` to deploy GPUDirect Storage (nvidia-fs) for direct NVMe-to-GPU transfers. When IOMMU is enabled (`iommu=on` strict mode), GDS still works but RDMA may need `iommu=pt` for full performance. These are independent toggles — you can have GDS without RDMA.

## The Problem

- Not all GPU clusters need RDMA (single-node inference, no SR-IOV NICs)
- GDS is needed for fast checkpoint/data loading from local NVMe but RDMA is not
- Enabling RDMA when no InfiniBand/RoCE fabric exists causes module load errors
- Need to understand which driver components to enable for each topology
- IOMMU strict mode works with GDS but can conflict with RDMA nvidia-peermem

## The Solution

### ClusterPolicy: RDMA Disabled + GDS Enabled

```yaml
apiVersion: nvidia.com/v1
kind: ClusterPolicy
metadata:
  name: cluster-policy
spec:
  operator:
    defaultRuntime: containerd

  driver:
    enabled: true
    version: "560.35.03"
    rdma:
      enabled: false          # ← RDMA DISABLED (no nvidia-peermem)
      useHostMofed: false     # Irrelevant when rdma.enabled=false

  gds:
    enabled: true             # ← GDS ENABLED (nvidia-fs for NVMe direct)
    version: "2.17.5"

  devicePlugin:
    enabled: true

  toolkit:
    enabled: true

  gfd:
    enabled: true

  dcgmExporter:
    enabled: true
```

### What Each Toggle Controls

```text
Setting                   │ Module Loaded    │ Feature Enabled
──────────────────────────┼──────────────────┼────────────────────────────────────
driver.rdma.enabled: true │ nvidia-peermem   │ GPUDirect RDMA (GPU↔NIC direct DMA)
driver.rdma.enabled: false│ (none)           │ No RDMA — network traffic stages via CPU
──────────────────────────┼──────────────────┼────────────────────────────────────
gds.enabled: true         │ nvidia-fs        │ GPUDirect Storage (GPU↔NVMe direct)
gds.enabled: false        │ (none)           │ No GDS — storage I/O goes via CPU bounce
──────────────────────────┴──────────────────┴────────────────────────────────────

Components deployed:
  rdma.enabled: true  → nvidia-peermem-ctr (init container in driver pod)
  gds.enabled: true   → nvidia-fs-ctr (DaemonSet or driver pod sidecar)
```

### When to Disable RDMA

```text
Disable driver.rdma.enabled when:
  ❌ No InfiniBand or RoCE NICs installed
  ❌ Single-node GPU server (no multi-node training)
  ❌ Using shared RDMA plugin instead (manages peermem independently)
  ❌ MLNX_OFED not installed on host (nvidia-peermem won't load anyway)
  ❌ Running inference only (no collective communication)
  ❌ IOMMU strict mode and RDMA conflicts (use GDS only)

Keep driver.rdma.enabled: true when:
  ✅ Multi-node training with InfiniBand/RoCE
  ✅ GPUDirect RDMA needed for NCCL performance
  ✅ SR-IOV NICs with RDMA capability
  ✅ Host has MLNX_OFED or inbox RDMA drivers
```

### When to Enable GDS

```text
Enable gds.enabled when:
  ✅ Local NVMe drives for checkpoints (direct GPU↔NVMe, bypass CPU)
  ✅ RAPIDS/cuDF workloads reading Parquet from local disk
  ✅ Training with large datasets on local storage
  ✅ Checkpoint frequency is high (saves CPU cycles)

Disable gds.enabled when:
  ❌ No local NVMe (data comes from network: NFS, S3, Ceph)
  ❌ Inference only (model loaded once at startup)
  ❌ nvidia-fs causes conflicts with other storage drivers
  ❌ Kernel too old (< 5.4 — nvidia-fs won't load)
```

### RDMA Disabled + GDS Enabled + IOMMU Enabled

```yaml
# Full ClusterPolicy for: no RDMA, with GDS, IOMMU strict/on
apiVersion: nvidia.com/v1
kind: ClusterPolicy
metadata:
  name: cluster-policy
spec:
  driver:
    enabled: true
    rdma:
      enabled: false        # No RDMA (no nvidia-peermem)
      useHostMofed: false
    # With iommu=on (strict), nvidia-peermem can have issues
    # Disabling RDMA avoids this entirely

  gds:
    enabled: true           # GDS works fine with IOMMU enabled
    # nvidia-fs uses kernel DMA APIs that work with IOMMU translation
    # No performance penalty for GDS with IOMMU (NVMe is local PCIe)

  devicePlugin:
    enabled: true
    config:
      name: device-plugin-config

  toolkit:
    enabled: true
    env:
      - name: CONTAINERD_CONFIG
        value: /etc/containerd/config.toml
```

### Verify Configuration

```bash
# Check ClusterPolicy status
kubectl get clusterpolicy cluster-policy -o yaml | grep -A5 "rdma\|gds"

# Check driver pod — should NOT have nvidia-peermem container
kubectl get pods -n gpu-operator -l app=nvidia-driver-daemonset -o yaml | grep -c peermem
# 0 (if rdma disabled)

# Check GDS pod/container
kubectl get pods -n gpu-operator -l app=nvidia-fs
# or
kubectl get pods -n gpu-operator -l app=nvidia-driver-daemonset -o yaml | grep nvidia-fs

# On node — verify modules
kubectl debug node/gpu-worker-0 -it --image=busybox -- chroot /host bash -c '
  echo "=== nvidia-peermem (should NOT be loaded) ==="
  lsmod | grep nvidia_peermem || echo "NOT LOADED (correct)"
  
  echo "=== nvidia-fs (should be loaded) ==="
  lsmod | grep nvidia_fs || echo "NOT LOADED (problem!)"
  
  echo "=== IOMMU status ==="
  dmesg | grep "Default domain" | tail -1
'
```

### IOMMU Impact on GDS vs RDMA

```text
                        │ iommu=off │ iommu=pt │ iommu=on (strict)
────────────────────────┼───────────┼──────────┼───────────────────
GPUDirect RDMA          │ ✅ Fast    │ ✅ Fast   │ ⚠️ 10-15% slower
  (nvidia-peermem)      │           │          │ May have issues
────────────────────────┼───────────┼──────────┼───────────────────
GPUDirect Storage       │ ✅ Fast    │ ✅ Fast   │ ✅ Fast
  (nvidia-fs)           │           │          │ (local PCIe, no penalty)
────────────────────────┼───────────┼──────────┼───────────────────
Regular GPU compute     │ ✅         │ ✅        │ ✅
────────────────────────┴───────────┴──────────┴───────────────────

Why GDS works with strict IOMMU but RDMA may not:
- GDS: NVMe and GPU on same PCIe tree, IOMMU handles local DMA efficiently
- RDMA: NIC does remote DMA to GPU memory — IOMMU translation adds latency
  on every network packet (thousands per second)
```

### OpenShift ClusterPolicy with GDS

```yaml
# On OpenShift, GPU Operator is installed via OLM
# Edit the ClusterPolicy via:
oc edit clusterpolicy cluster-policy

# Or apply declaratively:
apiVersion: nvidia.com/v1
kind: ClusterPolicy
metadata:
  name: cluster-policy
spec:
  driver:
    enabled: true
    rdma:
      enabled: false
    upgradePolicy:
      autoUpgrade: true
      maxParallelUpgrades: 1
      waitForCompletion:
        timeoutSeconds: 1800
  gds:
    enabled: true
  devicePlugin:
    enabled: true
  validator:
    plugin:
      env:
        - name: WITH_GDS
          value: "true"
```

### Combining with Shared RDMA Plugin

```yaml
# Scenario: RDMA disabled in GPU Operator, but using shared RDMA plugin separately
# This is valid! The shared RDMA plugin manages /dev/infiniband access
# without nvidia-peermem (no GPUDirect — falls back to host memory staging)

# GPU Operator:
spec:
  driver:
    rdma:
      enabled: false    # No nvidia-peermem from GPU Operator

# Separately deployed:
# - k8s-rdma-shared-dev-plugin (gives pods /dev/infiniband access)
# - NCCL will use NET/IB transport WITHOUT GDRDMA suffix
# - Data path: GPU → CPU memory → NIC → wire (slower but works)

# If you need GDRDMA with shared plugin:
# Option 1: Set driver.rdma.enabled: true (GPU Operator loads peermem)
# Option 2: Load nvidia-peermem manually on host (outside GPU Operator)
```

## Common Issues

### GDS pod CrashLoopBackOff after enabling
- **Cause**: Kernel version incompatible; or nvidia-fs conflicts with existing storage driver
- **Fix**: Check GDS pod logs; verify kernel ≥ 5.4; check for conflicting modules (nvme_fabrics)

### "nvidia_peermem: module not found" warnings (rdma disabled)
- **Cause**: Some NCCL containers try to load peermem at runtime
- **Fix**: Expected when rdma disabled — NCCL falls back to non-GDRDMA path automatically

### GDS enabled but cuFile operations fail
- **Cause**: nvidia-fs loaded but cuFile not configured; or filesystem doesn't support GDS
- **Fix**: GDS requires ext4/XFS on NVMe; create `/etc/cufile.json` config; verify with `gdscheck`

### ClusterPolicy changes not taking effect
- **Cause**: Operator needs to restart driver pods; or nodes need drain
- **Fix**: GPU Operator automatically rolling-restarts driver DaemonSet. Wait for rollout; check `kubectl rollout status`

## Best Practices

1. **Match toggles to hardware** — don't enable RDMA without RDMA NICs
2. **GDS without RDMA is valid** — independent features for different I/O paths
3. **IOMMU strict + GDS: fine** — no performance penalty for local NVMe
4. **IOMMU strict + RDMA: avoid** — use `iommu=pt` instead if RDMA needed
5. **Validate after changes** — check module load status on nodes
6. **Version-pin GDS** — `gds.version` should match CUDA toolkit version
7. **Separate RDMA management** — can use shared plugin independently of GPU Operator

## Key Takeaways

- `driver.rdma.enabled: false` → no nvidia-peermem → no GPUDirect RDMA
- `gds.enabled: true` → nvidia-fs deployed → GPUDirect Storage active (GPU↔NVMe)
- GDS and RDMA are independent — enable based on your I/O topology
- IOMMU strict: works with GDS (local PCIe), problematic for RDMA (remote DMA penalty)
- Without RDMA, NCCL still works over network — just stages data via CPU (slower)
- GPU Operator manages module lifecycle — no manual modprobe needed
- Shared RDMA plugin can work alongside GPU Operator with rdma disabled (no GDRDMA path)
