---
title: "K8s Container Runtimes: containerd vs CRI-O"
description: "Compare Kubernetes container runtimes containerd and CRI-O. Configuration, crictl debugging, runtime class for gVisor and Kata, and migration from Docker."
publishDate: "2026-05-02"
author: "Luca Berton"
category: "configuration"
difficulty: "intermediate"
timeToComplete: "10 minutes"
kubernetesVersion: "1.28+"
tags:
  - "container-runtime"
  - "containerd"
  - "cri-o"
  - "configuration"
  - "cka"
relatedRecipes:
  - "kubernetes-kubeadm-init-guide"
  - "kubernetes-kubelet-configuration"
  - "kubernetes-security-context-guide"
---

> 💡 **Quick Answer:** Kubernetes uses CRI (Container Runtime Interface) to talk to runtimes. **containerd** (default, from Docker lineage, used by EKS/GKE/AKS) and **CRI-O** (from Red Hat, used by OpenShift) are the two main options. Debug with `crictl` (not `docker`). Use `RuntimeClass` for sandboxed workloads (gVisor, Kata Containers). Docker was removed as a runtime in K8s 1.24.

## The Problem

After Docker removal from Kubernetes 1.24:

- Which runtime should you use?
- How to debug containers without `docker` commands?
- How to configure containerd or CRI-O?
- How to run untrusted workloads in sandboxed runtimes?

## The Solution

### Runtime Comparison

```
containerd:
  - Default for most distributions (kubeadm, EKS, GKE, AKS)
  - Graduated from Docker (containerd was Docker's core)
  - Supports Docker image format natively
  - Plugin system for snapshots, content, runtime
  - Socket: /run/containerd/containerd.sock

CRI-O:
  - Purpose-built for Kubernetes (no extras)
  - Default for OpenShift, Fedora CoreOS
  - Lighter footprint (no Docker baggage)
  - Matches K8s release versions (CRI-O 1.30 for K8s 1.30)
  - Socket: /var/run/crio/crio.sock
```

### Debug with crictl

```bash
# crictl = CRI CLI (works with containerd AND CRI-O)
# Replaces: docker ps, docker logs, docker exec

# List running containers
crictl ps
# CONTAINER   IMAGE    CREATED    STATE     NAME    POD ID

# List pods
crictl pods

# Container logs
crictl logs <container-id>
crictl logs --tail 50 <container-id>

# Exec into container
crictl exec -it <container-id> sh

# Inspect container
crictl inspect <container-id>

# List images
crictl images

# Pull image
crictl pull nginx:1.27

# Container stats
crictl stats

# Pod stats
crictl statsp

# Config
cat /etc/crictl.yaml
# runtime-endpoint: unix:///run/containerd/containerd.sock
# image-endpoint: unix:///run/containerd/containerd.sock
```

### containerd Configuration

```toml
# /etc/containerd/config.toml

version = 2

[plugins."io.containerd.grpc.v1.cri"]
  sandbox_image = "registry.k8s.io/pause:3.9"

  [plugins."io.containerd.grpc.v1.cri".containerd]
    default_runtime_name = "runc"

    [plugins."io.containerd.grpc.v1.cri".containerd.runtimes.runc]
      runtime_type = "io.containerd.runc.v2"

      [plugins."io.containerd.grpc.v1.cri".containerd.runtimes.runc.options]
        SystemdCgroup = true     # Required for K8s!

  [plugins."io.containerd.grpc.v1.cri".registry]
    [plugins."io.containerd.grpc.v1.cri".registry.mirrors]
      [plugins."io.containerd.grpc.v1.cri".registry.mirrors."docker.io"]
        endpoint = ["https://mirror.gcr.io"]
```

```bash
# Apply changes
systemctl restart containerd

# Verify
containerd --version
ctr version
crictl info
```

### RuntimeClass (Sandboxed Workloads)

```yaml
# Define runtime class for gVisor
apiVersion: node.k8s.io/v1
kind: RuntimeClass
metadata:
  name: gvisor
handler: runsc               # containerd handler name

---
# Define runtime class for Kata Containers
apiVersion: node.k8s.io/v1
kind: RuntimeClass
metadata:
  name: kata
handler: kata-qemu
scheduling:
  nodeSelector:
    kata-runtime: "true"     # Only nodes with Kata installed

---
# Use RuntimeClass in pod
apiVersion: v1
kind: Pod
metadata:
  name: sandboxed-app
spec:
  runtimeClassName: gvisor   # Run in gVisor sandbox
  containers:
  - name: app
    image: nginx:1.27
```

```bash
# List runtime classes
kubectl get runtimeclass
# NAME     HANDLER     AGE
# gvisor   runsc       5d
# kata     kata-qemu   5d

# Verify pod is using correct runtime
crictl inspect <container-id> | grep runtime
```

### Runtime Security Comparison

```
runc (default):
  - Standard Linux containers (namespaces + cgroups)
  - Fast, low overhead
  - Shared kernel with host
  → Use for: trusted workloads

gVisor (runsc):
  - User-space kernel intercepts syscalls
  - Strong isolation without VM overhead
  - ~5-10% performance overhead
  → Use for: multi-tenant, untrusted code

Kata Containers:
  - Lightweight VMs (QEMU/Firecracker)
  - Strongest isolation (hardware virtualization)
  - Higher overhead (~50-100MB per pod)
  → Use for: highest security requirements

Youki:
  - Rust implementation of OCI runtime
  - Drop-in runc replacement
  - Memory-safe, potentially faster
  → Use for: security-conscious, runc-compatible
```

### Check Current Runtime

```bash
# On the node
kubectl get nodes -o wide
# CONTAINER-RUNTIME column shows: containerd://1.7.x or cri-o://1.30.x

# Detailed node info
kubectl describe node worker-1 | grep -i runtime
# Container Runtime Version:  containerd://1.7.15

# Check socket
ls -la /run/containerd/containerd.sock
ls -la /var/run/crio/crio.sock
```

## Common Issues

**"docker: command not found" after K8s upgrade**

Docker removed in K8s 1.24. Use `crictl` instead. Images still work — only the runtime interface changed.

**containerd not using systemd cgroup**

Kubelet and containerd must agree on cgroup driver. Set `SystemdCgroup = true` in containerd config. Mismatch causes pod failures.

**Private registry auth with containerd**

Configure in `/etc/containerd/config.toml` under `[plugins."io.containerd.grpc.v1.cri".registry.configs]` or use Kubernetes imagePullSecrets.

## Best Practices

- **containerd for most clusters** — widest support, well-tested
- **CRI-O for OpenShift** — purpose-built, tight K8s integration
- **Use `crictl` for debugging** — works with any CRI runtime
- **SystemdCgroup = true** — match kubelet's cgroup driver
- **RuntimeClass for untrusted workloads** — gVisor or Kata

## Key Takeaways

- Docker was removed as K8s runtime in 1.24 — Docker images still work
- containerd and CRI-O are the two production runtimes
- `crictl` is the universal CRI debugging tool (replaces `docker` commands)
- RuntimeClass enables per-pod runtime selection (runc, gVisor, Kata)
- Always set `SystemdCgroup = true` in containerd for Kubernetes
