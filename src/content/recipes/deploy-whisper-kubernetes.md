---
title: "Deploy Whisper Speech-to-Text on K8s"
description: "Deploy OpenAI Whisper for speech-to-text on Kubernetes with faster-whisper, batch transcription Jobs, and real-time streaming endpoints."
category: "ai"
difficulty: "intermediate"
timeToComplete: "20 minutes"
kubernetesVersion: "1.28+"
prerequisites:
  - "NVIDIA GPU Operator installed"
  - "GPU with 4GB+ VRAM (Whisper large-v3)"
relatedRecipes:
  - "deploy-stable-diffusion-xl-kubernetes"
  - "deploy-retinanet-kubernetes"
  - "triton-multi-model-serving"
  - "inference-autoscaling-gpu-metrics"
tags:
  - whisper
  - speech-to-text
  - transcription
  - audio
  - nvidia
  - inference
  - ai
author: "Luca Berton"
publishDate: "2026-02-26"
---

> 💡 **Quick Answer:** Deploy `faster-whisper` (CTranslate2-optimized) on Kubernetes for 4x faster transcription than vanilla Whisper. The `large-v3` model needs ~3GB VRAM and transcribes 1 hour of audio in ~2 minutes on an A100.

## The Problem

Production speech-to-text on Kubernetes needs:

- **Speed** — vanilla Whisper is slow; `faster-whisper` with CTranslate2 is 4x faster
- **Batch processing** — transcribing thousands of audio files from S3/PVC
- **API serving** — real-time transcription for live applications
- **Language detection** — auto-detect language or force specific language
- **Cost** — Whisper runs well on smaller GPUs (T4, L4) unlike LLMs

## The Solution

### Step 1: Deploy Whisper API Server

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: whisper-server
  namespace: ai-inference
spec:
  replicas: 1
  selector:
    matchLabels:
      app: whisper-server
  template:
    metadata:
      labels:
        app: whisper-server
    spec:
      containers:
        - name: whisper
          image: python:3.11-slim
          command:
            - /bin/bash
            - -c
            - |
              apt-get update && apt-get install -y ffmpeg
              pip install faster-whisper fastapi uvicorn python-multipart

              python3 << 'PYEOF'
              from faster_whisper import WhisperModel
              from fastapi import FastAPI, UploadFile, File
              import tempfile, os

              app = FastAPI()

              # Load model — large-v3 for best quality
              model = WhisperModel(
                  "large-v3",
                  device="cuda",
                  compute_type="float16",
              )

              @app.get("/health")
              def health():
                  return {"status": "ready", "model": "large-v3"}

              @app.post("/transcribe")
              async def transcribe(
                  file: UploadFile = File(...),
                  language: str = None,
                  task: str = "transcribe",
              ):
                  with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as tmp:
                      content = await file.read()
                      tmp.write(content)
                      tmp_path = tmp.name

                  try:
                      segments, info = model.transcribe(
                          tmp_path,
                          language=language,
                          task=task,  # "transcribe" or "translate"
                          beam_size=5,
                          vad_filter=True,
                          vad_parameters=dict(
                              min_silence_duration_ms=500,
                          ),
                      )

                      results = []
                      full_text = ""
                      for segment in segments:
                          results.append({
                              "start": segment.start,
                              "end": segment.end,
                              "text": segment.text.strip(),
                          })
                          full_text += segment.text

                      return {
                          "text": full_text.strip(),
                          "segments": results,
                          "language": info.language,
                          "language_probability": info.language_probability,
                          "duration": info.duration,
                      }
                  finally:
                      os.unlink(tmp_path)

              import uvicorn
              uvicorn.run(app, host="0.0.0.0", port=8000)
              PYEOF
          ports:
            - containerPort: 8000
          resources:
            limits:
              nvidia.com/gpu: "1"
              memory: 8Gi
              cpu: "4"
          volumeMounts:
            - name: model-cache
              mountPath: /root/.cache/huggingface
          startupProbe:
            httpGet:
              path: /health
              port: 8000
            initialDelaySeconds: 60
            periodSeconds: 10
            failureThreshold: 12
          readinessProbe:
            httpGet:
              path: /health
              port: 8000
            periodSeconds: 10
      volumes:
        - name: model-cache
          persistentVolumeClaim:
            claimName: whisper-model-cache
---
apiVersion: v1
kind: Service
metadata:
  name: whisper-server
  namespace: ai-inference
spec:
  selector:
    app: whisper-server
  ports:
    - port: 8000
      targetPort: 8000
```

### Step 2: Batch Transcription Job

```yaml
apiVersion: batch/v1
kind: Job
metadata:
  name: whisper-batch-transcribe
  namespace: ai-inference
