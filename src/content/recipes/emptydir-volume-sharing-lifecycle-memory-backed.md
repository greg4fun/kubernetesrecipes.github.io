---
title: "emptyDir Volumes: Sharing, Lifecycle, and Memory-Backed"
description: "Master emptyDir volumes for CKA/CKAD exam prep. Share data between containers, understand volume lifecycle across restarts vs Pod deletion, and configure"
tags:
  - "emptydir"
  - "volumes"
  - "cka"
  - "ckad"
  - "storage"
category: "storage"
publishDate: "2026-05-18"
author: "Luca Berton"
difficulty: "beginner"
relatedRecipes:
  - "kubernetes-emptydir-hostpath-volumes"
  - "kubernetes-persistent-volume"
  - "pvc-storageclass-examples"
  - "kubernetes-init-containers"
---

> 💡 **Quick Answer:** `emptyDir` creates a fresh empty directory when a Pod starts. It's shared across all containers in the Pod, survives container restarts, but is **deleted permanently when the Pod is removed from the node**. Use `medium: Memory` for RAM-backed tmpfs when you need ultra-fast ephemeral storage.

## The Problem

CKA/CKAD exams test your understanding of:

- How to share files between containers in the same Pod (sidecar patterns)
- What happens to data when a container crashes vs when a Pod is deleted
- How to use memory-backed storage for performance-sensitive temp files
- Resource limits for ephemeral storage (`sizeLimit`, `ephemeral-storage` requests)

## The Solution

### Basic emptyDir: Shared Between Containers

```yaml
apiVersion: v1
kind: Pod
metadata:
  name: shared-data
spec:
  containers:
    # Writer container — generates data
    - name: writer
      image: busybox:1.36
      command: ["/bin/sh", "-c"]
      args:
        - |
          while true; do
            echo "$(date) - Log entry" >> /data/output.log
            sleep 5
          done
      volumeMounts:
        - name: shared
          mountPath: /data

    # Reader container — consumes data
    - name: reader
      image: busybox:1.36
      command: ["/bin/sh", "-c"]
      args:
        - tail -f /data/output.log
      volumeMounts:
        - name: shared
          mountPath: /data

  volumes:
    - name: shared
      emptyDir: {}            # Empty directory, shared between containers
```

```bash
# Verify sharing works
kubectl exec shared-data -c reader -- cat /data/output.log
# Shows log entries written by the writer container

# Both containers see the same files
kubectl exec shared-data -c writer -- ls /data/
kubectl exec shared-data -c reader -- ls /data/
# Same output — same volume
```

### Lifecycle: Container Restart vs Pod Deletion

```yaml
apiVersion: v1
kind: Pod
metadata:
  name: lifecycle-test
spec:
  containers:
    - name: app
      image: busybox:1.36
      command: ["/bin/sh", "-c"]
      args:
        - |
          echo "Pod started at $(date)" >> /cache/history.txt
          cat /cache/history.txt
          sleep 3600
      volumeMounts:
        - name: cache
          mountPath: /cache
  volumes:
    - name: cache
      emptyDir: {}
```

```bash
# Create the Pod
kubectl apply -f lifecycle-test.yaml

# Write some data
kubectl exec lifecycle-test -- sh -c 'echo "important data" > /cache/myfile.txt'

# Kill the container (simulates crash) — Pod restarts
kubectl exec lifecycle-test -- kill 1
# Wait for restart...
kubectl get pod lifecycle-test
# STATUS: Running (RESTARTS: 1)

# Data SURVIVES container restart ✅
kubectl exec lifecycle-test -- cat /cache/myfile.txt
# "important data" — still there!

# Now delete the Pod
kubectl delete pod lifecycle-test

# Recreate it
kubectl apply -f lifecycle-test.yaml

# Data is GONE after Pod deletion ❌
kubectl exec lifecycle-test -- cat /cache/myfile.txt
# cat: /cache/myfile.txt: No such file or directory
```

```text
emptyDir Lifecycle Rules:
──────────────────────────────────────────────────────────────────
Event                    Data Survives?    Why
──────────────────────────────────────────────────────────────────
Container crash/restart  ✅ Yes           emptyDir tied to Pod, not container
Container OOMKill        ✅ Yes           Same — Pod still exists
Pod rescheduled          ❌ No            New Pod = new emptyDir
Pod deleted              ❌ No            emptyDir deleted with Pod
Node reboot              ❌ No            Pod evicted, recreated elsewhere
kubectl rollout restart  ❌ No            Creates new Pod
```

### Memory-Backed emptyDir (tmpfs)

```yaml
apiVersion: v1
kind: Pod
metadata:
  name: memory-backed
spec:
  containers:
    - name: app
      image: busybox:1.36
      command: ["sleep", "3600"]
      volumeMounts:
        - name: fast-cache
          mountPath: /cache
      resources:
        requests:
          memory: "256Mi"
          ephemeral-storage: "100Mi"
        limits:
          memory: "512Mi"
          ephemeral-storage: "200Mi"
  volumes:
    - name: fast-cache
      emptyDir:
        medium: Memory          # RAM-backed tmpfs ⚡
        sizeLimit: 128Mi        # Max size (counts against memory limit)
```

