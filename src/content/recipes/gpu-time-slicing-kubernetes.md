---
title: "Configure GPU Time-Slicing on Kubernetes"
description: "Configure NVIDIA GPU time-slicing with the GPU Operator: device plugin ConfigMap, replicas, per-node profiles, verification, and memory-sharing caveats."
publishDate: "2026-03-19"
updatedDate: "2026-09-27"
author: "Luca Berton"
category: "ai"
difficulty: "intermediate"
timeToComplete: "20 minutes"
kubernetesVersion: "1.28+"
prerequisites:
  - "NVIDIA GPU Operator installed"
tags:
  - nvidia
  - gpu
  - time-slicing
  - gpu-sharing
  - gpu-operator
  - kubernetes
  - cost-optimization
relatedRecipes:
  - "kubernetes-gpu-sharing-mps-mig"
  - "kai-scheduler-gpu-sharing"
  - "gpu-operator-clusterpolicy-reference"
  - "nvidia-gpu-operator-gitops-openshift"
  - "resourcequota-limitrange-gpu"
  - "kubernetes-cost-optimization"
  - "kubernetes-resource-requests-limits"
---

> 💡 **Quick Answer:** Create a device-plugin ConfigMap with `sharing.timeSlicing.resources[].replicas: 4`, point the GPU Operator ClusterPolicy at it (`spec.devicePlugin.config.name` / `.default`), and each physical GPU is advertised as 4 `nvidia.com/gpu`. Pods take turns on the GPU via CUDA time-slicing. It works on any NVIDIA GPU, but there is **no memory or fault isolation** — every pod can allocate all of the VRAM. For isolation, see [time-slicing vs MIG vs MPS](/recipes/ai/kubernetes-gpu-sharing-mps-mig/).

## When Time-Slicing Fits

Notebooks, dev/test inference, CI jobs and other bursty, low-utilization workloads that would otherwise each hold a whole GPU. Not for training or latency-SLA inference: contention between pods is unbounded.

## Step 1: Create the Device Plugin Config

Each key is a named profile; nodes pick one.

```yaml
apiVersion: v1
kind: ConfigMap
metadata:
  name: device-plugin-config
  namespace: gpu-operator
data:
  default: |-
    version: v1
    sharing:
      timeSlicing:
        renameByDefault: false
        failRequestsGreaterThanOne: true
        resources:
          - name: nvidia.com/gpu
            replicas: 4
  dev: |-
    version: v1
    sharing:
      timeSlicing:
        renameByDefault: false
        failRequestsGreaterThanOne: true
        resources:
          - name: nvidia.com/gpu
            replicas: 8
  no-sharing: |-
    version: v1
```

- `replicas` — how many shares each GPU is advertised as.
- `failRequestsGreaterThanOne: true` — reject containers requesting more than one share (`UnexpectedAdmissionError`). Two shares of the same GPU give no extra performance, so this prevents a false sense of capacity.
- `renameByDefault: true` — advertise `nvidia.com/gpu.shared` instead of `nvidia.com/gpu`, so workloads must opt in to shared GPUs explicitly.

## Step 2: Point the GPU Operator at It

```bash
kubectl apply -f device-plugin-config.yaml

kubectl patch clusterpolicies.nvidia.com/cluster-policy --type merge \
  -p '{"spec":{"devicePlugin":{"config":{"name":"device-plugin-config","default":"default"}}}}'
```

Or at install time:

```bash
helm install gpu-operator nvidia/gpu-operator \
  --namespace gpu-operator --create-namespace \
  --set devicePlugin.config.name=device-plugin-config \
  --set devicePlugin.config.default=default
```

## Step 3: Per-Node Profiles

```bash
# dev nodes: 8-way sharing
kubectl label node dev-gpu-node nvidia.com/device-plugin.config=dev --overwrite

# training nodes: exclusive GPUs
kubectl label node train-gpu-node nvidia.com/device-plugin.config=no-sharing --overwrite

# unlabeled nodes use the "default" profile (4-way)
```

The device plugin's config manager picks up label changes. If you edit the ConfigMap contents, restart the plugin:

```bash
kubectl rollout restart -n gpu-operator ds/nvidia-device-plugin-daemonset
```

## Step 4: Verify

