---
title: "LeaderWorkerSet (LWS) on Kubernetes and OpenShift"
description: "Deploy LeaderWorkerSet on Kubernetes or OpenShift for multi-node LLM inference and distributed training: install, vLLM example, env vars, restart policy."
publishDate: "2026-02-26"
updatedDate: "2026-09-27"
author: "Luca Berton"
category: "ai"
difficulty: "advanced"
timeToComplete: "30 minutes"
kubernetesVersion: "1.28+"
prerequisites:
  - "GPU nodes with the NVIDIA GPU Operator"
  - "cluster-admin to install CRDs/operators"
tags:
  - "leaderworkerset"
  - "lws"
  - "multi-node"
  - "inference"
  - "vllm"
  - "distributed-training"
  - "openshift"
  - "gpu"
relatedRecipes:
  - "disaggregatedset-leaderworkerset-llm-inference-kubernetes"
  - "distributed-multi-gpu-inference-kubernetes"
  - "kubernetes-1-36-gang-scheduling"
  - "kubeflow-training-operator"
  - "mpi-operator-kubernetes"
  - "deepspeed-kubernetes-distributed"
  - "genai-perf-nvidia-inference-benchmarking"
  - "aiperf-benchmark-llm-kubernetes"
---

> 💡 **Quick Answer:** LeaderWorkerSet (LWS, `leaderworkerset.x-k8s.io/v1`) is a Kubernetes SIG Apps API that deploys **groups** of pods — one leader plus N-1 workers — as a single replica unit. Each group is created, scaled, rolled and (by default) restarted together, and every pod gets `LWS_LEADER_ADDRESS`, `LWS_GROUP_SIZE` and `LWS_WORKER_INDEX`. Its main use is multi-node LLM inference (e.g. vLLM with tensor parallelism inside a node and pipeline parallelism across nodes); it also works for tightly coupled training. Install upstream with `kubectl apply --server-side -f https://github.com/kubernetes-sigs/lws/releases/download/$VERSION/manifests.yaml`, or on OpenShift via the Leader Worker Set Operator.

## Why LeaderWorkerSet

Models such as Llama 3.1 405B don't fit on one 8×80 GB node in BF16. Serving them means one "replica" is really several pods on several nodes that must:

- start together and find each other (leader address, group size, rank)
- fail together — if one shard dies, the whole replica is useless
- scale and roll out as a unit (add a replica = add a whole group)

Deployments and StatefulSets treat pods individually. LWS models the group explicitly: `replicas` is the number of groups, `leaderWorkerTemplate.size` the pods per group.

## Install

### Upstream Kubernetes

```bash
VERSION=v0.11.0   # check https://github.com/kubernetes-sigs/lws/releases for the latest
kubectl apply --server-side -f \
  https://github.com/kubernetes-sigs/lws/releases/download/${VERSION}/manifests.yaml

kubectl get pods -n lws-system
kubectl get crd leaderworkersets.leaderworkerset.x-k8s.io
```

A Helm chart is also published with each release (see the LWS installation docs).

### OpenShift

Red Hat ships the **Leader Worker Set Operator** (OpenShift AI-workloads docs):

1. Create the `openshift-lws-operator` namespace and install **Leader Worker Set Operator** from OperatorHub into it.
2. Create the operator's CR to deploy the LWS controller:

```yaml
apiVersion: operator.openshift.io/v1
kind: LeaderWorkerSetOperator
metadata:
  name: cluster
  namespace: openshift-lws-operator
spec:
  managementState: Managed
  logLevel: Normal
  operatorLogLevel: Normal
```

```bash
oc get pods -n openshift-lws-operator
oc get crd leaderworkersets.leaderworkerset.x-k8s.io
```

GPU/RDMA pods may additionally need an SCC that allows `IPC_LOCK` and the host devices your network setup uses.

## Multi-Node vLLM Inference (TP inside the node, PP across nodes)

One replica = 2 pods × 8 GPUs. The leader starts a Ray head and the OpenAI server; the worker joins the Ray cluster.

