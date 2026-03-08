---
title: "Validate GPUDirect RDMA Performance with DMA-BUF"
description: "Run ib_write_bw with CUDA DMA-BUF to verify GPUDirect RDMA data transfer rates between GPU pods and validate network operator configuration."
category: "networking"
difficulty: "advanced"
timeToComplete: "30 minutes"
kubernetesVersion: "1.28+"
prerequisites:
  - "NVIDIA GPU Operator with DMA-BUF or RDMA configured"
  - "NVIDIA Network Operator or MOFED installed"
  - "Two GPU nodes with Mellanox ConnectX NICs"
  - "Secondary RDMA network configured"
relatedRecipes:
  - "configure-gpudirect-rdma-gpu-operator"
  - "switch-gpudirect-rdma-dma-buf"
  - "compare-nccl-intra-inter-node"
tags:
  - nvidia
  - gpu
  - rdma
  - dma-buf
  - performance
  - networking
  - benchmarking
publishDate: "2026-02-18"
author: "Luca Berton"
---

> 💡 **Quick Answer:** Deploy two pods with `mellanox/cuda-perftest`, run `ib_write_bw --use_cuda=0 --use_cuda_dmabuf` between them, and verify throughput reaches near line-rate (80–95+ Gbps for 100G NICs).


After configuring GPUDirect RDMA, validate that GPU-to-GPU transfers over the network achieve expected throughput using the `ib_write_bw` benchmark with DMA-BUF.

## Step 1 — Get Network Interface Name

```bash
kubectl exec -it -n network-operator mofed-ubuntu22.04-ds-xxxxx -- ibdev2netdev
```

Example output:

```text
mlx5_0 port 1 ==> ens64np1 (Up)
```

## Step 2 — Deploy Test Pods

Create pods requesting GPU and RDMA resources on two different nodes:

```yaml
apiVersion: v1
kind: Pod
metadata:
  name: rdma-gpu-pod-1
  annotations:
    k8s.v1.cni.cncf.io/networks: rdma-test-network
spec:
  nodeSelector:
    kubernetes.io/hostname: gpu-node-1
  restartPolicy: OnFailure
  containers:
  - image: mellanox/cuda-perftest
    name: rdma-gpu-test
    securityContext:
      capabilities:
        add: ["IPC_LOCK"]
    resources:
      limits:
        nvidia.com/gpu: 1
        rdma/rdma_shared_device_a: 1
      requests:
        nvidia.com/gpu: 1
        rdma/rdma_shared_device_a: 1
```

Create a matching pod for the second node (`rdma-gpu-pod-2` on `gpu-node-2`).

```bash
kubectl apply -f rdma-gpu-pod-1.yaml -f rdma-gpu-pod-2.yaml
kubectl get pods -o wide
```

## Step 3 — Run the Benchmark

Start the server on pod 1:

```bash
kubectl exec -it rdma-gpu-pod-1 -- ib_write_bw --use_cuda=0 --use_cuda_dmabuf \
  -d mlx5_0 -a -F --report_gbits -q 1
```

Run the client on pod 2 (replace IP with pod 1 address):

```bash
kubectl exec -it rdma-gpu-pod-2 -- ib_write_bw -n 5000 --use_cuda=0 --use_cuda_dmabuf \
  -d mlx5_0 -a -F --report_gbits -q 1 <pod-1-ip>
```

## Step 4 — Interpret Results

Expected output (100G NIC):

```text
#bytes     #iterations    BW peak[Gb/sec]    BW average[Gb/sec]   MsgRate[Mpps]
65536      5000             92.39              92.38               0.176196
131072     5000             92.42              92.41               0.088131
1048576    5000             92.40              92.40               0.011015
8388608    5000             92.39              92.39               0.001377
```

Performance targets:
- **100G NIC** — expect 90–95 Gbps for large messages
- **200G NIC** — expect 180–195 Gbps for large messages
- **Small messages** — lower throughput is normal due to latency overhead

## Step 5 — Validate DMA-BUF Path

The `--use_cuda_dmabuf` flag confirms the DMA-BUF path. If it falls back to legacy `nvidia-peermem`, you will see errors or warnings in the output.

Also verify with NCCL:

```bash
NCCL_DEBUG=INFO NCCL_NET_GDR_LEVEL=5 all_reduce_test
```

Look for `GPUDirect RDMA DMA-BUF enabled` and no `peer memory` fallback.

## Cleanup

```bash
kubectl delete pod rdma-gpu-pod-1 rdma-gpu-pod-2
```

## Why This Matters

Benchmarking confirms that GPUDirect RDMA is functioning at the hardware level. Without validation, misconfigurations can silently degrade multi-node training throughput by falling back to CPU-staged transfers.
