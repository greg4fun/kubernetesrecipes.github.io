---
title: "Deploy Qwen3.5 9B Multimodal on K8s"
description: "Deploy Alibaba Qwen3.5-9B vision-language model on Kubernetes with vLLM. Process images and text with a single GPU deployment."
category: "ai"
difficulty: "intermediate"
timeToComplete: "20 minutes"
kubernetesVersion: "1.28+"
prerequisites:
  - "NVIDIA GPU Operator installed"
  - "A100 40GB, L40S, or A10G GPU"
relatedRecipes:
  - "deploy-qwen35-35b-moe-kubernetes"
  - "deploy-nemotron-120b-kubernetes"
  - "deploy-phi4-kubernetes"
  - "deploy-llama31-8b-kubernetes"
  - "triton-vllm-kubernetes"
tags:
  - qwen3.5
  - multimodal
  - vision-language
  - vllm
  - nvidia
  - inference
  - ai
author: "Luca Berton"
publishDate: "2026-02-26"
---

> 💡 **Quick Answer:** Deploy Qwen3.5-9B with vLLM on a single A100 or L40S GPU. It's a vision-language model (VLM) — processes both images and text in one model. ~18GB VRAM at FP16, supports image understanding, OCR, diagram analysis, and visual Q&A.

## The Problem

Modern AI applications need multimodal understanding — not just text, but images too:

- **Document analysis** — extract data from scanned PDFs, receipts, invoices
- **Diagram understanding** — interpret architecture diagrams, flowcharts, Kubernetes manifests as images
- **Visual Q&A** — answer questions about screenshots, dashboards, monitoring graphs
- **OCR + reasoning** — read text from images AND reason about it

Running separate OCR + LLM pipelines is complex. A single vision-language model handles both.

## The Solution

### Step 1: Deploy Qwen3.5-9B with vLLM

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: qwen35-9b
  namespace: ai-inference
  labels:
    app: qwen35-9b
spec:
  replicas: 1
  selector:
    matchLabels:
      app: qwen35-9b
  template:
    metadata:
      labels:
        app: qwen35-9b
    spec:
      containers:
        - name: vllm
          image: vllm/vllm-openai:latest
          args:
            - "--model"
            - "Qwen/Qwen3.5-9B"
            - "--max-model-len"
            - "32768"
            - "--gpu-memory-utilization"
            - "0.90"
            - "--max-num-seqs"
            - "32"
            - "--trust-remote-code"
            - "--limit-mm-per-prompt"
            - "image=4"
            - "--port"
            - "8000"
          ports:
            - containerPort: 8000
              name: http
          env:
            - name: HUGGING_FACE_HUB_TOKEN
              valueFrom:
                secretKeyRef:
                  name: huggingface-token
                  key: token
          resources:
            limits:
              nvidia.com/gpu: "1"
              memory: 32Gi
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
            claimName: qwen35-model-cache
        - name: shm
          emptyDir:
            medium: Memory
            sizeLimit: 4Gi
---
apiVersion: v1
kind: Service
metadata:
  name: qwen35-9b
  namespace: ai-inference
spec:
  selector:
    app: qwen35-9b
  ports:
    - port: 8000
      targetPort: 8000
```

### Step 2: Image + Text Inference

```bash
# Analyze a Kubernetes dashboard screenshot
kubectl run test-vlm --rm -it --image=curlimages/curl -- \
  curl -s http://qwen35-9b:8000/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "Qwen/Qwen3.5-9B",
    "messages": [
      {
        "role": "user",
        "content": [
          {"type": "text", "text": "What Kubernetes issues do you see in this dashboard? List any pods in error state."},
          {"type": "image_url", "image_url": {"url": "https://example.com/k8s-dashboard.png"}}
        ]
      }
    ],
    "max_tokens": 1024
  }'

# OCR + reasoning on a YAML screenshot
curl -s http://qwen35-9b:8000/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "Qwen/Qwen3.5-9B",
    "messages": [
      {
        "role": "user",
        "content": [
          {"type": "text", "text": "Read this Kubernetes manifest and identify any security issues."},
          {"type": "image_url", "image_url": {"url": "data:image/png;base64,<base64_encoded_image>"}}
        ]
      }
    ],
    "max_tokens": 2048
  }'
```

### Step 3: Batch Image Processing Job

```yaml
apiVersion: batch/v1
kind: Job
metadata:
  name: vlm-batch-analysis
  namespace: ai-inference
spec:
  template:
    spec:
      restartPolicy: Never
      containers:
        - name: analyzer
          image: python:3.11-slim
          command:
            - /bin/bash
            - -c
            - |
              pip install openai pillow

              python3 << 'EOF'
              import openai, base64, glob, json

              client = openai.OpenAI(
                  base_url="http://qwen35-9b:8000/v1",
                  api_key="not-needed"
              )

              for img_path in glob.glob("/images/*.png"):
                  with open(img_path, "rb") as f:
                      b64 = base64.b64encode(f.read()).decode()

                  response = client.chat.completions.create(
                      model="Qwen/Qwen3.5-9B",
                      messages=[{
                          "role": "user",
                          "content": [
                              {"type": "text", "text": "Describe what you see in this image. Extract any text."},
                              {"type": "image_url", "image_url": {"url": f"data:image/png;base64,{b64}"}}
                          ]
                      }],
                      max_tokens=1024,
                  )

                  result = {"file": img_path, "analysis": response.choices[0].message.content}
                  print(json.dumps(result))
              EOF
```

```mermaid
flowchart TD
    A[Input] --> B{Content Type}
    B -->|Text only| C[Text Encoder]
    B -->|Image + Text| D[Vision Encoder]
    D --> E[Image Tokens]
    C --> F[Text Tokens]
    E --> G[Combined Sequence]
    F --> G
    G --> H[Qwen3.5-9B Transformer]
    H --> I[Response]
    subgraph Single GPU ~18GB
        C
        D
        H
    end
```

## Common Issues

### Image too large causes OOM

```bash
# Limit images per prompt
--limit-mm-per-prompt image=4  # max 4 images per request

# Resize images client-side before sending
# 1024x1024 is usually sufficient for VLM understanding
```

### Base64 images vs URL images

```bash
# URLs require the vLLM pod to have network access to fetch images
# Base64 is more reliable in air-gapped clusters
# Convert: base64 -w0 image.png | xargs -I{} echo "data:image/png;base64,{}"
```

### Text-only mode slower than expected

```bash
# VLM models have vision encoder overhead even for text-only
# For text-only workloads, use a text-only model (Llama 3.1, Phi-4)
# VLMs shine when you actually use the vision capability
```

## Best Practices

- **Single GPU deployment** — Qwen3.5-9B fits on A100 40GB or L40S at FP16
- **Limit images per prompt** — each image adds ~1000+ tokens of vision embeddings
- **Resize images** — 1024×1024 max, higher resolution doesn't proportionally improve understanding
- **Base64 for air-gapped** — don't rely on URL fetching inside the cluster
- **Use text-only models for text tasks** — VLMs have overhead from the vision encoder

## Key Takeaways

- Qwen3.5-9B is a **vision-language model** — processes images and text in one model
- Fits on a **single GPU** (~18GB VRAM at FP16)
- Use cases: **document OCR, diagram analysis, visual Q&A, dashboard monitoring**
- OpenAI-compatible API via vLLM — send images as base64 or URLs in chat completions
- **1.54M+ downloads** — one of the most popular open multimodal models
