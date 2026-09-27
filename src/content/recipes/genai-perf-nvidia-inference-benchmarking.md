---
title: "GenAI-Perf: Benchmark LLM Inference on Kubernetes"
description: "Benchmark Triton, vLLM and NIM endpoints with NVIDIA GenAI-Perf on Kubernetes: TTFT, ITL, throughput, concurrency sweeps, GPU telemetry, and AIPerf migration."
publishDate: "2026-05-05"
updatedDate: "2026-09-27"
author: "Luca Berton"
category: "ai"
difficulty: "intermediate"
timeToComplete: "25 minutes"
kubernetesVersion: "1.28+"
prerequisites:
  - "An LLM endpoint on Kubernetes (Triton, vLLM, NIM, TGI)"
  - "DCGM Exporter (optional, for GPU telemetry)"
tags:
  - "genai-perf"
  - "benchmarking"
  - "inference"
  - "llm"
  - "triton"
  - "vllm"
  - "nvidia"
  - "performance"
relatedRecipes:
  - "aiperf-benchmark-llm-kubernetes"
  - "aiperf-concurrency-sweep-kubernetes"
  - "aiperf-goodput-slo-benchmark"
  - "triton-inference-server-vs-vllm-comparison"
  - "triton-tensorrt-llm-kubernetes"
  - "triton-vllm-kubernetes"
  - "triton-autoscaling-gpu-metrics"
  - "gpu-tenant-slo-observability"
  - "nim-model-profiles-selection-kubernetes"
---

> 💡 **Quick Answer:** GenAI-Perf is NVIDIA's CLI for benchmarking generative AI endpoints. Point it at your Service from inside the cluster: `genai-perf profile -m <model> --endpoint-type chat --streaming --url http://vllm:8000 --concurrency 16` (OpenAI-compatible) or `genai-perf profile -m <model> --backend tensorrtllm --streaming --url triton:8001` (Triton gRPC). It reports time to first token (TTFT), inter-token latency (ITL), request latency, and output/request throughput. **Note:** NVIDIA is phasing GenAI-Perf out in favour of [AIPerf](/recipes/ai/aiperf-benchmark-llm-kubernetes/) — use AIPerf for new benchmarking work.

## GenAI-Perf vs AIPerf

GenAI-Perf lives in the `triton-inference-server/perf_analyzer` repo and wraps Perf Analyzer. Its README now states it is being phased out with no new feature development, and points to **AIPerf** (`ai-dynamo/aiperf`) as the successor. AIPerf keeps a similar `profile` CLI and metric set, adds request-rate/arrival patterns, goodput, trace replay and a live dashboard.

Use GenAI-Perf when you have existing scripts/baselines built on it or are benchmarking Triton's native KServe gRPC protocol; start new work on AIPerf. Keep the tool constant when comparing results — the two do not produce bit-identical numbers.

## Install

```bash
# pip
pip install genai-perf

# or the Triton SDK container, which bundles genai-perf + perf_analyzer
kubectl run genai-perf -n ai-inference --restart=Never \
  --image=nvcr.io/nvidia/tritonserver:25.01-py3-sdk -- sleep infinity
kubectl exec -it -n ai-inference genai-perf -- bash
```

> **CLI versions:** older releases select the protocol with `--service-kind openai|triton` and name the dataset size `--num-prompts`. Current releases infer the protocol from `--endpoint-type` (default `kserve`, i.e. Triton) and use `--num-dataset-entries`. Commands below use the current syntax; run `genai-perf profile --help` to confirm what your version accepts.

## Benchmark an OpenAI-Compatible Endpoint (vLLM, NIM, TGI)

```bash
genai-perf profile \
  -m meta-llama/Llama-3.1-8B-Instruct \
  --tokenizer meta-llama/Llama-3.1-8B-Instruct \
  --endpoint-type chat \
  --streaming \
  --url http://vllm-service.ai-inference:8000 \
  --concurrency 16 \
  --request-count 200 \
  --warmup-request-count 10 \
  --synthetic-input-tokens-mean 512 \
  --synthetic-input-tokens-stddev 32 \
  --output-tokens-mean 256 \
  --extra-inputs max_tokens:256 \
  --artifact-dir /results/vllm-c16
```

- `-m` must match the server's model name (`curl http://vllm-service:8000/v1/models`).
- `--tokenizer` should match the model; otherwise token counts, and every per-token metric, are off.
- `--endpoint-type completions` targets `/v1/completions`; `embeddings` benchmarks embedding models.
- Authenticated endpoints: add `-H "Authorization: Bearer $TOKEN"`.

## Benchmark Triton (TensorRT-LLM or vLLM Backend)

Triton's native protocol is KServe v2 over gRPC (port 8001), which is GenAI-Perf's default endpoint type:

```bash
# TensorRT-LLM backend
genai-perf profile \
  -m llama3-8b \
  --backend tensorrtllm \
  --streaming \
  --url triton-trtllm.ai-inference:8001 \
  --concurrency 32 \
  --request-count 200 \
  --synthetic-input-tokens-mean 550 \
  --output-tokens-mean 256 \
  --artifact-dir /results/trtllm-c32

# vLLM backend on Triton: same command, --backend vllm
genai-perf profile \
  -m mistral-7b \
  --backend vllm \
  --streaming \
  --url triton-vllm.ai-inference:8001 \
  --concurrency 32 \
  --request-count 200 \
  --synthetic-input-tokens-mean 550 \
  --output-tokens-mean 256 \
  --artifact-dir /results/vllm-backend-c32
```

Running identical parameters against both backends is the fairest [TensorRT-LLM vs vLLM comparison](/recipes/ai/triton-inference-server-vs-vllm-comparison/) you can do on your own hardware. If Triton's OpenAI-compatible frontend is enabled, you can also benchmark it with `--endpoint-type chat` like any OpenAI server.

## Run as a Kubernetes Job

In-cluster Jobs remove laptop/VPN/ingress noise and make runs reproducible:

```yaml
apiVersion: batch/v1
kind: Job
metadata:
  name: genai-perf-sweep
  namespace: ai-inference
spec:
  backoffLimit: 0
  template:
    spec:
      restartPolicy: Never
      containers:
        - name: genai-perf
          image: nvcr.io/nvidia/tritonserver:25.01-py3-sdk
          command: ["/bin/bash", "-c"]
          args:
            - |
              set -euo pipefail
              for C in 1 2 4 8 16 32 64; do
                genai-perf profile \
                  -m meta-llama/Llama-3.1-8B-Instruct \
                  --tokenizer meta-llama/Llama-3.1-8B-Instruct \
                  --endpoint-type chat --streaming \
                  --url http://vllm-service:8000 \
                  --concurrency "$C" \
                  --request-count $(( C * 10 > 100 ? C * 10 : 100 )) \
                  --warmup-request-count 10 \
                  --synthetic-input-tokens-mean 512 \
                  --output-tokens-mean 256 \
                  --random-seed 42 \
                  --artifact-dir /results/c$C \
                  --generate-plots
              done
          env:
            - name: HF_TOKEN            # gated tokenizers (Llama, etc.)
              valueFrom:
                secretKeyRef:
                  name: hf-token
                  key: token
          resources:
            requests:
              cpu: "4"
              memory: 8Gi
          volumeMounts:
            - name: results
              mountPath: /results
      volumes:
        - name: results
          persistentVolumeClaim:
            claimName: benchmark-results
```

`--concurrency` takes one value per run, hence the loop. Current releases also offer `genai-perf analyze --sweep-type concurrency --sweep-range 1:64` to sweep in one command.

For air-gapped clusters, mount a pre-downloaded tokenizer and pass `--tokenizer /models/tokenizers/llama3`.

## Reproducible Runs with a Config File

Current releases accept YAML config (`genai-perf create-template` writes a starting file):

```bash
genai-perf create-template          # writes a template YAML config to edit
genai-perf config -f <your-config>.yaml
```

Commit the config next to your deployment manifests so every benchmark of a model version uses the same stimulus.

## GPU Telemetry

GenAI-Perf can scrape DCGM Exporter during the run and add GPU power, utilization, memory and energy to the report:

```bash
genai-perf profile -m llama3-8b --backend tensorrtllm --streaming \
  --url triton-trtllm:8001 --concurrency 32 \
  --server-metrics-urls http://nvidia-dcgm-exporter.gpu-operator:9400/metrics \
  --verbose
```

The default is `http://localhost:9400/metrics`, so in Kubernetes always pass the DCGM Exporter Service URL (check the name with `kubectl get svc -n gpu-operator`). The scraped exporter must be on the node running the inference pod for the numbers to mean anything.

## Reading the Output

```text
                          NVIDIA GenAI-Perf | LLM Metrics
┏━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┳━━━━━━━━┳━━━━━━━━┳━━━━━━━━┳━━━━━━━━┳━━━━━━━━┓
┃                         Statistic ┃    avg ┃    min ┃    max ┃    p99 ┃    p90 ┃
┡━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━╇━━━━━━━━╇━━━━━━━━╇━━━━━━━━╇━━━━━━━━╇━━━━━━━━┩
│          Time to first token (ms) │  16.26 │  12.39 │  17.25 │  17.09 │  16.68 │
│          Inter token latency (ms) │   1.85 │   1.55 │   2.04 │   2.02 │   1.97 │
│              Request latency (ms) │ 499.20 │ 451.01 │ 554.61 │ 548.69 │ 526.13 │
│            Output sequence length │ 261.90 │ 256.00 │ 298.00 │ 296.60 │ 270.00 │
│             Input sequence length │ 550.06 │ 550.00 │ 553.00 │ 551.60 │ 550.00 │
│ Output token throughput (per sec) │ 520.87 │    N/A │    N/A │    N/A │    N/A │
│      Request throughput (per sec) │   1.99 │    N/A │    N/A │    N/A │    N/A │
└───────────────────────────────────┴────────┴────────┴────────┴────────┴────────┘
```

