---
title: "Talos Linux MIG Configuration with GPU Operator"
description: "Configure NVIDIA MIG on Talos Linux Kubernetes clusters. Install GPU Operator, set MIG strategy, and dynamically partition A100 GPUs without node reboot."
tags:
  - "talos"
  - "nvidia"
  - "mig"
  - "gpu"
  - "gpu-operator"
category: "ai"
publishDate: "2026-05-03"
author: "Luca Berton"
difficulty: "advanced"
relatedRecipes:
  - "openshift-nvidia-mig-reconfiguration"
  - "nvidia-gpu-operator-gitops-openshift"
  - "kubernetes-1-36-dra-gpu-management"
  - "gpu-node-affinity-scheduling"
---

> 💡 **Quick Answer:** On Talos Linux with NVIDIA GPU extensions, MIG reconfiguration requires the **GPU Operator with mig-manager**. Without it, labeling `nvidia.com/mig.config` does nothing. Install the GPU Operator with `mig.strategy: mixed`, then use `kubectl label` to switch MIG profiles dynamically.

## The Problem

Talos Linux provides NVIDIA drivers via system extensions, and nodes show `nvidia.com/gpu.present=true`. But basic driver presence doesn't mean MIG management is available:

- No `nvidia.com/mig.capable` label → GPU Feature Discovery (GFD) not running
- No `nvidia.com/mig.config.state` → mig-manager not deployed
- No `nvidia.com/gpu.product` or `gpu.count` → device plugin not advertising GPUs
- Setting `nvidia.com/mig.config` label has no effect without mig-manager watching it

## The Solution

## Architecture

On Talos, the stack splits cleanly between OS-level and Kubernetes-level:

```text
Talos Extensions (immutable, OS-level)
  └─ NVIDIA driver/kernel modules + nvidia-container-toolkit

NVIDIA GPU Operator (Kubernetes-level)
  ├─ driver: disabled (Talos provides it)
  ├─ toolkit: disabled (Talos provides it)
  ├─ device-plugin: enabled
  ├─ gpu-feature-discovery: enabled
  ├─ mig-manager: enabled
  ├─ dcgm-exporter: enabled
  └─ validator: optional
```

Talos manages the **immutable driver**, GPU Operator manages the **Kubernetes GPU runtime**, and MIG is **declarative via labels** — no shelling into nodes.


### Step 1: Verify Current NVIDIA State

```bash
# Check what NVIDIA labels exist
kubectl get node worker-gpu-gwc-0 --show-labels | tr ',' '\n' | grep nvidia
# If you only see nvidia.com/gpu.present=true, GPU Operator is missing

# Check for GPU Operator components
kubectl get pods -A | grep -E 'gpu-operator|mig|nvidia'
# Empty = GPU Operator not installed

# Verify GPU model (critical for MIG profile selection)
kubectl debug node/worker-gpu-gwc-0 -it --image=nvidia/cuda:12.9.0-base-ubuntu24.04 -- nvidia-smi -L
# GPU 0: NVIDIA A100 80GB PCIe (UUID: GPU-...)
```

### Step 2: Install NVIDIA GPU Operator with MIG Support

```bash
# Add NVIDIA Helm repo
helm repo add nvidia https://helm.ngc.nvidia.com/nvidia
helm repo update

# Install GPU Operator with MIG strategy
helm upgrade --install gpu-operator nvidia/gpu-operator \
  -n gpu-operator --create-namespace \
  --set driver.enabled=false \
  --set toolkit.enabled=false \
  --set mig.strategy=mixed \
  --set migManager.enabled=true \
  --set gfd.enabled=true \
  --set devicePlugin.enabled=true \
  --set dcgmExporter.enabled=true
```

Key flags for Talos:
- `driver.enabled=false` — Talos provides the driver via extensions
- `toolkit.enabled=false` — Talos bundles the container toolkit in extensions
- `mig.strategy=mixed` — allows different MIG profiles per GPU (or `single` for uniform)

### Step 3: Verify GPU Operator Deployment

```bash
# Check all GPU Operator pods are running
kubectl get pods -n gpu-operator
# NAME                                       READY   STATUS
# gpu-operator-...                            1/1     Running
# nvidia-device-plugin-daemonset-...          1/1     Running
# nvidia-gpu-feature-discovery-...            1/1     Running
# nvidia-mig-manager-...                      1/1     Running

# Verify NVIDIA labels are now populated
kubectl get node worker-gpu-gwc-0 --show-labels | tr ',' '\n' | grep nvidia
# nvidia.com/gpu.present=true
# nvidia.com/gpu.count=1
# nvidia.com/gpu.product=NVIDIA-A100-80GB-PCIe
# nvidia.com/mig.capable=true
# nvidia.com/cuda.driver.major=570
```

### Step 4: Configure MIG Layout

