---
title: "K8s Volumes: emptyDir and hostPath Guide"
description: "Configure Kubernetes emptyDir and hostPath volumes for temporary storage and host filesystem access. Memory-backed tmpfs, size limits, and security considerations."
publishDate: "2026-05-02"
author: "Luca Berton"
category: "storage"
difficulty: "beginner"
timeToComplete: "8 minutes"
kubernetesVersion: "1.28+"
tags:
  - "volumes"
  - "storage"
  - "emptydir"
  - "hostpath"
  - "cka"
relatedRecipes:
  - "kubernetes-persistent-volume-guide"
  - "kubernetes-csi-driver-guide"
  - "kubernetes-sidecar-containers-guide"
---

> 💡 **Quick Answer:** `emptyDir: {}` creates a temporary directory that exists as long as the pod runs — perfect for scratch space, caches, and sharing data between containers. `emptyDir: {medium: Memory}` uses tmpfs (RAM-backed, faster). `hostPath` mounts a file or directory from the host node — use sparingly due to security risks. Both are ephemeral: data is lost when the pod is deleted.

## The Problem

Containers need temporary storage for:

- Scratch space (compilation, image processing)
- Cache directories (CDN, build cache)
- Shared data between sidecar containers
- Log files before collection
- Host-level access (node monitoring, device access)

## The Solution

### emptyDir

```yaml
apiVersion: v1
kind: Pod
metadata:
  name: scratch-pod
spec:
  containers:
  - name: app
    image: myapp:v2
    volumeMounts:
    - name: scratch
      mountPath: /tmp/work
    - name: shared-data
      mountPath: /data
  
  - name: sidecar
    image: busybox:1.36
    command: ["sh", "-c", "while true; do ls /data; sleep 10; done"]
    volumeMounts:
    - name: shared-data
      mountPath: /data     # Same volume, shared between containers
  
  volumes:
  - name: scratch
    emptyDir: {}            # Disk-backed, node's filesystem
  - name: shared-data
    emptyDir:
      sizeLimit: 1Gi       # Evicts pod if exceeded
```

### Memory-Backed emptyDir (tmpfs)

```yaml
volumes:
- name: cache
  emptyDir:
    medium: Memory          # RAM-backed tmpfs
    sizeLimit: 256Mi        # Counts against container memory limit!

# Use cases:
# - High-speed caching
# - Sensitive data (no disk persistence)
# - /tmp for applications that need fast I/O
```

### hostPath

```yaml
apiVersion: v1
kind: Pod
metadata:
  name: log-reader
spec:
  containers:
  - name: reader
    image: busybox:1.36
    command: ["sh", "-c", "tail -f /var/log/syslog"]
    volumeMounts:
    - name: host-logs
      mountPath: /var/log
      readOnly: true         # ALWAYS use readOnly for hostPath
  
  volumes:
  - name: host-logs
    hostPath:
      path: /var/log
      type: Directory        # Must exist as directory

# hostPath types:
# ""               - No checks (default)
# DirectoryOrCreate - Create directory if missing
# Directory        - Must exist as directory
# FileOrCreate     - Create file if missing
# File             - Must exist as file
# Socket           - Must exist as Unix socket
# CharDevice       - Must exist as char device
# BlockDevice      - Must exist as block device
```

### Common Patterns

```yaml
# Pattern 1: Share data between init and main container
spec:
  initContainers:
  - name: download-config
    image: curlimages/curl:8.6
    command: ["curl", "-o", "/config/app.conf", "https://config.example.com/app.conf"]
    volumeMounts:
    - name: config
      mountPath: /config
  containers:
  - name: app
    image: myapp:v2
    volumeMounts:
    - name: config
      mountPath: /etc/app
      readOnly: true
  volumes:
  - name: config
    emptyDir: {}

---
# Pattern 2: ReadOnly filesystem with writable paths
spec:
  containers:
  - name: nginx
    image: nginx:1.27
    securityContext:
      readOnlyRootFilesystem: true
    volumeMounts:
    - name: tmp
      mountPath: /tmp
    - name: run
      mountPath: /var/run
    - name: cache
      mountPath: /var/cache/nginx
  volumes:
  - name: tmp
    emptyDir: {}
  - name: run
    emptyDir: {}
  - name: cache
    emptyDir: {}
```

### emptyDir vs hostPath vs PVC

| Feature | emptyDir | hostPath | PVC |
|---------|----------|----------|-----|
| Lifetime | Pod | Node | Independent |
| Survives restart | Container restart only | Yes (node-level) | Yes |
| Shared between pods | No | Yes (same node) | Yes (RWX) |
| Data safety | None | None (node dies) | Replicated |
| Security risk | Low | High | Low |
| Use case | Temp/cache | Node access | Persistent data |

## Common Issues

**Pod evicted: "emptyDir usage exceeds sizeLimit"**

emptyDir with `sizeLimit` evicts the pod when exceeded. Increase limit or clean up data.

**Memory-backed emptyDir counts against memory limit**

tmpfs `medium: Memory` usage counts toward the container's memory limit. Set memory limits accordingly.

**hostPath not available on other nodes**

hostPath is node-local. If pod reschedules to a different node, data is gone. Use PVCs for persistent data.

## Best Practices

- **emptyDir for scratch/cache** — never for data you can't lose
- **Set sizeLimit on emptyDir** — prevent pods from filling node disk
- **tmpfs (Memory medium) for sensitive temp data** — not written to disk
- **Avoid hostPath in production** — security risk, breaks portability
- **ReadOnly hostPath** — if you must use it, mount read-only

## Key Takeaways

- emptyDir is temporary storage tied to pod lifetime — deleted when pod is removed
- `medium: Memory` creates RAM-backed tmpfs (fast, counts against memory limits)
- emptyDir is the standard way to share data between containers in a pod
- hostPath mounts host filesystem — powerful but dangerous, avoid in production
- For persistent data, always use PersistentVolumeClaims instead
