---
title: "Run:ai Distributed Inference with SR-IOV RDMA"
description: "Deploy distributed vLLM inference on Run:ai using SR-IOV RDMA for NCCL inter-node communication. Covers extended-resource for Mellanox VFs, network annotation"
tags:
  - "runai"
  - "sriov"
  - "rdma"
  - "vllm"
  - "nccl"
category: "ai"
publishDate: "2026-05-08"
author: "Luca Berton"
difficulty: "advanced"
relatedRecipes:
  - "runai-distributed-inference-vllm-nccl"
  - "vllm-distributed-inference-debugging-nccl"
  - "openshift-sriov-rdma-infiniband-device-plugin"
  - "sriov-vf-container-mapping-lifecycle"
---

> 💡 **Quick Answer:** To use SR-IOV RDMA for distributed vLLM inference on Run:ai, add `--extended-resource "openshift.io/mellanoxnics=1"` to request a VF, `--annotation "k8s.v1.cni.cncf.io/networks=<sriov-net>"` to attach the Multus network, and `NCCL_SOCKET_IFNAME=net1` to bind NCCL to the SR-IOV interface instead of the default Pod network.

## The Problem

The previous Ethernet-only deployment works but has limited inter-node bandwidth:

- TCP over default Pod network: ~10-25 Gb/s
- SR-IOV RDMA: ~100-400 Gb/s (10-40x faster)
- For 119B model distributed inference, RDMA reduces latency on cross-node tensor operations
- Need to request VFs, attach Multus network, and bind NCCL to the right interface

## The Solution

### Run:ai Command with SR-IOV RDMA

```bash
runai inference distributed submit my-llm-rdma \
  -p my-project \
  -i registry.example.com/vllm-openai:latest \
  --existing-pvc claimname=my-project-models,path=/data \
  --workers 2 \
  -g 2 \
  --serving-port container=8000,authorization-type=authenticatedUsers \
  --environment-variable TRANSFORMERS_OFFLINE=1 \
  --environment-variable HF_HUB_OFFLINE=1 \
  --environment-variable NCCL_DEBUG=INFO \
  --environment-variable NCCL_DEBUG_SUBSYS=ALL \
  --environment-variable NCCL_SOCKET_IFNAME=net1 \
  --extended-resource "openshift.io/mellanoxnics=1" \
  --annotation "k8s.v1.cni.cncf.io/networks=gpu-rdma-network" \
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

### New Flags Explained (vs Ethernet-Only)

```text
What Changed from Ethernet to RDMA:
──────────────────────────────────────────────────────────────────

REMOVED:
  --environment-variable NCCL_IB_DISABLE=1     ← Was disabling IB
  --environment-variable NCCL_P2P_DISABLE=0    ← Default is 0 anyway

ADDED:
  --extended-resource "openshift.io/mellanoxnics=1"
    → Requests 1 SR-IOV VF per worker Pod
    → Device plugin allocates a Mellanox VF + RDMA devices
    → Each worker gets /dev/infiniband/uverbs* + rdma_cm

  --annotation "k8s.v1.cni.cncf.io/networks=gpu-rdma-network"
    → Tells Multus to attach the SR-IOV network to each Pod
    → VF moved into Pod netns as "net1" interface
    → IP assigned by IPAM (nv-ipam or whereabouts)

  --environment-variable NCCL_SOCKET_IFNAME=net1
    → Bind NCCL to the SR-IOV interface (not eth0)
    → "net1" is the default name Multus gives the first extra network
    → NCCL uses this for both bootstrap AND data transport
```

### What Run:ai Creates (Under the Hood)

```yaml
apiVersion: v1
kind: Pod
metadata:
  name: my-llm-rdma-head
  namespace: runai-my-project
  annotations:
    # Multus network attachment — SR-IOV VF
    k8s.v1.cni.cncf.io/networks: gpu-rdma-network
spec:
  securityContext:
    runAsUser: 2000
    runAsGroup: 2000
    runAsNonRoot: true
  containers:
    - name: vllm
      image: registry.example.com/vllm-openai:latest
      args:
        - --model
        - /data/input/Models/Mistral-Small-4-119B-2603
        - --served-model-name
        - mistral4
        - --tensor-parallel-size
        - "2"
        - --port
        - "8000"
      env:
        - name: TRANSFORMERS_OFFLINE
          value: "1"
        - name: HF_HUB_OFFLINE
          value: "1"
        - name: NCCL_DEBUG
          value: "INFO"
        - name: NCCL_DEBUG_SUBSYS
          value: "ALL"
        - name: NCCL_SOCKET_IFNAME
          value: "net1"              # SR-IOV interface
      resources:
        requests:
          nvidia.com/gpu: "2"
          openshift.io/mellanoxnics: "1"    # ← SR-IOV VF
        limits:
          nvidia.com/gpu: "2"
          openshift.io/mellanoxnics: "1"
      volumeMounts:
        - name: model-data
          mountPath: /data
  volumes:
    - name: model-data
      persistentVolumeClaim:
        claimName: my-project-models
