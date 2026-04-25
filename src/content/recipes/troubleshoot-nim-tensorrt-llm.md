---
title: "Fix NVIDIA NIM TensorRT-LLM Initialization ..."
description: "Diagnose and fix common NIM TensorRT-LLM executor failures including DecoderState mismatch, version incompatibilities, and engine build errors."
category: "troubleshooting"
difficulty: "advanced"
timeToComplete: "20 minutes"
kubernetesVersion: "1.28+"
prerequisites:
  - "NVIDIA NIM LLM deployment (failing or unstable)"
  - "kubectl access to read pod logs"
  - "Basic understanding of TensorRT-LLM"
relatedRecipes:
  - "debug-crashloopbackoff"
  - "deploy-mistral-nvidia-nim"
  - "deploy-mistral-vllm-kubernetes"
  - "test-llm-inference-endpoints"
tags:
  - nvidia-nim
  - tensorrt-llm
  - troubleshooting
  - gpu
  - inference
  - debugging
publishDate: "2026-02-16"
author: "Luca Berton"
---

> 💡 **Quick Answer:** If NIM logs show `Failed to initialize executor on rank 0: setup(): incompatible function arguments` with `max_attention_window` as a list instead of int, your TensorRT-LLM bindings are older than the NIM runtime expects. Upgrade NIM container image, or remove `NIM_NUM_KV_CACHE_SEQ_LENS` override. If `/v1/completions` returns `activator request timeout`, the backend never finished initializing.


This recipe covers the most common NIM + TensorRT-LLM startup failures and their resolutions.

## Symptom: "activator request timeout"

When calling the inference endpoint:

```bash
curl -k -X POST https://<endpoint>/v1/completions \
  -H "Content-Type: application/json" \
  -d '{"model": "Mistral-7B-v0.1", "prompt": "Hello", "max_tokens": 32}'
```

You get:

```text
activator request timeout
```

**This means:** The model server never became ready. The TensorRT-LLM engine failed to initialize, so no inference requests can be served.

## Root Cause 1: DecoderState.setup() ABI Mismatch

### The Error

```text
ERROR [TRT-LLM] Failed to initialize executor on rank 0:
setup(): incompatible function arguments.

Expected:
  max_attention_window: int

Received:
  max_attention_window: [4096, 4096, ..., 4096]  # list of 32 ints
```

### What Happened

The NIM runtime passes `max_attention_window` as a **per-layer list** (one value per transformer layer), but the installed TensorRT-LLM C++ bindings expect a **single integer**.

This is a **binary ABI mismatch** between the NIM runtime and the TensorRT-LLM version bundled in the container.

### How to Confirm

Check the TRT-LLM version inside the container:

```bash
kubectl exec -it <nim-pod> -n ai-inference -- \
  python3 -c "import tensorrt_llm; print(tensorrt_llm.__version__)"
```

Then verify the `DecoderState.setup()` signature:

```bash
kubectl exec -it <nim-pod> -n ai-inference -- \
  python3 -c "
import tensorrt_llm.bindings.internal.runtime as rt
import inspect
print(inspect.signature(rt.DecoderState.setup))
"
```

If you see `max_attention_window: int` (not `List[int]`), the bindings are too old.

### Fix

**Option A — Upgrade NIM container image** (recommended)

Use a newer NIM LLM image that bundles TensorRT-LLM ≥ 1.0.4:

```yaml
image: registry.example.com/org/nvidia/llm-nim:v0.16.0  # or newer
```

**Option B — Remove sliding window override**

If your deployment sets `NIM_NUM_KV_CACHE_SEQ_LENS`, remove it. This environment variable overrides attention window logic and can trigger the mismatch.

## Root Cause 2: Infinite Restart Loop

NIM retries engine initialization every ~5 seconds. The pattern in logs:

```text
Loading weights concurrently: 100%|██████████| 617/617
Model init total -- 4.40s
ERROR [TRT-LLM] Failed to initialize executor on rank 0: ...
INFO Using JIT Config to create LLM args      ← retry starts
Loading weights concurrently: 100%|██████████| 617/617
Model init total -- 4.42s
ERROR [TRT-LLM] Failed to initialize executor on rank 0: ...
INFO Using JIT Config to create LLM args      ← retry again
```