```yaml
apiVersion: leaderworkerset.x-k8s.io/v1
kind: LeaderWorkerSet
metadata:
  name: llama-405b
  namespace: inference
spec:
  replicas: 1                      # number of serving groups
  leaderWorkerTemplate:
    size: 2                        # 1 leader + 1 worker
    restartPolicy: RecreateGroupOnPodRestart
    leaderTemplate:
      metadata:
        labels:
          role: leader
      spec:
        containers:
          - name: vllm-leader
            image: vllm/vllm-openai:latest   # pin a release tag in production
            command: ["/bin/bash", "-c"]
            args:
              - |
                ray start --head --port=6379
                # wait until every pod in the group has joined Ray
                until [ "$(python3 -c 'import ray; ray.init(address="auto", logging_level="ERROR"); print(sum(n["Alive"] for n in ray.nodes()))')" -ge "$LWS_GROUP_SIZE" ]; do
                  echo "waiting for workers..."; sleep 5
                done
                exec vllm serve meta-llama/Llama-3.1-405B-Instruct \
                  --tensor-parallel-size 8 \
                  --pipeline-parallel-size 2 \
                  --distributed-executor-backend ray \
                  --port 8000
            env:
              - name: HF_TOKEN
                valueFrom:
                  secretKeyRef:
                    name: hf-token
                    key: token
            ports:
              - containerPort: 8000
                name: http
            readinessProbe:
              httpGet:
                path: /health
                port: 8000
              initialDelaySeconds: 300
              periodSeconds: 10
            resources:
              limits:
                nvidia.com/gpu: 8
            volumeMounts:
              - name: model-cache
                mountPath: /root/.cache/huggingface
              - name: dshm
                mountPath: /dev/shm
        volumes:
          - name: model-cache
            persistentVolumeClaim:
              claimName: model-cache-405b     # RWX, pre-populated
          - name: dshm
            emptyDir:
              medium: Memory
              sizeLimit: 64Gi
    workerTemplate:
      spec:
        containers:
          - name: vllm-worker
            image: vllm/vllm-openai:latest
            command: ["/bin/bash", "-c"]
            args:
              - ray start --address=${LWS_LEADER_ADDRESS}:6379 --block
            env:
              - name: HF_TOKEN
                valueFrom:
                  secretKeyRef:
                    name: hf-token
                    key: token
            resources:
              limits:
                nvidia.com/gpu: 8
            volumeMounts:
              - name: model-cache
                mountPath: /root/.cache/huggingface
              - name: dshm
                mountPath: /dev/shm
        volumes:
          - name: model-cache
            persistentVolumeClaim:
              claimName: model-cache-405b
          - name: dshm
            emptyDir:
              medium: Memory
              sizeLimit: 64Gi
---
apiVersion: v1
kind: Service
metadata:
  name: llama-405b-api
  namespace: inference
spec:
  selector:
    leaderworkerset.sigs.k8s.io/name: llama-405b
    role: leader
  ports:
    - port: 8000
      targetPort: 8000
```

Notes:
- Pipeline parallelism across nodes moves activations over the network; tensor parallelism across nodes is far more bandwidth-hungry. Keep TP within the NVLink domain and give the pods RDMA networking (and `NCCL_SOCKET_IFNAME`/`NCCL_IB_HCA` as in [NCCL tests](/recipes/ai/run-nccl-tests-kubernetes/)) for anything beyond a demo.
- Pre-populate the RWX model cache — two pods pulling ~800 GB each at startup is slow and fragile.
- The vLLM image also ships a `multi-node-serving.sh` helper under `examples/` used by the upstream LWS vLLM example; either approach works.
- Benchmark the endpoint with [AIPerf](/recipes/ai/aiperf-benchmark-llm-kubernetes/) to confirm the multi-node overhead is acceptable.

## Distributed Training with torchrun

LWS can also run a fixed-size training group; the leader acts as the c10d rendezvous host:

```yaml
apiVersion: leaderworkerset.x-k8s.io/v1
kind: LeaderWorkerSet
metadata:
  name: distributed-training
  namespace: ai-workloads
spec:
  replicas: 1
  leaderWorkerTemplate:
    size: 4                              # 4 nodes × 8 GPUs
    restartPolicy: RecreateGroupOnPodRestart
    leaderTemplate:
      spec:
        containers:
          - name: trainer
            image: nvcr.io/nvidia/pytorch:25.01-py3
            command: ["/bin/bash", "-c"]
            args:
              - >
                torchrun --nnodes=${LWS_GROUP_SIZE} --nproc_per_node=8
                --node_rank=${LWS_WORKER_INDEX}
                --rdzv_backend=c10d --rdzv_endpoint=${LWS_LEADER_ADDRESS}:29500
                /workspace/train.py
            ports:
              - containerPort: 29500
            resources:
              limits:
                nvidia.com/gpu: 8
    workerTemplate:
      spec:
        containers:
          - name: trainer
            image: nvcr.io/nvidia/pytorch:25.01-py3
            command: ["/bin/bash", "-c"]
            args:
              - >
                torchrun --nnodes=${LWS_GROUP_SIZE} --nproc_per_node=8
                --node_rank=${LWS_WORKER_INDEX}
                --rdzv_backend=c10d --rdzv_endpoint=${LWS_LEADER_ADDRESS}:29500
                /workspace/train.py
            resources:
              limits:
                nvidia.com/gpu: 8
```

