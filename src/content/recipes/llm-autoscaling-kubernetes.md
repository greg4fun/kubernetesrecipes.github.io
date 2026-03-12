---
title: "Autoscale LLM Inference on Kubernetes"
description: "Configure Horizontal Pod Autoscaling and KEDA for LLM workloads using GPU utilization, request queue depth, and custom metrics."
category: "ai"
difficulty: "advanced"
timeToComplete: "30 minutes"
kubernetesVersion: "1.28+"
prerequisites:
  - "Working LLM inference deployment (vLLM or NIM)"
  - "Metrics Server or Prometheus installed"
  - "NVIDIA DCGM Exporter for GPU metrics"
relatedRecipes:
  - "triton-autoscaling-gpu-metrics"
  - "model-caching-shared-memory"
  - "deploy-mistral-vllm-kubernetes"
  - "deploy-mistral-nvidia-nim"
  - "nvidia-gpu-operator-install"
  - "cluster-autoscaler"
  - "llm-serving-frameworks-compared"
tags:
  - autoscaling
  - hpa
  - keda
  - llm
  - inference
  - gpu
  - scaling
  - ai-workloads
publishDate: "2026-02-16"
author: "Luca Berton"
---

> 💡 **Quick Answer:** Use KEDA with Prometheus triggers to autoscale LLM replicas based on request queue depth or GPU utilization. Standard HPA works for CPU-based metrics. For GPU-aware scaling, scrape DCGM metrics (`DCGM_FI_DEV_GPU_UTIL`) or vLLM's built-in `/metrics` endpoint (`vllm:num_requests_waiting`). Set `minReplicas: 1` to avoid cold-start delays.


LLM inference workloads have variable demand. Autoscaling saves GPU costs during low traffic and prevents latency spikes during peaks.

## Scaling Challenges for LLMs

| Challenge | Impact | Solution |
|---|---|---|
| Slow model loading | 30–120s cold start | Keep `minReplicas ≥ 1` |
| GPU allocation | Must reserve full GPU per replica | Use GPU fractioning or time-slicing |
| Memory requirements | Each replica needs full model in VRAM | Plan total GPU budget |
| Batch processing | vLLM batches dynamically | Scale on queue depth, not CPU |

## Strategy 1: HPA with Custom Metrics

### vLLM Prometheus Metrics

vLLM exposes metrics at `/metrics`:

```bash
curl http://mistral-vllm:8000/metrics | grep vllm
```

Key scaling metrics:

| Metric | Description | Good for Scaling? |
|---|---|---|
| `vllm:num_requests_running` | Active requests | Yes |
| `vllm:num_requests_waiting` | Queued requests | Best |
| `vllm:avg_generation_throughput_toks_per_s` | Token throughput | Informational |
| `vllm:gpu_cache_usage_perc` | KV cache utilization | Yes |

### Prometheus ServiceMonitor

```yaml
# vllm-servicemonitor.yaml
apiVersion: monitoring.coreos.com/v1
kind: ServiceMonitor
metadata:
  name: vllm-metrics
  namespace: ai-inference
spec:
  selector:
    matchLabels:
      app: mistral-vllm
  endpoints:
    - port: http
      path: /metrics
      interval: 15s
```

### HPA with Prometheus Adapter

```yaml
# vllm-hpa.yaml
apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata:
  name: mistral-vllm-hpa
  namespace: ai-inference
spec:
  scaleTargetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: mistral-vllm
  minReplicas: 1
  maxReplicas: 4
  metrics:
    - type: Pods
      pods:
        metric:
          name: vllm_num_requests_waiting
        target:
          type: AverageValue
          averageValue: "5"    # Scale up when >5 requests queued per pod
  behavior:
    scaleUp:
      stabilizationWindowSeconds: 60
      policies:
        - type: Pods
          value: 1
          periodSeconds: 120    # Add 1 replica every 2 min max
    scaleDown:
      stabilizationWindowSeconds: 300
      policies:
        - type: Pods
          value: 1
          periodSeconds: 300    # Remove 1 replica every 5 min max
```

**Scale-down is deliberately slow** because each replica holds significant GPU resources and model reload is expensive.

## Strategy 2: KEDA (Recommended)

KEDA provides richer trigger options and simpler configuration than raw HPA + Prometheus Adapter.