```bash
# allocatable = physical GPUs × replicas (e.g. 2 GPUs × 4 = 8)
kubectl get node gpu-node -o jsonpath='{.status.allocatable.nvidia\.com/gpu}{"\n"}'

# GPU Feature Discovery labels reflect sharing
kubectl get node gpu-node -L nvidia.com/gpu.replicas -L nvidia.com/gpu.product
# gpu.product gets a -SHARED suffix when time-slicing is active
```

Schedule four pods onto one GPU's worth of shares:

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: timeslice-test
spec:
  replicas: 4
  selector:
    matchLabels:
      app: timeslice-test
  template:
    metadata:
      labels:
        app: timeslice-test
    spec:
      containers:
        - name: cuda
          image: nvcr.io/nvidia/cuda:12.4.1-base-ubuntu22.04
          command: ["sleep", "infinity"]
          resources:
            limits:
              nvidia.com/gpu: 1
```

```bash
kubectl apply -f timeslice-test.yaml
kubectl get pods -l app=timeslice-test -o wide
kubectl exec deploy/timeslice-test -- nvidia-smi -L   # compare GPU UUIDs across pods
```

## Choosing a Replica Count

| Replicas | Typical use |
|----------|-------------|
| 1 (`no-sharing`) | Training, large models |
| 2 | Light sharing of production-ish inference |
| 4 | Mixed dev / small inference |
| 8+ | Notebooks, CI, tests |

Higher counts increase density but not capacity: four pods on a 4-way GPU each get roughly a quarter of GPU time when all are busy.

## Common Issues

### One pod's OOM breaks the others

Time-slicing doesn't partition memory. Cap usage inside the application:

```python
import torch
torch.cuda.set_per_process_memory_fraction(0.25)   # PyTorch: cap for this process
```

```bash
vllm serve <model> --gpu-memory-utilization 0.20   # vLLM pre-allocates this fraction
```

For TensorFlow, enable memory growth (`tf.config.experimental.set_memory_growth`) or set a logical device memory limit. For enforced limits use **MPS** (per-client memory/compute caps) or **MIG** — `CUDA_MPS_*` variables have no effect under plain time-slicing.

### Pods stuck Pending after a config change

Allocatable hasn't updated. Check the device plugin logs and restart it (`kubectl rollout restart -n gpu-operator ds/nvidia-device-plugin-daemonset`), then re-check `allocatable`.

### Pods rejected with UnexpectedAdmissionError

The container asked for more than one share while `failRequestsGreaterThanOne: true`. Request `nvidia.com/gpu: 1`, or move the workload to a `no-sharing` node.

### Uneven GPU time across tenants

Time-slicing gives equal time slices per process, not per tenant. For quota-aware fractional sharing and fair queueing use [KAI Scheduler](/recipes/ai/kai-scheduler-gpu-sharing/).

## Best Practices

- Keep training and SLA inference on `no-sharing` or MIG nodes; label nodes per profile.
- Set `failRequestsGreaterThanOne: true`; consider `renameByDefault: true` so sharing is opt-in.
- Watch `DCGM_FI_DEV_GPU_UTIL` and framebuffer usage per GPU to spot oversubscription.
- Enforce memory caps in the frameworks you run, since the GPU won't.

## Frequently Asked Questions

### How do I enable GPU time-slicing in Kubernetes?

With the NVIDIA GPU Operator: create a ConfigMap containing a `sharing.timeSlicing` config with the desired `replicas`, then set `spec.devicePlugin.config.name` and `.default` in the ClusterPolicy (or the equivalent Helm values). The device plugin re-advertises each GPU as that many `nvidia.com/gpu` resources.

### Does time-slicing isolate GPU memory?

No. All pods sharing a GPU see and can allocate its full memory, and a fault in one can affect the others. Use MIG for hardware isolation or MPS for enforced per-client limits.

### Does time-slicing work on any NVIDIA GPU?

Yes — unlike MIG it needs no special hardware, so it works on T4, L4, L40S, A10 and other GPUs, and it can also oversubscribe MIG slices.

### Can I use different sharing ratios on different nodes?

Yes. Put several named profiles in the ConfigMap and label nodes with `nvidia.com/device-plugin.config=<profile>`; unlabeled nodes use the ClusterPolicy default.
