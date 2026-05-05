---
title: "PScale NFS and SMB Storage Benchmarking"
description: "Benchmark NFS and SMB storage performance on Kubernetes using fio clients in Pods. Covers multi-client parallel testing, bandwidth measurement, and IOPS profiling."
tags:
  - "benchmarking"
  - "storage"
  - "nfs"
  - "performance"
  - "fio"
category: "storage"
publishDate: "2026-05-05"
author: "Luca Berton"
difficulty: "intermediate"
relatedRecipes:
  - "kubernetes-persistent-volume-guide"
  - "kubernetes-csi-driver-guide"
  - "fio-nfs-benchmark-openshift"
  - "gds-nvme-nfs-rdma"
---

> 💡 **Quick Answer:** Deploy multiple fio client Pods on OpenShift, each pointing to a specific scale-out NAS node IP, to measure aggregate NFS/SMB bandwidth. This reveals per-node throughput limits and whether the storage network is the bottleneck for AI training workloads.

## The Problem

AI training reads massive datasets from shared storage. You need to know:

- Can the storage system sustain the I/O bandwidth training requires?
- Is the bottleneck per-node (NAS head) or aggregate?
- Does SMB perform differently than NFS for your workload?
- What's the realistic throughput when N training Pods read simultaneously?

## The Solution

### Deploy Multiple fio Pods Targeting Different NAS Nodes

```yaml
apiVersion: batch/v1
kind: Job
metadata:
  name: fio-nfs-bench
  namespace: storage-bench
spec:
  completions: 4
  parallelism: 4
  completionMode: Indexed
  template:
    spec:
      containers:
        - name: fio
          image: registry.example.com/tools/fio:3.37
          command:
            - /bin/bash
            - -c
            - |
              NODE_IPS=("10.0.1.10" "10.0.1.11" "10.0.1.12" "10.0.1.13")
              TARGET_IP=${NODE_IPS[$JOB_COMPLETION_INDEX]}
              
              echo "=== fio targeting NAS node $TARGET_IP ==="
              
              # Sequential read (large files — dataset loading)
              fio --name=seq-read \
                --directory=/mnt/nfs \
                --rw=read \
                --bs=1M \
                --numjobs=4 \
                --size=10G \
                --runtime=120 \
                --time_based \
                --group_reporting \
                --output-format=json \
                --output=/results/seq-read-node-${JOB_COMPLETION_INDEX}.json
              
              # Random read (metadata, small file access)
              fio --name=rand-read \
                --directory=/mnt/nfs \
                --rw=randread \
                --bs=4K \
                --numjobs=8 \
                --size=1G \
                --runtime=60 \
                --time_based \
                --group_reporting \
                --output-format=json \
                --output=/results/rand-read-node-${JOB_COMPLETION_INDEX}.json
          env:
            - name: JOB_COMPLETION_INDEX
              valueFrom:
                fieldRef:
                  fieldPath: metadata.labels['batch.kubernetes.io/job-completion-index']
          volumeMounts:
            - name: nfs-data
              mountPath: /mnt/nfs
            - name: results
              mountPath: /results
      volumes:
        - name: nfs-data
          nfs:
            server: "${NODE_IPS[$INDEX]}"
            path: /export/datasets
        - name: results
          emptyDir: {}
      restartPolicy: Never
```

### Per-Node NFS Mount (Direct to NAS Head)

```yaml
# Mount each fio Pod directly to a specific NAS node IP
apiVersion: v1
kind: PersistentVolume
metadata:
  name: nfs-node-0
spec:
  capacity:
    storage: 10Ti
  accessModes:
    - ReadWriteMany
  nfs:
    server: 10.0.1.10     # NAS node 0
    path: /export/ai-datasets
---
apiVersion: v1
kind: PersistentVolume
metadata:
  name: nfs-node-1
spec:
  capacity:
    storage: 10Ti
  accessModes:
    - ReadWriteMany
  nfs:
    server: 10.0.1.11     # NAS node 1
    path: /export/ai-datasets
```

### fio Job Profiles for AI Workloads

```ini
# sequential-read.fio — simulates dataset loading for training
[global]
ioengine=libaio
direct=1
bs=1M
numjobs=4
runtime=120
time_based
group_reporting

[seq-read]
rw=read
size=10G
directory=/mnt/nfs

---

# mixed-rw.fio — simulates checkpoint writes during reads
[global]
ioengine=libaio
direct=1
runtime=120
time_based
group_reporting

[dataset-read]
rw=read
bs=1M
numjobs=4
size=10G
directory=/mnt/nfs/datasets

[checkpoint-write]
rw=write
bs=4M
numjobs=1
size=5G
directory=/mnt/nfs/checkpoints
```

### Aggregate Results Analysis

```bash
#!/bin/bash
# Collect results from all fio Pods
echo "=== NFS Bandwidth per NAS Node ==="
for i in 0 1 2 3; do
  BW=$(jq '.jobs[0].read.bw_bytes' results/seq-read-node-${i}.json)
  BW_MB=$((BW / 1024 / 1024))
  echo "Node $i: ${BW_MB} MB/s sequential read"
done

echo ""
echo "=== Aggregate ==="
TOTAL=$(jq -s '[.[].jobs[0].read.bw_bytes] | add' results/seq-read-node-*.json)
echo "Total: $((TOTAL / 1024 / 1024)) MB/s"
echo "Per-node average: $((TOTAL / 4 / 1024 / 1024)) MB/s"
```

### SMB Benchmark Comparison

```yaml
apiVersion: v1
kind: PersistentVolume
metadata:
  name: smb-bench
spec:
  capacity:
    storage: 10Ti
  accessModes:
    - ReadWriteMany
  csi:
    driver: smb.csi.k8s.io
    volumeHandle: smb-bench
    volumeAttributes:
      source: "//10.0.1.10/ai-datasets"
    nodeStageSecretRef:
      name: smb-creds
      namespace: storage-bench
```

### Expected Results (Scale-Out NAS)

```text
Access Pattern        Per-Node    4-Node Aggregate
──────────────────────────────────────────────────
Sequential Read 1M    2-4 GB/s    8-16 GB/s
Random Read 4K        50K IOPS    200K IOPS
Sequential Write 1M   1-2 GB/s    4-8 GB/s
Mixed 80R/20W         1.5 GB/s    6 GB/s

NFS vs SMB (same hardware):
  NFS: ~5-10% higher throughput (less protocol overhead)
  SMB: Better for Windows clients, similar for Linux
```

## Common Issues

### fio reports much lower than expected bandwidth
- **Cause**: Mount options suboptimal (small `rsize/wsize`, no `async`)
- **Fix**: Mount with `rsize=1048576,wsize=1048576,async,noatime`

### Uneven throughput across NAS nodes
- **Cause**: Data not balanced across nodes, or one node is degraded
- **Fix**: Check NAS rebalancing status; distribute fio targets evenly

## Best Practices

1. **Test per-node first** — identify slowest node before aggregating
2. **Use `direct=1`** — bypass OS page cache for realistic measurements
3. **Match real workload patterns** — sequential 1M reads for training data
4. **Run long enough** — 120s minimum to avoid cache warm-up effects
5. **Test under load** — run fio during actual training to measure contention

## Key Takeaways

- Deploy fio Pods targeting individual NAS node IPs for per-node measurement
- Sequential read with 1M block size simulates AI training dataset loading
- Scale-out NAS bandwidth scales linearly with node count (if network allows)
- Compare NFS vs SMB protocol overhead for your specific workload
- Results determine if storage is the training bottleneck vs GPU/network
