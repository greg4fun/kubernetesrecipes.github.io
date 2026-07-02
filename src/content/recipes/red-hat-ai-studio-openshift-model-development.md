---
title: "Red Hat AI Studio on OpenShift"
description: "Deploy Red Hat AI Studio on OpenShift for end-to-end LLM development. Model catalog, InstructLab fine-tuning, experiment tracking, model"
tags:
  - "red-hat"
  - "openshift"
  - "ai-studio"
  - "instructlab"
  - "fine-tuning"
  - "model-serving"
category: "ai"
publishDate: "2026-05-22"
author: "Luca Berton"
difficulty: "intermediate"
relatedRecipes:
  - "vllm-openai-container-kubernetes"
  - "nvidia-gpu-operator-gitops-openshift"
---

> 💡 **Quick Answer:** Red Hat AI Studio is an integrated development environment on OpenShift for building, fine-tuning, evaluating, and serving LLMs. It combines a model catalog (Granite, Llama, Mistral), InstructLab-based fine-tuning pipelines, experiment tracking, and one-click deployment to NVIDIA NIM or vLLM serving runtimes — all with enterprise RBAC and air-gap support.

## The Problem

- Data scientists use notebooks but have no path from experiment to production serving
- Fine-tuning requires manual pipeline setup (data prep → train → evaluate → deploy)
- No visibility into model lineage — which dataset, which hyperparams produced which checkpoint
- Model evaluation is ad-hoc — no standardized benchmarks before production deployment
- Security teams need audit trails for model provenance in regulated industries

## The Solution

### AI Studio Architecture

```text
┌──────────────────────────────────────────────────────────────┐
│ Red Hat AI Studio (OpenShift AI 3.x)                          │
│                                                               │
│  ┌────────────┐  ┌───────────────┐  ┌───────────────────┐   │
│  │ Model      │  │ Fine-Tuning   │  │ Model Evaluation  │   │
│  │ Catalog    │  │ (InstructLab) │  │ (lm-eval-harness) │   │
│  │            │  │               │  │                   │   │
│  │ • Granite  │  │ • LAB method  │  │ • MMLU, HellaSwag │   │
│  │ • Llama    │  │ • LoRA/QLoRA  │  │ • Custom evals    │   │
│  │ • Mistral  │  │ • Full FT     │  │ • A/B comparison  │   │
│  └─────┬──────┘  └───────┬───────┘  └────────┬──────────┘   │
│        │                  │                    │              │
│        ▼                  ▼                    ▼              │
│  ┌────────────────────────────────────────────────────────┐  │
│  │ Experiment Tracking & Model Registry                    │  │
│  │ (MLflow-compatible, S3-backed artifacts)                │  │
│  └────────────────────────────────────┬───────────────────┘  │
│                                    │                          │
│  ┌─────────────────────────────────▼──────────────────────┐  │
│  │ Model Serving                                           │  │
│  │ • vLLM (OpenAI-compatible)                              │  │
│  │ • NVIDIA NIM (optimized profiles)                       │  │
│  │ • Caikit (embeddings, rerankers)                        │  │
│  └────────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────┘
```

### Install AI Studio on OpenShift

```yaml
# Prerequisites: OpenShift AI operator installed
# GPU Operator with NVIDIA GPUs available

# Enable AI Studio feature (OpenShift AI 3.x+)
apiVersion: dscinitialization.opendatahub.io/v1
kind: DSCInitialization
metadata:
  name: default-dsci
spec:
  serviceMesh:
    managementState: Managed
  monitoring:
    managementState: Managed
---
apiVersion: datasciencecluster.opendatahub.io/v1
kind: DataScienceCluster
metadata:
  name: default-dsc
spec:
  components:
    dashboard:
      managementState: Managed
    workbenches:
      managementState: Managed
    modelmeshserving:
      managementState: Managed
    kserve:
      managementState: Managed
    # AI Studio components
    modelregistry:
      managementState: Managed
    trustyai:
      managementState: Managed
    training:
      managementState: Managed        # Fine-tuning pipelines
    aistudio:
      managementState: Managed        # AI Studio UI and workflows
```

