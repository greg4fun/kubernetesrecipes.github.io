---
title: "Fix Thanos Receive OOMKilled in Run:ai"
description: "Troubleshoot and fix Thanos Receive OOMKilled (exit code 137) with 143+ restarts in Run:ai backend on OpenShift. Covers memory tuning, TSDB retention, and replication settings."
tags:
  - "thanos"
  - "runai"
  - "oomkilled"
  - "troubleshooting"
  - "openshift"
category: "troubleshooting"
publishDate: "2026-05-05"
author: "Luca Berton"
difficulty: "intermediate"
relatedRecipes:
  - "runai-backend-architecture-openshift"
  - "runai-observability-opentelemetry-openshift"
  - "kubernetes-oomkilled-troubleshooting"
  - "openshift-gpu-node-resource-planning"
---

> 💡 **Quick Answer:** Thanos Receive in Run:ai crashes with OOMKilled (exit 137) because 512Mi memory limit is insufficient for ingesting metrics from large GPU clusters. Fix: increase memory limit to 2Gi+ or reduce TSDB retention from 183d.

## The Problem

```text
State:          Running
Last State:     Terminated
  Reason:       OOMKilled
  Exit Code:    137
  Started:      Tue, 05 May 2026 15:09:47 +0200
  Finished:     Tue, 05 May 2026 15:17:02 +0200
Ready:          False
Restart Count:  143
```

Thanos Receive is the metrics ingestion component — it accepts remote-write from OTel Collector and stores time-series data. With 143 restarts and 0/1 Ready, your metrics pipeline is broken.

## The Solution

### Identify the Issue

```bash
# Check current resource limits
oc get statefulset runai-backend-thanos-receive -n runai-backend \
  -o jsonpath='{.spec.template.spec.containers[0].resources}'

# Output:
# Limits:   cpu: 500m, memory: 512Mi
# Requests: cpu: 250m, memory: 256Mi

# 512Mi is too low for a cluster with many GPU nodes and high-cardinality metrics
```

### Thanos Receive Configuration (from Pod args)

```text
Args:
  receive
  --log.level=info
  --log.format=logfmt
  --grpc-address=0.0.0.0:10901
  --http-address=0.0.0.0:10902
  --remote-write.address=0.0.0.0:19291
  --receive.capnproto-address=0.0.0.0:19391
  --objstore.config=$(OBJSTORE_CONFIG)
  --tsdb.path=/var/thanos/receive
  --label=runai_replica="$(NAME)"
  --label=receive="true"
  --tsdb.retention=183d                          ← 6 months retention in-memory TSDB
  --receive.local-endpoint=127.0.0.1:10901
  --receive.hashrings-file=/var/lib/thanos-receive/hashrings.json
  --receive.replication-protocol=capnproto
  --receive.replication-factor=1
```

### Fix 1: Increase Memory Limits (Recommended)

```bash
# Patch the StatefulSet
oc patch statefulset runai-backend-thanos-receive -n runai-backend \
  --type='json' -p='[
    {"op": "replace", "path": "/spec/template/spec/containers/0/resources/limits/memory", "value": "2Gi"},
    {"op": "replace", "path": "/spec/template/spec/containers/0/resources/requests/memory", "value": "1Gi"}
  ]'

# Or via Helm values (persistent across upgrades):
# thanos:
#   receive:
#     resources:
#       limits:
#         cpu: "1"
#         memory: 2Gi
#       requests:
#         cpu: 250m
#         memory: 1Gi
```

### Fix 2: Reduce TSDB Retention

```bash
# 183d (6 months) retention keeps too much data in memory
# Reduce to 30d if object storage handles long-term

oc patch statefulset runai-backend-thanos-receive -n runai-backend \
  --type='json' -p='[
    {"op": "replace", "path": "/spec/template/spec/containers/0/args/12", "value": "--tsdb.retention=30d"}
  ]'
```

### Fix 3: Update via GitOps (Proper Way)

```yaml
# In your GitOps repo, update the Run:ai Helm values:
# gitops/resources/runai-backend/values.yaml

thanos:
  receive:
    retention: 30d
    resources:
      limits:
        cpu: "1"
        memory: 2Gi
      requests:
        cpu: 250m
        memory: 1Gi
    replicationFactor: 1
```

### Verify Recovery

```bash
# Wait for new Pod to start
oc get pods -n runai-backend -l app.kubernetes.io/name=thanos-receive -w

# Check it stays Running and becomes Ready
# NAME                              READY   STATUS    RESTARTS
# runai-backend-thanos-receive-0    1/1     Running   0

# Verify metrics flowing
oc exec -n runai-backend runai-backend-thanos-receive-0 -- \
  wget -qO- http://localhost:10902/metrics | grep thanos_receive_write_requests_total
```

### Why 512Mi is Too Low

```text
Memory usage factors for Thanos Receive:
─────────────────────────────────────────────────────────────
Factor                          Memory Impact
─────────────────────────────────────────────────────────────
Active time series              ~1 KB per series
TSDB head block (2h of data)    Proportional to ingestion rate
WAL (Write-Ahead Log)           Buffered before compaction
Replication buffers             capnproto serialization
Object store upload buffers     Temporary during compaction

For a cluster with:
- 8 GPU nodes × 8 GPUs = 64 GPUs
- ~50 metrics per GPU = 3,200 series
- Plus node/pod/container metrics = ~10,000 series
- Head block + WAL = ~500Mi minimum

512Mi leaves almost no headroom → OOMKilled during compaction
```

### Container Details

```text
Image:    thanos:2.24.38 (from JFrog Artifactory mirror)
Ports:    10901/TCP (gRPC), 10902/TCP (HTTP),
          19291/TCP (remote-write), 19391/TCP (capnproto)
Liveness: http-get http://:http/-/healthy delay=30s timeout=30s
Readiness: http-get http://:http/-/ready delay=30s timeout=30s
```

## Common Issues

### Pod stuck in CrashLoopBackOff after 143 restarts
- **Cause**: Kubernetes back-off timer reaches 5 minutes between restarts
- **Fix**: Apply memory fix, then delete Pod to restart immediately

### Metrics gap during OOM restarts
- **Cause**: Each OOMKill loses in-flight data not yet written to object store
- **Fix**: Increase memory; data already in object store is safe

### thanos-receive 0/1 Ready but Running
- **Cause**: Readiness probe fails during TSDB replay after restart
- **Fix**: Give it time (TSDB replay from WAL can take minutes); increase memory

## Best Practices

1. **Minimum 1Gi for small clusters, 2Gi+ for production** GPU clusters
2. **Reduce retention** if using object storage (S3/GCS) for long-term
3. **Monitor memory usage** before it OOMs: `container_memory_working_set_bytes`
4. **Update via Helm/GitOps** — direct patches get overwritten on ArgoCD sync
5. **replication-factor=1** is fine for single-instance; saves memory vs factor=3

## Key Takeaways

- Exit code 137 = OOMKilled (SIGKILL from kernel)
- 143 restarts = issue persists for hours/days without fix
- Root cause: 512Mi limit too low for GPU cluster metrics volume
- Fix: Increase to 2Gi (or reduce `--tsdb.retention` from 183d to 30d)
- Always update via GitOps/Helm values — ArgoCD will revert manual patches
- Thanos Receive uses ports 10901 (gRPC), 10902 (HTTP), 19291 (remote-write), 19391 (capnproto)