For training, a JobSet, Kubeflow Trainer/[Training Operator](/recipes/ai/kubeflow-training-operator/) or [MPI Operator](/recipes/ai/mpi-operator-kubernetes/) job is usually a better fit (completion semantics, framework integration); LWS shines for long-running, scalable serving groups.

## Key Fields and Environment

| Item | Meaning |
|------|---------|
| `spec.replicas` | Number of groups (serving replicas); scalable, HPA-compatible |
| `leaderWorkerTemplate.size` | Pods per group, leader included |
| `leaderTemplate` / `workerTemplate` | Separate pod specs (leader template optional — defaults to worker template) |
| `restartPolicy` | `RecreateGroupOnPodRestart` (default): any pod restart recreates the whole group. `RecreateGroupAfterStart`: same, but only after the group first became ready. `None`: restart pods individually |
| `startupPolicy` | `LeaderCreated` (default) or `LeaderReady` — create workers only after the leader is Ready |
| `rolloutStrategy.rollingUpdateConfiguration` | `maxUnavailable` / `maxSurge` at group granularity |
| `LWS_LEADER_ADDRESS` | Stable DNS name of the group's leader (headless Service) |
| `LWS_GROUP_SIZE` | Pods per group |
| `LWS_WORKER_INDEX` | Pod index in the group; leader is `0` |

Pod names are `<lws>-<group>` for leaders and `<lws>-<group>-<index>` for workers; labels include `leaderworkerset.sigs.k8s.io/name`, `.../group-index` and `.../worker-index`.

For topology-aware placement, the `leaderworkerset.sigs.k8s.io/exclusive-topology` annotation keeps each group within (and exclusive to) a topology domain such as a rack or NVLink domain.

## Gang Scheduling

LWS creates a group's pods together but does not by itself guarantee all-or-nothing placement: with too few free GPUs you can get a leader running and workers Pending. Put a gang-aware admission/scheduler in front — Kueue (supports LWS), Volcano, or KAI Scheduler — or see [gang scheduling in Kubernetes 1.36](/recipes/ai/kubernetes-1-36-gang-scheduling/).

## Operate

```bash
kubectl get lws -n inference
kubectl describe lws llama-405b -n inference
kubectl get pods -n inference -l leaderworkerset.sigs.k8s.io/name=llama-405b -o wide
kubectl logs llama-405b-0 -n inference          # leader of group 0
kubectl logs llama-405b-0-1 -n inference        # worker 1 of group 0
kubectl scale lws llama-405b -n inference --replicas=2   # add a whole group
```

## Common Issues

| Symptom | Cause | Fix |
|---------|-------|-----|
| Leader Running, workers Pending | Not enough GPUs for the whole group | Gang admission (Kueue/Volcano/KAI), or free capacity |
| Worker can't reach Ray head / rendezvous | NetworkPolicy blocks 6379/29500, DNS not ready | Allow intra-namespace traffic; use `startupPolicy: LeaderReady` |
| Group keeps restarting | `RecreateGroupOnPodRestart` reacting to one crashing pod | Find the failing pod's logs; fix OOM/probe timeouts |
| Model load very slow / OOM | Each pod downloading full weights | Shared pre-populated RWX cache |
| Pipeline-parallel throughput poor | Inter-node traffic over TCP | RDMA networking; verify with NCCL tests |
| OpenShift pods fail admission | SCC lacks required capabilities | Grant an SCC with `IPC_LOCK` / required devices |

## Frequently Asked Questions

### What is LeaderWorkerSet in Kubernetes?

A SIG Apps workload API (`leaderworkerset.x-k8s.io/v1`) that manages groups of pods — a leader and its workers — as one replica. It is designed for multi-host inference, where a single model instance spans several nodes, and handles group-level creation, scaling, rolling updates and failure recovery.

### LeaderWorkerSet vs StatefulSet?

A StatefulSet gives each pod a stable identity but scales and restarts pods individually. LWS scales and restarts whole groups, injects leader discovery and rank environment variables, and supports rolling updates at group granularity — the semantics a multi-node model replica needs.

### Does LeaderWorkerSet do gang scheduling?

Not on its own. It creates pods per group, but all-or-nothing placement requires a gang-aware scheduler or admission controller such as Kueue, Volcano or KAI Scheduler.

### How do workers find the leader?

Through `LWS_LEADER_ADDRESS`, injected into every pod in the group, which resolves via a headless Service to that group's leader. Use it as the Ray head address or torchrun `--rdzv_endpoint`.

### What is DisaggregatedSet?

A newer API in the LWS project that orchestrates several LeaderWorkerSets (e.g. prefill and decode roles) as one unit for disaggregated serving. See [DisaggregatedSet](/recipes/ai/disaggregatedset-leaderworkerset-llm-inference-kubernetes/).
