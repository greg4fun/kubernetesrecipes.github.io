---
title: "Ephemeral Containers for Live Debugging"
description: "Use kubectl debug with ephemeral containers to troubleshoot running Pods without restarting them. Attach debugging tools to distroless containers, inspect"
tags:
  - "ephemeral-containers"
  - "debugging"
  - "kubectl-debug"
  - "troubleshooting"
  - "distroless"
category: "troubleshooting"
publishDate: "2026-05-06"
author: "Luca Berton"
difficulty: "intermediate"
relatedRecipes:
  - "crashloopbackoff-troubleshooting"
---

> 💡 **Quick Answer:** `kubectl debug` injects an ephemeral container into a running Pod (sharing its PID/network namespace), giving you a shell with debugging tools even in distroless/scratch containers that have no shell.

## The Problem

Modern production containers:

- Use distroless base images (no shell, no tools)
- Don't include curl, tcpdump, strace, dig
- Can't `kubectl exec` into scratch-based containers
- Restarting the Pod to add tools loses the reproduction state
- Need to inspect network, filesystem, or process state live

## The Solution

### Basic Ephemeral Debug Container

```bash
# Attach a debug container to running Pod
kubectl debug -it my-pod --image=busybox:1.36 --target=my-container

# With a full debugging toolkit
kubectl debug -it my-pod \
  --image=nicolaka/netshoot:latest \
  --target=my-container

# Share process namespace (see processes of target container)
kubectl debug -it my-pod \
  --image=busybox:1.36 \
  --target=my-container \
  --share-processes
```

### Debug Distroless Containers

```bash
# Target container is distroless (gcr.io/distroless/static)
# Can't exec into it — no shell exists

# Inject ephemeral container sharing the PID namespace
kubectl debug -it my-pod \
  --image=ubuntu:22.04 \
  --target=my-container \
  --share-processes

# Inside the debug container:
# See target container processes
ps aux

# Read target container filesystem via /proc
ls /proc/1/root/app/
cat /proc/1/root/app/config.yaml

# Trace system calls
strace -p 1

# Check open files
ls -la /proc/1/fd/
```

### Network Debugging

```bash
# Inject netshoot for network troubleshooting
kubectl debug -it my-pod \
  --image=nicolaka/netshoot:latest \
  --target=my-container

# Inside debug container (shares Pod network namespace):
# DNS resolution
dig kubernetes.default.svc.cluster.local
nslookup my-service.production.svc

# TCP connectivity
curl -v http://backend-service:8080/healthz
nc -zv database-host 5432

# Packet capture
tcpdump -i eth0 -n port 8080

# HTTP debugging
httpie GET http://localhost:8080/api/status

# Network stats
ss -tlnp
netstat -an | grep ESTABLISHED
```

### Node-Level Debugging

```bash
# Debug a node (creates a Pod with host namespaces)
kubectl debug node/worker-01 -it --image=ubuntu:22.04

# Inside the debug Pod:
chroot /host    # Access node filesystem

# Check kubelet
systemctl status kubelet
journalctl -u kubelet --since "10 minutes ago"

# Check container runtime
crictl ps
crictl logs <container-id>

# Check disk
df -h
du -sh /var/lib/containers/*
```

### Copy-Based Debugging (Pod Clone)

```bash
# Create a copy of the Pod with an added debug container
kubectl debug my-pod -it \
  --image=busybox \
  --copy-to=my-pod-debug \
  --container=debugger

# Copy with modified command (useful for CrashLoopBackOff)
kubectl debug my-pod -it \
  --copy-to=my-pod-debug \
  --container=my-container \
  --set-image=my-container=my-image:latest \
  -- sh    # Override command to shell instead of crashing binary
```

### Ephemeral Container with Specific Tools

```bash
# Java debugging (JVM profiling)
kubectl debug -it my-java-pod \
  --image=eclipse-temurin:17-jdk \
  --target=app \
  --share-processes

# Inside: attach to JVM
jcmd 1 VM.flags
jcmd 1 GC.heap_info
jcmd 1 Thread.print

# Python debugging
kubectl debug -it my-python-pod \
  --image=python:3.12-slim \
  --target=app \
  --share-processes

# GPU debugging
kubectl debug -it my-gpu-pod \
  --image=nvcr.io/nvidia/cuda:12.4.0-base-ubuntu22.04 \
  --target=model-server

# Inside: check GPU state
nvidia-smi
nvidia-smi dmon -d 1
```

### Security-Scoped Debug Profile

```bash
# Use a debug profile for elevated access
kubectl debug -it my-pod \
  --image=busybox \
  --target=my-container \
  --profile=sysadmin    # Adds SYS_PTRACE, SYS_ADMIN capabilities

# Available profiles:
# general   — default (no special privileges)
# baseline  — same as Pod Security baseline
# restricted — same as Pod Security restricted
# sysadmin  — all capabilities + host namespaces
# netadmin  — NET_ADMIN + NET_RAW (tcpdump, iptables)
```

## Common Issues

### "ephemeral containers are disabled"
- **Cause**: Kubernetes < 1.25 or feature gate disabled
- **Fix**: Upgrade to K8s 1.25+ (ephemeral containers GA)

### Can't see target container processes
- **Cause**: Missing `--share-processes` flag
- **Fix**: Add `--share-processes` to share PID namespace

### Debug container can't access network
- **Cause**: NetworkPolicy blocking new containers
- **Fix**: Ephemeral containers share Pod network; check Pod-level policies

### Permission denied on /proc/1/root
- **Cause**: Debug container lacks privileges
- **Fix**: Use `--profile=sysadmin` for elevated access

## Best Practices

1. **Use `netshoot` for network issues** — has every network tool
2. **Use `--share-processes`** always — enables /proc access
3. **Use `--profile=netadmin`** for tcpdump (avoids full sysadmin)
4. **Copy for CrashLoopBackOff** — clone Pod with shell override
5. **Don't leave debug containers** — they persist until Pod deletion
6. **Pre-approve debug images** — maintain an approved debug image list

## Key Takeaways

- `kubectl debug` injects containers into running Pods without restart
- Shares PID namespace (`--share-processes`) to see target processes
- Shares network namespace automatically (same Pod IP)
- Works with distroless/scratch containers (no shell needed in target)
- Node debugging: `kubectl debug node/` gives host filesystem access
- Copy mode clones Pods (useful for CrashLoopBackOff investigation)
- Profiles control security: general, netadmin, sysadmin
- Ephemeral containers persist until Pod is deleted (no cleanup needed)
