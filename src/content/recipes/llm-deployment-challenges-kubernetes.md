---
title: "LLM Deployment Challenges Kubernetes"
description: "The five common LLM deployment failure modes on Kubernetes: GPU memory, cold starts, latency, autoscaling, and multi-node inference, with worked YAML."
publishDate: "2026-04-24"
updatedDate: "2026-07-06"
author: "Luca Berton"
category: "ai"
difficulty: "advanced"
timeToComplete: "30 minutes"
kubernetesVersion: "1.28+"
tags:
  - "llm"
  - "deployment"
  - "gpu-memory"
  - "cold-starts"
  - "autoscaling"
  - "inference"
relatedRecipes:
  - "vllm-openai-container-kubernetes"
  - "prefix-caching-vllm-kubernetes"
  - "lora-adapter-serving-vllm-kubernetes"
  - "distributed-multi-gpu-inference-kubernetes"
  - "cuda-out-of-memory-kubernetes"
---

> **Quick Answer:** Most LLM outages on Kubernetes come from five places: underestimating GPU memory, downloading models during pod startup, chasing CPU-based latency signals, autoscaling on the wrong metric, and attempting multi-node inference without topology-aware scheduling and tested collective networking.

## The Problem

LLM serving looks like normal API serving until production traffic arrives. Then the differences matter:

- A model can be larger than a container image by two orders of magnitude.
- GPU memory, not CPU, is usually the hard limit.
- A single replica can be both expensive and overloaded.
- Cold starts are measured in minutes when model weights are pulled at startup.
- Multi-node inference depends on fast networking, topology, and collective communication.

This article walks through the five failure modes and the Kubernetes patterns that reduce them.

## Failure Mode 1: GPU Memory Does Not Fit the Model

The most common mistake is sizing the pod for model weights only. Runtime memory also includes KV cache, framework overhead, CUDA graphs, tokenizer buffers, request queues, and temporary allocation spikes.

### Sizing Rule

```text
usable_gpu_memory =
  gpu_capacity
  * gpu_memory_utilization
  - runtime_overhead
  - kv_cache_headroom
```

For a 70B model:

| Precision | Approx weight memory | Typical placement |
| --- | ---: | --- |
| FP16/BF16 | 140 GB | 2x H100 80GB or 4x A100 40GB |
| FP8 | 70 GB | 1x H100 80GB with careful headroom |
| INT4/AWQ/GPTQ | 35 GB | 1x A100 80GB or H100 80GB |

### Worked YAML

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: llama-70b-awq
  namespace: ai-serving
spec:
  replicas: 2
  selector:
    matchLabels:
      app: llama-70b-awq
  template:
    metadata:
      labels:
        app: llama-70b-awq
    spec:
      nodeSelector:
        accelerator: a100-80gb
      containers:
        - name: vllm
          image: vllm/vllm-openai:v0.6.6
          args:
            - "--model=/models/llama-70b-awq"
            - "--quantization=awq"
            - "--dtype=half"
            - "--gpu-memory-utilization=0.88"
            - "--max-model-len=8192"
            - "--max-num-seqs=32"
            - "--served-model-name=llama-70b"
          ports:
            - containerPort: 8000
              name: http
          resources:
            requests:
              cpu: "8"
              memory: 48Gi
              nvidia.com/gpu: "1"
            limits:
              memory: 64Gi
              nvidia.com/gpu: "1"
          volumeMounts:
            - name: models
              mountPath: /models
              readOnly: true
      volumes:
        - name: models
          persistentVolumeClaim:
            claimName: llama-model-cache
```

## Failure Mode 2: Cold Starts from Model Downloads

Pulling a 40 GB to 200 GB model during pod startup makes every rollout, node drain, and scale-up painful. It also turns a small object storage issue into an inference outage.

Use a cache warming job, a ReadOnlyMany PVC when your storage supports it, or a node-local model cache for very large fleets.

### Model Cache Job

```yaml
apiVersion: batch/v1
kind: Job
metadata:
  name: warm-llama-70b-cache
  namespace: ai-serving
spec:
  backoffLimit: 2
  template:
    spec:
      restartPolicy: Never
      containers:
        - name: downloader
          image: registry.example.com/tools/hf-downloader:2026.07
          env:
            - name: HF_HOME
              value: /models/.cache
            - name: HF_TOKEN
              valueFrom:
                secretKeyRef:
                  name: huggingface-token
                  key: token
          command: ["huggingface-cli"]
          args:
            - "download"
            - "TheBloke/Llama-2-70B-AWQ"
            - "--local-dir=/models/llama-70b-awq"
            - "--local-dir-use-symlinks=False"
          resources:
            requests:
              cpu: "4"
              memory: 8Gi
            limits:
              memory: 16Gi
          volumeMounts:
            - name: models
              mountPath: /models
      volumes:
        - name: models
          persistentVolumeClaim:
            claimName: llama-model-cache
```

### Startup Probe for Slow Loads

```yaml
startupProbe:
  httpGet:
    path: /health
    port: 8000
  periodSeconds: 10
  failureThreshold: 180
readinessProbe:
  httpGet:
    path: /v1/models
    port: 8000
  periodSeconds: 5
  failureThreshold: 6
