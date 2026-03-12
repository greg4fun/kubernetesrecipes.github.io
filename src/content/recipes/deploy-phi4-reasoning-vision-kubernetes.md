---
title: "Deploy Phi-4 Reasoning Vision on K8s"
description: "Deploy Microsoft Phi-4-reasoning-vision-15B on Kubernetes for multimodal chain-of-thought reasoning with visual understanding on a single GPU."
category: "ai"
difficulty: "intermediate"
timeToComplete: "20 minutes"
kubernetesVersion: "1.28+"
prerequisites:
  - "NVIDIA GPU Operator installed"
  - "A100 40GB, L40S, or A10G GPU"
relatedRecipes:
  - "deploy-phi4-kubernetes"
  - "deploy-qwen35-9b-kubernetes"
  - "deploy-llama31-8b-kubernetes"
  - "triton-vllm-kubernetes"
tags:
  - phi-4
  - microsoft
  - reasoning
  - multimodal
  - vision
  - chain-of-thought
  - vllm
  - nvidia
  - inference
  - ai
author: "Luca Berton"
publishDate: "2026-02-26"
---

> 💡 **Quick Answer:** Deploy Phi-4-reasoning-vision-15B with vLLM on a single A100 or L40S GPU. Microsoft's reasoning-optimized VLM that combines chain-of-thought reasoning with visual understanding. ~30GB VRAM at FP16, excels at math, code, and diagram analysis.

## The Problem

Standard vision-language models see images but don't deeply reason about them:

- **Math problems from images** — screenshots of equations, geometry diagrams
- **Code from screenshots** — analyze code screenshots, UI wireframes, error messages
- **Complex diagrams** — architecture diagrams, flowcharts, circuit diagrams need step-by-step reasoning
- **Exam-style questions** — multi-step visual reasoning with structured thinking

Phi-4-reasoning-vision combines Microsoft's reasoning specialization with vision capabilities.

## The Solution

### Deploy Phi-4-reasoning-vision-15B

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: phi4-reasoning-vision
  namespace: ai-inference
  labels:
    app: phi4-reasoning-vision
spec:
  replicas: 1
  selector:
    matchLabels:
      app: phi4-reasoning-vision
  template:
    metadata:
      labels:
        app: phi4-reasoning-vision
    spec:
      containers:
        - name: vllm
          image: vllm/vllm-openai:latest
          args:
            - "--model"
            - "microsoft/Phi-4-reasoning-vision-15B"
            - "--max-model-len"
            - "16384"
            - "--gpu-memory-utilization"
            - "0.90"
            - "--max-num-seqs"
            - "16"
            - "--trust-remote-code"
            - "--limit-mm-per-prompt"
            - "image=2"
            - "--port"
            - "8000"
          ports:
            - containerPort: 8000
          env:
            - name: HUGGING_FACE_HUB_TOKEN
              valueFrom:
                secretKeyRef:
                  name: huggingface-token
                  key: token
          resources:
            limits:
              nvidia.com/gpu: "1"
              memory: 48Gi
              cpu: "8"
          volumeMounts:
            - name: model-cache
              mountPath: /root/.cache/huggingface
            - name: shm
              mountPath: /dev/shm
          startupProbe:
            httpGet:
              path: /health
              port: 8000
            initialDelaySeconds: 120
            periodSeconds: 15
            failureThreshold: 20
          readinessProbe:
            httpGet:
              path: /health
              port: 8000
            periodSeconds: 10
      volumes:
        - name: model-cache
          persistentVolumeClaim:
            claimName: phi4-vision-cache
        - name: shm
          emptyDir:
            medium: Memory
            sizeLimit: 4Gi
---
apiVersion: v1
kind: Service
metadata:
  name: phi4-reasoning-vision
  namespace: ai-inference
spec:
  selector:
    app: phi4-reasoning-vision
  ports:
    - port: 8000
      targetPort: 8000
```

### Reasoning with Visual Input

```bash
# Analyze a Kubernetes architecture diagram
kubectl run test-phi4v --rm -it --image=curlimages/curl -- \
  curl -s http://phi4-reasoning-vision:8000/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "microsoft/Phi-4-reasoning-vision-15B",
    "messages": [
      {
        "role": "user",
        "content": [
          {"type": "text", "text": "Analyze this Kubernetes architecture diagram. Identify potential single points of failure and suggest improvements. Think step by step."},
          {"type": "image_url", "image_url": {"url": "data:image/png;base64,<base64_encoded_diagram>"}}
        ]
      }
    ],
    "max_tokens": 2048,
    "temperature": 0.3
  }'
```

### Phi-4 Family Comparison

```text
| Model                         | Params | Vision | Reasoning | VRAM  | GPU         |
|-------------------------------|--------|--------|-----------|-------|-------------|
| Phi-4 (text only)             | 14B    | No     | Standard  | ~28GB | 1x A100 40G |
| Phi-4-reasoning-vision-15B   | 15B    | Yes    | CoT       | ~30GB | 1x A100 40G |
| Qwen3.5-9B (multimodal)      | 10B    | Yes    | Standard  | ~18GB | 1x A100 40G |
```

```mermaid
flowchart TD
    A[Visual Input + Question] --> B[Vision Encoder]
    B --> C[Visual Tokens]
    D[Text Question] --> E[Text Tokens]
    C --> F[Phi-4 Reasoning Transformer]
    E --> F
    F --> G[Chain-of-Thought Reasoning]
    G --> H[Step 1: Identify elements]
    H --> I[Step 2: Analyze relationships]
    I --> J[Step 3: Draw conclusions]
    J --> K[Structured Answer]
    subgraph Single GPU ~30GB
        F
        G
    end
```

## Common Issues

### Chain-of-thought uses more tokens

```bash
# Reasoning models generate longer outputs (thinking steps)
# Set max_tokens higher than you would for a standard model
"max_tokens": 2048  # vs typical 512 for standard models
# Or set temperature to 0 for more concise reasoning
```

### Vision vs text-only Phi-4

```bash
# If your tasks are text-only, use standard Phi-4 (14B)
# Vision adds ~1B parameters of overhead
# For pure code/math text, Phi-4 is faster and uses less VRAM
```

## Best Practices

- **Single GPU** — fits on A100 40GB or L40S 48GB at FP16
- **Reasoning tasks** — best for math, code analysis, diagram understanding
- **Lower temperature** (0.1-0.3) for structured reasoning
- **Higher max_tokens** — CoT reasoning generates longer intermediate steps
- **Use text-only Phi-4** when you don't need vision — saves ~2GB VRAM

## Key Takeaways

- Phi-4-reasoning-vision-15B: **15B parameter VLM** optimized for chain-of-thought reasoning
- Fits on **single A100 or L40S** GPU (~30GB VRAM)
- **18.2K downloads** — growing adoption for reasoning-heavy visual tasks
- Excels at **math problems, code screenshots, architecture diagrams**
- Part of Microsoft's Phi family — small but highly capable
