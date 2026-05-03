---
title: "Kubernetes 1.36 DRA for GPU and TPU Management"
description: "Use Dynamic Resource Allocation in Kubernetes 1.36 for advanced GPU/TPU management with partitionable devices, device taints, and tolerations."
tags:
  - "kubernetes-1.36"
  - "dra"
  - "gpu"
  - "tpu"
  - "resource-allocation"
category: "ai"
publishDate: "2026-05-03"
author: "Luca Berton"
difficulty: "advanced"
relatedRecipes:
  - "kubernetes-1-36-oci-volume-source"
  - "kubernetes-1-36-selinux-mount-labeling"
  - "gpu-sharing-mig-timeslicing-kubernetes"
  - "kubernetes-dynamic-resource-allocation-gpu"
---

> 💡 **Quick Answer:** Kubernetes 1.36 promotes DRA features to **Beta** (enabled by default): partitionable devices let you split GPUs into slices, and device taints/tolerations give fine-grained control over which workloads run on which accelerators.

## The Problem

Traditional device plugins (`nvidia.com/gpu: 1`) are crude:
- **No GPU partitioning** — you get a whole GPU or nothing (MIG requires out-of-band setup)
- **No device preferences** — can't say "prefer A100 over H100" or "avoid faulty GPU 3"
- **No device-level taints** — a degraded GPU still gets workloads scheduled to it
- **No sharing policies** — time-slicing is runtime-level, invisible to the scheduler

## The Solution

DRA in 1.36 brings partitionable devices and device taints/tolerations as **Beta features enabled by default**.

### Request a GPU Partition

```yaml
apiVersion: resource.k8s.io/v1beta1
kind: ResourceClaim
metadata:
  name: gpu-slice-small
spec:
  devices:
    requests:
      - name: gpu
        deviceClassName: gpu.nvidia.com
        selectors:
          - cel:
              expression: "device.attributes['gpu.nvidia.com'].memoryGiB >= 20"
    config:
      - requests: ["gpu"]
        opaque:
          driver: gpu.nvidia.com
          parameters:
            partition: "3g.20gb"    # MIG partition: 3 compute units, 20GB
```

### Pod Using a GPU Partition

```yaml
apiVersion: v1
kind: Pod
metadata:
  name: inference-small
spec:
  containers:
    - name: vllm
      image: vllm/vllm-openai:v0.8.0
      command: ["python", "-m", "vllm.entrypoints.openai.api_server"]
      args: ["--model", "meta-llama/Llama-3.1-8B"]
      resources:
        claims:
          - name: gpu-slice
  resourceClaims:
    - name: gpu-slice
      resourceClaimTemplateName: gpu-slice-small
```

### Device Taints and Tolerations

Mark a degraded GPU as tainted:

```yaml
# Applied by the DRA driver automatically or by admin
apiVersion: resource.k8s.io/v1beta1
kind: ResourceSlice
metadata:
  name: node-1-gpu-3
spec:
  driver: gpu.nvidia.com
  pool:
    name: node-1-gpus
  devices:
    - name: gpu-3
      basic:
        attributes:
          gpu.nvidia.com:
            model: { string: "NVIDIA-H100" }
            memoryGiB: { int: 80 }
        taints:
          - key: gpu.nvidia.com/ecc-errors
            value: "uncorrectable"
            effect: NoSchedule
```

Tolerate the taint for non-critical workloads:

```yaml
apiVersion: resource.k8s.io/v1beta1
kind: ResourceClaim
metadata:
  name: gpu-any
spec:
  devices:
    requests:
      - name: gpu
        deviceClassName: gpu.nvidia.com
        tolerations:
          - key: gpu.nvidia.com/ecc-errors
            operator: Exists
            effect: NoSchedule
```

### DeviceClass for GPU Tiers

```yaml
apiVersion: resource.k8s.io/v1beta1
kind: DeviceClass
metadata:
  name: gpu-training-tier
spec:
  selectors:
    - cel:
        expression: >
          device.attributes['gpu.nvidia.com'].model in
          ['NVIDIA-H100', 'NVIDIA-H200', 'NVIDIA-B200'] &&
          device.attributes['gpu.nvidia.com'].memoryGiB >= 80
  config:
    - opaque:
        driver: gpu.nvidia.com
        parameters:
          computeMode: "EXCLUSIVE_PROCESS"
```

### Multi-GPU Training with DRA

```yaml
apiVersion: v1
kind: Pod
metadata:
  name: training-node-0
spec:
  containers:
    - name: trainer
      image: registry.example.com/training:v2.0
      resources:
        claims:
          - name: gpus
  resourceClaims:
    - name: gpus
      resourceClaimTemplateName: training-gpus
---
apiVersion: resource.k8s.io/v1beta1
kind: ResourceClaimTemplate
metadata:
  name: training-gpus
spec:
  spec:
    devices:
      requests:
        - name: gpu
          deviceClassName: gpu-training-tier
          count: 8
      constraints:
        - requests: ["gpu"]
          matchAttribute: "gpu.nvidia.com/numa-node"
```

## Common Issues

### ResourceClaim stuck in Pending
- **Cause**: No devices match the selector criteria
- **Fix**: Check available devices with `kubectl get resourceslices -o yaml`

### GPU partition not supported
- **Cause**: GPU doesn't support MIG (e.g., consumer GPUs)
- **Fix**: Use full GPU allocation or time-slicing instead of partitioning

### Device taint blocks all workloads
- **Cause**: Taint applied but no workloads tolerate it
- **Fix**: Add tolerations to ResourceClaims that can handle degraded devices

## Best Practices

1. **Define DeviceClasses** for your GPU tiers (training, inference, dev)
2. **Use device taints** for ECC errors, thermal throttling, or maintenance
3. **Partition GPUs** for inference workloads that don't need full GPU memory
4. **Set NUMA constraints** for multi-GPU training to minimize PCIe latency
5. **Monitor ResourceSlices** to track available vs allocated device inventory

## Key Takeaways

- DRA partitionable devices and device taints are **Beta in Kubernetes 1.36** (enabled by default)
- Split GPUs into partitions for efficient sharing across workloads
- Taint degraded GPUs to prevent scheduling critical workloads
- DeviceClasses create reusable GPU tier definitions
- NUMA-aware constraints optimize multi-GPU training performance
