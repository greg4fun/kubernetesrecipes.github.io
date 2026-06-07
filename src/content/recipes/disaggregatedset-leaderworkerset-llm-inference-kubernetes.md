---
title: "DisaggregatedSet for Multi-Role LLM Inference"
description: "Deploy disaggregated LLM inference on Kubernetes with DisaggregatedSet and LeaderWorkerSet. Separate prefill and decode phases across GPU pools"
tags:
  - "leaderworkerset"
  - "disaggregated-inference"
  - "llm"
  - "vllm"
  - "multi-node"
  - "gpu"
category: "ai"
publishDate: "2026-05-26"
author: "Luca Berton"
difficulty: "advanced"
relatedRecipes:
  - "runai-distributed-inference-vllm-nccl"
  - "distributed-inference-kubernetes"
  - "lws-multi-node-distributed-inference"
  - "nim-multinode-deployment-helm-kubernetes"
  - "integrate-disaggregatedset-llmd-kubernetes"
---

> 💡 **Quick Answer:** DisaggregatedSet (DS) is a CRD in the LeaderWorkerSet (LWS) project that orchestrates multiple LeaderWorkerSets as a single unit for disaggregated LLM inference. It manages separate roles (e.g., prefill on high-compute GPUs, decode on memory-optimized GPUs) with coordinated rolling updates, automatic headless service creation per role/revision, and unified failure handling — solving the operational complexity of manually coordinating multi-role inference deployments.

## The Problem

- LLM inference has two phases with different hardware requirements: **prefill** (compute-bound, needs fast GPUs) and **decode** (memory-bound, needs large VRAM)
- Running both phases on same hardware wastes resources — expensive compute GPUs sit idle during decode
- Deploying separate LeaderWorkerSets per role requires manual coordination of updates, scaling, and failure handling
- Rolling updates across roles can break inference if prefill and decode run incompatible versions
- No built-in mechanism to ensure all roles are ready before routing traffic
- Configuration drift between separately managed roles causes subtle failures

## The Solution

### Architecture Overview

```text
┌─────────────────────────────────────────────────────────────────┐
│ DisaggregatedSet (single CRD)                                    │
│                                                                   │
│  ┌──────────────────────┐    ┌──────────────────────────────┐   │
│  │ Role: prefill         │    │ Role: decode                  │   │
│  │ (LeaderWorkerSet)     │    │ (LeaderWorkerSet)             │   │
│  │                       │    │                               │   │
│  │ Replica 0:            │    │ Replica 0:                    │   │
│  │  Leader + 3 Workers   │    │  Leader + 1 Worker            │   │
│  │  (4x H100 each)       │    │  (2x A100-80GB each)          │   │
│  │                       │    │                               │   │
│  │ Replica 1:            │    │ Replica 1:                    │   │
│  │  Leader + 3 Workers   │    │  Leader + 1 Worker            │   │
│  │                       │    │                               │   │
│  └──────────┬───────────┘    └──────────────┬───────────────┘   │
│             │                                │                    │
│  ┌──────────▼───────────┐    ┌──────────────▼───────────────┐   │
│  │ Service: prefill-rev1 │    │ Service: decode-rev1          │   │
│  │ (headless, auto)      │    │ (headless, auto)              │   │
│  └───────────────────────┘    └───────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
                          │
                          ▼
              ┌───────────────────────┐
              │ Router (llm-d / vLLM) │
              │ Routes prefill→decode │
              └───────────────────────┘
```

### Install LeaderWorkerSet (includes DisaggregatedSet)

```bash
# Install LWS controller (includes DS CRD)
kubectl apply --server-side -f \
  https://github.com/kubernetes-sigs/lws/releases/latest/download/manifests.yaml

# Verify CRDs installed
kubectl get crd | grep -E "leaderworkersets|disaggregatedsets"
# disaggregatedsets.leaderworkerset.x-k8s.io   2026-05-26T00:00:00Z
# leaderworkersets.leaderworkerset.x-k8s.io    2026-05-26T00:00:00Z

# Verify controller running
kubectl get pods -n lws-system
# NAME                              READY   STATUS    RESTARTS   AGE
# lws-controller-manager-xxx        1/1     Running   0          1m
```

