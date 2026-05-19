---
title: "Validate CSI Storage Performance with FIO Kubernetes Job"
description: "Benchmark CSI storage performance using FIO inside a Kubernetes Job. Create a PVC backed by a CSI StorageClass, run sequential/random read/write tests, interpret IOPS, throughput, and latency results for storage class comparison."
tags:
  - "fio"
  - "csi"
  - "storage"
  - "benchmarking"
  - "cka"
category: "storage"
publishDate: "2026-05-18"
author: "Luca Berton"
difficulty: "intermediate"
relatedRecipes:
  - "pvc-storageclass-examples"
  - "csi-drivers-storage"
  - "kubernetes-persistent-volume"
  - "emptydir-volume-sharing-lifecycle-memory-backed"
---

> 💡 **Quick Answer:** Create a PVC with your CSI StorageClass, then run FIO as a Kubernetes Job to benchmark IOPS, throughput, and latency. Compare results across storage classes (gp3 vs io2, standard vs premium) to choose the right backend for your workload.

## The Problem

- You deployed a CSI driver but don't know actual performance
- Storage vendor claims vs reality (advertised IOPS vs delivered)
- Need to compare storage classes before running production workloads
- CKA/CKAD: demonstrate understanding of PVC lifecycle and Jobs

## The Solution

### PVC for Benchmarking

```yaml
apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: fio-bench-pvc
  namespace: storage-test
spec:
  accessModes:
    - ReadWriteOnce
  storageClassName: fast-ssd        # Your CSI StorageClass
  resources:
    requests:
      storage: 50Gi                  # Large enough to avoid cache effects
```

### FIO Benchmark Job

```yaml
apiVersion: batch/v1
kind: Job
metadata:
  name: fio-benchmark
  namespace: storage-test
spec:
  backoffLimit: 0
  template:
    spec:
      restartPolicy: Never
      containers:
        - name: fio
          image: nixery.dev/fio
          command: ["/bin/sh", "-c"]
          args:
            - |
              echo "=== Sequential Write ==="
              fio --name=seq-write \
                --directory=/data \
                --ioengine=libaio \
                --direct=1 \
                --bs=128k \
                --size=4G \
                --numjobs=4 \
                --rw=write \
                --group_reporting \
                --runtime=60 \
                --time_based

              echo "=== Sequential Read ==="
              fio --name=seq-read \
                --directory=/data \
                --ioengine=libaio \
                --direct=1 \
                --bs=128k \
                --size=4G \
                --numjobs=4 \
                --rw=read \
                --group_reporting \
                --runtime=60 \
                --time_based

              echo "=== Random Write (4K) ==="
              fio --name=rand-write \
                --directory=/data \
                --ioengine=libaio \
                --direct=1 \
                --bs=4k \
                --size=4G \
                --numjobs=4 \
                --iodepth=32 \
                --rw=randwrite \
                --group_reporting \
                --runtime=60 \
                --time_based

              echo "=== Random Read (4K) ==="
              fio --name=rand-read \
                --directory=/data \
                --ioengine=libaio \
                --direct=1 \
                --bs=4k \
                --size=4G \
                --numjobs=4 \
                --iodepth=32 \
                --rw=randread \
                --group_reporting \
                --runtime=60 \
                --time_based

              echo "=== Mixed Random 70/30 Read/Write ==="
              fio --name=mixed-rw \
                --directory=/data \
                --ioengine=libaio \
                --direct=1 \
                --bs=4k \
                --size=4G \
                --numjobs=4 \
                --iodepth=32 \
                --rw=randrw \
                --rwmixread=70 \
                --group_reporting \
                --runtime=60 \
                --time_based
          volumeMounts:
            - name: bench-vol
              mountPath: /data
          resources:
            requests:
              cpu: "2"
              memory: "2Gi"
            limits:
              cpu: "4"
              memory: "4Gi"
      volumes:
        - name: bench-vol
          persistentVolumeClaim:
            claimName: fio-bench-pvc
```

