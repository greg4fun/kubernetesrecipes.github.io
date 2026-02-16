---
title: "Install NVIDIA GPU Operator on Kubernetes"
description: "Deploy the NVIDIA GPU Operator to automate GPU driver, container toolkit, and device plugin management across your Kubernetes cluster."
category: "ai"
difficulty: "intermediate"
timeToComplete: "25 minutes"
kubernetesVersion: "1.28+"
prerequisites:
  - "Kubernetes cluster with NVIDIA GPU nodes"
  - "Helm CLI installed"
  - "kubectl access to the cluster"
  - "Nodes with supported NVIDIA GPUs (A100, H100, A10, T4, etc.)"
relatedRecipes:
  - "kai-scheduler-installation"
  - "kai-scheduler-gpu-sharing"
  - "deploy-mistral-vllm-kubernetes"
  - "dra-gpu-allocation"
tags:
  - nvidia
  - gpu-operator
  - gpu
  - drivers
  - device-plugin
  - ai-workloads
  - infrastructure
publishDate: "2026-02-16"
author: "Luca Berton"
---

> 💡 **Quick Answer:** Install with Helm: `helm install gpu-operator nvidia/gpu-operator -n gpu-operator --create-namespace`. The operator auto-deploys GPU drivers, container toolkit, device plugin, and monitoring on every GPU node. Verify with `kubectl get pods -n gpu-operator` and `kubectl get nodes -o json | jq '.items[].status.capacity["nvidia.com/gpu"]'`.

# Install NVIDIA GPU Operator on Kubernetes

The NVIDIA GPU Operator automates the deployment and lifecycle of GPU software components on Kubernetes. Instead of manually installing drivers and plugins on each node, the operator handles everything as DaemonSets.

## What the GPU Operator Manages

```text
┌─────────────────────────────────────────────┐
│  GPU Operator (namespace: gpu-operator)      │
│                                              │
│  ┌────────────────┐  ┌───────────────────┐  │
│  │ GPU Driver     │  │ Container Toolkit │  │
│  │ (DaemonSet)    │  │ (DaemonSet)       │  │
│  └────────────────┘  └───────────────────┘  │
│                                              │
│  ┌────────────────┐  ┌───────────────────┐  │
│  │ Device Plugin  │  │ DCGM Exporter     │  │
│  │ (DaemonSet)    │  │ (Monitoring)      │  │
│  └────────────────┘  └───────────────────┘  │
│                                              │
│  ┌────────────────┐  ┌───────────────────┐  │
│  │ GPU Feature    │  │ MIG Manager       │  │
│  │ Discovery      │  │ (Optional)        │  │
│  └────────────────┘  └───────────────────┘  │
└─────────────────────────────────────────────┘
```

## Install with Helm

```bash
# Add NVIDIA Helm repository
helm repo add nvidia https://helm.ngc.nvidia.com/nvidia
helm repo update

# Install GPU Operator
helm install gpu-operator nvidia/gpu-operator \
  --namespace gpu-operator \
  --create-namespace \
  --set driver.enabled=true \
  --set toolkit.enabled=true \
  --set devicePlugin.enabled=true \
  --set dcgmExporter.enabled=true

# Wait for all pods to be ready
kubectl wait --for=condition=Ready pods --all -n gpu-operator --timeout=600s
```

## Pre-Installed Drivers (Skip Driver Install)

If GPU drivers are already installed on nodes (common on OpenShift or cloud-managed nodes):

```bash
helm install gpu-operator nvidia/gpu-operator \
  --namespace gpu-operator \
  --create-namespace \
  --set driver.enabled=false
```

## OpenShift Installation

On OpenShift, install via the OperatorHub:

1. Go to **Operators → OperatorHub**
2. Search for **NVIDIA GPU Operator**
3. Click **Install**
4. Select namespace `nvidia-gpu-operator`
5. Accept defaults and click **Install**

Or via CLI:

```bash
oc apply -f - <<EOF
apiVersion: operators.coreos.com/v1alpha1
kind: Subscription
metadata:
  name: gpu-operator-certified
  namespace: nvidia-gpu-operator
spec:
  channel: v24.9
  name: gpu-operator-certified
  source: certified-operators
  sourceNamespace: openshift-marketplace
EOF
```

Then create a `ClusterPolicy`:

```yaml
apiVersion: nvidia.com/v1
kind: ClusterPolicy
metadata:
  name: gpu-cluster-policy
spec:
  operator:
    defaultRuntime: crio
  driver:
    enabled: false    # OpenShift provides pre-installed drivers
  toolkit:
    enabled: true
  devicePlugin:
    enabled: true
  dcgm:
    enabled: true
  dcgmExporter:
    enabled: true
  gfd:
    enabled: true
  migManager:
    enabled: false
```