### Deploy Disaggregated vLLM Inference

```yaml
apiVersion: leaderworkerset.x-k8s.io/v1alpha1
kind: DisaggregatedSet
metadata:
  name: llama-70b-disaggregated
  namespace: inference
spec:
  roles:
    # Prefill role: compute-intensive, needs fast GPUs
    - name: prefill
      metadata:
        labels:
          role: prefill
        annotations:
          leaderworkerset.sigs.k8s.io/exclusive-topology: "topology.kubernetes.io/zone"
      spec:
        replicas: 2
        leaderWorkerTemplate:
          size: 4    # 1 leader + 3 workers = 4 pods per replica
          restartPolicy: RecreateGroupOnPodRestart
          leaderTemplate:
            metadata:
              labels:
                role: prefill
                component: leader
            spec:
              containers:
                - name: vllm-prefill
                  image: vllm/vllm-openai:v0.8.0
                  args:
                    - --model=meta-llama/Llama-3.1-70B-Instruct
                    - --tensor-parallel-size=4
                    - --pipeline-parallel-size=4
                    - --enable-disagg
                    - --disagg-role=prefill
                    - --port=8000
                  env:
                    - name: NCCL_SOCKET_IFNAME
                      value: "eth0"
                    - name: HF_TOKEN
                      valueFrom:
                        secretKeyRef:
                          name: hf-token
                          key: token
                  ports:
                    - containerPort: 8000
                      name: http
                  resources:
                    limits:
                      nvidia.com/gpu: "1"
                    requests:
                      cpu: "8"
                      memory: "64Gi"
                  volumeMounts:
                    - name: shm
                      mountPath: /dev/shm
              volumes:
                - name: shm
                  emptyDir:
                    medium: Memory
                    sizeLimit: 32Gi
              nodeSelector:
                nvidia.com/gpu.product: "NVIDIA-H100-80GB-HBM3"
          workerTemplate:
            spec:
              containers:
                - name: vllm-prefill-worker
                  image: vllm/vllm-openai:v0.8.0
                  args:
                    - --model=meta-llama/Llama-3.1-70B-Instruct
                    - --tensor-parallel-size=4
                    - --pipeline-parallel-size=4
                    - --enable-disagg
                    - --disagg-role=prefill
                  env:
                    - name: NCCL_SOCKET_IFNAME
                      value: "eth0"
                    - name: HF_TOKEN
                      valueFrom:
                        secretKeyRef:
                          name: hf-token
                          key: token
                  resources:
                    limits:
                      nvidia.com/gpu: "1"
                    requests:
                      cpu: "8"
                      memory: "64Gi"
                  volumeMounts:
                    - name: shm
                      mountPath: /dev/shm
              volumes:
                - name: shm
                  emptyDir:
                    medium: Memory
                    sizeLimit: 32Gi
              nodeSelector:
                nvidia.com/gpu.product: "NVIDIA-H100-80GB-HBM3"

    # Decode role: memory-intensive, can use cheaper GPUs
    - name: decode
      metadata:
        labels:
          role: decode
      spec:
        replicas: 4    # More decode replicas (decode is the bottleneck)
        leaderWorkerTemplate:
          size: 2    # 1 leader + 1 worker per replica
          restartPolicy: RecreateGroupOnPodRestart
          leaderTemplate:
            metadata:
              labels:
                role: decode
                component: leader
            spec:
              containers:
                - name: vllm-decode
                  image: vllm/vllm-openai:v0.8.0
                  args:
                    - --model=meta-llama/Llama-3.1-70B-Instruct
                    - --tensor-parallel-size=2
                    - --enable-disagg
                    - --disagg-role=decode
                    - --port=8000
                  env:
                    - name: NCCL_SOCKET_IFNAME
                      value: "eth0"
                    - name: HF_TOKEN
                      valueFrom:
                        secretKeyRef:
                          name: hf-token
                          key: token
                  ports:
                    - containerPort: 8000
                      name: http
                  resources:
                    limits:
                      nvidia.com/gpu: "1"
                    requests:
                      cpu: "4"
                      memory: "96Gi"
                  volumeMounts:
                    - name: shm
                      mountPath: /dev/shm
              volumes:
                - name: shm
                  emptyDir:
                    medium: Memory
                    sizeLimit: 32Gi
              nodeSelector:
                nvidia.com/gpu.product: "NVIDIA-A100-SXM4-80GB"
          workerTemplate:
            spec:
              containers:
                - name: vllm-decode-worker
                  image: vllm/vllm-openai:v0.8.0
                  args:
                    - --model=meta-llama/Llama-3.1-70B-Instruct
                    - --tensor-parallel-size=2
                    - --enable-disagg
                    - --disagg-role=decode
                  env:
                    - name: NCCL_SOCKET_IFNAME
                      value: "eth0"
                    - name: HF_TOKEN
                      valueFrom:
                        secretKeyRef:
                          name: hf-token
                          key: token
                  resources:
                    limits:
                      nvidia.com/gpu: "1"
                    requests:
                      cpu: "4"
                      memory: "96Gi"
                  volumeMounts:
                    - name: shm
                      mountPath: /dev/shm
              volumes:
                - name: shm
                  emptyDir:
                    medium: Memory
                    sizeLimit: 32Gi
              nodeSelector:
                nvidia.com/gpu.product: "NVIDIA-A100-SXM4-80GB"
```

