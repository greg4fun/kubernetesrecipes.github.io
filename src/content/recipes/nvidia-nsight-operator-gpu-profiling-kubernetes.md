---
title: "NVIDIA Nsight Operator for GPU Profiling on Kubernetes"
description: "Deploy NVIDIA Nsight Systems and Nsight Compute on Kubernetes for GPU workload profiling. Capture kernel traces, memory bandwidth, SM occupancy, and NCCL communication timelines for distributed training and inference optimization."
tags:
  - "nvidia"
  - "nsight"
  - "profiling"
  - "gpu"
  - "performance"
  - "observability"
category: "observability"
publishDate: "2026-05-22"
author: "Luca Berton"
difficulty: "advanced"
relatedRecipes:
  - "dcgm-exporter-gpu-metrics-prometheus"
  - "nvidia-doca-telemetry-network-monitoring-kubernetes"
  - "nvidia-cns-insight-operator-network-diagnostics"
  - "nccl-pxn-cross-nic-nvlink"
---

> 💡 **Quick Answer:** NVIDIA Nsight Systems profiles GPU timelines (kernels, memory, NCCL comms) and Nsight Compute provides per-kernel metrics (occupancy, memory throughput, warp stalls). On Kubernetes, run profiling as sidecar containers or one-shot Jobs with `CAP_SYS_ADMIN` + access to `/dev/nvidia*`. Export `.nsys-rep` and `.ncu-rep` files for analysis.

## The Problem

- GPU utilization shows 80% but you don't know if kernels are efficient or just queued
- NCCL all-reduce takes 40% of step time but you can't see which collective is slow
- Memory-bound vs compute-bound — need per-kernel analysis to optimize
- Distributed training has idle bubbles — where exactly is the pipeline stall?
- Standard monitoring (DCGM) shows utilization, not *why* it's low

## The Solution

### Nsight Systems: Timeline Profiling

```yaml
# Profile a training job with Nsight Systems
apiVersion: batch/v1
kind: Job
metadata:
  name: nsight-systems-profile
  namespace: ai-workloads
spec:
  backoffLimit: 0
  template:
    spec:
      restartPolicy: Never
      containers:
        - name: profiler
          image: nvcr.io/nvidia/pytorch:24.05-py3
          command: ["/bin/bash", "-c"]
          args:
            - |
              # Profile the training script with Nsight Systems
              nsys profile \
                --trace=cuda,nvtx,osrt,cudnn,cublas,nccl \
                --sample=cpu \
                --output=/profiles/training_profile \
                --export=sqlite \
                --force-overwrite=true \
                --duration=120 \
                --delay=30 \
                python /workspace/train.py \
                  --model llama-3-8b \
                  --batch-size 4 \
                  --gradient-accumulation-steps 8

              echo "Profile saved to /profiles/training_profile.nsys-rep"
              ls -lh /profiles/
          securityContext:
            capabilities:
              add: ["SYS_ADMIN"]        # Required for GPU profiling
          env:
            - name: CUDA_VISIBLE_DEVICES
              value: "0,1,2,3"
          volumeMounts:
            - name: profiles
              mountPath: /profiles
            - name: shm
              mountPath: /dev/shm
          resources:
            limits:
              nvidia.com/gpu: "4"
              memory: "64Gi"
            requests:
              cpu: "8"
              memory: "64Gi"
      volumes:
        - name: profiles
          persistentVolumeClaim:
            claimName: nsight-profiles-pvc
        - name: shm
          emptyDir:
            medium: Memory
            sizeLimit: 32Gi
```

### Nsight Systems CLI Options

