---
title: "Kubernetes AI Infrastructure Scaling"
description: "Scale AI inference infrastructure on Kubernetes from 10K to 100K requests per second. Covers latency optimization, horizontal scaling, caching"
tags:
  - "ai-infrastructure"
  - "scaling"
  - "inference"
  - "performance"
  - "high-availability"
category: "ai"
publishDate: "2026-05-07"
author: "Luca Berton"
difficulty: "advanced"
relatedRecipes:
  - "nim-multinode-deployment-helm-kubernetes"
  - "kubernetes-horizontal-pod-autoscaler-v2"
  - "kyverno-llm-inference-guardrails"
  - "kubernetes-cost-optimization-strategies"
---

> 💡 **Quick Answer:** Next-generation AI infrastructure connects models to reality with fresh data, shrinks latency from 4s to sub-second, scales from 400M to 6B daily requests (10K→100K req/s), and evolves dynamically with changing use cases — all powered by Kubernetes orchestration patterns.

## The Problem

AI workloads at scale present unique infrastructure challenges:

- Models need real-time data (not stale training snapshots)
- Inference latency of 4s is unacceptable for user-facing apps
- Traffic grows from 10K to 100K requests/second
- Daily request volume scales from 400M to 6B
- Use cases change faster than infrastructure can adapt
- Fresh web data must flow into pipelines continuously

## The Solution

### Architecture: AI Infrastructure at Scale

```text
┌─────────────────────────────────────────────────────────────────┐
│                    AI Infrastructure Stack                       │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ┌───────────┐   ┌──────────────┐   ┌────────────────┐        │
│  │ Real-Time │   │ Data Pipeline│   │ Model Serving  │        │
│  │ Data Feeds│──▶│ (Streaming)  │──▶│ (GPU Cluster)  │        │
│  └───────────┘   └──────────────┘   └────────────────┘        │
│        │                                      │                 │
│        ▼                                      ▼                 │
│  ┌───────────┐   ┌──────────────┐   ┌────────────────┐        │
│  │ Web Crawl │   │ Feature Store│   │ Response Cache │        │
│  │ Pipeline  │   │ (Redis/Feast)│   │ (Semantic)     │        │
│  └───────────┘   └──────────────┘   └────────────────┘        │
│                                                                 │
│  Scaling: 10K → 100K req/s | Latency: 4s → <500ms            │
│  Volume: 400M → 6B requests/day                                │
└─────────────────────────────────────────────────────────────────┘
```

### 1. Connect Models to Reality (Real-Time Data)

```yaml
# Streaming data pipeline feeding AI models
apiVersion: apps/v1
kind: Deployment
metadata:
  name: data-connector
  namespace: ai-pipeline
spec:
  replicas: 5
  selector:
    matchLabels:
      app: data-connector
  template:
    spec:
      containers:
        - name: connector
          image: registry.example.com/ai/data-connector:2.1
          env:
            - name: KAFKA_BROKERS
              value: "kafka-0.kafka:9092,kafka-1.kafka:9092,kafka-2.kafka:9092"
            - name: TOPICS
              value: "web-events,user-signals,market-data"
            - name: BATCH_SIZE
              value: "1000"
            - name: FLUSH_INTERVAL_MS
              value: "100"
          resources:
            requests:
              cpu: 500m
              memory: 1Gi
            limits:
              cpu: 2000m
              memory: 4Gi
---
# Feature store for real-time model context
apiVersion: apps/v1
kind: StatefulSet
metadata:
  name: feature-store
  namespace: ai-pipeline
spec:
  replicas: 3
  selector:
    matchLabels:
      app: feature-store
  template:
    spec:
      containers:
        - name: feast
          image: feastdev/feature-server:0.40
          args: ["serve", "--host", "0.0.0.0", "--port", "6566"]
          ports:
            - containerPort: 6566
          resources:
            requests:
              cpu: 1000m
              memory: 4Gi
```

### 2. Fresh Web Data into Pipelines

```yaml
# Web scraping/crawling pipeline with rate limiting
apiVersion: batch/v1
kind: CronJob
metadata:
  name: web-data-refresh
  namespace: ai-pipeline
spec:
  schedule: "*/5 * * * *"    # Every 5 minutes
  concurrencyPolicy: Replace
  jobTemplate:
    spec:
      template:
        spec:
          containers:
            - name: crawler
              image: registry.example.com/ai/web-crawler:1.3
              env:
                - name: TARGET_SOURCES
                  value: "news,docs,forums"
                - name: OUTPUT_TOPIC
                  value: "raw-web-content"
                - name: MAX_PAGES_PER_RUN
                  value: "10000"
                - name: VECTORIZE
                  value: "true"
              resources:
                requests:
                  cpu: 2000m
                  memory: 8Gi
          restartPolicy: OnFailure
```

