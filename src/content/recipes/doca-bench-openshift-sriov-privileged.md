---
title: "Run DOCA Bench on OpenShift with SR-IOV and Privileged SCC"
description: "Run NVIDIA DOCA Bench as a Kubernetes Job on OpenShift with SR-IOV VF allocation, privileged SCC, and huge pages to benchmark BlueField DPU from x86 pods."
tags:
  - "openshift"
  - "networking"
  - "benchmarking"
  - "rdma"
  - "nvidia"
category: "networking"
publishDate: "2026-06-15"
author: "Luca Berton"
difficulty: "advanced"
relatedRecipes:
  - "nvidia-doca-bench-dpu-performance-kubernetes"
  - "ib-write-bw-rdma-bandwidth-kubernetes"
---

> 💡 **Quick Answer:** To run DOCA Bench on OpenShift: (1) configure SR-IOV with `isRdma: true` for Mellanox VFs, (2) create a dedicated namespace with privileged SCC granted to a service account, (3) request huge pages and the SR-IOV resource, (4) deploy a Job using the `nvcr.io/nvidia/doca/doca:2.9.0-devel` image targeting the device via `--device net1`. Always start with `--query device-capabilities` before running benchmarks.

## The Problem

- DOCA Bench requires low-level device access (RDMA verbs, huge pages, privileged)
- OpenShift SCCs block privileged containers by default
- SR-IOV VFs must be allocated with RDMA capability for BlueField/ConnectX testing
- Need a repeatable pattern for infrastructure validation before AI workload deployment
- Companion app required for remote/Ethernet benchmarks adds complexity

## The Solution

### Step 1: SR-IOV Network Node Policy

```yaml
apiVersion: sriovnetwork.openshift.io/v1
kind: SriovNetworkNodePolicy
metadata:
  name: bf-rdma
  namespace: openshift-sriov-network-operator
spec:
  resourceName: bf_rdma
  nodeSelector:
    feature.node.kubernetes.io/network-sriov.capable: "true"
  numVfs: 8
  nicSelector:
    vendor: "15b3"              # Mellanox/NVIDIA
    pfNames:
      - ens1f0np0              # Physical function name
  deviceType: netdevice         # Use netdevice for Mellanox RDMA (not vfio-pci)
  isRdma: true                  # Enable RDMA on VFs
```

> **Note**: For Mellanox on bare metal, always use `deviceType: netdevice` with `isRdma: true`. The `vfio-pci` driver type is for non-Mellanox DPDK use cases.

### Step 2: SR-IOV Network Attachment

```yaml
apiVersion: sriovnetwork.openshift.io/v1
kind: SriovNetwork
metadata:
  name: bf-rdma-net
  namespace: openshift-sriov-network-operator
spec:
  resourceName: bf_rdma
  networkNamespace: doca-bench
  ipam: '{}'                   # No IPAM — or use whereabouts/nv-ipam
```

The SR-IOV Operator automatically creates a `NetworkAttachmentDefinition` from this `SriovNetwork` CR. The `resourceName` must match the policy.

### Step 3: Namespace and Privileged SCC

```bash
# Create dedicated namespace
oc new-project doca-bench

# Create service account for benchmark pods
oc create sa doca-bench -n doca-bench

# Grant privileged SCC (required for device access, huge pages, raw network)
oc adm policy add-scc-to-user privileged \
  system:serviceaccount:doca-bench:doca-bench
```

> **Security note**: Grant privileged SCC only to the benchmark service account, not the entire namespace. Remove after validation is complete.

### Step 4: Verify Huge Pages

```bash
# Check node has huge pages allocated
oc get node gpu-worker-01 -o jsonpath='{.status.allocatable.hugepages-2Mi}{"\n"}'
# Expected: 1Gi or more

# If not available, configure via MachineConfig or tuned profile:
# kernel args: hugepagesz=2M hugepages=512
```

### Step 5: DOCA Bench Job

```yaml
apiVersion: batch/v1
kind: Job
metadata:
  name: doca-bench-sha
  namespace: doca-bench
spec:
  backoffLimit: 0
  template:
    metadata:
      annotations:
        k8s.v1.cni.cncf.io/networks: |
          [{"name": "bf-rdma-net"}]
    spec:
      restartPolicy: Never
      serviceAccountName: doca-bench
      containers:
        - name: doca-bench
          image: nvcr.io/nvidia/doca/doca:2.9.0-devel
          imagePullPolicy: IfNotPresent
          securityContext:
            privileged: true
            capabilities:
              add:
                - IPC_LOCK
                - SYS_RESOURCE
                - NET_ADMIN
                - NET_RAW
          env:
            - name: DOCA_DEVICE
              value: "net1"
          command: ["/bin/bash", "-lc"]
          args:
            - |
              set -euxo pipefail
              DOCA_BENCH=/opt/mellanox/doca/tools/doca_bench

              echo "=== Available RDMA devices ==="
              ibv_devices || true

              echo "=== Network interfaces ==="
              ip -br link

              echo "=== Query DOCA Bench capabilities ==="
              ${DOCA_BENCH} \
                --device "${DOCA_DEVICE}" \
                --query device-capabilities

              echo "=== SHA256 throughput benchmark ==="
              ${DOCA_BENCH} \
                --device "${DOCA_DEVICE}" \
                --core-list 2 \
                --threads-per-core 1 \
                --pipeline-steps doca_sha \
                --data-provider random-data \
                --uniform-job-size 2048 \
                --job-output-buffer-size 2048 \
                --run-limit-seconds 10 \
                --attribute doca_sha.algorithm=sha256 \
                --csv-output-file /tmp/doca-bench-sha.csv

              echo "=== Results ==="
              cat /tmp/doca-bench-sha.csv || true
          resources:
            requests:
              cpu: "2"
              memory: 2Gi
              hugepages-2Mi: 512Mi
              openshift.io/bf_rdma: "1"
            limits:
              cpu: "2"
              memory: 2Gi
              hugepages-2Mi: 512Mi
              openshift.io/bf_rdma: "1"
          volumeMounts:
            - name: hugepages
              mountPath: /dev/hugepages
      volumes:
        - name: hugepages
          emptyDir:
            medium: HugePages
```