```bash
# Verify AI Studio pods are running
oc get pods -n redhat-ods-applications | grep ai-studio
# ai-studio-ui-7b8c9d6f5-x4k2m          1/1  Running
# ai-studio-backend-5d7e8f9a2-m3n1p     1/1  Running
# model-registry-6c5d4e3f2-k8j7h        1/1  Running

# Access AI Studio UI
oc get route ai-studio -n redhat-ods-applications
# https://ai-studio.apps.cluster.example.com
```

### Model Catalog: Import and Manage

```yaml
# Register a model in the catalog (from Hugging Face or private registry)
apiVersion: modelregistry.opendatahub.io/v1alpha1
kind: RegisteredModel
metadata:
  name: granite-3-8b-instruct
  namespace: ai-studio
spec:
  name: "IBM Granite 3.1 8B Instruct"
  description: "Enterprise-grade instruction-following model"
  owner: "platform-team"
  customProperties:
    license: "Apache-2.0"
    parameters: "8B"
    context_length: "128K"
    source: "ibm-granite/granite-3.1-8b-instruct"
---
apiVersion: modelregistry.opendatahub.io/v1alpha1
kind: ModelVersion
metadata:
  name: granite-3-8b-instruct-v1
  namespace: ai-studio
spec:
  registeredModelId: granite-3-8b-instruct
  name: "v1.0"
  state: LIVE
  artifacts:
    - name: model-weights
      uri: "s3://models/granite-3.1-8b-instruct/"
      modelFormatName: "safetensors"
      modelFormatVersion: "1"
```

```bash
# List available models in catalog
oc exec deploy/model-registry -n redhat-ods-applications -- \
  curl -s localhost:8080/api/model_registry/v1alpha1/registered_models | jq '.items[].name'
# "IBM Granite 3.1 8B Instruct"
# "Meta Llama 3.1 70B"
# "Mistral Small 3.1 24B"
# "custom/finance-qa-v2" (fine-tuned)
```

### Fine-Tuning with InstructLab

```yaml
# AI Studio fine-tuning job (InstructLab LAB method)
apiVersion: training.opendatahub.io/v1alpha1
kind: FineTuningJob
metadata:
  name: granite-finance-ft
  namespace: ai-studio
spec:
  baseModel:
    registeredModel: granite-3-8b-instruct
    version: v1.0

  method: instructlab                  # LAB (Large-scale Alignment for chatBots)
  # Other options: lora, qlora, full

  dataset:
    source:
      s3:
        bucket: training-data
        path: finance-qa/taxonomy/
        endpoint: s3.openshift-storage.svc
        secretRef: s3-credentials
    # InstructLab taxonomy format:
    # finance-qa/taxonomy/
    # ├── qna.yaml          (question-answer pairs)
    # └── knowledge.yaml    (knowledge documents)

  hyperparameters:
    epochs: 3
    batchSize: 4
    learningRate: 2e-5
    gradientAccumulationSteps: 8
    warmupRatio: 0.1
    # InstructLab-specific
    syntheticDataGeneration: true       # Generate additional training data
    sdgModel: "granite-3-8b-instruct"   # Model for synthetic data gen
    sdgSamples: 1000                    # Synthetic samples to generate

  compute:
    gpus: 4
    gpuType: "nvidia.com/gpu"          # Or specific: "nvidia.com/gpu.product=A100"
    memoryPerGpu: "80Gi"

  output:
    modelRegistry:
      registeredModel: granite-3-8b-instruct
      versionName: "v2.0-finance"
    s3:
      bucket: models
      path: "fine-tuned/granite-finance-v2/"

  tracking:
    experiment: "finance-qa-finetuning"
    runName: "ft-granite-8b-finance-epoch3-lr2e5"
```

```bash
# Monitor fine-tuning progress
oc logs -f job/granite-finance-ft-trainer -n ai-studio

# Check training metrics
oc exec deploy/ai-studio-backend -n redhat-ods-applications -- \
  curl -s localhost:8080/api/experiments/finance-qa-finetuning/runs | jq '.[0].metrics'
# {
#   "train_loss": 0.42,
#   "eval_loss": 0.38,
#   "eval_accuracy": 0.87,
#   "epoch": 3
# }
```

### Model Evaluation