## Verify GPU Availability

```bash
# Check operator pods
kubectl get pods -n gpu-operator

# Verify GPU resources on nodes
kubectl get nodes -o custom-columns=NAME:.metadata.name,GPUs:.status.capacity.nvidia\\.com/gpu

# Describe a GPU node
kubectl describe node <gpu-node-name> | grep -A5 "Capacity\|Allocatable"

# Check GPU details from within a pod
kubectl run gpu-test --rm -it --restart=Never \
  --image=nvidia/cuda:12.4.0-base-ubuntu22.04 \
  --limits=nvidia.com/gpu=1 \
  -- nvidia-smi
```

Expected `nvidia-smi` output:

```text
+-----------------------------------------------------------------------------+
| NVIDIA-SMI 550.54.15   Driver Version: 550.54.15   CUDA Version: 12.4      |
|-------------------------------+----------------------+----------------------+
| GPU  Name        Persistence-M| Bus-Id       Disp.A | Volatile Uncorr. ECC |
| Fan  Temp  Perf  Pwr:Usage/Cap|         Memory-Usage | GPU-Util  Compute M. |
|===============================+======================+======================|
|   0  NVIDIA A100-SXM4   On    | 00000000:07:00.0 Off |                    0 |
| N/A   32C    P0    62W / 400W |      0MiB / 81920MiB |      0%      Default |
+-------------------------------+----------------------+----------------------+
```

## Enable GPU Time-Slicing

Share a single GPU across multiple pods using time-slicing:

```yaml
# time-slicing-config.yaml
apiVersion: v1
kind: ConfigMap
metadata:
  name: time-slicing-config
  namespace: gpu-operator
data:
  any: |-
    version: v1
    flags:
      migStrategy: none
    sharing:
      timeSlicing:
        renameByDefault: false
        failRequestsGreaterThanOne: false
        resources:
          - name: nvidia.com/gpu
            replicas: 4    # Each GPU appears as 4 virtual GPUs
```

Apply it:

```bash
kubectl apply -f time-slicing-config.yaml

# Patch the ClusterPolicy to use time-slicing
kubectl patch clusterpolicy/gpu-cluster-policy \
  -n gpu-operator --type merge \
  -p '{"spec":{"devicePlugin":{"config":{"name":"time-slicing-config","default":"any"}}}}'
```

After restart, each GPU node shows 4× the GPU count:

```bash
kubectl get nodes -o custom-columns=NAME:.metadata.name,GPUs:.status.capacity.nvidia\\.com/gpu
# Node with 1 A100 now shows GPUs: 4
```

## Enable MIG (Multi-Instance GPU)

For A100/H100 GPUs, MIG provides hardware-isolated GPU partitions:

```yaml
# Enable MIG Manager in ClusterPolicy
spec:
  migManager:
    enabled: true
    config:
      name: default-mig-parted-config
```

## DCGM Monitoring Metrics

The GPU Operator deploys DCGM Exporter which serves Prometheus metrics:

```bash
# Check DCGM Exporter is running
kubectl get pods -n gpu-operator -l app=nvidia-dcgm-exporter

# Sample metrics
kubectl port-forward -n gpu-operator svc/nvidia-dcgm-exporter 9400:9400
curl localhost:9400/metrics | grep DCGM_FI_DEV_GPU_UTIL
```

Key metrics:

| Metric | Description |
|---|---|
| `DCGM_FI_DEV_GPU_UTIL` | GPU utilization % |
| `DCGM_FI_DEV_FB_USED` | GPU memory used (MB) |
| `DCGM_FI_DEV_FB_FREE` | GPU memory free (MB) |
| `DCGM_FI_DEV_GPU_TEMP` | GPU temperature (°C) |
| `DCGM_FI_DEV_POWER_USAGE` | Power consumption (W) |

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| No `nvidia.com/gpu` on nodes | Device plugin not running | Check `kubectl get pods -n gpu-operator` |
| Driver pod in CrashLoop | Kernel headers missing | Install matching kernel-devel package |
| GPU test pod pending | No allocatable GPUs | Verify node labels and taints |
| DCGM metrics empty | Exporter not running | Check DCGM Exporter pod logs |

## Related Recipes

- [KAI Scheduler Installation](./kai-scheduler-installation)
- [GPU Sharing with KAI Scheduler](./kai-scheduler-gpu-sharing)
- [Deploy Mistral with vLLM](./deploy-mistral-vllm-kubernetes)
- [Dynamic Resource Allocation for GPUs](./dra-gpu-allocation)