```bash
# Cordon and drain
kubectl cordon worker-gpu-gwc-0
kubectl drain worker-gpu-gwc-0 --ignore-daemonsets --delete-emptydir-data

# Apply MIG configuration (A100 80GB profiles)
kubectl label node worker-gpu-gwc-0 nvidia.com/mig.config=all-1g.10gb --overwrite

# Watch mig-manager apply the configuration
kubectl logs -n gpu-operator -l app=nvidia-mig-manager -c nvidia-mig-manager -f

# Verify success
kubectl get node worker-gpu-gwc-0 \
  -o jsonpath='{.metadata.labels.nvidia\.com/mig\.config}{"\n"}{.metadata.labels.nvidia\.com/mig\.config\.state}{"\n"}'
# all-1g.10gb
# success

# Uncordon
kubectl uncordon worker-gpu-gwc-0
```

### MIG Profiles: A100 80GB vs 40GB

**A100 80GB** (e.g., Azure `Standard_NC24ads_A100_v4` if 80GB SKU):

| Profile | Instances | Memory Each |
|---------|-----------|-------------|
| `all-1g.10gb` | 7 | 10 GB |
| `all-2g.20gb` | 3 | 20 GB |
| `all-3g.40gb` | 2 | 40 GB |
| `all-7g.80gb` | 1 | 80 GB |

**A100 40GB**:

| Profile | Instances | Memory Each |
|---------|-----------|-------------|
| `all-1g.5gb` | 7 | 5 GB |
| `all-2g.10gb` | 3 | 10 GB |
| `all-3g.20gb` | 2 | 20 GB |
| `all-4g.20gb` | 1 | 20 GB |
| `all-7g.40gb` | 1 | 40 GB |

> ⚠️ Using `all-1g.10gb` on A100 40GB will fail — the profile doesn't exist. Always verify your GPU model first.

### MIG Strategy: Single vs Mixed

```yaml
# Single strategy: all GPUs on a node get the same MIG profile
mig:
  strategy: single

# Mixed strategy: different GPUs can have different profiles
mig:
  strategy: mixed
```

With `mixed` strategy, you can use custom ConfigMaps:

```yaml
apiVersion: v1
kind: ConfigMap
metadata:
  name: mig-parted-config
  namespace: gpu-operator
data:
  config.yaml: |
    version: v1
    mig-configs:
      inference-optimized:
        - devices: [0]
          mig-enabled: true
          mig-devices:
            "3g.40gb": 1
            "1g.10gb": 4
```

### Talos-Specific: GPU Extensions Configuration

```yaml
# Talos machine config for NVIDIA extensions
machine:
  install:
    extensions:
      - image: ghcr.io/siderolabs/nvidia-open-gpu-kernel-modules:570.133.20-v1.10.0
      - image: ghcr.io/siderolabs/nvidia-container-toolkit:570.133.20-v1.17.7
  kernel:
    modules:
      - name: nvidia
      - name: nvidia_uvm
      - name: nvidia_drm
      - name: nvidia_modeset
```

### Debug Checklist

```bash
# 1. Is the GPU visible at all?
kubectl describe node worker-gpu-gwc-0 | grep -i 'gpu.product'

# 2. Is GFD running and labeling?
kubectl logs -n gpu-operator -l app=gpu-feature-discovery --tail=50

# 3. Is mig-manager deployed?
kubectl get ds -n gpu-operator | grep mig

# 4. What's the mig-manager doing?
kubectl logs -n gpu-operator -l app=nvidia-mig-manager -c nvidia-mig-manager --tail=200

# 5. Are MIG devices advertised?
kubectl get node worker-gpu-gwc-0 -o json | \
  jq '.status.allocatable | to_entries[] | select(.key | startswith("nvidia.com/mig-"))'

# 6. Device plugin healthy?
kubectl logs -n gpu-operator -l app=nvidia-device-plugin-daemonset --tail=50
```

## Common Issues

### Label set but mig.config.state never appears
- **Cause**: mig-manager not deployed (GPU Operator missing or `migManager.enabled=false`)
- **Fix**: Install GPU Operator with `--set migManager.enabled=true`

### mig-manager fails with "driver not loaded"
- **Cause**: Talos extension not properly configured
- **Fix**: Verify kernel modules are loaded: `kubectl debug node/... -- ls /dev/nvidia*`

### Wrong MIG profile for GPU model
- **Cause**: Using A100-80GB profiles on A100-40GB (or vice versa)
- **Fix**: Check `nvidia.com/gpu.product` label and use matching profiles

### Device plugin shows 0 MIG resources
- **Cause**: Device plugin hasn't re-enumerated after MIG change
- **Fix**: Wait 1-2 minutes; check device plugin logs for errors

## Best Practices

1. **Verify GPU model before choosing profiles** — 80GB and 40GB have different MIG geometries
2. **Disable driver/toolkit in GPU Operator on Talos** — Talos provides these via extensions
3. **Use `mixed` MIG strategy** for flexibility across GPU workloads
4. **Always drain before MIG changes** — in-flight GPU workloads will fail
5. **Monitor mig-manager logs** during reconfiguration — it shows each step
6. **Label nodes with intended MIG profile** — enables GitOps-driven GPU fleet management

## Key Takeaways

- Talos provides NVIDIA drivers via extensions, but **GPU Operator is still needed** for MIG management
- Without mig-manager, `nvidia.com/mig.config` labels are ignored
- Install GPU Operator with `driver.enabled=false` and `toolkit.enabled=false` on Talos
- A100 80GB and 40GB have different MIG profile names — verify your SKU
- The workflow is: drain → label → wait for `success` → uncordon