### How DisaggregatedSet Works

```text
DisaggregatedSet Controller Logic:
───────────────────────────────────────────────────────────────────

1. CREATE: For each role in spec.roles[]:
   → Creates a LeaderWorkerSet with name: <ds-name>-<role-name>
   → Creates a headless Service: <ds-name>-<role-name>-<revision>

2. UPDATE (N-Dimensional Rolling Update):
   → Scale UP new revision for ALL roles simultaneously
   → Wait until new replicas are Ready across ALL roles
   → Scale DOWN old revision for ALL roles simultaneously
   → Maintains capacity ratio: prefill:decode stays constant

3. FAILURE:
   → If any pod in a role group fails → RecreateGroupOnPodRestart
   → Coordinated drain across roles if needed
   → Controller is stateless — derives state from observed resources

4. SERVICE ORCHESTRATION:
   → Headless Service per role per revision
   → Enables revision-aware routing (new traffic → new revision only)
   → Old services cleaned up after successful rollout
```

### N-Dimensional Rolling Update

```yaml
# When you update the DS spec (e.g., new vLLM image version):
# The controller performs coordinated rollout across ALL roles

# Example: updating from v0.7.0 to v0.8.0
# With 2 prefill replicas and 4 decode replicas:

# Step 1: Scale up new revision
#   prefill: 2 old + 1 new (surge)
#   decode:  4 old + 2 new (surge, maintains 1:2 ratio)

# Step 2: Verify new replicas healthy
#   All pods in new replicas must be Ready
#   Services for new revision created and receiving traffic

# Step 3: Scale down old revision
#   prefill: 2 old → 1 old (drain 1)
#   decode:  4 old → 2 old (drain 2, maintains ratio)

# Step 4: Repeat until complete
#   prefill: 0 old + 2 new ✓
#   decode:  0 old + 4 new ✓

# Key invariant: The ratio between roles is ALWAYS maintained
# If prefill has 2 replicas and decode has 4, the 1:2 ratio
# is preserved at every step of the rollout
```

### Automatic Service Orchestration