spec:
  parallelism: 4
  completions: 4
  completionMode: Indexed
  template:
    spec:
      restartPolicy: Never
      containers:
        - name: transcriber
          image: python:3.11-slim
          command:
            - /bin/bash
            - -c
            - |
              apt-get update && apt-get install -y ffmpeg
              pip install faster-whisper

              python3 << 'PYEOF'
              import os, glob, json
              from faster_whisper import WhisperModel

              model = WhisperModel("large-v3", device="cuda", compute_type="float16")
              index = int(os.environ.get("JOB_COMPLETION_INDEX", 0))

              # Split files across parallel workers
              all_files = sorted(glob.glob("/audio/*.wav") + glob.glob("/audio/*.mp3"))
              chunk_size = len(all_files) // 4 + 1
              my_files = all_files[index * chunk_size : (index + 1) * chunk_size]

              for audio_file in my_files:
                  print(f"Transcribing: {audio_file}")
                  segments, info = model.transcribe(
                      audio_file, beam_size=5, vad_filter=True
                  )
                  result = {
                      "file": audio_file,
                      "language": info.language,
                      "duration": info.duration,
                      "segments": [
                          {"start": s.start, "end": s.end, "text": s.text.strip()}
                          for s in segments
                      ]
                  }
                  out_path = f"/output/{os.path.basename(audio_file)}.json"
                  with open(out_path, "w") as f:
                      json.dump(result, f, indent=2)
              PYEOF
          resources:
            limits:
              nvidia.com/gpu: "1"
              memory: 8Gi
          volumeMounts:
            - name: audio
              mountPath: /audio
              readOnly: true
            - name: output
              mountPath: /output
      volumes:
        - name: audio
          persistentVolumeClaim:
            claimName: audio-files
        - name: output
          persistentVolumeClaim:
            claimName: transcription-output
```

### Step 3: Test Transcription

```bash
# Upload and transcribe
kubectl run test-whisper --rm -it --image=curlimages/curl -- \
  curl -X POST http://whisper-server:8000/transcribe \
  -F "file=@/path/to/audio.wav" \
  -F "language=en"

# Translate to English
kubectl run test-translate --rm -it --image=curlimages/curl -- \
  curl -X POST http://whisper-server:8000/transcribe \
  -F "file=@/path/to/spanish-audio.wav" \
  -F "task=translate"
```

```mermaid
flowchart TD
    A[Audio Input] --> B{Deployment Type}
    B -->|API| C[Whisper Server Pod]
    B -->|Batch| D[Parallel Job Workers]
    C --> E[faster-whisper + CTranslate2]
    D --> E
    E --> F[VAD Filter]
    F --> G[Beam Search Decoding]
    G --> H[Timestamped Segments]
    H --> I[JSON Response]
    subgraph GPU ~3GB VRAM
        E
        F
        G
    end
```

## Common Issues

### Audio format not supported

```bash
# Install ffmpeg in the container — faster-whisper uses it
apt-get install -y ffmpeg

# Supported: wav, mp3, flac, ogg, m4a, webm
# ffmpeg handles format conversion automatically
```

### Slow transcription on long files

```bash
# Enable VAD filter — skips silence, 2-3x faster
vad_filter=True
vad_parameters=dict(min_silence_duration_ms=500)

# Use int8 for faster inference (slight quality trade-off)
model = WhisperModel("large-v3", compute_type="int8_float16")
```

### Model size selection

```text
| Model    | VRAM  | Speed (1h audio) | Quality |
|----------|-------|-------------------|---------|
| tiny     | 1GB   | ~15 seconds       | Basic   |
| base     | 1GB   | ~30 seconds       | Fair    |
| small    | 2GB   | ~1 minute         | Good    |
| medium   | 5GB   | ~1.5 minutes      | Great   |
| large-v3 | 3GB*  | ~2 minutes        | Best    |
* with CTranslate2 float16 optimization
```

## Best Practices

- **Use `faster-whisper`** over vanilla Whisper — 4x faster with CTranslate2
- **VAD filter** — skips silence, dramatically speeds up podcasts and meetings
- **Indexed Jobs for batch** — parallelize across GPUs for large audio libraries
- **`int8_float16`** for speed — marginal quality trade-off for 30% faster inference
- **PVC model cache** — `large-v3` is ~3GB, avoid re-downloading

## Key Takeaways

- `faster-whisper` with CTranslate2 is **4x faster** than OpenAI's Whisper
- `large-v3` needs only **~3GB VRAM** — runs on T4, L4, or any modern GPU
- **VAD filtering** skips silence for 2-3x speedup on real-world audio
- **Indexed parallel Jobs** scale batch transcription across multiple GPUs
- Supports **99 languages** with automatic language detection
