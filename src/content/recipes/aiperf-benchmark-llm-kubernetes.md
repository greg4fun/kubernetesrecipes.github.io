---
title: "AIPerf: Benchmark LLM Inference on Kubernetes"
description: "Benchmark vLLM, NIM, Triton and SGLang endpoints on Kubernetes with NVIDIA AIPerf: TTFT, ITL, throughput, request rates, datasets, goodput and GPU telemetry."
category: "ai"
difficulty: "intermediate"
timeToComplete: "20 minutes"
kubernetesVersion: "1.28+"
prerequisites:
  - "An OpenAI-compatible LLM endpoint on Kubernetes (vLLM, NIM, Triton, SGLang, TGI)"
  - "DCGM Exporter (optional, for GPU telemetry)"
relatedRecipes:
  - "aiperf-concurrency-sweep-kubernetes"
  - "aiperf-goodput-slo-benchmark"
  - "aiperf-trace-replay-kubernetes"
  - "aiperf-multi-model-benchmark"
  - "aiperf-vllm-benchmark-offline"
  - "genai-perf-nvidia-inference-benchmarking"
  - "triton-inference-server-vs-vllm-comparison"
  - "nvidia-dynamo-distributed-inference-kubernetes"
  - "nim-model-profiles-selection-kubernetes"
  - "deploy-multinode-nim-models-kubernetes"
tags:
  - aiperf
  - benchmarking
  - nvidia
  - inference
  - llm
  - vllm
  - nim
  - gpu
  - performance
author: "Luca Berton"
publishDate: "2026-02-26"
updatedDate: "2026-09-27"
---

> 💡 **Quick Answer:** `pip install aiperf`, then from a pod inside the cluster run `aiperf profile --model <served-model> --tokenizer <hf-model> --endpoint-type chat --streaming --url http://<svc>:8000 --concurrency 16 --request-count 200`. AIPerf (`ai-dynamo/aiperf`) is NVIDIA's successor to GenAI-Perf: it reports TTFT, time to second token, inter-token latency, request latency and throughput, and adds request-rate/arrival patterns, public datasets, goodput SLOs, trace replay, GPU telemetry and a live dashboard. In Jobs use `--ui simple` or `--ui none`.

## Why AIPerf

HTTP load tools (wrk, hey, k6) don't understand streamed tokens. AIPerf measures what LLM users feel — first-token delay and streaming smoothness — under controlled load, and replaces GenAI-Perf, which NVIDIA is phasing out. It runs as a set of cooperating processes over a ZeroMQ bus, so a single client can drive high concurrency without becoming the bottleneck.

## Install

```bash
pip install aiperf
aiperf profile --help
```

Run it from a pod in the cluster (same namespace or at least the same network path as real clients) so ingress, VPN and laptop Wi-Fi don't pollute the numbers.

## Quick Benchmark

```bash
aiperf profile \
  --model meta-llama/Llama-3.1-8B-Instruct \
  --tokenizer meta-llama/Llama-3.1-8B-Instruct \
  --endpoint-type chat \
  --streaming \
  --url http://vllm-service.ai-inference:8000 \
  --concurrency 16 \
  --request-count 200 \
  --warmup-request-count 10
```

- `--model` must equal the server's model name (`curl http://vllm-service:8000/v1/models`).
- `--tokenizer` must match the model, or every token-based metric is wrong. For air-gapped clusters pass a local path (`--tokenizer /models/tokenizers/llama3`).
- The same command works for NIM, SGLang, TGI and Triton's OpenAI-compatible frontend — change `--url`/`--model`.
- Authenticated endpoints: `-H "Authorization: Bearer $TOKEN"`.

## Run as a Kubernetes Job

```yaml
apiVersion: batch/v1
kind: Job
metadata:
  name: aiperf-benchmark
  namespace: ai-inference
spec:
  backoffLimit: 0
  template:
    spec:
      restartPolicy: Never
      containers:
        - name: aiperf
          image: python:3.12-slim
          command: ["/bin/bash", "-c"]
          args:
            - |
              set -euo pipefail
              pip install -q aiperf
              aiperf profile \
                --model meta-llama/Llama-3.1-8B-Instruct \
                --tokenizer meta-llama/Llama-3.1-8B-Instruct \
                --endpoint-type chat --streaming \
                --url http://vllm-service:8000 \
                --concurrency 1,4,16,64 \
                --request-count 500 \
                --warmup-request-count 10 \
                --synthetic-input-tokens-mean 512 \
                --output-tokens-mean 256 \
                --random-seed 42 \
                --ui simple \
                --artifact-dir /results/llama8b
          env:
            - name: HF_TOKEN                # gated tokenizers
              valueFrom:
                secretKeyRef:
                  name: hf-token
                  key: token
          resources:
            requests:
              cpu: "4"
              memory: 4Gi
          volumeMounts:
            - name: results
              mountPath: /results
      volumes:
        - name: results
          persistentVolumeClaim:
            claimName: benchmark-results
```