### 3. Evolve with Changing Use Cases (Dynamic Model Routing)

```yaml
# Model router that directs traffic based on use case
apiVersion: apps/v1
kind: Deployment
metadata:
  name: model-router
  namespace: ai-serving
spec:
  replicas: 10
  selector:
    matchLabels:
      app: model-router
  template:
    spec:
      containers:
        - name: router
          image: registry.example.com/ai/model-router:3.0
          env:
            - name: ROUTING_CONFIG
              value: |
                rules:
                  - path: /v1/chat
                    model: llama-3.1-70b
                    pool: gpu-large
                  - path: /v1/embeddings
                    model: bge-large-en
                    pool: gpu-small
                  - path: /v1/code
                    model: codellama-34b
                    pool: gpu-medium
                  - path: /v1/vision
                    model: llava-next
                    pool: gpu-large
                fallback:
                  model: mistral-7b
                  pool: gpu-small
          resources:
            requests:
              cpu: 1000m
              memory: 512Mi
---
# KEDA-driven scaling per model pool
apiVersion: keda.sh/v1alpha1
kind: ScaledObject
metadata:
  name: gpu-large-scaler
  namespace: ai-serving
spec:
  scaleTargetRef:
    name: llama-70b-inference
  minReplicaCount: 2
  maxReplicaCount: 20
  triggers:
    - type: prometheus
      metadata:
        query: |
          sum(rate(inference_requests_total{model="llama-3.1-70b"}[1m]))
        threshold: "50"
```

### 4. Shrink Latency from 4s to Sub-Second

```yaml
# Semantic response cache (avoid redundant inference)
apiVersion: apps/v1
kind: Deployment
metadata:
  name: semantic-cache
  namespace: ai-serving
spec:
  replicas: 5
  selector:
    matchLabels:
      app: semantic-cache
  template:
    spec:
      containers:
        - name: cache
          image: registry.example.com/ai/semantic-cache:1.2
          env:
            - name: SIMILARITY_THRESHOLD
              value: "0.95"
            - name: REDIS_URL
              value: "redis://redis-cluster:6379"
            - name: EMBEDDING_MODEL
              value: "bge-small-en"
            - name: CACHE_TTL_SECONDS
              value: "3600"
          resources:
            requests:
              cpu: 2000m
              memory: 4Gi
              nvidia.com/gpu: "1"    # GPU for embedding computation
---
# Model optimization: quantization + batching
apiVersion: apps/v1
kind: Deployment
metadata:
  name: llama-70b-inference
  namespace: ai-serving
spec:
  replicas: 4
  selector:
    matchLabels:
      app: llama-70b
  template:
    spec:
      containers:
        - name: vllm
          image: vllm/vllm-openai:0.8.0
          args:
            - "--model=/models/llama-3.1-70b-awq"
            - "--quantization=awq"
            - "--max-model-len=8192"
            - "--tensor-parallel-size=4"
            - "--enable-prefix-caching"     # KV cache reuse
            - "--max-num-batched-tokens=32768"
            - "--gpu-memory-utilization=0.92"
          resources:
            requests:
              nvidia.com/gpu: "4"
            limits:
              nvidia.com/gpu: "4"
          readinessProbe:
            httpGet:
              path: /health
              port: 8000
            initialDelaySeconds: 120
```

### 5. Scale from 400M to 6B Daily Requests

```yaml
# HPA for inference fleet
apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata:
  name: inference-hpa
  namespace: ai-serving
spec:
  scaleTargetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: llama-70b-inference
  minReplicas: 4
  maxReplicas: 50
  metrics:
    - type: Pods
      pods:
        metric:
          name: inference_queue_depth
        target:
          type: AverageValue
          averageValue: "10"
    - type: Resource
      resource:
        name: cpu
        target:
          type: Utilization
          averageUtilization: 70
  behavior:
    scaleUp:
      stabilizationWindowSeconds: 60
      policies:
        - type: Pods
          value: 4
          periodSeconds: 60
    scaleDown:
      stabilizationWindowSeconds: 300
      policies:
        - type: Percent
          value: 10
          periodSeconds: 60
---
# Karpenter NodePool for GPU autoscaling
apiVersion: karpenter.sh/v1
kind: NodePool
metadata:
  name: gpu-inference
spec:
  template:
    spec:
      requirements:
        - key: node.kubernetes.io/instance-type
          operator: In
          values: ["p4d.24xlarge", "p5.48xlarge"]
        - key: karpenter.sh/capacity-type
          operator: In
          values: ["on-demand"]
      nodeClassRef:
        name: gpu-nodes
  limits:
    nvidia.com/gpu: "200"
  disruption:
    consolidationPolicy: WhenEmpty
    consolidateAfter: 600s    # 10min idle before removing GPU node
```