```bash
# Key nsys profile flags:
nsys profile \
  --trace=cuda,nvtx,osrt,cudnn,cublas,nccl \
  #  cuda   — CUDA API calls and kernel launches
  #  nvtx   — Developer annotations (PyTorch/DeepSpeed markers)
  #  osrt   — OS runtime (pthread, file I/O)
  #  cudnn  — cuDNN operations (conv, attention)
  #  cublas — cuBLAS GEMM operations
  #  nccl   — NCCL collective communications
  
  --cuda-memory-usage=true \        # Track allocations
  --gpuctxsw=true \                 # GPU context switches
  --sample=cpu \                    # CPU call stack sampling
  --backtrace=dwarf \               # Full backtraces
  --output=/profiles/report \       # Output path
  --export=sqlite,json \            # Also export for scripting
  --duration=120 \                  # Profile for 120 seconds
  --delay=30 \                      # Skip warmup (first 30s)
  --kill=sigterm \                  # Clean shutdown after duration
  python train.py

# Analyze from CLI (headless)
nsys stats /profiles/report.nsys-rep
# Shows: top GPU kernels, CUDA API summary, NCCL ops, memory ops

# Export specific stats
nsys stats --report cuda_gpu_kern_sum /profiles/report.nsys-rep
nsys stats --report nccl_gpu_proj /profiles/report.nsys-rep
```

### Nsight Compute: Per-Kernel Analysis

```yaml
# Deep-dive into specific GPU kernels
apiVersion: batch/v1
kind: Job
metadata:
  name: nsight-compute-profile
  namespace: ai-workloads
spec:
  backoffLimit: 0
  template:
    spec:
      restartPolicy: Never
      containers:
        - name: profiler
          image: nvcr.io/nvidia/pytorch:24.05-py3
          command: ["/bin/bash", "-c"]
          args:
            - |
              # Profile specific kernels with Nsight Compute
              ncu \
                --set full \
                --target-processes all \
                --kernel-name "regex:.*gemm.*|.*attention.*" \
                --launch-count 10 \
                --output /profiles/kernel_analysis \
                python /workspace/inference.py \
                  --model llama-3-70b \
                  --prompt "Explain Kubernetes"

              echo "Kernel analysis saved"
              ncu --import /profiles/kernel_analysis.ncu-rep --summary
          securityContext:
            capabilities:
              add: ["SYS_ADMIN"]
          volumeMounts:
            - name: profiles
              mountPath: /profiles
          resources:
            limits:
              nvidia.com/gpu: "1"
              memory: "32Gi"
      volumes:
        - name: profiles
          persistentVolumeClaim:
            claimName: nsight-profiles-pvc
```

```bash
# Nsight Compute CLI options
ncu \
  --set full \                      # All metrics (or: basic, roofline)
  --section SpeedOfLight \          # SM and memory throughput %
  --section MemoryWorkloadAnalysis \ # Memory access patterns
  --section Occupancy \             # Warp occupancy analysis
  --section WarpStateStatistics \   # Why warps are stalled
  --kernel-name "regex:.*gemm.*" \  # Only profile GEMM kernels
  --launch-skip 100 \              # Skip warmup launches
  --launch-count 10 \              # Profile 10 kernel launches
  --target-processes all \         # Profile child processes too
  --output /profiles/report \
  python inference.py

# Key metrics from Nsight Compute:
# - SM Throughput %    — are SMs fully utilized?
# - Memory Throughput % — saturating HBM bandwidth?
# - Achieved Occupancy — warps active vs theoretical max
# - Warp Stall Reasons — memory dependency? instruction fetch?
```

### Profile Distributed Training (Multi-Node)

