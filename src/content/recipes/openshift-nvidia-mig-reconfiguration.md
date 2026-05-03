---
title: "OpenShift NVIDIA MIG Reconfiguration Without Reboot"
description: "Reconfigure NVIDIA MIG geometry on OpenShift without rebooting nodes. Use nvidia-mig-manager with node labels to dynamically switch GPU partitions."
tags:
  - "openshift"
  - "nvidia"
  - "mig"
  - "gpu"
  - "gpu-operator"
category: "ai"
publishDate: "2026-05-03"
author: "Luca Berton"
difficulty: "advanced"
relatedRecipes:
  - "nvidia-gpu-operator-setup"
  - "kubernetes-1-36-dra-gpu-management"
  - "nvidia-smi-kubernetes-monitoring"
  - "gpu-node-affinity-scheduling"
---

> 💡 **Quick Answer:** On OpenShift, reconfigure MIG geometry **without rebooting** by draining the node and setting `nvidia.com/mig.config` label. The `nvidia-mig-manager` DaemonSet handles the dynamic reconfiguration — no manual `nvidia-smi` needed.

## The Problem

NVIDIA Multi-Instance GPU (MIG) partitions A100/H100 GPUs into isolated instances. Changing MIG layouts traditionally requires:

- SSH into the node and run `nvidia-smi mig` commands manually
- Restart the GPU driver or reboot the entire node
- Reconfigure each GPU individually
- Risk of inconsistent state across GPUs

On OpenShift, you don't SSH into nodes. You need a declarative, operator-driven approach.

## The Solution

The NVIDIA GPU Operator includes `nvidia-mig-manager`, which watches node labels and reconfigures MIG geometry automatically.

### Step 1: Cordon and Drain the Node

```bash
# Prevent new workloads from scheduling
oc adm cordon <node>

# Evict existing workloads (GPU pods must be stopped before reconfiguration)
oc adm drain <node> --ignore-daemonsets --delete-emptydir-data
```

### Step 2: Apply MIG Configuration via Label

```bash
# Split into 7x 1g.10gb instances (A100 80GB)
oc label node <node> nvidia.com/mig.config=all-1g.10gb --overwrite

# Or use other common layouts:
oc label node <node> nvidia.com/mig.config=all-2g.20gb --overwrite
oc label node <node> nvidia.com/mig.config=all-3g.40gb --overwrite

# Disable MIG entirely (full GPU mode)
oc label node <node> nvidia.com/mig.config=all-disabled --overwrite
```

### Step 3: Verify Reconfiguration

```bash
# Check MIG config and state
oc get node <node> \
  -o jsonpath='{.metadata.labels.nvidia\.com/mig\.config}{"\n"}{.metadata.labels.nvidia\.com/mig\.config\.state}{"\n"}'
# Expected output:
# all-1g.10gb
# success
```

### Step 4: Uncordon the Node

```bash
oc adm uncordon <node>
```

### Common MIG Profiles (A100 80GB)

| Profile | Instances | Memory Each | Use Case |
|---------|-----------|-------------|----------|
| `all-1g.10gb` | 7 | 10 GB | Inference, many small models |
| `all-2g.20gb` | 3 | 20 GB | Medium inference, fine-tuning |
| `all-3g.40gb` | 2 | 40 GB | Large model inference |
| `all-7g.80gb` | 1 | 80 GB | Training (full GPU) |
| `all-disabled` | 1 | 80 GB | MIG off, full GPU |

### Mixed MIG Profiles

```bash
# Custom mixed profile (if supported by your mig-parted config)
oc label node <node> nvidia.com/mig.config=custom-mixed --overwrite
```

Define custom profiles in the `nvidia-mig-manager` ConfigMap:

```yaml
apiVersion: v1
kind: ConfigMap
metadata:
  name: mig-parted-config
  namespace: nvidia-gpu-operator
data:
  config.yaml: |
    version: v1
    mig-configs:
      custom-mixed:
        - devices: [0]
          mig-enabled: true
          mig-devices:
            "3g.40gb": 1
            "2g.20gb": 1
            "1g.10gb": 1
```

### Debug MIG Manager

```bash
# Check mig-manager logs
oc logs -n nvidia-gpu-operator ds/nvidia-mig-manager -c nvidia-mig-manager --tail=200

# Find the specific mig-manager pod for your node
oc get pods -n nvidia-gpu-operator -o wide | grep mig-manager
oc logs -n nvidia-gpu-operator <mig-manager-pod> -c nvidia-mig-manager

# Check GPU Operator events
oc get events -n nvidia-gpu-operator --sort-by='.lastTimestamp' | tail -20
```

### Verify MIG Devices After Reconfiguration

```bash
# Check available MIG resources on the node
oc get node <node> -o json | jq '.status.allocatable | to_entries[] | select(.key | startswith("nvidia.com/mig-"))'
# Output:
# "nvidia.com/mig-1g.10gb": "7"

# Or check via the device plugin
oc get pods -n nvidia-gpu-operator -o wide | grep device-plugin
oc logs -n nvidia-gpu-operator <device-plugin-pod> --tail=50
```

### Request MIG Slices in Workloads

```yaml
apiVersion: v1
kind: Pod
metadata:
  name: inference-small
spec:
  containers:
    - name: model
      image: nvcr.io/nim/nim-llm:2.0.2
      resources:
        limits:
          nvidia.com/mig-1g.10gb: 1    # Request one MIG slice
```

```yaml
# Larger slice for bigger models
apiVersion: v1
kind: Pod
metadata:
  name: inference-large
spec:
  containers:
    - name: model
      image: nvcr.io/nim/nim-llm:2.0.2
      resources:
        limits:
          nvidia.com/mig-3g.40gb: 1
```

## Common Issues

### MIG config state stuck at "pending"
- **Cause**: GPU workloads still running on the node
- **Fix**: Ensure `oc adm drain` completed successfully; check for pods with `nvidia.com/gpu` requests

### mig-manager pod CrashLoopBackOff
- **Cause**: GPU driver version incompatible with requested MIG profile
- **Fix**: Check driver compatibility; update GPU Operator to latest version

### Config state shows "failed"
- **Cause**: Invalid MIG profile for the GPU model (e.g., requesting A100 profiles on T4)
- **Fix**: Check supported profiles for your GPU: `nvidia-smi mig -lgip` (via debug pod)

### Node shows 0 MIG resources after reconfiguration
- **Cause**: Device plugin hasn't re-enumerated after MIG change
- **Fix**: Wait 1-2 minutes; the device plugin restarts automatically. Check its logs.

## Best Practices

1. **Always drain before reconfiguring** — GPU pods must be stopped before MIG changes
2. **Use labels, not SSH** — the `nvidia-mig-manager` handles all GPU operations
3. **Monitor mig-manager logs** — first place to look when reconfiguration fails
4. **Plan MIG layouts per workload type** — inference nodes get `all-1g.10gb`, training nodes get `all-disabled`
5. **Use node pools** — separate MIG-enabled nodes from non-MIG nodes with labels and taints
6. **Expect brief service restarts** — mig-manager may restart kubelet/container runtime during apply (not a full reboot)

## Key Takeaways

- MIG reconfiguration on OpenShift is **label-driven** via `nvidia.com/mig.config`
- No `nvidia-smi` commands, no SSH, no node reboot required
- `nvidia-mig-manager` DaemonSet handles the reconfiguration lifecycle
- Drain the node before changing MIG geometry to avoid GPU workload disruption
- Verify with `nvidia.com/mig.config.state=success` label before uncordoning