### 6. Grow from 10K to 100K req/s

```yaml
# Multi-layer scaling strategy
# Layer 1: Semantic cache (70% hit rate = 70K req/s served from cache)
# Layer 2: Model batching (batch 32 requests = 32x throughput)
# Layer 3: Horizontal Pod scaling (4→50 replicas)
# Layer 4: Node autoscaling (Karpenter provisions GPU nodes)

# Load balancing across inference replicas
apiVersion: v1
kind: Service
metadata:
  name: inference-gateway
  namespace: ai-serving
  annotations:
    service.beta.kubernetes.io/aws-load-balancer-type: nlb
    service.beta.kubernetes.io/aws-load-balancer-cross-zone-load-balancing-enabled: "true"
spec:
  type: LoadBalancer
  selector:
    app: model-router
  ports:
    - port: 443
      targetPort: 8080
      protocol: TCP
  sessionAffinity: None    # Stateless inference = round-robin

---
# Request queue for burst absorption
apiVersion: apps/v1
kind: Deployment
metadata:
  name: request-queue
  namespace: ai-serving
spec:
  replicas: 3
  selector:
    matchLabels:
      app: request-queue
  template:
    spec:
      containers:
        - name: queue
          image: registry.example.com/ai/request-queue:1.0
          env:
            - name: MAX_QUEUE_DEPTH
              value: "50000"
            - name: TIMEOUT_MS
              value: "30000"
            - name: PRIORITY_LEVELS
              value: "3"    # premium, standard, batch
          resources:
            requests:
              cpu: 2000m
              memory: 8Gi
```

### Monitoring at Scale

```bash
# Key metrics for AI infrastructure at 100K req/s
# Latency percentiles
inference_request_duration_seconds{quantile="0.5"}   # Target: <200ms
inference_request_duration_seconds{quantile="0.95"}  # Target: <500ms
inference_request_duration_seconds{quantile="0.99"}  # Target: <1s

# Throughput
sum(rate(inference_requests_total[1m]))               # Current req/s
sum(rate(inference_tokens_generated_total[1m]))       # Tokens/s

# Cache effectiveness
semantic_cache_hit_ratio                              # Target: >70%
semantic_cache_latency_seconds{quantile="0.95"}       # Target: <10ms

# GPU utilization
DCGM_FI_DEV_GPU_UTIL                                 # Target: >80%
DCGM_FI_DEV_MEM_COPY_UTIL                           # Memory bandwidth

# Queue depth (burst indicator)
request_queue_depth                                   # Alert if >10000
request_queue_timeout_total                           # Alert if increasing
```

## Common Issues

### Latency spikes during model loading
- **Cause**: Cold start when new replicas initialize (loading 70B model = 2-5min)
- **Fix**: Pre-warm replicas; minReplicas high enough; use model sharding

### GPU memory fragmentation at scale
- **Cause**: Variable sequence lengths cause KV cache fragmentation
- **Fix**: Use vLLM PagedAttention; set `--max-model-len` explicitly

### Cache poisoning with stale responses
- **Cause**: Semantic cache returns outdated answers for time-sensitive queries
- **Fix**: TTL per query type; bypass cache for real-time data queries

### Cluster autoscaler too slow for GPU nodes
- **Cause**: GPU instances take 5-10min to provision
- **Fix**: Over-provision by 20%; use Karpenter with pre-configured AMIs

## Best Practices

1. **Cache first** — 70%+ of inference requests are semantically similar
2. **Batch aggressively** — continuous batching gives 10-30x throughput
3. **Quantize models** — AWQ/GPTQ: same quality at 2-4x speed
4. **Prefix caching** — reuse KV cache for common system prompts
5. **Priority queues** — premium users skip the queue during bursts
6. **Pre-warm GPU nodes** — don't wait for Karpenter during traffic spikes
7. **Monitor tokens/s not just req/s** — long responses consume more GPU time

## Key Takeaways

- AI infrastructure scales through 4 layers: cache → batching → Pods → nodes
- Semantic caching eliminates 70%+ redundant GPU computation
- Latency: 4s → sub-second via quantization, batching, and caching
- 100K req/s achievable with ~50 GPU replicas + semantic cache + request queue
- Karpenter/cluster-autoscaler provisions GPU nodes on demand (5-10min lead time)
- Fresh data pipelines (Kafka + feature store) keep models connected to reality
- Dynamic model routing enables evolving use cases without infrastructure changes
- Key metrics: P95 latency, cache hit ratio, GPU utilization, queue depth