```yaml
# Evaluate fine-tuned model before promotion
apiVersion: training.opendatahub.io/v1alpha1
kind: ModelEvaluation
metadata:
  name: granite-finance-eval
  namespace: ai-studio
spec:
  model:
    registeredModel: granite-3-8b-instruct
    version: "v2.0-finance"

  benchmarks:
    # Standard benchmarks
    - name: mmlu
      subset: "professional_accounting,business_ethics"
    - name: hellaswag
    - name: truthfulqa

    # Custom domain evaluation
    - name: custom
      dataset:
        s3:
          bucket: eval-data
          path: finance-qa/eval-set.jsonl
      metrics:
        - accuracy
        - f1
        - relevance_score

  comparison:
    # Compare against base model
    baselineModel:
      registeredModel: granite-3-8b-instruct
      version: v1.0
    # Minimum improvement required for promotion
    thresholds:
      accuracy_improvement: 0.05      # Must be 5% better than base
      regression_tolerance: 0.02      # No metric can drop >2%

  compute:
    gpus: 1
    memoryPerGpu: "80Gi"

  output:
    reportFormat: "html"
    s3:
      bucket: eval-reports
      path: "granite-finance-v2-eval/"
```

```text
Evaluation Results:
──────────────────────────────────────────
Benchmark            Base v1.0    Fine-tuned v2.0    Δ
──────────────────────────────────────────
MMLU (accounting)    0.72         0.84               +0.12 ✅
MMLU (bus. ethics)   0.68         0.71               +0.03 ✅
HellaSwag            0.81         0.80               -0.01 ✅ (within tolerance)
Custom Finance QA    0.65         0.89               +0.24 ✅
TruthfulQA           0.54         0.56               +0.02 ✅
──────────────────────────────────────────
RESULT: PASS — model promoted to v2.0-finance
```

### One-Click Model Serving

```yaml
# Deploy evaluated model to production serving (vLLM runtime)
apiVersion: serving.kserve.io/v1beta1
kind: InferenceService
metadata:
  name: granite-finance
  namespace: ai-serving
  annotations:
    serving.kserve.io/deploymentMode: RawDeployment
  labels:
    opendatahub.io/dashboard: "true"
spec:
  predictor:
    model:
      modelFormat:
        name: vLLM
      runtime: vllm-runtime
      storageUri: "s3://models/fine-tuned/granite-finance-v2/"
      resources:
        limits:
          nvidia.com/gpu: "1"
          memory: "80Gi"
        requests:
          cpu: "4"
          memory: "80Gi"
    minReplicas: 1
    maxReplicas: 4
    scaleTarget: 10                   # Concurrent requests per replica
```

```yaml
# Alternative: NVIDIA NIM runtime for optimized inference
apiVersion: serving.kserve.io/v1beta1
kind: InferenceService
metadata:
  name: granite-finance-nim
  namespace: ai-serving
spec:
  predictor:
    model:
      modelFormat:
        name: nvidia-nim
      runtime: nvidia-nim-runtime
      storageUri: "s3://models/fine-tuned/granite-finance-v2/"
      resources:
        limits:
          nvidia.com/gpu: "1"
```

```bash
# Test the endpoint
ENDPOINT=$(oc get inferenceservice granite-finance -n ai-serving \
  -o jsonpath='{.status.url}')

curl -s "$ENDPOINT/v1/chat/completions" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "granite-finance",
    "messages": [{"role": "user", "content": "What is the EBITDA margin for Q3?"}],
    "max_tokens": 200
  }' | jq '.choices[0].message.content'
```

### AI Studio Pipeline: End-to-End

