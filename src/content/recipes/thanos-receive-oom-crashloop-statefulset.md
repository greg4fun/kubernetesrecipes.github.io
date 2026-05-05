---
title: "Thanos Receive OOMKilled CrashLoopBackOff"
description: "Debug and fix Thanos Receive StatefulSet OOMKilled CrashLoopBackOff caused by WAL replay exceeding memory limits. Covers ArgoCD conflict resolution, liveness probe tuning, and memory sizing."
tags:
  - "thanos"
  - "oom"
  - "crashloopbackoff"
  - "statefulset"
  - "argocd"
category: "troubleshooting"
publishDate: "2026-05-05"
author: "Luca Berton"
difficulty: "advanced"
relatedRecipes:
  - "crashloopbackoff-troubleshooting"
  - "kubernetes-oomkilled-troubleshooting"
  - "argocd-declarative-application-setup"
  - "openshift-gpu-node-resource-planning"
---

> 💡 **Quick Answer:** Thanos Receive OOMKilled during WAL (Write-Ahead Log) replay at startup needs both a liveness probe timeout increase (to survive replay) AND a memory limit increase (to hold all series in memory post-replay). When managed by ArgoCD, you must commit the fix to GitOps — manual patches get reverted.

## The Problem

Thanos Receive StatefulSet enters CrashLoopBackOff with these symptoms:

- Pod starts, begins loading WAL segments (hundreds of segments)
- Liveness probe fails during replay (default 30s timeout too short)
- OR: WAL replay completes but steady-state memory exceeds limit → OOMKilled
- ArgoCD continuously reverts manual patches back to Git state
- Multi-Attach volume errors when Pod reschedules to different node

## The Solution

### Diagnose the Root Cause

```bash
# Check Pod events
oc describe pod thanos-receive-0 -n monitoring

# Look for:
# - OOMKilled (exit code 137)
# - Liveness probe failed
# - Back-off restarting failed container
# - Multi-Attach error for volume

# Check previous container logs
oc logs thanos-receive-0 -n monitoring --previous | tail -50

# Check current memory usage (if Pod is running)
oc exec thanos-receive-0 -n monitoring -- \
  cat /sys/fs/cgroup/memory.current
```

### Identify WAL Replay Duration

```bash
# Count WAL segments
oc exec thanos-receive-0 -n monitoring -- \
  ls /var/thanos/receive/wal/ | wc -l

# Typical output: 347 segments
# Each segment ≈ 128MB → replay loads all into memory
# 347 × estimated 3KB/series × 1M series ≈ needs 2-4Gi RAM
```

### Logs During WAL Replay

```text
level=info component=receive component=multi-tsdb tenant=default-tenant
  caller=head.go:825 msg="WAL segment loaded" segment=341
level=info component=receive component=multi-tsdb tenant=default-tenant
  caller=head.go:825 msg="WAL segment loaded" segment=342
...
# Hundreds of these lines before the Pod is ready
# If liveness kills it before completion → infinite CrashLoop
```

### Fix 1: Liveness Probe Timeout (Survive Startup)

```yaml
# StatefulSet spec.template.spec.containers[0]
livenessProbe:
  httpGet:
    path: /-/healthy
    port: http
    scheme: HTTP
  initialDelaySeconds: 120    # Give 2 min before first check
  timeoutSeconds: 30          # Individual probe timeout
  periodSeconds: 10
  successThreshold: 1
  failureThreshold: 30        # 30 failures × 10s = 5 min grace
```

Or use a **startupProbe** (preferred for slow-starting containers):

```yaml
startupProbe:
  httpGet:
    path: /-/healthy
    port: http
  initialDelaySeconds: 30
  periodSeconds: 10
  failureThreshold: 60        # 60 × 10s = 10 min for WAL replay
livenessProbe:
  httpGet:
    path: /-/healthy
    port: http
  timeoutSeconds: 5
  periodSeconds: 10
  failureThreshold: 6
```

### Fix 2: Memory Limit (Survive Post-Replay)

```yaml
containers:
  - name: receive
    resources:
      limits:
        cpu: 800m
        memory: 4Gi      # ← Increase from 1Gi
      requests:
        cpu: 500m
        memory: 2Gi      # ← Increase from 1Gi
```

