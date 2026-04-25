---
title: "Deploy LTX Video Generation on K8s"
description: "Deploy Lightricks LTX-2.3 image-to-video model on Kubernetes for AI video generation with batch processing and S3 output storage."
category: "ai"
difficulty: "advanced"
timeToComplete: "25 minutes"
kubernetesVersion: "1.28+"
prerequisites:
  - "NVIDIA GPU Operator installed"
  - "A100 80GB or H100 GPU (high VRAM required)"
relatedRecipes:
  - "deploy-stable-diffusion-xl-kubernetes"
  - "deploy-sarvam-105b-kubernetes"
  - "triton-multi-model-serving"
tags:
  - ltx
  - video-generation
  - image-to-video
  - lightricks
  - diffusion
  - nvidia
  - inference
  - ai
author: "Luca Berton"
publishDate: "2026-02-26"
---

> 💡 **Quick Answer:** Deploy LTX-2.3 for image-to-video generation on Kubernetes with an A100 80GB GPU. Generate short video clips from images or text prompts. Use batch Jobs for bulk generation and KEDA for scale-to-zero when idle.

## The Problem

AI video generation is the next frontier after image generation:

- **Marketing teams** need product demo videos from static images
- **Content creators** want to animate concept art and storyboards
- **Data augmentation** — synthetic video for training CV models
- **High GPU requirements** — video models need 40GB+ VRAM and long inference times

LTX-2.3 from Lightricks (401K+ downloads) is one of the most popular open image-to-video models.

## The Solution

### Step 1: Deploy LTX-2.3

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: ltx-video
  namespace: ai-inference
  labels:
    app: ltx-video
spec:
  replicas: 1
  selector:
    matchLabels:
      app: ltx-video
  template:
    metadata:
      labels:
        app: ltx-video
    spec:
      containers:
        - name: ltx
          image: python:3.11-slim
          command:
            - /bin/bash
            - -c
            - |
              pip install torch torchvision diffusers transformers \
                accelerate safetensors fastapi uvicorn pillow

              python3 << 'PYEOF'
              import torch
              from diffusers import LTXPipeline
              from fastapi import FastAPI, UploadFile, File
              from fastapi.responses import FileResponse
              import tempfile, io, base64
              from PIL import Image

              app = FastAPI()

              pipe = LTXPipeline.from_pretrained(
                  "Lightricks/LTX-2.3",
                  torch_dtype=torch.bfloat16,
              ).to("cuda")

              @app.get("/health")
              def health():
                  return {"status": "ready"}

              @app.post("/generate")
              async def generate(request: dict):
                  prompt = request.get("prompt", "a cat walking")
                  num_frames = request.get("num_frames", 49)
                  height = request.get("height", 480)
                  width = request.get("width", 704)
                  steps = request.get("num_inference_steps", 30)

                  output = pipe(
                      prompt=prompt,
                      num_frames=num_frames,
                      height=height,
                      width=width,
                      num_inference_steps=steps,
                  )

                  # Save as MP4
                  tmp = tempfile.NamedTemporaryFile(suffix=".mp4", delete=False)
                  from diffusers.utils import export_to_video
                  export_to_video(output.frames[0], tmp.name, fps=24)

                  return FileResponse(tmp.name, media_type="video/mp4")

              import uvicorn
              uvicorn.run(app, host="0.0.0.0", port=8000)
              PYEOF
          ports:
            - containerPort: 8000
          resources:
            limits:
              nvidia.com/gpu: "1"
              memory: 96Gi
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
            initialDelaySeconds: 300
            periodSeconds: 30
            failureThreshold: 20
      volumes:
        - name: model-cache
          persistentVolumeClaim:
            claimName: ltx-model-cache
---
apiVersion: v1
kind: Service
metadata:
  name: ltx-video
  namespace: ai-inference
spec:
  selector:
    app: ltx-video
  ports:
    - port: 8000
      targetPort: 8000
```

### Step 2: GGUF Quantized Version

```bash
# Use unsloth GGUF for lower memory usage
# unsloth/LTX-2.3-GGUF — 21B params quantized
# Fits on A100 40GB with Q4 quantization
```

### Step 3: Batch Video Generation Job

```yaml
apiVersion: batch/v1
kind: Job
metadata:
  name: ltx-batch-generate
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
              a kubernetes pod spinning up with blue energy
              containers being orchestrated in a futuristic datacenter
              a helm wheel steering through digital clouds
              network packets flowing between microservices
              '

              i=0
              echo "$PROMPTS" | while IFS= read -r prompt; do
                [ -z "$prompt" ] && continue
                i=$((i+1))
                echo "Generating video $i: $prompt"
                curl -s http://ltx-video:8000/generate \
                  -H "Content-Type: application/json" \
                  -d "{\"prompt\": \"$prompt\", \"num_frames\": 49, \"num_inference_steps\": 30}" \
                  -o /output/video_$i.mp4
                echo " Done: /output/video_$i.mp4"
              done
          volumeMounts:
            - name: output
              mountPath: /output
      volumes:
        - name: output
          persistentVolumeClaim:
            claimName: generated-videos
```

```mermaid
flowchart TD
    A[Text Prompt or Image] --> B[LTX-2.3 Pipeline]
    B --> C[Text Encoder]
    C --> D[Temporal Denoising UNet]
    D --> E[49 frames × 30 steps]
    E --> F[VAE Decoder]
    F --> G[MP4 Video Output]
    subgraph GPU ~40-60GB VRAM
        C
        D
        F
    end
```

## Common Issues

### OOM with high resolution

```bash
# Reduce resolution or frame count
# 480x704 at 49 frames is the default sweet spot
# For lower VRAM: reduce to 320x512 or 24 frames
```

### Slow generation

```bash
# Video generation is compute-intensive
# 49 frames × 30 steps = 1470 denoising iterations
# Reduce steps to 20 for faster (slightly lower quality) output
# A100 80GB: ~2-5 minutes per video
```

## Best Practices

- **A100 80GB or H100** — video generation needs high VRAM
- **KEDA scale-to-zero** — video gen is bursty, don't pay for idle GPUs
- **Batch Jobs** for bulk generation — queue requests, process overnight
- **PVC for model cache** — LTX-2.3 is a large model, avoid re-downloading
- **BF16 precision** — best quality and performance on A100/H100

## Key Takeaways

- LTX-2.3 generates **short video clips from text or images** — 401K+ downloads
- Needs **A100 80GB or H100** for full resolution (480×704, 49 frames)
- Generation takes **2-5 minutes per video** on A100
- Available in **GGUF format** (unsloth) for reduced memory usage
- Use **batch Jobs** for bulk generation and **KEDA** for scale-to-zero