```yaml
# Full pipeline: catalog → fine-tune → evaluate → serve
apiVersion: training.opendatahub.io/v1alpha1
kind: AIStudioPipeline
metadata:
  name: finance-model-pipeline
  namespace: ai-studio
spec:
  trigger:
    # Re-run when new training data arrives
    s3Watch:
      bucket: training-data
      prefix: finance-qa/
    # Or on schedule
    schedule: "0 2 * * 0"             # Weekly Sunday 2 AM

  stages:
    - name: fine-tune
      type: FineTuningJob
      spec:
        baseModel:
          registeredModel: granite-3-8b-instruct
          version: v1.0
        method: instructlab
        dataset:
          source:
            s3:
              bucket: training-data
              path: finance-qa/taxonomy/
        compute:
          gpus: 4

    - name: evaluate
      type: ModelEvaluation
      dependsOn: [fine-tune]
      spec:
        model:
          fromStage: fine-tune         # Use output of previous stage
        benchmarks:
          - name: custom
            dataset:
              s3:
                bucket: eval-data
                path: finance-qa/eval-set.jsonl
        comparison:
          thresholds:
            accuracy_improvement: 0.03

    - name: deploy
      type: InferenceService
      dependsOn: [evaluate]
      condition: "evaluate.result == 'PASS'"
      spec:
        runtime: vllm-runtime
        resources:
          limits:
            nvidia.com/gpu: "1"
        canary:
          weight: 10                   # Start with 10% traffic
          promotionThreshold:
            errorRate: 0.01
            latencyP99Ms: 500
```

### RBAC and Multi-Tenancy

```yaml
# AI Studio project isolation
apiVersion: v1
kind: Namespace
metadata:
  name: ai-studio-finance
  labels:
    opendatahub.io/dashboard: "true"
    ai-studio.redhat.com/project: "finance"
---
# Role: data scientist (can fine-tune, evaluate, but not deploy to prod)
apiVersion: rbac.authorization.k8s.io/v1
kind: RoleBinding
metadata:
  name: ds-finance-team
  namespace: ai-studio-finance
subjects:
  - kind: Group
    name: finance-data-scientists
    apiGroup: rbac.authorization.k8s.io
roleRef:
  kind: ClusterRole
  name: ai-studio-developer           # Fine-tune, evaluate, experiment
  apiGroup: rbac.authorization.k8s.io
---
# Role: ML engineer (can also deploy and manage serving)
apiVersion: rbac.authorization.k8s.io/v1
kind: RoleBinding
metadata:
  name: mle-finance-team
  namespace: ai-studio-finance
subjects:
  - kind: Group
    name: finance-ml-engineers
    apiGroup: rbac.authorization.k8s.io
roleRef:
  kind: ClusterRole
  name: ai-studio-deployer            # All above + serving management
  apiGroup: rbac.authorization.k8s.io
```

## Common Issues

### Fine-tuning OOM on 4x A100
- **Cause**: Full fine-tuning with batch size too large for model + optimizer states
- **Fix**: Switch to LoRA/QLoRA method; or reduce batch size + increase gradient accumulation

### Model registry artifact upload fails
- **Cause**: S3 credentials expired or bucket policy restrictive
- **Fix**: Check `oc get secret s3-credentials`; verify bucket write permissions

### InferenceService stuck in "Unknown" state
- **Cause**: Model format mismatch or storage URI inaccessible from serving namespace
- **Fix**: Verify `storageUri` is reachable; check ServingRuntime supports the model format

### Evaluation job timeout
- **Cause**: Large eval dataset + single GPU too slow
- **Fix**: Increase `compute.gpus` for evaluation; or reduce eval dataset size

## Best Practices

1. **Always evaluate before serving** — automated thresholds prevent regression
2. **Use InstructLab for domain adaptation** — LAB method needs fewer examples than full FT
3. **Version everything** — model registry tracks lineage from dataset → training → deployment
4. **Canary deploys for model updates** — don't swap 100% traffic immediately
5. **Air-gap the catalog** — mirror models to internal registry for disconnected environments
6. **Separate namespaces per team** — RBAC isolation + GPU quota per project

## Key Takeaways

- AI Studio provides end-to-end LLM lifecycle: catalog → fine-tune → evaluate → serve
- InstructLab integration: synthetic data generation + LAB method for efficient fine-tuning
- Model registry tracks versions, lineage, and evaluation results
- Automated pipelines: trigger on new data, gate on eval thresholds, canary deploy
- Serving options: vLLM (open), NVIDIA NIM (optimized), Caikit (embeddings)
- Enterprise features: RBAC, multi-tenancy, audit trail, air-gap support
- Builds on OpenShift AI (RHOAI) — requires OpenShift AI 3.x operator