### Step 6: Deploy and Check

```bash
# Apply the Job
oc apply -f doca-bench-sha-job.yaml

# Watch pod creation
oc get pods -n doca-bench -w

# Check logs
oc logs -n doca-bench job/doca-bench-sha -f

# Verify network attachment
oc exec -n doca-bench job/doca-bench-sha -- ip -br addr
# Expected: net1 with VF attached

# Verify DOCA tools exist
oc exec -n doca-bench job/doca-bench-sha -- \
  ls -l /opt/mellanox/doca/tools/doca_bench
```

### Step 7: Remote RDMA/Ethernet with Companion App

```bash
# For doca_eth, doca_rdma send/receive, you need the companion on the far side

# Pod A (companion/receiver):
/opt/mellanox/doca/tools/doca_bench_companion \
  --device net1 \
  --listen 0.0.0.0:12345

# Pod B (benchmark/sender):
/opt/mellanox/doca/tools/doca_bench \
  --device net1 \
  --core-mask 0x02 \
  --pipeline-steps doca_eth::tx \
  --data-provider random-data \
  --uniform-job-size 1500 \
  --run-limit-seconds 10 \
  --companion-connection-string proto=tcp,addr=<companion-ip>,port=12345 \
  --job-output-buffer-size 1500
```

### Smoke Test Sequence

```text
Recommended order for validating a new node:

1. Query capabilities     → --query device-capabilities
2. Local SHA benchmark    → doca_sha (no network needed)
3. Local DMA benchmark    → doca_dma (host↔DPU memory)
4. Local compress         → doca_compress (hardware offload)
5. Remote RDMA send/recv  → doca_rdma (needs companion app)
6. Remote Ethernet tx/rx  → doca_eth (needs companion app)

If step 1 fails → DOCA driver/library issue
If steps 2-4 fail → device access or huge page issue
If steps 5-6 fail → network connectivity or companion issue
```

### Tuning for Accurate Results

```bash
# Verify NUMA locality of the device
oc debug node/gpu-worker-01 -- chroot /host \
  cat /sys/class/infiniband/mlx5_0/device/numa_node
# Expected: 0 or 1 — then use cores from same NUMA zone

# Check SR-IOV resource availability
oc describe node gpu-worker-01 | grep -i 'bf_rdma\|hugepages'
# Allocatable:
#   openshift.io/bf_rdma: 8
#   hugepages-2Mi: 2Gi

# Verify secondary network is attached
oc exec -n doca-bench job/doca-bench-sha -- ip -br addr
# Expected:
#   lo       UNKNOWN  127.0.0.1/8
#   eth0@..  UP       10.128.4.15/23
#   net1@..  UP       (VF interface)
```

## Common Issues

### Pod stuck in Pending — "insufficient bf_rdma"
- **Cause**: All VFs allocated or SriovNetworkNodePolicy not applied
- **Fix**: Check `oc get sriovnetworknodestates -n openshift-sriov-network-operator`

### "Permission denied" accessing /dev/infiniband
- **Cause**: SCC not granting privileged; capabilities insufficient
- **Fix**: Verify `serviceAccountName: doca-bench` and SCC binding exists

### DOCA Bench reports "library not installed"
- **Cause**: Container image missing specific DOCA library
- **Fix**: Use full `doca:2.9.0-devel` image; run `--query` to check

### "Failed to allocate huge pages"
- **Cause**: Node has no huge pages pre-allocated
- **Fix**: Add `hugepagesz=2M hugepages=512` to kernel args via MachineConfig

### Companion app connection refused
- **Cause**: Pod network policy blocking TCP port, or companion not started
- **Fix**: Use SR-IOV network (net1) for companion connection, not pod network

## Best Practices

1. **Dedicated namespace + SA** — don't grant privileged SCC broadly
2. **`isRdma: true`** in SriovNetworkNodePolicy — mandatory for DOCA RDMA
3. **Query before benchmark** — always run `--query device-capabilities` first
4. **Huge pages pre-allocated** — DOCA performance depends on pinned memory
5. **NUMA-local CPU cores** — `--core-list` should match device NUMA zone
6. **Skip CPU 0** — OS scheduler and IRQs run there
7. **`backoffLimit: 0`** — don't retry failed benchmarks automatically
8. **Clean up SCC grants** — remove privileged SCC after validation complete

## Key Takeaways

- DOCA Bench on OpenShift needs: SR-IOV VF (isRdma), privileged SCC, huge pages
- Device targeting: `--device net1` (interface), `mlx5_0` (IB name), or `03:00.0` (PCIe)
- Smoke test path: query → SHA → DMA → compress → RDMA → Ethernet
- `nvcr.io/nvidia/doca/doca:2.9.0-devel` contains all DOCA tools
- Remote benchmarks (RDMA send, Ethernet) require companion app on peer node
- `deviceType: netdevice` + `isRdma: true` is the correct SR-IOV config for Mellanox
- Always validate infrastructure with DOCA Bench before deploying AI training workloads
