---
title: "Integrate DisaggregatedSet with llm-d on Kubernetes"
description: "Deploy disaggregated LLM inference using DisaggregatedSet and llm-d on Kubernetes. Install LWS then DS controller, model prefill/decode roles, wire llm-d"
tags:
  - "leaderworkerset"
  - "disaggregated-inference"
  - "llm-d"
  - "vllm"
  - "kserve"
  - "gpu"
category: "ai"
publishDate: "2026-05-28"
author: "Luca Berton"
difficulty: "advanced"
relatedRecipes:
  - "disaggregatedset-leaderworkerset-llm-inference-kubernetes"
  - "runai-distributed-inference-vllm-nccl"
  - "distributed-inference-kubernetes"
  - "kubernetes-ai-gateway-inference-extension"
---

> 💡 **Quick Answer:** DisaggregatedSet is the workload-orchestration layer underneath llm-d's serving/routing stack. Install LWS first, then the DisaggregatedSet controller from `disaggregatedset/config/default`. Replace manually managed prefill/decode LeaderWorkerSets with a single DisaggregatedSet CR, then point llm-d routing to the auto-created per-role Services using label selectors (`disaggregatedset.x-k8s.io/role: prefill|decode`).

## The Problem

- Deploying disaggregated inference requires manually creating and coordinating separate LeaderWorkerSets for prefill and decode
- Rolling updates across roles are uncoordinated — one role can update while the other runs an incompatible version
- Service lifecycle is manual — you must ensure routing only targets ready pods of matching revisions
- Configuration drift between separately managed roles causes subtle failures
- llm-d needs stable service discovery that survives revision changes during rollouts

## The Solution

### Architecture: Where DisaggregatedSet Fits

```text
Gateway / KServe / llm-d
        │
Inference routing / endpoint picking (prefix-cache-aware)
        │
Role selectors:
  prefill → DisaggregatedSet-managed LWS pods
  decode  → DisaggregatedSet-managed LWS pods
        │
DisaggregatedSet (single CRD)
        │
LeaderWorkerSet per role/revision
        │
vLLM pods on GPU nodes
```

**llm-d / KServe / Gateway API Inference Extension** handles model serving APIs, routing, prefix/KV-cache-aware scheduling, and traffic entry. **DisaggregatedSet** manages the Kubernetes workloads for disaggregated roles, creating and coordinating multiple underlying LeaderWorkerSets. DisaggregatedSet is being co-designed with llm-d (CNCF sandbox project).

### Step 1: Install LWS

```bash
# Install LeaderWorkerSet via Helm (required before DisaggregatedSet)
CHART_VERSION=0.8.0

helm install lws oci://registry.k8s.io/lws/charts/lws \
  --version "${CHART_VERSION}" \
  --namespace lws-system \
  --create-namespace \
  --wait \
  --timeout 300s

# Verify installation
kubectl get pods -n lws-system
# NAME                              READY   STATUS    RESTARTS   AGE
# lws-controller-manager-xxx        1/1     Running   0          30s

kubectl api-resources | grep -i leaderworker
# leaderworkersets   lws   leaderworkerset.x-k8s.io/v1   true   LeaderWorkerSet
```

### Step 2: Install DisaggregatedSet Controller

DisaggregatedSet runs as a separate controller in its own namespace (`disaggregatedset-system`). It must be installed **after** LWS.

```bash
# Install from repo source (kustomize)
kubectl apply --server-side \
  -k "github.com/kubernetes-sigs/lws/disaggregatedset/config/default?ref=main"

# Verify
kubectl get pods -n disaggregatedset-system
# NAME                                          READY   STATUS    RESTARTS   AGE
# disaggregatedset-controller-manager-xxx       1/1     Running   0          30s

kubectl api-resources | grep -i disaggregated
# disaggregatedsets   ds   disaggregatedset.x-k8s.io/v1alpha1   true   DisaggregatedSet
```

If the kustomize path changes, clone and inspect:

```bash
git clone https://github.com/kubernetes-sigs/lws.git
cd lws
find disaggregatedset -maxdepth 3 -type f | sort
kubectl apply --server-side -k disaggregatedset/config/default
```

### Step 3: Deploy DisaggregatedSet for llm-d

