---
title: "Debug Distributed vLLM Inference with NCCL Verbose Logging"
description: "Debug distributed vLLM inference using NCCL_DEBUG=INFO and NCCL_DEBUG_SUBSYS=ALL. Covers air-gapped deployment with TRANSFORMERS_OFFLINE, interpreting NCCL"
tags:
  - "vllm"
  - "nccl"
  - "debugging"
  - "distributed-inference"
  - "air-gapped"
category: "ai"
publishDate: "2026-05-08"
author: "Luca Berton"
difficulty: "advanced"
relatedRecipes:
  - "runai-distributed-inference-vllm-nccl"
  - "nccl-pxn-cross-nic-nvlink-topology"
  - "iommu-bios-kernel-nccl-gpu-direct"
  - "disable-acs-pcie-gpu-direct-p2p"
---

> 💡 **Quick Answer:** Add `NCCL_DEBUG=INFO` and `NCCL_DEBUG_SUBSYS=ALL` to see exactly which transport NCCL selects, why connections fail, and how GPUs communicate. Combine with `TRANSFORMERS_OFFLINE=1` and `HF_HUB_OFFLINE=1` for air-gapped clusters that can't reach Hugging Face.

## The Problem

Distributed vLLM inference fails silently or hangs during initialization:

- Workers can't find each other (NCCL timeout)
- Wrong transport selected (TCP instead of NVLink)
- Model download attempted in air-gapped environment
- No visibility into what NCCL is doing without debug flags

## The Solution

### Debug Environment Variables

```bash
# Distributed inference with full NCCL debugging
# (anonymized command — replace registry, project, model)

runai inference distributed submit my-llm-debug \
  -p my-project \
  -i registry.example.com/vllm-openai:latest \
  --existing-pvc claimname=my-project-models,path=/data \
  --workers 2 \
  -g 2 \
  --serving-port container=8000,authorization-type=authenticatedUsers \
  --environment-variable NCCL_IB_DISABLE=1 \
  --environment-variable NCCL_P2P_DISABLE=0 \
  --environment-variable NCCL_DEBUG=INFO \
  --environment-variable NCCL_DEBUG_SUBSYS=ALL \
  --environment-variable TRANSFORMERS_OFFLINE=1 \
  --environment-variable HF_HUB_OFFLINE=1 \
  --run-as-uid 2000 \
  --run-as-gid 2000 \
  --run-as-non-root \
  --preemptibility preemptible \
  -- \
  --model /data/input/Models/Mistral-Small-4-119B-2603 \
  --served-model-name mistral4 \
  --tensor-parallel-size 2 \
  --port 8000
```

### NCCL Debug Variables Explained

```text
Variable                    Value       Purpose
──────────────────────────────────────────────────────────────────
NCCL_DEBUG=INFO             INFO        Log transport selection, topology, errors
                            WARN        Errors and warnings only
                            TRACE       Maximum detail (very verbose)

NCCL_DEBUG_SUBSYS=ALL       ALL         All subsystems
                            INIT        Initialization only
                            NET         Network transport
                            GRAPH       Topology graph building
                            COLL        Collective operations
                            NET,INIT    Combine specific subsystems
```

### Reading NCCL Debug Output

```text
Successful Startup — What to Look For:
──────────────────────────────────────────────────────────────────

1. INITIALIZATION
   gpu-worker-01:0:0 [0] NCCL INFO Bootstrap: Using eth0:10.244.1.15<0>
   gpu-worker-01:0:0 [0] NCCL INFO Channel 00/02 : 0 1 2 3
   → Bootstrap uses Pod default network (eth0)
   → Channel shows GPU rank ordering

2. TOPOLOGY DETECTION
   gpu-worker-01:0:0 [0] NCCL INFO Trees [0] 1/-1/-1->0->-1
   gpu-worker-01:0:0 [0] NCCL INFO P2P Chunksize set to 524288
   → Tree topology detected for collectives
   → P2P chunk size configured

3. TRANSPORT SELECTION
   gpu-worker-01:0:0 [0] NCCL INFO Channel 00 : 0[0] -> 1[1] via P2P/CUMEM
   gpu-worker-01:0:1 [1] NCCL INFO Channel 00 : 1[1] -> 0[0] via P2P/CUMEM
   → P2P/CUMEM = NVLink or PCIe direct (GOOD ✅)

   gpu-worker-01:0:0 [0] NCCL INFO Channel 00 : 0[0] -> 2[0] via NET/Socket/0
   → NET/Socket = TCP over Ethernet (expected when IB disabled)

4. COMPLETION
   gpu-worker-01:0:0 [0] NCCL INFO comm 0x... rank 0 nranks 4 ... - Init COMPLETE
   → All ranks initialized successfully
```