### Read Results

```bash
# Wait for Job to complete
kubectl wait --for=condition=complete job/fio-benchmark -n storage-test --timeout=600s

# View results
kubectl logs job/fio-benchmark -n storage-test

# Key metrics to look for:
#   IOPS:   read: IOPS=45.2k    ← 4K random read IOPS
#   BW:     bw=1823MiB/s        ← sequential throughput
#   lat:    avg=2845.21usec      ← average latency (lower = better)
#   clat percentiles:
#     99.00th=[  5342]           ← P99 latency in microseconds
```

```text
Interpreting FIO Results:
──────────────────────────────────────────────────────────────────
Metric              Good (NVMe SSD)    OK (gp3)      Poor (HDD)
──────────────────────────────────────────────────────────────────
Seq Read BW         3000+ MB/s         500 MB/s      150 MB/s
Seq Write BW        2000+ MB/s         250 MB/s      100 MB/s
4K Random Read IOPS 100K+              16K           200
4K Random Write IOPS 50K+             5K            150
Avg Latency (4K)    <100 μs           <500 μs       >5 ms
P99 Latency (4K)    <500 μs           <2 ms         >20 ms
```

### Compare Storage Classes

```bash
# Run the same Job with different StorageClasses:
# 1. Change storageClassName in PVC
# 2. Record results in a table

# Example comparison:
# StorageClass    Seq Read    Rand IOPS   P99 Lat
# gp3             500 MB/s    16,000      1.2 ms
# io2             1000 MB/s   64,000      0.3 ms
# local-nvme      3200 MB/s   120,000     0.08 ms
# nfs-client      110 MB/s    800         12 ms
```

### JSON Output for Automation

```yaml
# Add --output=json for machine-parseable results
args:
  - |
    fio --name=rand-read \
      --directory=/data \
      --ioengine=libaio \
      --direct=1 \
      --bs=4k \
      --size=4G \
      --numjobs=4 \
      --iodepth=32 \
      --rw=randread \
      --runtime=60 \
      --time_based \
      --output-format=json \
      --output=/data/results.json
    
    # Extract key metrics
    cat /data/results.json | \
      jq '.jobs[0].read | {iops, bw_bytes, lat_ns: .lat_ns.mean}'
```

### Cleanup

```bash
kubectl delete job fio-benchmark -n storage-test
kubectl delete pvc fio-bench-pvc -n storage-test
```

## Common Issues

### FIO reports 0 IOPS
- **Cause**: PVC not bound (StorageClass doesn't exist or no capacity)
- **Fix**: Check `kubectl get pvc` — status should be `Bound`

### Very low IOPS compared to spec
- **Cause**: Missing `--direct=1` (OS page cache hides real performance)
- **Fix**: Always use `--direct=1` for O_DIRECT to bypass cache

### Job OOMKilled
- **Cause**: FIO `--size` larger than container memory limit with buffered I/O
- **Fix**: Use `--direct=1`; or increase memory limits

## Best Practices

1. **Use `--direct=1`** — bypass OS cache for true storage performance
2. **Test size > RAM** — prevents cache from inflating results
3. **Run 60s minimum** — short tests miss steady-state behavior
4. **`iodepth=32`** for random I/O — saturates NVMe queue depth
5. **4 numjobs** — simulates realistic concurrent access
6. **Test the workload pattern you'll actually use** — databases = random 4K; streaming = sequential 128K

## Key Takeaways

- Create PVC → run FIO Job → read logs for IOPS/BW/latency
- `--direct=1` + `--ioengine=libaio` for accurate CSI benchmarks
- Compare storage classes with identical FIO parameters
- Key metrics: IOPS (random), BW (sequential), P99 latency
- `--output-format=json` for automated comparison pipelines
- Clean up PVC after benchmarking to release storage