**Sizing formula:**
```text
Required memory ≈ 
  WAL size on disk × 2-3x (decompressed in-memory)
  + active series × 2KB per series
  + receive buffer (incoming writes)
  + Go runtime overhead (~200MB)

Example:
  WAL: 347 segments ≈ 4GB on disk
  Active series: ~500K × 2KB = 1GB
  Buffer: 500MB
  Runtime: 200MB
  Total: ~3-4Gi minimum → set limit to 4Gi
```

### Fix 3: Commit to GitOps (Permanent)

```yaml
# In your Helm values (GitOps repo):
thanos:
  receive:
    tolerations: *tolerations
    resources:
      limits:
        cpu: 800m
        memory: 4Gi
      requests:
        cpu: 500m
        memory: 2Gi
    livenessProbe:
      initialDelaySeconds: 120
      failureThreshold: 30
```

```bash
# Commit and push
git add values.yaml
git commit -m "fix: increase thanos-receive memory to 4Gi for WAL replay"
git push origin main

# ArgoCD will auto-sync (if enabled)
# Or manually sync:
argocd app sync monitoring --resource apps/StatefulSet/thanos-receive
```

### Handle ArgoCD Conflict

If ArgoCD keeps reverting your manual patches:

```bash
# Option A: Pause auto-sync temporarily
oc patch application monitoring -n argocd --type=merge \
  -p '{"spec":{"syncPolicy":{"automated":null}}}'

# Apply manual fix
oc patch sts thanos-receive -n monitoring --type=json -p='[
  {"op":"replace","path":"/spec/template/spec/containers/0/resources/limits/memory","value":"4Gi"},
  {"op":"replace","path":"/spec/template/spec/containers/0/resources/requests/memory","value":"2Gi"}
]'

# Delete Pod to pick up new spec
oc delete pod thanos-receive-0 -n monitoring

# Option B: Add ignoreDifferences (not recommended for resources)
# Option C: Commit proper fix to Git (BEST)
```

### Handle Multi-Attach Volume Error

```text
Multi-Attach error for volume "csi-vol-4651b1036..."
Volume is already exclusively attached to one node and can't be attached to another
```

```bash
# This happens when Pod reschedules to a different node
# The PVC (RWO) is still attached to the old node

# Wait for old VolumeAttachment to expire (usually 6 min)
oc get volumeattachment | grep thanos-receive

# Or force-detach (DANGEROUS - data loss risk if old Pod still writing)
oc delete volumeattachment <attachment-name>

# Better: ensure Pod stays on same node via nodeAffinity
```

## Common Issues

### WAL replay takes >10 minutes
- **Cause**: Massive WAL accumulation from long downtime
- **Fix**: Increase startupProbe failureThreshold; consider compacting WAL manually

### Memory keeps growing after replay
- **Cause**: High cardinality metrics (too many unique label combinations)
- **Fix**: Add relabeling rules to drop high-cardinality series; increase memory limit

### ArgoCD shows "OutOfSync" after manual fix
- **Cause**: Live state differs from Git
- **Fix**: Commit the fix to Git; ArgoCD will show "Synced" again

### Pod stuck in Pending after OOM
- **Cause**: New memory request exceeds node available memory
- **Fix**: Check `oc describe node`; reduce requests or move to larger node

## Best Practices

1. **Use startupProbe** for Thanos Receive — separate startup from liveness
2. **Size memory at 3-4x WAL disk size** — decompression + runtime overhead
3. **Never fight ArgoCD** — always commit the real fix to Git
4. **Monitor WAL size** — set alerts when WAL exceeds expected size
5. **Use retention flags** — `--tsdb.retention=15d` limits WAL growth
6. **Set fsGroup in securityContext** — ensures WAL files are writable (fsGroup: 1001)
7. **Pin StatefulSet to node** — avoids Multi-Attach errors on RWO volumes

## Key Takeaways

- Thanos Receive OOM has two phases: startup (WAL replay) and steady-state
- Liveness probe timeout alone doesn't fix OOM — kernel OOMKiller ignores probes
- startupProbe is the correct K8s primitive for slow-starting containers
- ArgoCD will revert manual patches within its sync interval (default 3 min)
- Memory sizing: WAL disk × 3 + active series × 2KB + 700MB overhead
- Multi-Attach errors resolve by waiting for VolumeAttachment timeout (6 min)
- The permanent fix must go in the GitOps repo — no exceptions
