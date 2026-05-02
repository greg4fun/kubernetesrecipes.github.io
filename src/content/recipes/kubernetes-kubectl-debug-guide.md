---
title: "kubectl debug: Advanced Pod Debugging"
description: "Use kubectl debug for ephemeral containers, node debugging, and pod copy debugging. Debug distroless images, share process namespaces, and node-level access."
publishDate: "2026-05-02"
author: "Luca Berton"
category: "troubleshooting"
difficulty: "intermediate"
timeToComplete: "10 minutes"
kubernetesVersion: "1.28+"
tags:
  - "kubectl"
  - "debugging"
  - "ephemeral-containers"
  - "troubleshooting"
  - "cka"
relatedRecipes:
  - "ephemeral-containers-debugging"
  - "kubectl-exec-into-pod"
  - "kubectl-describe-pod-events"
  - "debug-pod-networking"
---

> 💡 **Quick Answer:** `kubectl debug -it my-pod --image=busybox --target=my-container` attaches an ephemeral debug container that shares the target container's process namespace. For distroless images where `exec` fails, this is the only way to debug. `kubectl debug node/worker-1 -it --image=ubuntu` creates a pod with host access for node debugging. `kubectl debug my-pod -it --copy-to=debug-pod --share-processes` creates a debuggable copy.

## The Problem

Traditional debugging fails in modern Kubernetes:

- Distroless images have no shell (`kubectl exec` fails)
- Minimal images lack debugging tools (no `curl`, `dig`, `strace`)
- Can't install packages in running containers
- Node-level debugging requires SSH access
- Can't inspect processes in other containers

## The Solution

### Ephemeral Container (Most Common)

```bash
# Attach debug container to running pod
kubectl debug -it my-pod --image=busybox:1.36 --target=my-container

# With a more complete debug image
kubectl debug -it my-pod --image=nicolaka/netshoot --target=my-container

# What --target does:
# Shares the process namespace with the target container
# You can see its processes with 'ps aux'
# You can inspect /proc/<pid>/ of the target's processes
```

```bash
# Inside the debug container:
ps aux                              # See target container's processes
cat /proc/1/environ | tr '\0' '\n' # Read env vars of PID 1
ls /proc/1/root/app/                # Access target's filesystem
netstat -tlnp                       # See network connections
strace -p 1                         # Trace target process syscalls
```

### Debug Distroless Images

```bash
# Distroless has no shell:
kubectl exec -it my-pod -- sh
# Error: OCI runtime exec failed: exec: "sh": executable file not found

# Ephemeral container to the rescue:
kubectl debug -it my-pod --image=busybox:1.36 --target=my-container
# Now you have a shell + access to the target's process namespace

# Check what's happening
ps aux                    # Target's processes visible
cat /proc/1/root/etc/hostname   # Target's filesystem
wget -qO- localhost:8080  # Target's network
```

### Copy-Based Debugging

```bash
# Create a copy of the pod with shared processes
kubectl debug my-pod -it --copy-to=debug-pod --share-processes --image=busybox

# Copy with modified command (skip the crashing entrypoint)
kubectl debug my-pod -it --copy-to=debug-pod --container=my-container -- sh

# Copy with different image (test if image change fixes the issue)
kubectl debug my-pod -it --copy-to=debug-pod \
  --set-image=my-container=myapp:debug-v2
```

### Node Debugging

```bash
# Create a privileged debug pod on a specific node
kubectl debug node/worker-1 -it --image=ubuntu

# Inside the debug pod:
chroot /host                    # Access host filesystem
systemctl status kubelet         # Check kubelet
journalctl -u kubelet --tail=50  # Kubelet logs
crictl ps                        # List containers
crictl logs <container-id>       # Container logs
ip addr show                     # Node network interfaces
ss -tlnp                         # Node listening ports

# Exit chroot and debug pod
exit  # exit chroot
exit  # exit pod

# Cleanup
kubectl delete pod node-debugger-worker-1-xxxxx
```

### Debug Profiles (K8s 1.28+)

```bash
# Baseline profile (default)
kubectl debug -it my-pod --image=busybox --profile=baseline

# Restricted profile (minimal privileges)
kubectl debug -it my-pod --image=busybox --profile=restricted

# Netadmin profile (network debugging)
kubectl debug -it my-pod --image=nicolaka/netshoot --profile=netadmin
# Adds: NET_ADMIN, NET_RAW capabilities for tcpdump, iptables

# Sysadmin profile (full node access)
kubectl debug node/worker-1 --image=ubuntu --profile=sysadmin
```

### Recommended Debug Images

| Image | Size | Tools | Use Case |
|-------|------|-------|----------|
| `busybox:1.36` | 4MB | Basic Unix tools | Quick checks |
| `nicolaka/netshoot` | 300MB | Network tools galore | Network debugging |
| `ubuntu:22.04` | 77MB | apt-get available | Install anything |
| `alpine:3.19` | 7MB | apk available | Lightweight + installable |
| `curlimages/curl` | 16MB | curl only | HTTP testing |

### Practical Examples

```bash
# Debug DNS resolution
kubectl debug -it my-pod --image=busybox --target=app -- nslookup my-service

# Debug network connectivity
kubectl debug -it my-pod --image=nicolaka/netshoot --target=app
# Inside: curl -v http://backend:8080/health
#         tcpdump -i eth0 port 8080
#         traceroute backend

# Debug filesystem
kubectl debug -it my-pod --image=busybox --target=app
# Inside: ls /proc/1/root/app/config/
#         cat /proc/1/root/app/logs/error.log

# Debug OOM
kubectl debug -it my-pod --image=busybox --target=app
# Inside: cat /proc/1/status | grep VmRSS
#         cat /sys/fs/cgroup/memory.max
```

## Common Issues

**"ephemeral containers are disabled"**

Cluster running K8s < 1.25 or feature gate disabled. Upgrade cluster or use `--copy-to` approach.

**Can't see target processes**

Missing `--target` flag. Without it, the debug container gets its own PID namespace.

**Node debug pod stays after exit**

Cleanup manually: `kubectl get pods | grep node-debugger | kubectl delete pod`.

## Best Practices

- **Use `--target`** for process namespace sharing — essential for distroless debugging
- **`nicolaka/netshoot`** for network issues — has every network tool
- **`--copy-to` for crash loops** — debug a copy without affecting the original
- **Clean up debug pods** — they persist after exit
- **Use profiles** for appropriate privilege levels

## Key Takeaways

- `kubectl debug` creates ephemeral containers for debugging running pods
- `--target` shares process namespace — see and interact with target processes
- Essential for distroless/minimal images where `exec` can't find a shell
- Node debugging with `kubectl debug node/` replaces SSH access
- `--copy-to` creates debuggable pod copies for crash loop investigation