```bash
# Verify it's tmpfs
kubectl exec memory-backed -- df -h /cache
# Filesystem      Size  Used Avail Use% Mounted on
# tmpfs           128M     0  128M   0% /cache
#   ^^^ RAM-backed, not disk

# Verify mount type
kubectl exec memory-backed -- mount | grep cache
# tmpfs on /cache type tmpfs (rw,nosuid,nodev,noexec,relatime,size=131072k)

# Performance comparison:
# Disk emptyDir:   ~500 MB/s (SSD) or ~100 MB/s (HDD)
# Memory emptyDir: ~10 GB/s (RAM speed)
```

```text
medium: Memory considerations:
──────────────────────────────────────────────────────────────────
• Data stored counts against container's MEMORY limit
• If sizeLimit exceeded → Pod evicted
• If container memory limit exceeded (including tmpfs) → OOMKill
• Data lost on Pod deletion (same as disk emptyDir)
• Use for: temp files, caches, scratch space needing speed
• Don't use for: large datasets that could OOM the container
```

### Size Limiting (Disk-Based)

```yaml
apiVersion: v1
kind: Pod
metadata:
  name: size-limited
spec:
  containers:
    - name: app
      image: busybox:1.36
      command: ["sleep", "3600"]
      volumeMounts:
        - name: bounded
          mountPath: /tmp/work
      resources:
        requests:
          ephemeral-storage: "500Mi"    # Request from node
        limits:
          ephemeral-storage: "1Gi"       # Hard limit
  volumes:
    - name: bounded
      emptyDir:
        sizeLimit: 500Mi       # Volume-level limit
```

```bash
# What happens when sizeLimit is exceeded?
kubectl exec size-limited -- dd if=/dev/zero of=/tmp/work/big bs=1M count=600
# Pod gets evicted! kubelet periodically checks usage.
# Event: "Pod ephemeral local storage usage exceeds the total limit"
```

### Common CKA/CKAD Patterns

```yaml
# Pattern 1: Init container prepares data for main container
apiVersion: v1
kind: Pod
metadata:
  name: init-data-prep
spec:
  initContainers:
    - name: download
      image: curlimages/curl:8.7.1
      command: ["curl", "-o", "/work/config.json", "https://example.com/config.json"]
      volumeMounts:
        - name: work
          mountPath: /work
  containers:
    - name: app
      image: busybox:1.36
      command: ["cat", "/app/config.json"]
      volumeMounts:
        - name: work
          mountPath: /app
  volumes:
    - name: work
      emptyDir: {}
---
# Pattern 2: Sidecar log shipper
apiVersion: v1
kind: Pod
metadata:
  name: log-sidecar
spec:
  containers:
    - name: app
      image: busybox:1.36
      command: ["/bin/sh", "-c", "while true; do echo $(date) >> /var/log/app.log; sleep 1; done"]
      volumeMounts:
        - name: logs
          mountPath: /var/log
    - name: log-shipper
      image: busybox:1.36
      command: ["/bin/sh", "-c", "tail -f /logs/app.log"]
      volumeMounts:
        - name: logs
          mountPath: /logs
  volumes:
    - name: logs
      emptyDir: {}
---
# Pattern 3: Build artifact passing in CI
apiVersion: v1
kind: Pod
metadata:
  name: ci-build
spec:
  initContainers:
    - name: build
      image: golang:1.22
      command: ["go", "build", "-o", "/output/app", "."]
      workingDir: /src
      volumeMounts:
        - name: source
          mountPath: /src
        - name: artifacts
          mountPath: /output
  containers:
    - name: test
      image: busybox:1.36
      command: ["/artifacts/app", "--self-test"]
      volumeMounts:
        - name: artifacts
          mountPath: /artifacts
  volumes:
    - name: source
      emptyDir: {}
    - name: artifacts
      emptyDir: {}
```

## Common Issues

### Pod evicted due to ephemeral storage exceeded
- **Cause**: emptyDir grew beyond `sizeLimit` or node ephemeral storage full
- **Fix**: Set `sizeLimit` on emptyDir; set `ephemeral-storage` resource limits on containers

### Memory-backed emptyDir causes OOMKill
- **Cause**: tmpfs data counts toward container memory limit
- **Fix**: Account for tmpfs size in memory limits (container limit ≥ app memory + tmpfs size)

### Data missing after container restart
- **Cause**: Application writes to container filesystem, not emptyDir mount path
- **Fix**: Verify `volumeMount.mountPath` matches where app writes; check mount is correct

## Best Practices

1. **Always set `sizeLimit`** — prevents runaway Pods from filling node disk
2. **Use `medium: Memory` for temp caches** — 20x faster than disk
3. **Account for tmpfs in memory limits** — tmpfs usage counts against memory
4. **Prefer emptyDir over hostPath** — no node coupling, cleaner lifecycle
5. **Use for inter-container communication** — init containers preparing data, sidecars reading logs
6. **Never store important data** — emptyDir is ephemeral by design

## Key Takeaways

- `emptyDir` is created fresh when Pod starts, shared across all containers
- Data **survives container restarts** but **lost on Pod deletion**
- `medium: Memory` creates tmpfs (RAM-backed, ultra-fast, counts against memory limit)
- `sizeLimit` prevents unbounded growth (Pod evicted if exceeded)
- Common patterns: init prep → main consume, app → sidecar log ship, build → test
- CKA exam: know lifecycle rules (restart = survives, delete/reschedule = gone)
- Resource accounting: disk emptyDir = ephemeral-storage; memory emptyDir = memory