```

## Failure Mode 3: Latency Collapses Under Mixed Prompts

LLM latency has several parts:

- Time to first token depends heavily on prompt length and prefill.
- Inter-token latency depends on decode throughput.
- Queue time grows when too many requests compete for the same GPU.
- Long context requests can starve short interactive requests.

### Separate Traffic Classes

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: llama-chat-low-latency
  namespace: ai-serving
spec:
  replicas: 4
  selector:
    matchLabels:
      app: llama-chat
      tier: low-latency
  template:
    metadata:
      labels:
        app: llama-chat
        tier: low-latency
    spec:
      containers:
        - name: vllm
          image: vllm/vllm-openai:v0.6.6
          args:
            - "--model=/models/llama-70b-awq"
            - "--max-model-len=4096"
            - "--max-num-batched-tokens=8192"
            - "--max-num-seqs=24"
            - "--enable-prefix-caching"
            - "--enable-chunked-prefill"
          resources:
            limits:
              nvidia.com/gpu: "1"
              memory: 64Gi
```

### Route Long Context Elsewhere

```yaml
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: llm-router
  namespace: ai-serving
  annotations:
    nginx.ingress.kubernetes.io/proxy-read-timeout: "600"
spec:
  rules:
    - host: llm.internal.example.com
      http:
        paths:
          - path: /v1/chat/completions
            pathType: Prefix
            backend:
              service:
                name: llama-chat-low-latency
                port:
                  number: 8000
          - path: /v1/long-context
            pathType: Prefix
            backend:
              service:
                name: llama-long-context
                port:
                  number: 8000
```

## Failure Mode 4: Autoscaling on CPU

CPU is usually a weak signal for LLM capacity. A model server can be GPU-saturated while CPU looks acceptable. Autoscale on queue depth, in-flight requests, time to first token, or tokens per second.

### KEDA with Prometheus

```yaml
apiVersion: keda.sh/v1alpha1
kind: ScaledObject
metadata:
  name: llama-chat-scaler
  namespace: ai-serving
spec:
  scaleTargetRef:
    name: llama-chat-low-latency
  minReplicaCount: 2
  maxReplicaCount: 20
  pollingInterval: 15
  cooldownPeriod: 900
  advanced:
    horizontalPodAutoscalerConfig:
      behavior:
        scaleUp:
          stabilizationWindowSeconds: 60
          policies:
            - type: Percent
              value: 100
              periodSeconds: 60
        scaleDown:
          stabilizationWindowSeconds: 900
          policies:
            - type: Percent
              value: 25
              periodSeconds: 300
  triggers:
    - type: prometheus
      metadata:
        serverAddress: http://prometheus.monitoring.svc:9090
        metricName: vllm_waiting_requests
        threshold: "4"
        query: |
          avg(vllm:num_requests_waiting{namespace="ai-serving",model_name="llama-70b"})
```

### Why Scale Down Slowly

LLM replicas are expensive to create. If a pod takes six minutes to load a model, a two-minute scale-down window guarantees churn. Use longer cooldowns than web services.

## Failure Mode 5: Multi-Node Inference Without Network Validation

When a model does not fit in one node, tensor parallelism or pipeline parallelism crosses node boundaries. That changes the failure domain:

- Pods must land on compatible GPU nodes.
- GPU topology matters inside each node.
- RDMA, NCCL, or equivalent collective communication must be tested.
- All workers must start together.

### Multi-Node Placement

```yaml
apiVersion: apps/v1
kind: StatefulSet
metadata:
  name: llama-405b-tp
  namespace: ai-serving
spec:
  serviceName: llama-405b-headless
  replicas: 2
  selector:
    matchLabels:
      app: llama-405b-tp
  template:
    metadata:
      labels:
        app: llama-405b-tp
    spec:
      schedulerName: volcano
      affinity:
        podAntiAffinity:
          requiredDuringSchedulingIgnoredDuringExecution:
            - labelSelector:
                matchLabels:
                  app: llama-405b-tp
              topologyKey: kubernetes.io/hostname
      containers:
        - name: vllm
          image: vllm/vllm-openai:v0.6.6
          env:
            - name: NCCL_DEBUG
              value: INFO
            - name: NCCL_IB_DISABLE
              value: "0"
            - name: NCCL_SOCKET_IFNAME
              value: "eth0"
          args:
            - "--model=/models/llama-405b"
            - "--tensor-parallel-size=16"
            - "--pipeline-parallel-size=2"
            - "--distributed-executor-backend=ray"
            - "--gpu-memory-utilization=0.90"
          resources:
            limits:
              nvidia.com/gpu: "8"
              memory: 256Gi
```

### Preflight Test

```bash
kubectl -n ai-serving exec -it llama-405b-tp-0 -- nvidia-smi topo -m
kubectl -n ai-serving logs llama-405b-tp-0 -c vllm | grep NCCL
kubectl -n ai-serving run nccl-test --rm -it \
  --image=registry.example.com/gpu/nccl-tests:latest \
  --limits=nvidia.com/gpu=8 \
  -- ./build/all_reduce_perf -b 8M -e 8G -f 2 -g 8
```

## Observability Checklist

Track these per model, per replica, and per traffic class:

- Request queue depth.
- Time to first token.
- Inter-token latency.
- Tokens generated per second.
- Prompt tokens per second.
- GPU memory used and free.
- KV cache utilization.
- Cold start duration.
- Error rate by failure type.
- Cost per 1,000 generated tokens.

## Best Practices

- Size for KV cache, not only model weights.
- Preload models into PVCs or node-local caches before rollout.
- Use startup probes with realistic thresholds for model load time.
- Split low-latency and long-context traffic into separate pools.
- Autoscale on queue and token metrics, not CPU.
- Validate NCCL and network topology before multi-node serving.
- Keep scale-down conservative because model startup is expensive.

## Key Takeaways

- LLM serving fails differently from normal HTTP workloads.
- GPU memory and cold start behavior should be designed before the first rollout.
- Latency tuning requires batching, queue isolation, and prompt-length controls.
- Autoscaling needs inference metrics.
- Multi-node inference is a cluster networking problem as much as a model serving problem.