Instead of manually managing separate LWS objects:

```text
BEFORE (manual):                    AFTER (DisaggregatedSet):
─────────────────────               ─────────────────────────
LeaderWorkerSet: my-model-prefill   DisaggregatedSet: llama-pd
LeaderWorkerSet: my-model-decode      role: prefill (LWS template)
Services: manually managed             role: decode (LWS template)
Rollouts: manually coordinated
                                    Controller auto-creates:
                                      llama-pd-<revision>-prefill
                                      llama-pd-<revision>-decode
                                      llama-pd-<revision>-prefill-prv
                                      llama-pd-<revision>-decode-prv
```

```yaml
apiVersion: disaggregatedset.x-k8s.io/v1alpha1
kind: DisaggregatedSet
metadata:
  name: llama-pd
  namespace: llm-d
spec:
  roles:
    - name: prefill
      metadata:
        labels:
          app.kubernetes.io/name: llama-pd
          llm-d.ai/role: prefill
      spec:
        replicas: 2
        leaderWorkerTemplate:
          size: 2    # 1 leader + 1 worker (tensor-parallel across 2 GPUs)
          restartPolicy: RecreateGroupOnPodRestart
          leaderTemplate:
            spec:
              containers:
                - name: vllm
                  image: vllm/vllm-openai:v0.8.0
                  args:
                    - "--model=/models/llama-70b"
                    - "--tensor-parallel-size=2"
                    - "--kv-transfer-config=/etc/vllm/kv-transfer.yaml"
                    - "--enable-disagg"
                    - "--disagg-role=prefill"
                    - "--port=8000"
                  env:
                    - name: NCCL_SOCKET_IFNAME
                      value: "eth0"
                  ports:
                    - containerPort: 8000
                      name: http
                  resources:
                    limits:
                      nvidia.com/gpu: 1
                  volumeMounts:
                    - name: shm
                      mountPath: /dev/shm
                    - name: models
                      mountPath: /models
              volumes:
                - name: shm
                  emptyDir:
                    medium: Memory
                    sizeLimit: 32Gi
                - name: models
                  persistentVolumeClaim:
                    claimName: model-cache
              nodeSelector:
                nvidia.com/gpu.product: "NVIDIA-H100-80GB-HBM3"
          workerTemplate:
            spec:
              containers:
                - name: vllm
                  image: vllm/vllm-openai:v0.8.0
                  args:
                    - "--model=/models/llama-70b"
                    - "--tensor-parallel-size=2"
                    - "--enable-disagg"
                    - "--disagg-role=prefill"
                  env:
                    - name: NCCL_SOCKET_IFNAME
                      value: "eth0"
                  resources:
                    limits:
                      nvidia.com/gpu: 1
                  volumeMounts:
                    - name: shm
                      mountPath: /dev/shm
                    - name: models
                      mountPath: /models
              volumes:
                - name: shm
                  emptyDir:
                    medium: Memory
                    sizeLimit: 32Gi
                - name: models
                  persistentVolumeClaim:
                    claimName: model-cache
              nodeSelector:
                nvidia.com/gpu.product: "NVIDIA-H100-80GB-HBM3"

    - name: decode
      metadata:
        labels:
          app.kubernetes.io/name: llama-pd
          llm-d.ai/role: decode
      spec:
        replicas: 4    # More decode replicas (throughput bottleneck)
        leaderWorkerTemplate:
          size: 1    # Single GPU per decode replica
          restartPolicy: RecreateGroupOnPodRestart
          leaderTemplate:
            spec:
              containers:
                - name: vllm
                  image: vllm/vllm-openai:v0.8.0
                  args:
                    - "--model=/models/llama-70b"
                    - "--tensor-parallel-size=1"
                    - "--kv-transfer-config=/etc/vllm/kv-transfer.yaml"
                    - "--enable-disagg"
                    - "--disagg-role=decode"
                    - "--port=8000"
                  ports:
                    - containerPort: 8000
                      name: http
                  resources:
                    limits:
                      nvidia.com/gpu: 1
                  volumeMounts:
                    - name: shm
                      mountPath: /dev/shm
                    - name: models
                      mountPath: /models
              volumes:
                - name: shm
                  emptyDir:
                    medium: Memory
                    sizeLimit: 32Gi
                - name: models
                  persistentVolumeClaim:
                    claimName: model-cache
              nodeSelector:
                nvidia.com/gpu.product: "NVIDIA-A100-SXM4-80GB"
```