| Metric | What it measures | What moves it |
|--------|------------------|---------------|
| **TTFT** | Request sent → first token | Prefill cost (prompt length), queueing, network |
| **ITL** | Gap between streamed tokens | Decode speed, batch size, memory bandwidth |
| **Request latency** | Sent → last token (≈ TTFT + OSL × ITL) | Output length |
| **Output token throughput** | Tokens/s across all requests | Concurrency, batching efficiency |
| **Request throughput** | Completed requests/s | Output length, concurrency |

TTFT and ITL are only measured with `--streaming`. Artifacts land in `--artifact-dir`: `profile_export.json` (raw), `profile_export_genai_perf.json` and `profile_export_genai_perf.csv` (summaries), plus plots with `--generate-plots`.

Sweep concurrency and plot throughput against p99 TTFT: the operating point is just before TTFT inflects while throughput flattens. That concurrency per replica is the input for [autoscaling targets](/recipes/ai/triton-autoscaling-gpu-metrics/).

## Measure Network Overhead

Run the same benchmark from three places — a pod in the same namespace, a node outside the cluster behind the ingress/HAProxy, and a developer laptop. The TTFT delta between in-cluster and external runs is your ingress + TLS + WAN cost; ITL should barely change. Always quote in-cluster numbers as the model's performance.

## SLO Gate in CI

```bash
#!/usr/bin/env bash
# Fail the pipeline if p95 TTFT or ITL regress. Reads GenAI-Perf's JSON summary.
set -euo pipefail
ART=/results/ci
genai-perf profile -m "$MODEL" --tokenizer "$MODEL" --endpoint-type chat --streaming \
  --url "$ENDPOINT" --concurrency 16 --request-count 200 --artifact-dir "$ART" >/dev/null

SUMMARY=$(find "$ART" -name 'profile_export_genai_perf.json' | head -1)
TTFT_P95=$(jq '.time_to_first_token.p95' "$SUMMARY")
ITL_P95=$(jq '.inter_token_latency.p95' "$SUMMARY")
echo "TTFT p95=${TTFT_P95}ms ITL p95=${ITL_P95}ms"
awk -v t="$TTFT_P95" -v i="$ITL_P95" 'BEGIN{exit !(t<200 && i<30)}' || { echo "SLO FAIL"; exit 1; }
```

Check the key names against your version's JSON before wiring this into CI. For SLO-based throughput (goodput), AIPerf has first-class support: see [AIPerf goodput](/recipes/ai/aiperf-goodput-slo-benchmark/).

## Common Issues

| Symptom | Cause | Fix |
|---------|-------|-----|
| `Connection refused` to Triton | Using HTTP port with the default KServe gRPC endpoint type | Use `:8001` for gRPC, or `--endpoint-type chat` against an OpenAI port |
| `unrecognized arguments: --service-kind` | Current release removed it | Drop it; set `--endpoint-type` |
| Old release rejects `--endpoint-type chat` | Older CLI needs the service kind | Add `--service-kind openai` |
| Model not found | `-m` differs from the served name | Check `/v1/models` (vLLM `--served-model-name`) |
| TTFT huge on first requests | Cold start, CUDA graph capture | `--warmup-request-count 10+` |
| Output shorter than `--output-tokens-mean` | Server stops at EOS/defaults | `--extra-inputs max_tokens:N` (and `ignore_eos:true` on vLLM for fixed-length tests) |
| No GPU telemetry | Wrong DCGM URL | Pass `--server-metrics-urls` with the exporter Service |
| Results vary run to run | Short runs | More requests, fixed `--random-seed`, repeat 3×; compare medians |

## Frequently Asked Questions

### What is GenAI-Perf?

A command-line benchmarking tool from NVIDIA that generates synthetic or file-based prompts, sends them to an LLM endpoint at a chosen concurrency or request rate, and reports LLM-specific metrics — TTFT, inter-token latency, request latency, output token throughput and request throughput. It supports Triton (KServe) and OpenAI-compatible endpoints such as vLLM, NIM and TGI.

### Is GenAI-Perf deprecated?

It is being phased out: NVIDIA no longer develops new features and recommends AIPerf for new benchmarking. Existing GenAI-Perf releases keep working, so keep them where you have historical baselines, but plan the move to [AIPerf](/recipes/ai/aiperf-benchmark-llm-kubernetes/).

### How do I benchmark Triton Inference Server with GenAI-Perf?

Use the default KServe endpoint type over gRPC and set the backend: `genai-perf profile -m <model> --backend tensorrtllm --streaming --url <triton-svc>:8001`. Use `--backend vllm` for Triton's vLLM backend.

### How do I benchmark vLLM with GenAI-Perf?

Target its OpenAI API: `genai-perf profile -m <served-model-name> --endpoint-type chat --streaming --url http://<vllm-svc>:8000 --tokenizer <hf-model>`. On older releases add `--service-kind openai`.

### What is a good TTFT and ITL?

It depends on the product. As rough interactive-chat targets: TTFT under ~200–500 ms and ITL under ~30–50 ms feel responsive. Batch/offline workloads should optimise throughput instead. Define the targets as SLOs and test at the concurrency you expect in production.