```yaml
# Profile NCCL communications across nodes
apiVersion: batch/v1
kind: Job
metadata:
  name: nsight-distributed-profile
  namespace: ai-workloads
spec:
  completions: 2
  parallelism: 2
  backoffLimit: 0
  template:
    spec:
      restartPolicy: Never
      containers:
        - name: profiler
          image: nvcr.io/nvidia/pytorch:24.05-py3
          command: ["/bin/bash", "-c"]
          args:
            - |
              # Enable NCCL debug for correlation
              export NCCL_DEBUG=INFO
              export NCCL_DEBUG_SUBSYS=ALL

              # Profile with NCCL tracing
              nsys profile \
                --trace=cuda,nccl,nvtx,osrt \
                --cuda-memory-usage=true \
                --output=/profiles/rank_${RANK}_profile \
                --delay=60 \
                --duration=180 \
                torchrun \
                  --nproc_per_node=4 \
                  --nnodes=2 \
                  --node_rank=${RANK} \
                  --master_addr=${MASTER_ADDR} \
                  --master_port=29500 \
                  train_distributed.py
          securityContext:
            capabilities:
              add: ["SYS_ADMIN"]
          env:
            - name: RANK
              valueFrom:
                fieldRef:
                  fieldPath: metadata.annotations['batch.kubernetes.io/job-completion-index']
            - name: MASTER_ADDR
              value: "nsight-distributed-profile-0.ai-workloads.svc"
          volumeMounts:
            - name: profiles
              mountPath: /profiles
            - name: shm
              mountPath: /dev/shm
          resources:
            limits:
              nvidia.com/gpu: "4"
      volumes:
        - name: profiles
          persistentVolumeClaim:
            claimName: nsight-profiles-pvc
        - name: shm
          emptyDir:
            medium: Memory
            sizeLimit: 32Gi
```

```bash
# Analyze NCCL timelines across ranks
nsys stats --report nccl_gpu_proj rank_0_profile.nsys-rep
nsys stats --report nccl_gpu_proj rank_1_profile.nsys-rep

# Example output:
# NCCL Operation Summary (Rank 0):
# ─────────────────────────────────────────────────────────────
# Operation         Count   Avg (ms)   Total (ms)   % of Step
# AllReduce         240     12.3       2952         38.2%
# ReduceScatter     240     4.1        984          12.7%
# AllGather         240     3.8        912          11.8%
# ─────────────────────────────────────────────────────────────
# Total NCCL:                          4848         62.7%
#
# ⚠️ NCCL dominates step time — overlap compute with communication
```

### Sidecar Pattern for Production Profiling

```yaml
# Add Nsight as a sidecar to an existing training Pod
apiVersion: v1
kind: Pod
metadata:
  name: training-with-profiler
spec:
  containers:
    # Main training container
    - name: training
      image: registry.example.com/my-training:v2.1
      command: ["python", "train.py"]
      resources:
        limits:
          nvidia.com/gpu: "8"

    # Nsight Systems sidecar — attaches to running process
    - name: nsight-sidecar
      image: nvcr.io/nvidia/nsight-systems:2024.5
      command: ["/bin/bash", "-c"]
      args:
        - |
          # Wait for training to start
          sleep 60
          # Find the training PID
          TRAIN_PID=$(pgrep -f "python train.py")
          # Attach and profile for 120 seconds
          nsys profile \
            --trace=cuda,nccl,nvtx \
            --pid=$TRAIN_PID \
            --duration=120 \
            --output=/profiles/attached_profile
          echo "Profile captured"
          sleep infinity
      securityContext:
        capabilities:
          add: ["SYS_ADMIN", "SYS_PTRACE"]
      volumeMounts:
        - name: profiles
          mountPath: /profiles
  shareProcessNamespace: true        # Required for PID attachment
  volumes:
    - name: profiles
      persistentVolumeClaim:
        claimName: nsight-profiles-pvc
```

### Retrieve and Analyze Profiles

```bash
# Copy profiles from PVC to local machine
kubectl cp ai-workloads/nsight-systems-profile:/profiles/training_profile.nsys-rep \
  ./training_profile.nsys-rep

# Open in Nsight Systems GUI (local workstation)
nsys-ui ./training_profile.nsys-rep

# Or generate text summary
nsys stats ./training_profile.nsys-rep --report cuda_gpu_kern_sum

# Top GPU Kernels:
# ─────────────────────────────────────────────────────────────
# Kernel Name                          Time (ms)   Count   Avg (μs)
# volta_fp16_s884gemm_256x128_ldg8     1823.4      4800    379.9
# fmha_v2_flash_attention_fp16_512     892.1       2400    371.7
# nccl_allreduce_ring_ll128            672.3       240     2801.3
# void at::native::vectorized_elementwise  234.5   9600    24.4

# Roofline analysis (requires ncu with --set roofline)
ncu --import kernel_analysis.ncu-rep --page roofline
```

