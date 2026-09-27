---
title: "Run NCCL Tests on Kubernetes (all_reduce_perf)"
description: "Run nccl-tests all_reduce_perf on Kubernetes or OpenShift, single-node and multi-node with MPIJob, and read algbw/busbw to validate GPU interconnect bandwidth."
category: "ai"
difficulty: "advanced"
timeToComplete: "30 minutes"
kubernetesVersion: "1.28+"
prerequisites:
  - "Kubernetes or OpenShift cluster with NVIDIA GPUs"
  - "NVIDIA GPU Operator installed"
  - "Kubeflow MPI Operator (for multi-node runs)"
  - "RDMA/SR-IOV networking for inter-node tests (NVIDIA Network Operator)"
relatedRecipes:
  - "nccl-allgather-benchmark-profile"
  - "compare-nccl-intra-inter-node"
  - "nccl-roce-validation-mpijob-kubernetes"
  - "nccl-environment-variables-reference-kubernetes"
  - "nccl-gdr-level-tuning-pix-pxb-phb-sys"
  - "nccl-topology-dump-tuning-kubernetes"
  - "verify-nccl-rdma-traffic-debug"
  - "nvidia-peermem-gpudirect-rdma-k8s"
  - "kubeflow-mpijob-worker-ssh-gpu-training"
  - "automate-nccl-preflight-ci"
  - "monitor-nccl-performance-prometheus"
  - "ib-write-bw-rdma-bandwidth-kubernetes"
tags:
  - nccl
  - nccl-tests
  - all-reduce
  - mpijob
  - gpu
  - rdma
  - benchmarking
  - performance
publishDate: "2026-02-17"
updatedDate: "2026-09-27"
author: "Luca Berton"
---