This loop continues indefinitely. The endpoint never becomes healthy.

### Diagnosis

```bash
# Count how many times initialization has been attempted
kubectl logs <nim-pod> -n ai-inference | grep -c "Failed to initialize executor"

# Check if the pod is in CrashLoopBackOff
kubectl get pods -n ai-inference -l app=mistral-nim
```

### Fix

Stop redeploying with the same image. The error is deterministic — it will always fail with the same TRT-LLM version. Upgrade the container image.

## Root Cause 3: GPU Memory Issues

### The Error

```text
CUDA out of memory
Failed to allocate tensor
RuntimeError: CUDA error: out of memory
```

### Common Causes

| Scenario | Explanation |
|---|---|
| Small GPU fraction | 50% of 40 GB = 20 GB, but engine needs ~30 GB |
| Other pods sharing GPU | MIG or time-slicing leaves insufficient VRAM |
| Large `max_batch_size` | Default 512 may require too much KV cache memory |

### Fix

```bash
# Check GPU memory inside the pod
kubectl exec -it <nim-pod> -n ai-inference -- nvidia-smi
```

Increase GPU allocation or reduce batch size:

```yaml
env:
  - name: NIM_MAX_BATCH_SIZE
    value: "64"   # reduce from default 512
```

## Root Cause 4: Transformers Version Warning

```text
UserWarning: transformers version 4.56.1 is incompatible with nvidia-modelopt
```

This warning is usually harmless but can cause subtle issues with tokenizer loading. If inference fails after model loads successfully, pin a compatible transformers version in your custom image.

## Root Cause 5: Chat Template Missing

```json
{
  "error": {
    "message": "Model Mistral-7B-v0.1 does not have a default chat template defined in the tokenizer.",
    "code": 500
  }
}
```

This is **not a bug** — Mistral-7B-v0.1 is a base model without a chat template.

**Fix:** Use `/v1/completions` instead of `/v1/chat/completions`, or deploy an instruct-tuned model.

## Diagnostic Commands Summary

```bash
# Pod status
kubectl get pods -n ai-inference -l app=mistral-nim

# Full logs
kubectl logs -n ai-inference <nim-pod> --tail=200

# Search for errors
kubectl logs -n ai-inference <nim-pod> | grep -i "error\|failed\|exception"

# Check TRT-LLM version
kubectl exec -it <nim-pod> -- python3 -c "import tensorrt_llm; print(tensorrt_llm.__version__)"

# Check GPU status inside pod
kubectl exec -it <nim-pod> -- nvidia-smi

# Check engine initialization
kubectl logs -n ai-inference <nim-pod> | grep -i "engine\|executor\|trt"

# Test health endpoint
curl -k https://<endpoint>/v1/models
```

## Decision Tree

```text
curl returns "activator request timeout"
  └─ Check pod logs
      ├─ "Failed to initialize executor" + "setup(): incompatible"
      │   └─ TRT-LLM version mismatch → upgrade NIM image
      ├─ "CUDA out of memory"
      │   └─ Increase GPU allocation or reduce batch size
      ├─ "Failed to load model" / "plan file missing"
      │   └─ Model weights corrupted or incomplete → re-upload
      ├─ Logs end at "Creating TorchRT LLM API model"
      │   └─ Engine build hanging → check GPU driver and MOFED
      └─ No error but pod keeps restarting
          └─ Liveness probe failing → increase initialDelaySeconds
```

## When to Fall Back to vLLM

If NIM issues persist and you need inference running now:

1. Deploy vLLM instead (see [Deploy Mistral with vLLM](/recipes/ai/deploy-mistral-vllm-kubernetes/)
2. vLLM is more forgiving with driver/library versions
3. Lower throughput but much faster time-to-working-endpoint
4. Same OpenAI-compatible API, just different backend

## Related Recipes

- [Deploy Mistral with NVIDIA NIM](/recipes/ai/deploy-mistral-nvidia-nim/)
- [Deploy Mistral with vLLM](/recipes/ai/deploy-mistral-vllm-kubernetes/)
- [Test LLM Inference Endpoints](/recipes/ai/test-llm-inference-endpoints/)