```yaml
# DisaggregatedSet automatically creates these Services:

# For prefill role, revision 1:
apiVersion: v1
kind: Service
metadata:
  name: llama-70b-disaggregated-prefill-rev1
  namespace: inference
  labels:
    leaderworkerset.x-k8s.io/disaggregated-set: llama-70b-disaggregated
    leaderworkerset.x-k8s.io/role: prefill
    leaderworkerset.x-k8s.io/revision: "1"
spec:
  clusterIP: None    # Headless for direct pod addressing
  selector:
    leaderworkerset.x-k8s.io/name: llama-70b-disaggregated-prefill
    leaderworkerset.x-k8s.io/revision: "1"
  ports:
    - port: 8000
      targetPort: http
---
# For decode role, revision 1:
apiVersion: v1
kind: Service
metadata:
  name: llama-70b-disaggregated-decode-rev1
  namespace: inference
  labels:
    leaderworkerset.x-k8s.io/disaggregated-set: llama-70b-disaggregated
    leaderworkerset.x-k8s.io/role: decode
    leaderworkerset.x-k8s.io/revision: "1"
spec:
  clusterIP: None
  selector:
    leaderworkerset.x-k8s.io/name: llama-70b-disaggregated-decode
    leaderworkerset.x-k8s.io/revision: "1"
  ports:
    - port: 8000
      targetPort: http
```

### Integration with llm-d Router

```yaml
# llm-d (CNCF sandbox) provides the routing layer
# that connects prefill and decode services
apiVersion: apps/v1
kind: Deployment
metadata:
  name: llm-d-router
  namespace: inference
spec:
  replicas: 2
  selector:
    matchLabels:
      app: llm-d-router
  template:
    metadata:
      labels:
        app: llm-d-router
    spec:
      containers:
        - name: router
          image: ghcr.io/llm-d/llm-d-router:latest
          args:
            - --prefill-service=llama-70b-disaggregated-prefill-rev1.inference.svc
            - --decode-service=llama-70b-disaggregated-decode-rev1.inference.svc
            - --port=8080
            - --scheduling-policy=least-loaded
          ports:
            - containerPort: 8080
              name: http
          resources:
            requests:
              cpu: "2"
              memory: "4Gi"
---
apiVersion: v1
kind: Service
metadata:
  name: llm-inference
  namespace: inference
spec:
  selector:
    app: llm-d-router
  ports:
    - port: 80
      targetPort: 8080
  type: ClusterIP
```

### Monitor DisaggregatedSet Status

```bash
# Check overall DS status
kubectl get disaggregatedsets -n inference
# NAME                       ROLES   READY   AGE
# llama-70b-disaggregated    2       True    1h

# Detailed status
kubectl get ds llama-70b-disaggregated -n inference -o yaml | \
  yq '.status'
# conditions:
# - type: Available
#   status: "True"
# - type: Progressing
#   status: "False"
# roleStatuses:
# - name: prefill
#   replicas: 2
#   readyReplicas: 2
#   currentRevision: "rev1"
# - name: decode
#   replicas: 4
#   readyReplicas: 4
#   currentRevision: "rev1"

# Check underlying LeaderWorkerSets
kubectl get lws -n inference
# NAME                                    REPLICAS   READY   AGE
# llama-70b-disaggregated-prefill         2          2       1h
# llama-70b-disaggregated-decode          4          4       1h

# Check pods per role
kubectl get pods -n inference -l leaderworkerset.x-k8s.io/role=prefill
kubectl get pods -n inference -l leaderworkerset.x-k8s.io/role=decode

# Check auto-created services
kubectl get svc -n inference -l leaderworkerset.x-k8s.io/disaggregated-set=llama-70b-disaggregated
```

### LeaderWorkerSet Concepts (Foundation)