A comma-separated `--concurrency` list runs a sweep in one invocation; see [AIPerf concurrency sweeps](/recipes/ai/aiperf-concurrency-sweep-kubernetes/) for analysis. AIPerf also ships a JobSet-based Kubernetes operator for managed, repeatable runs (see the upstream `docs/kubernetes` guide).

## Load Shapes

```bash
# Fixed concurrency (closed loop): N requests always in flight
aiperf profile ... --concurrency 32 --request-count 500

# Request rate (open loop), Poisson arrivals — the default arrival pattern
aiperf profile ... --request-rate 10 --request-count 500

# Rate with a concurrency cap, constant or bursty (gamma) arrivals
aiperf profile ... --request-rate 10 --concurrency 50 --arrival-pattern constant
aiperf profile ... --request-rate 10 --arrival-pattern gamma --arrival-smoothness 0.5

# Ramp concurrency from 1 to target over 60 s, or run for a fixed time
aiperf profile ... --concurrency 100 --concurrency-ramp-duration 60 --request-count 1000
aiperf profile ... --concurrency 32 --benchmark-duration 300
```

Closed-loop concurrency answers "how much can one replica sustain"; open-loop request rate answers "what happens to latency at X req/s" and exposes queueing that concurrency tests hide.

## Datasets

```bash
# Synthetic prompts with controlled input/output sequence lengths
aiperf profile ... --synthetic-input-tokens-mean 1024 --synthetic-input-tokens-stddev 64 \
  --output-tokens-mean 256 --extra-inputs max_tokens:256

# Public conversational dataset
aiperf profile ... --public-dataset sharegpt

# Your own prompts (JSONL)
aiperf profile ... --input-file prompts.jsonl --custom-dataset-type single_turn
```

Timestamped production traces (e.g. Mooncake format) can be replayed with their original timing — see [AIPerf trace replay](/recipes/ai/aiperf-trace-replay-kubernetes/). If output lengths come back shorter than requested, the server stopped at EOS: set `max_tokens` via `--extra-inputs` (and `ignore_eos:true` on vLLM for fixed-length tests).

## Goodput (SLO-Based Throughput)

Count only requests that meet latency targets. Keys are metric tags, values in display units (ms):

```bash
aiperf profile ... --concurrency 50 --request-count 500 \
  --goodput "time_to_first_token:500 inter_token_latency:50"
```

Deep dive: [AIPerf goodput](/recipes/ai/aiperf-goodput-slo-benchmark/).

## Multiple Replicas, Embeddings and Rankings

```bash
# Round-robin across replicas (e.g. behind a headless Service)
aiperf profile ... --url http://vllm-0.vllm-headless:8000 --url http://vllm-1.vllm-headless:8000

# Embeddings (OpenAI-style) and NIM rerankers
aiperf profile --model nvidia/nv-embedqa-e5-v5 --endpoint-type embeddings \
  --url http://embedding-service:8000 --concurrency 50 --request-count 1000
aiperf profile --model nvidia/nv-rerankqa-mistral-4b-v3 --endpoint-type nim_rankings \
  --url http://ranking-service:8000 --concurrency 20 --request-count 500
```

Other endpoint types include `completions`, `responses`, `nim_embeddings`, `audio_transcription` and `image_generation`; multimodal (vision) requests go through `chat`. Run `aiperf profile --help` for your version's list. Benchmarking several models at once: [AIPerf multi-model](/recipes/ai/aiperf-multi-model-benchmark/).

## GPU Telemetry and Server Metrics

```bash
aiperf profile ... --gpu-telemetry http://nvidia-dcgm-exporter.gpu-operator:9400/metrics
```

AIPerf defaults to DCGM on `localhost:9400/9401`, so in Kubernetes pass the DCGM Exporter Service URL. It also scrapes the inference server's own Prometheus endpoint (`<url>/metrics`) by default; add more with `--server-metrics`, or disable with `--no-server-metrics`.

## Reading the Output