### Step 4: Wire llm-d Routing to Generated Services

DisaggregatedSet creates headless Services per role per revision. Use **label selectors** — not hard-coded service names — because DS creates revisioned names during rollouts.

```bash
# Discover auto-created services
kubectl get svc -n llm-d \
  -l disaggregatedset.x-k8s.io/name=llama-pd
# NAME                          TYPE        CLUSTER-IP   PORT(S)
# llama-pd-abc12-prefill-prv    ClusterIP   None         8000/TCP
# llama-pd-abc12-decode-prv     ClusterIP   None         8000/TCP

# Discover managed LeaderWorkerSets
kubectl get lws -n llm-d \
  -l disaggregatedset.x-k8s.io/name=llama-pd
# NAME                      REPLICAS   READY   AGE
# llama-pd-abc12-prefill    2          2       5m
# llama-pd-abc12-decode     4          4       5m
```

Labels applied to managed resources:

```text
disaggregatedset.x-k8s.io/name      → llama-pd
disaggregatedset.x-k8s.io/role      → prefill | decode
disaggregatedset.x-k8s.io/revision  → abc12345
```

### Configure llm-d InferencePool with Label Selectors

```yaml
# Use role labels for endpoint discovery — survives rollout revision changes
# llm-d InferencePool / EndpointPicker configuration:
apiVersion: inference.networking.x-k8s.io/v1alpha2
kind: InferencePool
metadata:
  name: llama-pd-pool
  namespace: llm-d
spec:
  targetPortNumber: 8000
  selector:
    matchLabels:
      disaggregatedset.x-k8s.io/name: llama-pd
---
# Or separate pools per role for explicit routing control:
apiVersion: inference.networking.x-k8s.io/v1alpha2
kind: InferencePool
metadata:
  name: llama-pd-prefill
  namespace: llm-d
spec:
  targetPortNumber: 8000
  selector:
    matchLabels:
      disaggregatedset.x-k8s.io/name: llama-pd
      disaggregatedset.x-k8s.io/role: prefill
---
apiVersion: inference.networking.x-k8s.io/v1alpha2
kind: InferencePool
metadata:
  name: llama-pd-decode
  namespace: llm-d
spec:
  targetPortNumber: 8000
  selector:
    matchLabels:
      disaggregatedset.x-k8s.io/name: llama-pd
      disaggregatedset.x-k8s.io/role: decode
```

**Important**: Prefer selectors like:

```yaml
# ✅ CORRECT — survives rollout revision changes
selector:
  matchLabels:
    disaggregatedset.x-k8s.io/name: llama-pd
    disaggregatedset.x-k8s.io/role: decode
```

Not hard-coded service names:

```yaml
# ❌ WRONG — breaks on every rollout (revision hash changes)
serviceName: llama-pd-abc12345-decode-prv
```

### Step 5: Validate the Integration

```bash
# Check DisaggregatedSet status
kubectl get disaggregatedset -n llm-d
# NAME       ROLES   READY   AGE
# llama-pd   2       True    10m

kubectl describe disaggregatedset llama-pd -n llm-d

# Check underlying resources
kubectl get lws -n llm-d \
  -l disaggregatedset.x-k8s.io/name=llama-pd

kubectl get pods -n llm-d \
  -l disaggregatedset.x-k8s.io/name=llama-pd -o wide

kubectl get svc -n llm-d \
  -l disaggregatedset.x-k8s.io/name=llama-pd

# Test inference through llm-d/KServe/Gateway endpoint
curl -X POST "http://llm-gateway.example.com/v1/completions" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "llama-70b",
    "prompt": "Explain disaggregated inference in one paragraph.",
    "max_tokens": 128
  }'
```

### Rolling Update Behavior