```

### Network Interfaces Inside the Pod

```text
Pod Network Interfaces:
──────────────────────────────────────────────────────────────────
Interface   Type              Network              Purpose
──────────────────────────────────────────────────────────────────
eth0        veth (OVN/Calico) Default Pod network  API, management
net1        SR-IOV VF         gpu-rdma-network     NCCL RDMA traffic
lo          loopback          —                    localhost

NCCL_SOCKET_IFNAME=net1 tells NCCL:
  "Use net1 for bootstrap (TCP) and discover RDMA devices on this interface"

Without NCCL_SOCKET_IFNAME:
  NCCL picks eth0 → uses default Pod network → slow TCP, no RDMA
```

### NCCL Transport with RDMA

```text
Expected NCCL Debug Output (RDMA enabled):
──────────────────────────────────────────────────────────────────

# IB transport selected (instead of Socket):
NCCL INFO NET/IB : Using [0]mlx5_0:1/RoCE [1]mlx5_1:1/RoCE
NCCL INFO Channel 00 : 0[0] -> 1[1] via P2P/CUMEM           ← Intra-node NVLink
NCCL INFO Channel 00 : 0[0] -> 2[0] via NET/IB/0            ← Inter-node RDMA ✅

Compare with Ethernet-only:
NCCL INFO Channel 00 : 0[0] -> 2[0] via NET/Socket/0        ← Inter-node TCP ⚠️

Performance difference:
  NET/Socket (TCP):  ~10-25 Gb/s
  NET/IB (RDMA):     ~100-400 Gb/s  (10-40x faster)
```

### Progression: Ethernet → RDMA → GPU-Direct RDMA

```bash
# Stage 1: Ethernet only (initial testing)
--environment-variable NCCL_IB_DISABLE=1
# Transport: NET/Socket → ~25 Gb/s

# Stage 2: SR-IOV RDMA (this recipe)
--extended-resource "openshift.io/mellanoxnics=1"
--annotation "k8s.v1.cni.cncf.io/networks=gpu-rdma-network"
--environment-variable NCCL_SOCKET_IFNAME=net1
# Transport: NET/IB → ~200 Gb/s

# Stage 3: GPU-Direct RDMA (maximum performance)
# Same as Stage 2, plus:
--environment-variable NCCL_NET_GDR_LEVEL=5
--environment-variable NCCL_IB_HCA=mlx5_0
# Transport: NET/IB + GDR → ~380 Gb/s
# Requires: nvidia_peermem loaded, iommu=pt
```

### Multiple VFs for Multi-NIC Nodes

```bash
# For nodes with 4 NICs, request multiple VFs:
runai inference distributed submit my-llm-multi-nic \
  -p my-project \
  -i registry.example.com/vllm-openai:latest \
  --existing-pvc claimname=my-project-models,path=/data \
  --workers 2 \
  -g 8 \
  --extended-resource "openshift.io/mellanoxnics=4" \
  --annotation 'k8s.v1.cni.cncf.io/networks=gpu-rdma-network,gpu-rdma-network,gpu-rdma-network,gpu-rdma-network' \
  --environment-variable NCCL_SOCKET_IFNAME=net1 \
  --environment-variable NCCL_IB_HCA=mlx5_0,mlx5_1,mlx5_2,mlx5_3 \
  --environment-variable NCCL_NET_GDR_LEVEL=5 \
  -- \
  --model /data/input/Models/Large-405B \
  --tensor-parallel-size 8 \
  --port 8000
```

### Verify RDMA is Working

```bash
# Check VF assigned inside Pod
kubectl exec -n runai-my-project <pod> -- ip addr show net1
# Should show: inet 10.0.100.X/24 (IP from IPAM pool)

# Check RDMA devices available
kubectl exec -n runai-my-project <pod> -- ls /dev/infiniband/
# Should show: rdma_cm  uverbs0 (or uverbs<N>)