```text
            NVIDIA AIPerf | LLM Metrics
┏━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┳━━━━━━━━━┳━━━━━━━━┳━━━━━━━━━┳━━━━━━━━━┳━━━━━━━━━┓
┃                      Metric ┃     avg ┃    min ┃     max ┃     p99 ┃     p50 ┃
┡━━━━━━━━━━━━━━━━━━━━━━━━━━━━━╇━━━━━━━━━╇━━━━━━━━╇━━━━━━━━━╇━━━━━━━━━╇━━━━━━━━━┩
│        Request Latency (ms) │ 1234.56 │ 987.34 │ 1567.89 │ 1534.23 │ 1223.45 │
│    Time to First Token (ms) │  234.56 │ 189.23 │  298.45 │  289.34 │  231.12 │
│    Inter Token Latency (ms) │   15.67 │  12.34 │   19.45 │   19.01 │   15.45 │
│ Output Token Count (tokens) │  150.00 │ 120.00 │  180.00 │  178.90 │  149.00 │
│  Request Throughput (req/s) │   31.45 │      - │       - │       - │       - │
└─────────────────────────────┴─────────┴────────┴─────────┴─────────┴─────────┘
```

| Metric | Meaning | Watch for |
|--------|---------|-----------|
| **TTFT** | Request → first token | Prefill cost and queueing; rises with prompt length and load |
| **TTST** | First → second token | A TTST much larger than ITL points at scheduling/batching stalls after prefill |
| **ITL** | Average gap between tokens | Decode speed; streaming smoothness |
| **Request latency** | Request → last token (≈ TTFT + OSL × ITL) | Output length dominates |
| **Output token throughput** | Tokens/s across all requests | Capacity per replica |
| **Output token throughput per user** | Tokens/s seen by one stream | Drops as concurrency rises |
| **Goodput** | Requests/s meeting all SLOs | Your real capacity |

Results go to `--artifact-dir` (default `artifacts/<model>-<endpoint>-<load>/`): `profile_export_aiperf.json` and `.csv` summaries plus per-request `profile_export.jsonl`. `--num-profile-runs 3` repeats the run and reports confidence intervals.

## Common Issues

| Symptom | Cause | Fix |
|---------|-------|-----|
| Dashboard garbled or empty in a Job | No TTY | `--ui simple` or `--ui none` (auto `none` when not a TTY) |
| Tokenizer download fails | Gated model or air-gapped cluster | `HF_TOKEN`, or mount a local tokenizer path |
| Token counts look wrong | Tokenizer doesn't match the served model | Set `--tokenizer` explicitly |
| `404` / model not found | `--model` ≠ served model name | Check `/v1/models` (vLLM `--served-model-name`) |
| TTFT spikes at the start | Cold caches, CUDA graph capture | `--warmup-request-count 10` or `--warmup-duration` |
| Client errors at extreme concurrency | Ephemeral port exhaustion on the client pod | Lower concurrency, spread across pods, or widen `net.ipv4.ip_local_port_range` (namespaced sysctl, must be allowed for the pod) |
| Unrecognized flag from an old blog post | Flags renamed over time | Use `aiperf profile --help`; e.g. `--public-dataset`, `--gpu-telemetry`, `--concurrency-ramp-duration` |

## Frequently Asked Questions

### What is NVIDIA AIPerf?

An open-source (Apache 2.0) benchmarking tool from NVIDIA's Dynamo project for generative AI inference. It drives OpenAI-compatible and other endpoints with synthetic, public or recorded workloads and reports LLM metrics such as TTFT, ITL, per-user throughput and goodput.

### AIPerf vs GenAI-Perf — which should I use?

AIPerf. GenAI-Perf is being phased out with no new features; AIPerf keeps a similar `profile` CLI and adds arrival patterns, goodput, trace replay, multi-URL load balancing and live dashboards. Keep GenAI-Perf only where you need continuity with existing baselines — see [GenAI-Perf](/recipes/ai/genai-perf-nvidia-inference-benchmarking/).

### How do I benchmark vLLM on Kubernetes with AIPerf?

Run AIPerf in a pod or Job in the cluster against the vLLM Service: `aiperf profile --model <served-name> --tokenizer <hf-model> --endpoint-type chat --streaming --url http://<vllm-svc>:8000 --concurrency 16`. For offline/batch throughput see [AIPerf with vLLM offline](/recipes/ai/aiperf-vllm-benchmark-offline/).

### Should I use concurrency or request rate?

Use concurrency to find the maximum sustainable load per replica, and request rate (Poisson arrivals) to see latency under realistic traffic at a given req/s. Production sizing usually needs both.

### How do I measure SLO compliance?

Use `--goodput` with metric-tag thresholds, for example `"time_to_first_token:500 inter_token_latency:50"`; AIPerf reports the throughput of requests that met every target.
