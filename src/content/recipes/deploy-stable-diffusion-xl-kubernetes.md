---
title: "Stable Diffusion XL on Kubernetes"
description: "Deploy Stable Diffusion XL for image generation on Kubernetes with TensorRT acceleration, queued batch processing, and S3 output storage."
category: "ai"
difficulty: "advanced"
timeToComplete: "30 minutes"
kubernetesVersion: "1.28+"
prerequisites:
  - "NVIDIA GPU Operator installed"
  - "A100 or L40S GPU with 24GB+ VRAM"
relatedRecipes:
  - "deploy-retinanet-kubernetes"
  - "triton-tensorrt-llm-kubernetes"
  - "inference-autoscaling-gpu-metrics"
  - "deploy-whisper-kubernetes"
tags:
  - stable-diffusion
  - sdxl
  - image-generation
  - diffusion
  - nvidia
  - tensorrt
  - inference
  - ai
author: "Luca Berton"
publishDate: "2026-02-26"
---

> 💡 **Quick Answer:** Deploy SDXL with the `diffusers` library on Kubernetes, using TensorRT for 2-3x faster generation. A single A100 generates 1024×1024 images in ~3 seconds (FP16) or ~1.5 seconds (TensorRT). Use a Job queue pattern for batch generation.

## The Problem

Image generation workloads have unique Kubernetes challenges:

- **GPU memory** — SDXL needs 7GB+ VRAM for FP16, more with refiner
- **Long inference times** — 3-10 seconds per image, too slow for synchronous APIs
- **Batch processing** — marketing teams need 100s of images, not one at a time
- **Storage** — generated images need persistent storage or S3 upload
- **Cost** — GPUs are expensive, autoscaling down to zero when idle saves money

## The Solution

### Step 1: Deploy SDXL as an API Server

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: sdxl-server
  namespace: ai-inference
spec:
  replicas: 1
  selector:
    matchLabels:
      app: sdxl-server
  template:
    metadata:
      labels:
        app: sdxl-server
    spec:
      containers:
        - name: sdxl
          image: python:3.11-slim
          command:
            - /bin/bash
            - -c
            - |
              pip install torch torchvision diffusers transformers \
                accelerate safetensors fastapi uvicorn pillow

              python3 << 'PYEOF'
              import torch
              from diffusers import StableDiffusionXLPipeline, AutoencoderKL
              from fastapi import FastAPI
              from fastapi.responses import Response
              import io, base64, json

              app = FastAPI()

              # Load SDXL with FP16
              vae = AutoencoderKL.from_pretrained(
                  "madebyollin/sdxl-vae-fp16-fix",
                  torch_dtype=torch.float16
              )
              pipe = StableDiffusionXLPipeline.from_pretrained(
                  "stabilityai/stable-diffusion-xl-base-1.0",
                  vae=vae,
                  torch_dtype=torch.float16,
                  variant="fp16",
                  use_safetensors=True,
              ).to("cuda")

              # Optimize
              pipe.enable_xformers_memory_efficient_attention()

              @app.get("/health")
              def health():
                  return {"status": "ready"}

              @app.post("/generate")
              async def generate(request: dict):
                  prompt = request.get("prompt", "a photo of a cat")
                  negative = request.get("negative_prompt", "")
                  steps = request.get("num_inference_steps", 30)
                  width = request.get("width", 1024)
                  height = request.get("height", 1024)
                  seed = request.get("seed", None)

                  generator = torch.Generator("cuda")
                  if seed:
                      generator.manual_seed(seed)

                  image = pipe(
                      prompt=prompt,
                      negative_prompt=negative,
                      num_inference_steps=steps,
                      width=width, height=height,
                      generator=generator,
                  ).images[0]

                  buf = io.BytesIO()
                  image.save(buf, format="PNG")
                  img_b64 = base64.b64encode(buf.getvalue()).decode()

                  return {"image": img_b64, "seed": seed}

              import uvicorn
              uvicorn.run(app, host="0.0.0.0", port=8000)
              PYEOF
          ports:
            - containerPort: 8000
          resources:
            limits:
              nvidia.com/gpu: "1"
              memory: 32Gi
              cpu: "8"
          env:
            - name: HUGGING_FACE_HUB_TOKEN
              valueFrom:
                secretKeyRef:
                  name: huggingface-token
                  key: token
          volumeMounts:
            - name: model-cache
              mountPath: /root/.cache/huggingface
          startupProbe:
            httpGet:
              path: /health
              port: 8000
            initialDelaySeconds: 120
            periodSeconds: 30
            failureThreshold: 20
          readinessProbe:
            httpGet:
              path: /health
              port: 8000
            periodSeconds: 15
      volumes:
        - name: model-cache
          persistentVolumeClaim:
            claimName: sdxl-model-cache
