---
title: "Configure GPUDirect RDMA with the NVIDIA GPU Operator"
description: "Set up GPUDirect RDMA on Kubernetes using the NVIDIA GPU Operator with either DMA-BUF or legacy nvidia-peermem, including Network Operator integration."
category: "networking"
difficulty: "advanced"
timeToComplete: "60 minutes"
kubernetesVersion: "1.28+"
prerequisites:
  - "NVIDIA GPU Operator installed"
  - "NVIDIA Network Operator or host MOFED installed"
  - "Mellanox ConnectX or BlueField NIC present"
  - "Multiple GPU nodes for RDMA testing"
relatedRecipes:
  - "switch-gpudirect-rdma-dma-buf"
  - "validate-gpudirect-rdma-performance"
  - "enable-gpudirect-storage-openshift"
  - "agent-config-device-by-path"
  - "coredns-configuration"
  - "custom-dns-configuration"
  - "dns-policies-configuration"
  - "istio-traffic-management"
  - "kubernetes-dns-configuration"
tags:
  - nvidia
  - gpu
  - rdma
  - gpudirect
  - networking
  - gpu-operator
publishDate: "2026-02-18"
author: "Luca Berton"
---

> 💡 **Quick Answer:** Install the GPU Operator and Network Operator together. DMA-BUF is the default RDMA transport; add `--set driver.rdma.enabled=true` only if you need the legacy `nvidia-peermem` path.


GPUDirect RDMA enables direct data transfer between GPUs and network devices over PCI Express, bypassing CPU memory copies. The GPU Operator and Network Operator work together to configure the full stack.

## Platform Support

GPUDirect RDMA is supported on:

- Kubernetes on bare metal
- vSphere VMs with GPU passthrough and vGPU
- VMware vSphere with Tanzu
- Red Hat OpenShift (via NVIDIA AI Enterprise)

## Installation

### DMA-BUF Mode (Recommended)

```bash
helm install --wait --generate-name \
  -n gpu-operator --create-namespace \
  nvidia/gpu-operator \
  --version=v25.10.1
```

### With Host MOFED

```bash
helm install --wait --generate-name \
  -n gpu-operator --create-namespace \
  nvidia/gpu-operator \
  --version=v25.10.1 \
  --set driver.rdma.useHostMofed=true
```

### Legacy nvidia-peermem Mode

```bash
helm install --wait --generate-name \
  -n gpu-operator --create-namespace \
  nvidia/gpu-operator \
  --version=v25.10.1 \
  --set driver.rdma.enabled=true
```

## Verify the Installation

Check the driver DaemonSet structure:

```bash
kubectl describe ds -n gpu-operator nvidia-driver-daemonset
```

Look for:
- `mofed-validation` init container — waits for network drivers
- `nvidia-driver-ctr` — main driver container
- `nvidia-peermem-ctr` — present only when `driver.rdma.enabled=true`

If using legacy mode, verify the module loaded:

```bash
kubectl logs -n gpu-operator ds/nvidia-driver-daemonset -c nvidia-peermem-ctr
```

Expected output:

```text
successfully loaded nvidia-peermem module
```

## Set Up a Test Network

Create a secondary macvlan network for RDMA traffic:

```yaml
apiVersion: mellanox.com/v1alpha1
kind: MacvlanNetwork
metadata:
  name: rdma-test-network
spec:
  networkNamespace: "default"
  master: "ens64np1"   # Replace with your IB interface
  mode: "bridge"
  mtu: 1500
  ipam: |
    {
      "type": "whereabouts",
      "range": "192.168.2.225/28"
    }
```

```bash
kubectl apply -f rdma-test-network.yaml
kubectl get macvlannetworks rdma-test-network
```

## Why This Matters

GPUDirect RDMA eliminates CPU-staged copies for GPU-to-GPU network communication, enabling near line-rate throughput for distributed training and HPC workloads.