> 💡 **Quick Answer:** Build [NVIDIA nccl-tests](https://github.com/NVIDIA/nccl-tests) into an image, then run `all_reduce_perf -b 8 -e 8G -f 2 -g <gpus>` in a single pod to validate NVLink/PCIe, and through `mpirun` in an **MPIJob** (one process per GPU, `-g 1`) to validate the inter-node fabric. Judge the run by **busbw** at large message sizes: single-node should approach the NVLink/NVSwitch figure for your GPU; multi-node should approach the per-node RDMA NIC bandwidth. `#wrong` must always be `0`.

## Why Run NCCL Tests

`all_reduce_perf` is the standard pre-flight check before distributed training or multi-node inference. It catches:

- RDMA/RoCE/InfiniBand misconfiguration and silent TCP socket fallback
- GPUDirect RDMA not active (traffic staged through host memory)
- GPU↔NIC topology/NUMA mismatches and NICs left unused
- Regressions after driver, firmware, NCCL, CNI or switch changes

## Build an nccl-tests Image

nccl-tests is a separate project from NCCL; build it on an image that already has CUDA, NCCL and Open MPI (NGC PyTorch/HPC images do):

```dockerfile
FROM nvcr.io/nvidia/pytorch:25.01-py3
RUN apt-get update && apt-get install -y --no-install-recommends openssh-server openssh-client \
    && mkdir -p /run/sshd && rm -rf /var/lib/apt/lists/*
RUN git clone --depth 1 https://github.com/NVIDIA/nccl-tests.git /opt/nccl-tests \
    && cd /opt/nccl-tests \
    && make -j MPI=1 MPI_HOME=/usr/local/mpi CUDA_HOME=/usr/local/cuda
ENV PATH=/opt/nccl-tests/build:$PATH
```

Point `MPI_HOME` at your image's Open MPI install. Binaries land in `/opt/nccl-tests/build` (`all_reduce_perf`, `all_gather_perf`, `reduce_scatter_perf`, `alltoall_perf`, `sendrecv_perf`, ...). Without `MPI=1` the binaries only run single-process.

## Flags You Need

| Flag | Meaning | Typical |
|------|---------|---------|
| `-b` | Minimum message size | `8` |
| `-e` | Maximum message size | `8G` (use ≥1G to reach peak bandwidth) |
| `-f` | Size multiplication factor per step | `2` |
| `-g` | GPUs per process (thread) | `8` single-process; `1` with MPI |
| `-t` | Threads per process | `1` |
| `-n` / `-w` | Timed / warmup iterations | `20` / `5` |
| `-c` | Check correctness (`1` default) | keep on for validation |
| `-d` / `-o` | Datatype / reduction op | `float` / `sum` |

Total ranks = MPI processes × threads × `-g`.

## Single-Node Test (NVLink / PCIe)

One process driving all GPUs in the pod — no MPI needed:

```yaml
apiVersion: v1
kind: Pod
metadata:
  name: nccl-single-node
  namespace: gpu-workloads
spec:
  restartPolicy: Never
  containers:
    - name: nccl-tests
      image: registry.example.com/nccl-tests:25.01
      command: ["/bin/bash", "-c"]
      args:
        - |
          nvidia-smi topo -m
          NCCL_DEBUG=INFO all_reduce_perf -b 8 -e 8G -f 2 -g 8 -n 20 -w 5
      resources:
        limits:
          nvidia.com/gpu: "8"
      volumeMounts:
        - name: dshm
          mountPath: /dev/shm
  volumes:
    - name: dshm
      emptyDir:
        medium: Memory
        sizeLimit: 64Gi
```

```bash
kubectl apply -f nccl-single-node.yaml
kubectl logs -f -n gpu-workloads nccl-single-node
```

Mount a memory-backed `/dev/shm` — the container default (64 MiB) breaks NCCL's shared-memory transport.

## Multi-Node Test with MPIJob

nccl-tests bootstraps over MPI, so multi-node runs need `mpirun` launching one rank per GPU across pods. The [Kubeflow MPI Operator](/recipes/ai/kubeflow-mpijob-worker-ssh-gpu-training/) handles SSH keys and the hostfile. (Running `all_reduce_perf` in several independent pods — e.g. a Job with `parallelism: 2` — does **not** test the network; each pod just benchmarks itself.)

```yaml
apiVersion: kubeflow.org/v2beta1
kind: MPIJob
metadata:
  name: nccl-allreduce-2node
  namespace: gpu-workloads
spec:
  slotsPerWorker: 8
  runPolicy:
    cleanPodPolicy: Running
  mpiReplicaSpecs:
    Launcher:
      replicas: 1
      restartPolicy: OnFailure
      template:
        spec:
          containers:
            - name: launcher
              image: registry.example.com/nccl-tests:25.01
              command: ["mpirun"]
              args:
                - --allow-run-as-root
                - -np
                - "16"
                - --map-by
                - ppr:8:node
                - --bind-to
                - none
                - -x
                - NCCL_DEBUG=INFO
                - -x
                - NCCL_IB_HCA=mlx5_0,mlx5_1,mlx5_2,mlx5_3
                - -x
                - NCCL_SOCKET_IFNAME=eth0
                - --mca
                - btl_tcp_if_include
                - eth0
                - all_reduce_perf
                - -b
                - "8"
                - -e
                - 8G
                - -f
                - "2"
                - -g
                - "1"
                - -n
                - "20"
                - -w
                - "5"
    Worker:
      replicas: 2
      template:
        metadata:
          annotations:
            k8s.v1.cni.cncf.io/networks: sriov-rdma-net   # your Multus/SR-IOV network
        spec:
          containers:
            - name: worker
              image: registry.example.com/nccl-tests:25.01
              command: ["/usr/sbin/sshd", "-De"]
              securityContext:
                capabilities:
                  add: ["IPC_LOCK"]        # RDMA memory registration
              resources:
                limits:
                  nvidia.com/gpu: "8"
                  nvidia.com/rdma_sriov: "4"   # resource name from your Network Operator config
              volumeMounts:
                - name: dshm
                  mountPath: /dev/shm
          volumes:
            - name: dshm
              emptyDir:
                medium: Memory
                sizeLimit: 64Gi
```

```bash
kubectl apply -f nccl-allreduce-2node.yaml
# MPI Operator v2 runs the launcher as a Job named <mpijob>-launcher
kubectl logs -f -n gpu-workloads job/nccl-allreduce-2node-launcher
```

Adjust to your fabric:
- `NCCL_IB_HCA` — list the RDMA devices you expect NCCL to use (`ibv_devices` in a worker).
- `NCCL_SOCKET_IFNAME` — the interface for NCCL's bootstrap/out-of-band traffic; `btl_tcp_if_include` does the same for MPI.
- Resource names (`nvidia.com/rdma_sriov`, shared RDMA device plugins, `openshift.io/...` on OpenShift) come from your Network Operator/SR-IOV configuration.
- Pin workers to the node pair under test with `nodeSelector`/affinity and one worker per node (pod anti-affinity).

See [NCCL environment variables](/recipes/ai/nccl-environment-variables-reference-kubernetes/) for the full set, and [RoCE validation with MPIJob](/recipes/ai/nccl-roce-validation-mpijob-kubernetes/) for a production-grade validation harness.

## Test Matrix

Run the same sweep across topologies to localise problems:

1. Single node, 2 GPUs → single node, all GPUs (NVLink/NVSwitch or PCIe)
2. Two nodes, 1 GPU each (one NIC path)
3. Two nodes, all GPUs (all NICs, the real training shape)
4. Swap `all_reduce_perf` for `all_gather_perf` / `reduce_scatter_perf` (FSDP/ZeRO) and `alltoall_perf` (MoE expert parallelism)

Always baseline single-node first: it separates NVLink/PCIe problems from network problems.

## Reading all_reduce_perf Output

Example from a 2-node, 16-GPU run over 4×400G RoCE NICs per node:

```text
#                                              out-of-place          in-place
#       size    count   type  redop  root    time   algbw  busbw  #wrong   time   algbw  busbw  #wrong
#        (B) (elements)                       (us)  (GB/s) (GB/s)          (us)  (GB/s) (GB/s)
           8        2  float    sum    -1    27.80   0.00   0.00      0    27.83   0.00   0.00      0
        8192     2048  float    sum    -1    38.24   0.21   0.40      0    37.78   0.22   0.41      0
      524288   131072  float    sum    -1   256.85   2.04   3.83      0   249.74   2.10   3.94      0
    33554432  8388608  float    sum    -1   531.96  15.77  29.57      0   530.99  15.80  29.62      0
  1073741824  2.68e+8  float    sum    -1  59530.2  18.04  33.82      0  57634.7  18.63  34.93      0
  8589934592  2.15e+9  float    sum    -1   458955  18.72  35.09      0   459021  18.71  35.09      0
# Avg bus bandwidth    : 13.49 GB/s
```

| Column | Meaning |
|--------|---------|
| `size` | Message size in bytes |
| `time` | Time per operation (µs) — small sizes show latency |
| `algbw` | size / time |
| `busbw` | algbw × correction factor; for all-reduce `2(n-1)/n` with n ranks — comparable to hardware link bandwidth |
| `#wrong` | Data verification errors — must be 0 |
| `Avg bus bandwidth` | Mean busbw over *all* sizes, dragged down by small messages — don't use it as the headline number |

**How to judge busbw** (large messages, ≥1 GB):
- **Single node, NVSwitch (H100/H200 SXM class):** in the hundreds of GB/s — hundreds, not tens. Numbers in the tens mean P2P over NVLink isn't being used.
- **Multi-node:** the bottleneck is the network, so busbw should approach the node's usable RDMA bandwidth (NIC count × line rate ÷ 8, minus protocol overhead). Four 400 Gb/s NICs are ~200 GB/s raw per node.
- The example above plateaus at ~35 GB/s — far below what 4×400G can carry. That pattern points to only part of the fabric being used, GPUDirect RDMA not active, or congestion; work through the checks below.
- In-place and out-of-place results should be close.

Use [ib_write_bw](/recipes/networking/ib-write-bw-rdma-bandwidth-kubernetes/) to measure raw NIC-to-NIC bandwidth first — nccl-tests can't beat the wire.

## Verify the Transport in NCCL_DEBUG=INFO Logs

```text
NCCL INFO NET/IB : Using [0]mlx5_0:1/RoCE [1]mlx5_1:1/RoCE [2]mlx5_2:1/RoCE [3]mlx5_3:1/RoCE
NCCL INFO Channel 00/0 : 0[0] -> 8[0] [send] via NET/IB/0/GDRDMA
NCCL INFO Channel 00 : 2[2] -> 1[1] via P2P/CUMEM
NCCL INFO DMA-BUF is available on GPU device 0
```

- `NET/IB : Using [...]` — every NIC you expect should be listed (`/RoCE` vs `/IB` shows the link layer).
- `via NET/IB/.../GDRDMA` — inter-node GPUDirect RDMA is active. `NET/IB` without `GDRDMA` means host staging; `NET/Socket` means TCP fallback.
- `via P2P/...` — intra-node peer-to-peer (NVLink or PCIe); `SHM` means going through host shared memory.
- `DMA-BUF is available` — the kernel path for GPUDirect RDMA without `nvidia-peermem`.
- `Could not find: libnccl-tuner.so` / net plugin not found — informational; NCCL falls back to built-in tuning and transports.
- `CC Off` in init lines refers to Confidential Computing, not compute capability.

## Tuning Knobs Worth Trying

Change one at a time and re-run the sweep:

```yaml
env:
  - name: NCCL_IB_HCA            # use all GPU-facing NICs, exclude management NICs
    value: "mlx5_0,mlx5_1,mlx5_2,mlx5_3"
  - name: NCCL_NET_GDR_LEVEL     # max GPU↔NIC distance for GPUDirect RDMA: LOC, PIX, PXB, PHB, SYS
    value: "SYS"
  - name: NCCL_IB_GID_INDEX      # RoCE v2 GID index (commonly 3; verify with show_gids)
    value: "3"
  - name: NCCL_NVLS_ENABLE       # NVLink SHARP on NVSwitch systems (default auto)
    value: "1"
  - name: NCCL_MIN_NCHANNELS     # more channels can help spread traffic across NICs
    value: "8"
```

Details: [GDR level tuning](/recipes/ai/nccl-gdr-level-tuning-pix-pxb-phb-sys/), [topology dump and tuning](/recipes/ai/nccl-topology-dump-tuning-kubernetes/), [RoCE tuning](/recipes/configuration/tune-nccl-env-rdma-ethernet/).

## Common Issues

| Symptom | Likely cause | Fix |
|---------|--------------|-----|
| `NET/Socket` in logs, very low inter-node busbw | RDMA devices not in the pod, `NCCL_IB_DISABLE=1`, wrong HCA names | Check `ibv_devices` in the pod, RDMA resource requests, `NCCL_IB_HCA` |
| `NET/IB` but no `GDRDMA` | No DMA-BUF / `nvidia-peermem`, ACS/IOMMU blocking P2P, GPU and NIC too far apart | [Verify GPUDirect RDMA](/recipes/ai/nvidia-peermem-gpudirect-rdma-k8s/); check `NCCL_NET_GDR_LEVEL` |
| Fewer NICs listed than expected | `NCCL_IB_HCA` too narrow, VFs not allocated | Fix the HCA list and resource requests |
| `unhandled system error` at init | `/dev/shm` too small, missing `IPC_LOCK`, device plugin issues | Memory-backed `/dev/shm`, add `IPC_LOCK`, check `NCCL_DEBUG=INFO` for the real cause |
| MPI hangs before NCCL starts | SSH/hostfile/DNS between launcher and workers | Check worker `sshd` is running and launcher can resolve worker hostnames |
| Plateau far below line rate | PFC/ECN misconfig, congestion, MTU mismatch | Switch counters (pause frames, drops), MTU end to end |
| `#wrong` > 0 | Hardware or driver fault | Treat as critical: check cables/CRC counters, replace faulty parts before training |
| Run-to-run variance | Shared NICs/switch, CPU throttling | Test on idle nodes, `--bind-to` sensible cores, repeat and compare medians |

## Operationalise It

- Store per-node-pair baselines (busbw at 1G/8G, small-message latency) and re-run after every driver, firmware, NCCL, CNI or switch change.
- Gate new or repaired nodes with an automated run — see [NCCL pre-flight in CI](/recipes/deployments/automate-nccl-preflight-ci/).
- Track trends over time with [NCCL performance monitoring](/recipes/observability/monitor-nccl-performance-prometheus/).

## Frequently Asked Questions

### How do I run all_reduce_perf on Kubernetes?

For one node, run `all_reduce_perf -b 8 -e 8G -f 2 -g <N>` in a pod that requests N GPUs and has a memory-backed `/dev/shm`. For multiple nodes, use an MPIJob: workers run `sshd` and request GPUs and RDMA NICs; the launcher runs `mpirun -np <total GPUs> --map-by ppr:<GPUs per node>:node all_reduce_perf ... -g 1`.

### What is the difference between algbw and busbw?

`algbw` is simply message size divided by time. `busbw` applies an algorithm-specific correction — `2(n-1)/n` for all-reduce — so the number reflects the bandwidth actually used on the links and can be compared with hardware limits regardless of how many ranks participate.

### What busbw should I expect?

Compare against the hardware bottleneck. Single-node NVSwitch systems should reach hundreds of GB/s. Multi-node runs are limited by the network and should approach the node's aggregate RDMA NIC bandwidth for large messages. The "Avg bus bandwidth" line averages all sizes and is always much lower — look at the plateau.

### What does -g mean in all_reduce_perf?

`-g` is the number of GPUs each process (thread) drives. Use `-g 8` for a single process on an 8-GPU node, and `-g 1` when MPI launches one process per GPU.

### Do I need MPI to run NCCL tests?

Only for multi-process or multi-node runs. A single process with `-g N` covers all GPUs on one node. Multi-node requires nccl-tests built with `MPI=1` and launched with `mpirun` (e.g. via the MPI Operator).

### What are the NCCL test binaries?

`all_reduce_perf`, `all_gather_perf`, `reduce_scatter_perf`, `broadcast_perf`, `reduce_perf`, `alltoall_perf`, `alltoallv_perf`, `sendrecv_perf`, `scatter_perf`, `gather_perf` and `hypercube_perf`. All accept the same size/iteration flags.