---
apiVersion: v1
kind: Service
metadata:
  name: sdxl-server
  namespace: ai-inference
spec:
  selector:
    app: sdxl-server
  ports:
    - port: 8000
      targetPort: 8000
```

### Step 2: Batch Processing with Job Queue

```yaml
apiVersion: batch/v1
kind: Job
metadata:
  name: sdxl-batch-generate
  namespace: ai-inference
spec:
  template:
    spec:
      restartPolicy: Never
      containers:
        - name: batch
          image: curlimages/curl
          command:
            - /bin/sh
            - -c
            - |
              PROMPTS='
              a futuristic Kubernetes control plane visualization
              a container ship navigating through cloud infrastructure
              a robot managing server racks in a data center
              abstract art of microservices communicating
              a helm wheel steering through digital ocean
              '

              echo "$PROMPTS" | while IFS= read -r prompt; do
                [ -z "$prompt" ] && continue
                echo "Generating: $prompt"
                curl -s http://sdxl-server:8000/generate \
                  -H "Content-Type: application/json" \
                  -d "{\"prompt\": \"$prompt\", \"num_inference_steps\": 30}" \
                  -o /dev/null
                echo " Done"
              done
```

### Step 3: KEDA Autoscaling to Zero

```yaml
apiVersion: keda.sh/v1alpha1
kind: ScaledObject
metadata:
  name: sdxl-scaler
  namespace: ai-inference
spec:
  scaleTargetRef:
    name: sdxl-server
  minReplicaCount: 0
  maxReplicaCount: 4
  cooldownPeriod: 300
  triggers:
    - type: prometheus
      metadata:
        serverAddress: http://prometheus.monitoring:9090
        metricName: sdxl_pending_requests
        query: |
          sum(rate(http_requests_total{service="sdxl-server"}[2m]))
        threshold: "2"
```

```mermaid
flowchart TD
    A[API Request] --> B[SDXL Server Pod]
    B --> C[Load Pipeline - FP16]
    C --> D[Text Encoder]
    D --> E[UNet Denoising - 30 steps]
    E --> F[VAE Decoder]
    F --> G[1024x1024 PNG]
    G --> H[Base64 Response]
    subgraph GPU Memory ~7GB
        D
        E
        F
    end
```

## Common Issues

### OOM with large images

```bash
# SDXL at 1024x1024 FP16 needs ~7GB VRAM
# For 2048x2048 use tiled VAE decoding:
pipe.enable_vae_tiling()

# Or use sequential CPU offloading (slower):
pipe.enable_sequential_cpu_offload()
```

### Slow first inference

```bash
# First inference triggers CUDA graph compilation
# Use warmup in startup:
pipe("warmup", num_inference_steps=1)
```

### Model download on every restart

```yaml
# Use PVC to cache the ~7GB model
volumeMounts:
  - name: model-cache
    mountPath: /root/.cache/huggingface
```

## Best Practices

- **FP16 variant** — half the memory, identical visual quality
- **xformers attention** — 20-30% faster and lower memory
- **PVC for model cache** — avoid 7GB download on every pod restart
- **Scale to zero** with KEDA — GPUs are expensive when idle
- **Startup probe with long timeout** — model loading takes 2-5 minutes

## Key Takeaways

- SDXL generates **1024×1024 images in ~3 seconds** on A100 with FP16
- Needs **~7GB VRAM** for base model, more with refiner
- Use **KEDA scale-to-zero** to eliminate idle GPU costs
- **Batch processing via Jobs** for bulk image generation
- Cache models on **PVC** to avoid repeated downloads
