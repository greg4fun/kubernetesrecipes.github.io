---
title: "Test LLM Inference Endpoints with curl"
description: "Validate Kubernetes-hosted LLM inference services using curl against OpenAI-compatible /v1/models, /v1/completions, and /v1/chat/completions endpoints."
category: "ai"
difficulty: "beginner"
timeToComplete: "10 minutes"
kubernetesVersion: "Any"
prerequisites:
  - "Working LLM inference deployment (vLLM or NIM)"
  - "curl installed"
  - "Network access to inference endpoint"
relatedRecipes:
  - "deploy-mistral-vllm-kubernetes"
  - "deploy-mistral-nvidia-nim"
  - "troubleshoot-nim-tensorrt-llm"
  - "llm-serving-frameworks-compared"
tags:
  - llm
  - inference
  - curl
  - openai-api
  - testing
  - vllm
  - nvidia-nim
publishDate: "2026-02-16"
author: "Luca Berton"
---

> 💡 **Quick Answer:** First call `/v1/models` to discover the exact model ID. Then use that ID in `/v1/completions` for text generation. Base models (Mistral-7B-v0.1) only support `/v1/completions`; instruct-tuned models also support `/v1/chat/completions`. Use `-k` flag if TLS certificates are self-signed.


Both vLLM and NVIDIA NIM expose an OpenAI-compatible REST API. This recipe shows how to test every endpoint systematically.

## Step 1: Discover the Model ID

Always start by listing available models:

```bash
curl -k https://<inference-endpoint>/v1/models
```

### vLLM Response

```json
{
  "object": "list",
  "data": [{
    "id": "/data/Mistral-7B-v0.1",
    "object": "model",
    "owned_by": "vllm",
    "max_model_len": 32768
  }]
}
```

### NIM Response

```json
{
  "object": "list",
  "data": [{
    "id": "Mistral-7B-v0.1",
    "object": "model",
    "owned_by": "system",
    "max_model_len": 32768
  }]
}
```

**Critical:** The `id` field is the exact string you must use in all subsequent requests. vLLM uses the path (`/data/Mistral-7B-v0.1`); NIM uses the served name (`Mistral-7B-v0.1`).

## Step 2: Text Completion

```bash
curl -k -X POST https://<inference-endpoint>/v1/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "<model-id-from-step-1>",
    "prompt": "Write a one-line greeting:",
    "max_tokens": 32
  }'
```

### Successful Response

```json
{
  "id": "cmpl-abc123",
  "object": "text_completion",
  "choices": [{
    "text": " Hello! Welcome to the world of AI.",
    "index": 0,
    "finish_reason": "stop"
  }],
  "usage": {
    "prompt_tokens": 7,
    "completion_tokens": 9,
    "total_tokens": 16
  }
}
```

## Step 3: Chat Completion (Instruct Models Only)

```bash
curl -k -X POST https://<inference-endpoint>/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "<model-id>",
    "messages": [
      {"role": "system", "content": "You are a helpful assistant."},
      {"role": "user", "content": "What is Kubernetes?"}
    ],
    "max_tokens": 64
  }'
```

**Note:** This only works with instruct-tuned models that have a chat template (e.g., `Mistral-7B-Instruct-v0.2`). Base models return:

```json
{
  "error": {
    "message": "Model does not have a default chat template defined in the tokenizer.",
    "code": 500
  }
}
```

## Step 4: Health Check

```bash
# Basic health
curl -k https://<inference-endpoint>/v1/models

# Some deployments also expose
curl -k https://<inference-endpoint>/v1/health
curl -k https://<inference-endpoint>/health
```

If `/v1/models` returns valid JSON, the backend is alive.

## Common Errors and Fixes

| Error | Cause | Fix |
|---|---|---|
| `"The model X does not exist"` (404) | Model ID mismatch | Copy exact `id` from `/v1/models` |
| `"does not have a default chat template"` (500) | Using `/chat/completions` with base model | Use `/v1/completions` instead |
| `activator request timeout` | Backend never initialized | Check pod logs for TRT-LLM errors |
| `curl: (60) SSL certificate problem` | Self-signed or wrong SAN | Use `-k` or fix certificate SANs |
| Connection refused | Pod not running or service misconfigured | Check `kubectl get pods` and `kubectl get svc` |
| Empty response / hangs | Model still loading or GPU issue | Wait for startup; check logs |

## TLS Certificate Issues

If the inference route uses internal certificates:

```bash
# Skip TLS verification (testing only)
curl -k https://<endpoint>/v1/models

# Use custom CA bundle
curl --cacert /path/to/ca-bundle.crt https://<endpoint>/v1/models
```

The SSL error `no alternative certificate subject name matches target host name` means the route certificate SAN does not include the hostname. Fix the certificate, not the curl command.

## Useful Parameters

```bash
# Control output length
"max_tokens": 32

# Adjust randomness
"temperature": 0.7

# Top-p sampling
"top_p": 0.9

# Get multiple responses
"n": 3

# Stream responses
"stream": true
```

### Streaming Example

```bash
curl -k -X POST https://<endpoint>/v1/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "<model-id>",
    "prompt": "Explain Kubernetes in one paragraph:",
    "max_tokens": 128,
    "stream": true
  }'
```

## Quick Validation Script

```bash
#!/bin/bash
ENDPOINT="https://<inference-endpoint>"
MODEL_ID="<model-id>"

echo "=== Health Check ==="
curl -sk "$ENDPOINT/v1/models" | python3 -m json.tool

echo ""
echo "=== Completion Test ==="
curl -sk -X POST "$ENDPOINT/v1/completions" \
  -H "Content-Type: application/json" \
  -d "{
    \"model\": \"$MODEL_ID\",
    \"prompt\": \"Hello, this is a test:\",
    \"max_tokens\": 16
  }" | python3 -m json.tool

echo ""
echo "=== Done ==="
```

## Related Recipes

- [Deploy Mistral with vLLM](/recipes/ai/deploy-mistral-vllm-kubernetes/)
- [Deploy Mistral with NVIDIA NIM](/recipes/ai/deploy-mistral-nvidia-nim/)
- [Troubleshoot NIM TensorRT-LLM Failures](/recipes/troubleshooting/troubleshoot-nim-tensorrt-llm/)