```text
When you update the DisaggregatedSet spec (e.g., new vLLM image):

1. Controller creates NEW revision LWS + Services for ALL roles
2. Scales UP new revision (surge replicas)
3. Waits for ALL new pods to be Ready across ALL roles
4. Scales DOWN old revision
5. Cleans up old Services

Key guarantees:
• Capacity ratio maintained at every step (prefill:decode = 1:2)
• No orphaned single-role workloads during interrupted rollouts
• Scale up BEFORE scale down (always maintains serving capacity)
• Controller is stateless — safe to restart at any point

Important: Do NOT set rollout strategy on embedded LWS templates.
DisaggregatedSet owns rollouts and does not propagate RolloutStrategy
to underlying LWS resources.
```

### When to Use LWS vs DisaggregatedSet

```text
Use LeaderWorkerSet when:
• Single multi-node serving pool (one role)
• Standard tensor-parallel inference
• Simple multi-host deployment

Use DisaggregatedSet when:
• Multiple coordinated serving roles (prefill + decode)
• Need coordinated rolling updates across roles
• Want automatic service orchestration per role/revision
• Using llm-d with disaggregated vLLM/SGLang
```

### Red Hat AI Inference / RHAI Integration

For Red Hat AI Inference deployments, LWS may already be installed as a dependency. The llm-d Helm chart can install all dependencies including Gateway API, LWS, and KServe:

```bash
# Red Hat AI Inference deploys llm-d with LWS as dependency
# Check if LWS is already present
kubectl get crd leaderworkersets.leaderworkerset.x-k8s.io

# If using RHAI Helm chart, LWS is installed automatically
# for wide expert parallelism with llm-d
helm install rhai-llmd redhat-ai/llm-d \
  --set lws.enabled=true \
  --set gatewayAPI.enabled=true \
  --namespace llm-d
```

## Common Issues

### DisaggregatedSet controller not found after install
- **Cause**: Installed before LWS, or kustomize path changed in repo
- **Fix**: Ensure LWS is running first; clone repo and inspect `disaggregatedset/config/`

### Pods pending — gang scheduling can't place all pods
- **Cause**: Not enough GPU nodes in zone for exclusive topology
- **Fix**: Ensure sufficient GPU capacity per zone; relax topology if needed

### llm-d can't discover endpoints after rollout
- **Cause**: Using hard-coded service names instead of label selectors
- **Fix**: Use `disaggregatedset.x-k8s.io/role` label selectors — they survive revision changes

### "role names must be unique" validation error
- **Cause**: Duplicate role names in spec
- **Fix**: Each role needs a unique name matching `^[a-z0-9]([-a-z0-9]*[a-z0-9])?$`

### Rollout stuck — new revision not becoming ready
- **Cause**: Insufficient GPU headroom for surge replicas during update
- **Fix**: Ensure at least 1 extra replica worth of GPUs available; pre-pull model images

## Best Practices

1. **Install order: LWS → DisaggregatedSet → llm-d** — DS depends on LWS CRDs
2. **Use label selectors for routing** — never hard-code revision-specific service names
3. **Don't set RolloutStrategy on embedded LWS** — DS owns the rollout lifecycle
4. **Scale decode > prefill** — decode is typically the throughput bottleneck (2:1 or 4:1)
5. **Pre-pull model images** — avoids 10+ minute delays during rollout surge
6. **RecreateGroupOnPodRestart** — ensures tensor-parallel groups restart atomically
7. **Monitor per-role** — track TTFT (prefill latency) and TPS (decode throughput) independently
8. **Single DisaggregatedSet per model** — don't mix different models in one DS

## Key Takeaways

- DisaggregatedSet is the workload orchestration layer *underneath* llm-d's routing stack
- Install order matters: LWS first → DisaggregatedSet → then llm-d/KServe
- DS controller runs in `disaggregatedset-system` namespace, manages LWS in workload namespace
- Replaces manually coordinated LWS objects with a single unified CRD
- Auto-creates revisioned headless Services per role for revision-aware routing
- llm-d discovers endpoints via label selectors (`disaggregatedset.x-k8s.io/role`)
- N-dimensional rolling updates maintain capacity ratios across all roles throughout rollout
- Co-designed with llm-d (CNCF sandbox) — the recommended pattern for production disaggregated inference
- DS is still v1alpha1 — API may change; docs are catching up (GitHub issue #806)