### Common Failure Patterns

```text
FAILURE: NCCL Timeout
──────────────────────────────────────────────────────────────────
Log: gpu-worker-01:0:0 [0] include/socket.h:403 NCCL WARN Connect to
     10.244.2.23:43210 failed: Connection timed out

Cause: Worker Pods can't reach each other on NCCL port
Fix:
  • Check NetworkPolicy allows all ports between workers
  • Verify NCCL_SOCKET_IFNAME matches correct interface
  • Check worker Pods are Running (not Pending)

──────────────────────────────────────────────────────────────────
FAILURE: Wrong Transport (TCP instead of P2P)
──────────────────────────────────────────────────────────────────
Log: Channel 00 : 0[0] -> 1[1] via NET/Socket/0
     (between GPUs on SAME node)

Cause: P2P disabled or ACS blocking NVLink
Fix:
  • Verify NCCL_P2P_DISABLE=0
  • Check nvidia-smi topo -m for P2P connectivity
  • Disable ACS (pcie_acs_override kernel param)

──────────────────────────────────────────────────────────────────
FAILURE: Model Download in Air-Gapped
──────────────────────────────────────────────────────────────────
Log: requests.exceptions.ConnectionError: HTTPSConnectionPool(
     host='huggingface.co', port=443)
     
Cause: TRANSFORMERS_OFFLINE not set; vLLM tries to fetch tokenizer
Fix:
  • Set TRANSFORMERS_OFFLINE=1 and HF_HUB_OFFLINE=1
  • Ensure model directory contains tokenizer files too

──────────────────────────────────────────────────────────────────
FAILURE: NCCL Version Mismatch
──────────────────────────────────────────────────────────────────
Log: NCCL WARN peer mapping resources exhausted
     or: NCCL version 2.18.5+cuda12.2

Cause: Different NCCL versions across workers
Fix:
  • Use same container image for all workers
  • Check: python -c "import torch; print(torch.cuda.nccl.version())"
```

### Air-Gapped / Offline Deployment

```text
TRANSFORMERS_OFFLINE=1
HF_HUB_OFFLINE=1
──────────────────────────────────────────────────────────────────

These prevent vLLM and transformers from making ANY HTTP requests:
  ❌ No model downloads from huggingface.co
  ❌ No tokenizer downloads
  ❌ No config.json fetches
  ❌ No telemetry or version checks

Requirements for offline mode:
  ✅ Full model weights on PVC (/data/input/Models/...)
  ✅ tokenizer.json + tokenizer_config.json in model dir
  ✅ config.json + generation_config.json in model dir
  ✅ All safetensors/bin files present

Verify model directory is complete:
  ls /data/input/Models/Mistral-Small-4-119B-2603/
  # Must contain:
  # config.json
  # tokenizer.json
  # tokenizer_config.json
  # special_tokens_map.json
  # model-00001-of-00059.safetensors
  # ...
  # model.safetensors.index.json
```

### Debug Checklist

```bash
# Step-by-step debugging distributed vLLM:

# 1. Are all Pods running?
kubectl get pods -n runai-my-project -l run.ai/workload=my-llm-debug
# All should be Running, not Pending/CrashLoopBackOff

# 2. Can workers reach each other?
kubectl exec -n runai-my-project <head-pod> -- \
  python3 -c "import socket; s=socket.socket(); s.settimeout(5); s.connect(('<worker-ip>', 29500)); print('OK')"

# 3. Check NCCL debug output
kubectl logs -n runai-my-project <head-pod> 2>&1 | grep "NCCL"

# 4. Check GPU visibility per worker
kubectl exec -n runai-my-project <head-pod> -- nvidia-smi -L
# Should show exactly 2 GPUs (matching -g 2)

# 5. Check model files accessible
kubectl exec -n runai-my-project <head-pod> -- \
  ls -la /data/input/Models/Mistral-Small-4-119B-2603/ | head -5

# 6. Check file permissions (non-root UID 2000)
kubectl exec -n runai-my-project <head-pod> -- \
  id && ls -la /data/input/Models/Mistral-Small-4-119B-2603/config.json

# 7. Check NCCL environment is set
kubectl exec -n runai-my-project <head-pod> -- env | grep NCCL

# 8. Check memory pressure
kubectl exec -n runai-my-project <head-pod> -- nvidia-smi --query-gpu=memory.used,memory.total --format=csv
```

