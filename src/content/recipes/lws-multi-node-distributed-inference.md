---
title: "LeaderWorkerSet Multi-Node Inference on K8s"
description: "Deploy multi-node distributed inference using LeaderWorkerSet (LWS) operator on Kubernetes. Covers vLLM pipeline parallelism across nodes for 405B+ parameter"
tags:
  - "inference"
  - "distributed"
  - "lws"
  - "vllm"
  - "multi-node"
category: "ai"
publishDate: "2026-05-05"
author: "Luca Berton"
difficulty: "advanced"
relatedRecipes:
  - "distributed-multi-gpu-inference-kubernetes"
  - "genai-perf-nvidia-inference-benchmarking"
  - "multi-node-training-kubernetes"
  - "kubernetes-1-36-gang-scheduling"
---

> 💡 **Quick Answer:** LeaderWorkerSet (LWS) operator manages multi-node inference deployments where a leader Pod coordinates workers. Use it for models too large for a single node (405B+) that need pipeline parallelism across multiple 8-GPU nodes.

## The Problem

Models like Llama 3.1 405B need 10+ A100-80GB GPUs — more than fit in a single node. You need:

- A leader Pod that serves the API and coordinates inference
- Worker Pods on other nodes that hold model shards
- Reliable discovery between leader and workers
- Automatic restart if any Pod fails (all must restart together)

## The Solution

### Install LeaderWorkerSet Operator

```bash
# Install LWS CRD and controller
kubectl apply --server-side -f \
  https://github.com/kubernetes-sigs/lws/releases/download/v0.5.0/manifests.yaml

# Verify
kubectl get pods -n lws-system
```

### Deploy 405B Model Across 2 Nodes

```yaml
apiVersion: leaderworkerset.x-k8s.io/v1
kind: LeaderWorkerSet
metadata:
  name: llama-405b-inference
  namespace: inference
spec:
  replicas: 1                          # 1 replica group (leader + workers)
  leaderWorkerTemplate:
    size: 2                            # 2 Pods total (1 leader + 1 worker)
    restartPolicy: RecreateGroupOnPodRestart
    leaderTemplate:
      metadata:
        labels:
          role: leader
      spec:
        containers:
          - name: vllm
            image: vllm/vllm-openai:v0.8.0
            command:
              - bash
              - -c
              - |
                # Leader starts Ray head
                ray start --head --port=6379
                
                # Wait for worker to join
                while [ $(ray status 2>/dev/null | grep -c "node_") -lt 2 ]; do
                  echo "Waiting for worker..."
                  sleep 5
                done
                
                # Start vLLM with pipeline parallelism
                python -m vllm.entrypoints.openai.api_server \
                  --model meta-llama/Llama-3.1-405B-Instruct \
                  --tensor-parallel-size 8 \
                  --pipeline-parallel-size 2 \
                  --port 8000 \
                  --trust-remote-code
            ports:
              - containerPort: 8000
                name: http
              - containerPort: 6379
                name: ray
            resources:
              limits:
                nvidia.com/gpu: 8
                memory: 600Gi
              requests:
                nvidia.com/gpu: 8
                memory: 400Gi
            env:
              - name: NCCL_SOCKET_IFNAME
                value: "eth0"
              - name: HF_TOKEN
                valueFrom:
                  secretKeyRef:
                    name: hf-token
                    key: token
            volumeMounts:
              - name: model-cache
                mountPath: /root/.cache/huggingface
              - name: shm
                mountPath: /dev/shm
        volumes:
          - name: model-cache
            persistentVolumeClaim:
              claimName: model-cache-405b
          - name: shm
            emptyDir:
              medium: Memory
              sizeLimit: 64Gi
        nodeSelector:
          nvidia.com/gpu.count: "8"
    workerTemplate:
      metadata:
        labels:
          role: worker
      spec:
        containers:
          - name: vllm-worker
            image: vllm/vllm-openai:v0.8.0
            command:
              - bash
              - -c
              - |
                # Connect to leader's Ray head
                LEADER_ADDR=$(echo $LWS_LEADER_ADDRESS)
                ray start --address=${LEADER_ADDR}:6379 --block
            resources:
              limits:
                nvidia.com/gpu: 8
                memory: 600Gi
              requests:
                nvidia.com/gpu: 8
                memory: 400Gi
            env:
              - name: NCCL_SOCKET_IFNAME
                value: "eth0"
              - name: LWS_LEADER_ADDRESS
                valueFrom:
                  fieldRef:
                    fieldPath: metadata.annotations['leaderworkerset.sigs.k8s.io/leader-address']
            volumeMounts:
              - name: model-cache
                mountPath: /root/.cache/huggingface
              - name: shm
                mountPath: /dev/shm
        volumes:
          - name: model-cache
            persistentVolumeClaim:
              claimName: model-cache-405b
          - name: shm
            emptyDir:
              medium: Memory
              sizeLimit: 64Gi
        nodeSelector:
          nvidia.com/gpu.count: "8"
---
apiVersion: v1
kind: Service
metadata:
  name: llama-405b-api
  namespace: inference
spec:
  selector:
    leaderworkerset.sigs.k8s.io/name: llama-405b-inference
    role: leader
  ports:
    - port: 8000
      targetPort: 8000
  type: ClusterIP
```

### Key LWS Features

```text
Feature                          Benefit
────────────────────────────────────────────────────────
RecreateGroupOnPodRestart        If any Pod dies, entire group restarts
LWS_LEADER_ADDRESS annotation    Workers auto-discover leader IP
size: N                          1 leader + (N-1) workers guaranteed together
replicas: M                      Scale to M independent serving groups
Exclusive placement              Each group gets dedicated nodes
```

### Benchmark the Distributed Endpoint

```bash
# After deployment is ready
genai-perf \
  --endpoint-type chat \
  --backend vllm \
  --url http://llama-405b-api.inference:8000/v1 \
  --model meta-llama/Llama-3.1-405B-Instruct \
  --concurrency 1 \
  --input-tokens-mean 200 \
  --output-tokens-mean 200 \
  --num-requests 50
```

## Common Issues

### Worker can't connect to leader Ray head
- **Cause**: Network policy blocking port 6379 between Pods
- **Fix**: Allow intra-namespace traffic; verify `LWS_LEADER_ADDRESS` resolves

### Pipeline parallel slower than expected
- **Cause**: Network bandwidth between nodes insufficient for activation transfers
- **Fix**: Use RDMA/InfiniBand; reduce pipeline stages; increase tensor parallelism per node

### Model loading OOM
- **Cause**: Both nodes trying to load full 405B model simultaneously
- **Fix**: Use shared RWX PVC with pre-downloaded model; Ray handles shard distribution

## Best Practices

1. **LWS over manual Deployments** — handles group restart semantics correctly
2. **Pre-download models** — avoid each Pod downloading 800GB independently
3. **RDMA networking** — pipeline parallelism is network-bound between nodes
4. **Size replicas for HA** — `replicas: 2` gives you a hot spare serving group
5. **Monitor both nodes** — pipeline bubble means one GPU is idle while other computes

## Key Takeaways

- LWS operator manages leader+worker groups with atomic restart
- Workers discover leader via `LWS_LEADER_ADDRESS` annotation
- Pipeline parallel across nodes + tensor parallel within each node
- 405B model needs 2× 8-GPU nodes minimum (A100-80GB or H200)
- `RecreateGroupOnPodRestart` ensures consistent model state after failure
- Benchmark with GenAI-Perf to validate multi-node overhead is acceptable