### Install KEDA

```bash
helm repo add kedacore https://kedacore.github.io/charts
helm repo update
helm install keda kedacore/keda \
  --namespace keda \
  --create-namespace
```

### KEDA ScaledObject for vLLM

```yaml
# vllm-keda-scaledobject.yaml
apiVersion: keda.sh/v1alpha1
kind: ScaledObject
metadata:
  name: mistral-vllm-keda
  namespace: ai-inference
spec:
  scaleTargetRef:
    name: mistral-vllm
  minReplicaCount: 1
  maxReplicaCount: 4
  cooldownPeriod: 300            # Wait 5 min before scaling down
  pollingInterval: 30
  triggers:
    # Scale on queued requests
    - type: prometheus
      metadata:
        serverAddress: http://prometheus.monitoring.svc.cluster.local:9090
        metricName: vllm_waiting_requests
        query: |
          sum(vllm:num_requests_waiting{namespace="ai-inference"})
        threshold: "10"          # Scale up when total queue > 10
    # Optional: scale on GPU utilization
    - type: prometheus
      metadata:
        serverAddress: http://prometheus.monitoring.svc.cluster.local:9090
        metricName: gpu_utilization
        query: |
          avg(DCGM_FI_DEV_GPU_UTIL{namespace="ai-inference"})
        threshold: "85"          # Scale up when avg GPU util > 85%
```

### KEDA with Scale-to-Zero

For non-production or cost-sensitive environments:

```yaml
spec:
  minReplicaCount: 0             # Scale to zero when idle
  maxReplicaCount: 3
  idleReplicaCount: 0
  cooldownPeriod: 600            # 10 min idle before scaling to zero
```

**Warning:** Scale-to-zero means 30–120 second cold start on the next request (model must reload into GPU memory).

## Strategy 3: GPU-Metric-Based HPA

Using DCGM GPU metrics directly:

```yaml
# gpu-hpa.yaml
apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata:
  name: llm-gpu-hpa
  namespace: ai-inference
spec:
  scaleTargetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: mistral-vllm
  minReplicas: 1
  maxReplicas: 4
  metrics:
    - type: Pods
      pods:
        metric:
          name: DCGM_FI_DEV_GPU_UTIL
        target:
          type: AverageValue
          averageValue: "80"     # Scale when GPU util > 80%
```

Requires the Prometheus Adapter to expose DCGM metrics as custom metrics API.

## Run:ai Autoscaling

If using Run:ai, configure replica autoscaling in the UI:

| Field | Value |
|---|---|
| Minimum replicas | 1 |
| Maximum replicas | 4 |
| Scale-to-zero | Never (production) or after idle period |

Run:ai handles GPU allocation and quota management automatically.

## Monitoring Autoscaling

```bash
# Check HPA status
kubectl get hpa -n ai-inference

# Watch KEDA ScaledObject
kubectl get scaledobject -n ai-inference

# Check current replicas
kubectl get deployment mistral-vllm -n ai-inference

# View scaling events
kubectl get events -n ai-inference --sort-by=.lastTimestamp | grep -i "scal"
```

## Recommended Autoscaling Settings

| Environment | Min Replicas | Max Replicas | Scale-to-Zero | Cooldown |
|---|---|---|---|---|
| Production | 2 | 8 | No | 5–10 min |
| Staging | 1 | 3 | Optional | 5 min |
| Development | 0 | 2 | Yes | 2 min |

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| HPA shows `<unknown>` | Metrics not being scraped | Check ServiceMonitor and Prometheus targets |
| Never scales up | Threshold too high | Lower threshold; check metric values |
| Scales up and down rapidly | No stabilization window | Increase `stabilizationWindowSeconds` |
| New replica not serving | Model still loading | Increase readiness probe `initialDelaySeconds` |

## Related Recipes

- [Deploy Mistral with vLLM](/recipes/ai/deploy-mistral-vllm-kubernetes/)
- [Deploy Mistral with NVIDIA NIM](/recipes/ai/deploy-mistral-nvidia-nim/)
- [Install NVIDIA GPU Operator](/recipes/ai/nvidia-gpu-operator-install/)
- [Cluster Autoscaler](/recipes/autoscaling/cluster-autoscaler/)