```yaml
# DisaggregatedSet builds on LWS — understanding LWS is key:
#
# LeaderWorkerSet = group of pods as a unit of replication
#
# Key LWS features used by DS:
# - size: total pods per replica (leader + workers)
# - restartPolicy: RecreateGroupOnPodRestart (all-or-nothing)
# - exclusive-topology: co-locate pods on same rack/zone
# - gang scheduling: all pods scheduled together or not at all
#
# Pod naming convention:
#   <lws-name>-<replica-index>          ← leader pod
#   <lws-name>-<replica-index>-<worker> ← worker pods
#
# Example for prefill with 2 replicas, size=4:
#   llama-70b-disaggregated-prefill-0         (leader, replica 0)
#   llama-70b-disaggregated-prefill-0-1       (worker 1, replica 0)
#   llama-70b-disaggregated-prefill-0-2       (worker 2, replica 0)
#   llama-70b-disaggregated-prefill-0-3       (worker 3, replica 0)
#   llama-70b-disaggregated-prefill-1         (leader, replica 1)
#   llama-70b-disaggregated-prefill-1-1       (worker 1, replica 1)
#   ...
```

### HPA Scaling per Role

```yaml
# Scale decode independently (it's the throughput bottleneck)
apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata:
  name: decode-scaler
  namespace: inference
spec:
  scaleTargetRef:
    apiVersion: leaderworkerset.x-k8s.io/v1
    kind: LeaderWorkerSet
    name: llama-70b-disaggregated-decode
  minReplicas: 2
  maxReplicas: 8
  metrics:
    - type: Pods
      pods:
        metric:
          name: vllm_num_requests_waiting
        target:
          type: AverageValue
          averageValue: "10"
```

## Common Issues

### Pods stuck Pending — gang scheduling can't find enough nodes
- **Cause**: Exclusive topology requires all pods in a replica on same rack/zone
- **Fix**: Ensure enough GPU nodes per zone; or relax topology constraint

### Rolling update stuck — new revision pods not becoming Ready
- **Cause**: Model download takes time; or GPU resources unavailable for surge replicas
- **Fix**: Pre-pull model images; ensure headroom for surge capacity (at least 1 extra replica worth of GPUs)

### Prefill and decode services can't communicate
- **Cause**: Network policy blocking inter-namespace or inter-role traffic
- **Fix**: Allow traffic between pods with DS labels; verify headless service DNS resolves

### "role names must be unique" validation error
- **Cause**: Two roles in spec share the same name
- **Fix**: Each role needs a unique name (regex: `^[a-z0-9]([-a-z0-9]*[a-z0-9])?$`)

### "replicas must be zero for all roles or non-zero for all roles"
- **Cause**: Mixed zero/non-zero replicas across roles
- **Fix**: Either all roles have replicas > 0, or all are 0 (paused)

## Best Practices

1. **Size decode > prefill replicas** — decode is typically the throughput bottleneck (2:1 or 3:1 ratio)
2. **Use RecreateGroupOnPodRestart** — ensures all pods in a tensor-parallel group restart together
3. **Exclusive topology for prefill** — co-locate on same switch for NVLink/NCCL performance
4. **Pre-pull model images** — avoids 10+ minute delays during rollout surge
5. **Use llm-d for routing** — co-designed with DisaggregatedSet, handles revision-aware traffic splitting
6. **Monitor per-role metrics** — prefill latency (p99 TTFT) and decode throughput (tokens/sec) independently
7. **2-10 roles supported** — most deployments use 2 (prefill + decode); advanced setups add embedding, routing, KV-cache roles
8. **Stateless controller** — safe to restart at any time; derives all state from observed resources

## Key Takeaways

- DisaggregatedSet manages multiple LeaderWorkerSets as one unit for disaggregated LLM inference
- Separates prefill (compute-bound) from decode (memory-bound) on different GPU hardware
- N-dimensional rolling update keeps role ratios constant throughout the rollout
- Automatic headless services per role per revision enable revision-aware routing
- Co-designed with llm-d (CNCF sandbox) for production-grade disaggregated serving
- Supports 2-10 roles — extensible beyond just prefill/decode
- Built on LWS primitives: gang scheduling, exclusive topology, all-or-nothing restart
- Controller is stateless — derives state from observed resources, safe to restart anytime