### Tuning After Debug

```bash
# Once working, reduce debug verbosity for production:
--environment-variable NCCL_DEBUG=WARN          # Only errors/warnings
# Remove NCCL_DEBUG_SUBSYS (not needed at WARN level)

# Performance tuning to add:
--environment-variable NCCL_SOCKET_NTHREADS=4   # More network threads
--environment-variable NCCL_NSOCKS_PERTHREAD=4  # More sockets per thread
--environment-variable NCCL_BUFFSIZE=8388608    # 8MB NCCL buffer

# vLLM-specific tuning:
-- \
  --max-model-len 8192 \                         # Limit context length (saves VRAM)
  --gpu-memory-utilization 0.92 \                # Use 92% of GPU memory
  --enable-chunked-prefill \                     # Better throughput
  --disable-log-requests \                       # Reduce log noise
```

### NCCL_DEBUG_SUBSYS Reference

```text
Subsystem    What It Logs
──────────────────────────────────────────────────────────────────
INIT         Initialization, rank setup, communicator creation
COLL         Collective ops (allReduce, allGather, etc.)
P2P          Point-to-point send/recv operations
SHM          Shared memory transport details
NET          Network transport (IB, Socket, collNet)
GRAPH        Topology graph and channel/ring construction
TUNING       Algorithm and protocol selection
ALLOC        Memory allocation events
PROXY        Proxy thread activity (network I/O)
NVLS         NVLink SHARP operations (H100+)
ALL          Everything (very verbose — use for debugging only)

Recommended for debugging:
  NCCL_DEBUG=INFO NCCL_DEBUG_SUBSYS=INIT,NET,GRAPH
  → Shows init, transport selection, and topology without flood
```

## Common Issues

### NCCL hangs at "Init COMPLETE" but vLLM never starts serving
- **Cause**: Model loading takes time (119B = ~240GB to load from PVC)
- **Fix**: Wait 5-10 min for NFS/PVC to load all shards; check `nvidia-smi` for VRAM filling up

### "CUDA out of memory" during model loading
- **Cause**: TP size too small for model; KV cache allocation fails
- **Fix**: Add `--max-model-len 4096` to reduce KV cache; increase TP or workers

### Debug output too verbose (millions of lines)
- **Cause**: `NCCL_DEBUG_SUBSYS=ALL` with `NCCL_DEBUG=INFO` on inference traffic
- **Fix**: Use `NCCL_DEBUG_SUBSYS=INIT,NET` for targeted debugging; set to `WARN` in production

### Workers crash with "tokenizer not found"
- **Cause**: `TRANSFORMERS_OFFLINE=1` but tokenizer files missing from model dir
- **Fix**: Download complete model (including tokenizer files) to PVC

## Best Practices

1. **Debug first, optimize later** — start with `NCCL_DEBUG=INFO NCCL_DEBUG_SUBSYS=ALL`
2. **Remove debug flags in production** — `NCCL_DEBUG=WARN` reduces log volume 100x
3. **Always set offline flags** in air-gapped clusters — prevents hanging on HTTP timeouts
4. **Verify model directory completeness** before deploying — missing tokenizer = crash
5. **Check transport selection** — `P2P/CUMEM` intra-node, `NET/Socket` inter-node is correct for Ethernet
6. **Save debug logs** before deleting workload — NCCL output vanishes with the Pod
7. **Test with smaller model first** — verify distributed setup before loading 119B

## Key Takeaways

- `NCCL_DEBUG=INFO` + `NCCL_DEBUG_SUBSYS=ALL` shows exactly what NCCL is doing
- Look for: `P2P/CUMEM` (intra-node NVLink ✅), `NET/Socket` (inter-node TCP ✅)
- Bad signs: `NET/Socket` between GPUs on same node (P2P broken), timeouts (network issue)
- `TRANSFORMERS_OFFLINE=1` + `HF_HUB_OFFLINE=1` = mandatory for air-gapped clusters
- Model directory must be complete (weights + tokenizer + config) for offline mode
- Reduce to `NCCL_DEBUG=WARN` in production — INFO is for debugging only
- NCCL debug subsystems let you focus on INIT, NET, or GRAPH without log flood
- Debug checklist: Pods running → network reachable → GPUs visible → model readable → NCCL init