# Check NCCL selected IB transport
kubectl logs -n runai-my-project <pod> 2>&1 | grep "NET/IB"
# Should show: NCCL INFO NET/IB : Using [0]mlx5_X

# If you see NET/Socket instead of NET/IB:
# → VF not allocated (check extended-resource)
# → RDMA devices not mounted (check device plugin logs)
# → NCCL_SOCKET_IFNAME wrong (net1 vs rdma0 naming)

# Test RDMA bandwidth between workers
kubectl exec -n runai-my-project <head-pod> -- \
  ib_write_bw -d mlx5_0 --rdma_cm &
kubectl exec -n runai-my-project <worker-pod> -- \
  ib_write_bw -d mlx5_0 --rdma_cm <head-net1-ip>
```

### Troubleshooting NCCL_SOCKET_IFNAME

```bash
# What interface name does Multus assign?
kubectl exec -n runai-my-project <pod> -- ip link show
# Common names:
#   net1  — Multus default for first additional network
#   net2  — second additional network
#   rdma0 — if SriovNetwork specifies interface name

# If using custom interface name in SriovNetwork:
apiVersion: sriovnetwork.openshift.io/v1
kind: SriovNetwork
metadata:
  name: gpu-rdma-network
spec:
  networkNamespace: runai-my-project
  resourceName: gpu-rdma
  capabilities: '{"rdma": true}'
  ipam: |
    {"type": "nv-ipam", "poolName": "gpu-fabric"}

# Then in annotation, can request specific name:
# k8s.v1.cni.cncf.io/networks: '[{"name":"gpu-rdma-network","interface":"rdma0"}]'
# → Set NCCL_SOCKET_IFNAME=rdma0

# Multiple interfaces — NCCL_SOCKET_IFNAME accepts comma-separated:
NCCL_SOCKET_IFNAME=net1,net2,net3,net4
```

## Common Issues

### NCCL still uses NET/Socket despite VF allocated
- **Cause**: `NCCL_SOCKET_IFNAME` doesn't match actual interface name
- **Fix**: Check `ip link show` inside Pod; match NCCL_SOCKET_IFNAME exactly

### Pod pending — "insufficient mellanoxnics"
- **Cause**: All VFs on target nodes are allocated to other Pods
- **Fix**: Check `kubectl describe node | grep mellanoxnics`; free VFs or add nodes

### RDMA connection timeout between workers
- **Cause**: SR-IOV VFs on different subnets; or IB subnet manager not running
- **Fix**: Verify both workers get IPs in same subnet from IPAM; check opensm/UFM

### "No RDMA device found" in NCCL logs
- **Cause**: Device plugin didn't mount /dev/infiniband/ into Pod
- **Fix**: Verify `--extended-resource` is set; check device plugin logs on that node

### net1 interface has no IP
- **Cause**: IPAM plugin failed or pool exhausted
- **Fix**: Check nv-ipam/whereabouts logs; verify IPPool has free addresses

## Best Practices

1. **Start with Ethernet, upgrade to RDMA** — verify distributed setup works first
2. **Match NCCL_SOCKET_IFNAME to Multus interface** — check `ip link` inside Pod
3. **One VF per Pod minimum** — add more for multi-NIC GPU-Direct
4. **Debug with NCCL_DEBUG=INFO** — confirm NET/IB appears in transport selection
5. **Remove debug flags in production** — `NCCL_DEBUG=WARN` once verified
6. **Test RDMA bandwidth** with `ib_write_bw` before running training/inference
7. **Use nv-ipam for GPU fabric IPs** — deterministic, per-node allocation

## Key Takeaways

- Three Run:ai flags enable SR-IOV RDMA: `--extended-resource`, `--annotation`, `NCCL_SOCKET_IFNAME`
- `--extended-resource "openshift.io/mellanoxnics=1"` requests a VF from device plugin
- `--annotation "k8s.v1.cni.cncf.io/networks=..."` tells Multus to attach SR-IOV network
- `NCCL_SOCKET_IFNAME=net1` binds NCCL to the SR-IOV interface (not default eth0)
- Look for `NET/IB` in NCCL debug logs — confirms RDMA transport selected
- Progression: Ethernet (25 Gb/s) → RDMA (200 Gb/s) → GPU-Direct RDMA (380 Gb/s)
- Air-gapped: always set `TRANSFORMERS_OFFLINE=1` + `HF_HUB_OFFLINE=1`
- `NCCL_IB_DISABLE=1` removed — IB is now enabled (the whole point of adding SR-IOV)