### Automated Profiling with CronJob

```yaml
# Periodic profiling to track performance regression
apiVersion: batch/v1
kind: CronJob
metadata:
  name: periodic-gpu-profile
  namespace: ai-workloads
spec:
  schedule: "0 2 * * 1"            # Monday 2 AM
  jobTemplate:
    spec:
      template:
        spec:
          restartPolicy: Never
          containers:
            - name: benchmark-profile
              image: nvcr.io/nvidia/pytorch:24.05-py3
              command: ["/bin/bash", "-c"]
              args:
                - |
                  DATE=$(date +%Y%m%d)
                  nsys profile \
                    --trace=cuda,nccl \
                    --output=/profiles/weekly_${DATE} \
                    --duration=300 \
                    python /workspace/benchmark.py
                  
                  # Compare with baseline
                  nsys stats --report cuda_gpu_kern_sum \
                    /profiles/weekly_${DATE}.nsys-rep > /profiles/weekly_${DATE}_stats.txt
              securityContext:
                capabilities:
                  add: ["SYS_ADMIN"]
              volumeMounts:
                - name: profiles
                  mountPath: /profiles
              resources:
                limits:
                  nvidia.com/gpu: "1"
          volumes:
            - name: profiles
              persistentVolumeClaim:
                claimName: nsight-profiles-pvc
```

## Common Issues

### "ERR_NVGPUCTRPERM: permission issue"
- **Cause**: Missing `CAP_SYS_ADMIN` capability
- **Fix**: Add `securityContext.capabilities.add: ["SYS_ADMIN"]`; or set `privileged: true`

### Profile file is empty (0 bytes)
- **Cause**: Application crashed before profile flush; or `--duration` too short for `--delay`
- **Fix**: Ensure `duration > delay`; add `--kill=none` to let app finish naturally

### "Cannot attach to process" in sidecar
- **Cause**: `shareProcessNamespace` not enabled; or missing `SYS_PTRACE`
- **Fix**: Set `shareProcessNamespace: true` on Pod spec; add `CAP_SYS_PTRACE`

### Nsight Compute causes 10-100x slowdown
- **Cause**: Normal — ncu replays kernels multiple times to collect all metrics
- **Fix**: Use `--launch-count` to limit profiled launches; use `--set basic` for less overhead

## Best Practices

1. **Nsight Systems first, Compute second** — Systems shows the timeline (where time goes); Compute shows why a specific kernel is slow
2. **Profile after warmup** — use `--delay` to skip initialization
3. **Limit duration** — 60-180s is usually enough for steady-state
4. **Use NVTX markers** in code — `torch.cuda.nvtx.range_push("forward")` for clear timeline labels
5. **Store profiles in PVC** — `.nsys-rep` files can be 1-10 GB for long traces
6. **Weekly regression profiles** — catch performance degradation early

## Key Takeaways

- **Nsight Systems** = timeline profiler (CUDA + NCCL + CPU, shows where time goes)
- **Nsight Compute** = kernel profiler (occupancy, memory, roofline, shows *why* a kernel is slow)
- Both require `CAP_SYS_ADMIN` on Kubernetes (GPU hardware counter access)
- Profile distributed training with per-rank `.nsys-rep` files → correlate NCCL timelines
- Sidecar pattern + `shareProcessNamespace` for profiling existing workloads non-intrusively
- Key findings: NCCL % of step time, compute vs memory bound kernels, pipeline bubbles
- Export to SQLite/JSON for automated regression detection
