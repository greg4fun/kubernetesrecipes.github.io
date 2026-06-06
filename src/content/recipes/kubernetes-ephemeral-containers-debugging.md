---
title: "Kubernetes Ephemeral Containers for Debugging"
description: "Debug running pods with Kubernetes ephemeral containers. Attach debug containers without restarting pods, troubleshoot distroless images, inspect network"
tags:
  - "ephemeral-containers"
  - "debugging"
  - "kubectl-debug"
  - "troubleshooting"
  - "distroless"
category: "troubleshooting"
publishDate: "2026-06-01"
author: "Luca Berton"
difficulty: "intermediate"
relatedRecipes:
  - "kubernetes-troubleshooting-guide"
  - "kubernetes-init-containers-patterns-examples"
  - "kubernetes-exec-into-pod"
---

> 💡 **Quick Answer:** `kubectl debug -it <pod> --image=busybox --target=<container>` attaches an ephemeral container to a running pod for debugging. No restart needed. The debug container shares the pod's network namespace (and optionally process namespace) so you can inspect traffic, run diagnostic tools, and debug distroless/minimal images that lack shells.

## The Problem

- Production pods use distroless images — no shell, no curl, no debugging tools
- Can't install tools in running containers without rebuilding the image
- Need to inspect network traffic or filesystem of a running pod
- Restarting the pod loses the problematic state you're trying to debug
- Need to debug CrashLoopBackOff pods that exit before you can exec in

## The Solution

### Basic Pod Debugging

```bash
# Attach debug container to running pod
kubectl debug -it my-pod --image=busybox:1.36 --target=app
# --target=app shares process namespace with the 'app' container

# Debug with full networking tools
kubectl debug -it my-pod --image=nicolaka/netshoot --target=app
# netshoot includes: curl, dig, nslookup, tcpdump, iperf, ss, ip, etc.

# Debug with custom command
kubectl debug -it my-pod --image=alpine:3.19 -- sh -c "apk add curl && curl localhost:8080/health"
```

### Debug Distroless Containers

```bash
# Distroless image has no shell — use ephemeral container
kubectl debug -it my-app-pod \
  --image=busybox:1.36 \
  --target=app \
  -- sh

# Inside the debug container:
# - Same network namespace (access localhost services)
# - Can see app's processes (if shareProcessNamespace=true)
# - Access shared volumes

# Check app's open files (process namespace sharing required)
ls /proc/1/fd
cat /proc/1/environ
```

### Debug CrashLoopBackOff Pods

```bash
# Copy the pod but override the command (prevents crash)
kubectl debug my-crashing-pod -it \
  --copy-to=debug-pod \
  --container=app \
  -- sh
# Creates a copy of the pod with shell as entrypoint
# Original pod unchanged — debug copy runs interactively

# Or copy with all containers and share processes
kubectl debug my-crashing-pod -it \
  --copy-to=debug-pod \
  --share-processes \
  --container=app \
  -- sh
```

### Debug Node Issues

```bash
# Create a privileged pod on a specific node
kubectl debug node/worker-node-1 -it --image=ubuntu:22.04
# Mounts node filesystem at /host
# You can inspect: /host/var/log, /host/etc, run host commands via chroot

# Inside the debug pod:
chroot /host
journalctl -u kubelet --since "1 hour ago"
crictl ps
crictl logs <container-id>
```

### Network Debugging

```bash
# Attach netshoot to inspect network
kubectl debug -it my-pod --image=nicolaka/netshoot --target=app

# Inside:
# Check DNS resolution
nslookup kubernetes.default.svc.cluster.local

# Check connectivity to another service
curl -v http://api-server.production:8080/health

# Capture traffic
tcpdump -i eth0 -n port 8080

# Check open ports
ss -tlnp

# Test network policy (is traffic blocked?)
nc -zv database.production 5432
```

### Inspect Filesystem

```bash
# Share process namespace to access container's filesystem
kubectl debug -it my-pod \
  --image=busybox:1.36 \
  --target=app \
  --share-processes

# Inside debug container:
# Access app container's filesystem via /proc
ls /proc/1/root/app/
cat /proc/1/root/app/config.yaml

# Check mounted secrets/configmaps
ls /proc/1/root/etc/secrets/
```

### Profile-Based Debugging

```bash
# Use built-in profiles (K8s 1.28+)
kubectl debug -it my-pod --image=busybox --profile=general
kubectl debug -it my-pod --image=busybox --profile=netadmin  # NET_ADMIN cap
kubectl debug -it my-pod --image=busybox --profile=sysadmin  # privileged

# Profiles add appropriate security contexts automatically
```

### Multiple Debug Containers

```bash
# List ephemeral containers on a pod
kubectl get pod my-pod -o jsonpath='{.spec.ephemeralContainers[*].name}'

# Note: ephemeral containers can't be removed — they stay in pod spec
# (but stop running after exit)
```

## Common Issues

### "ephemeral containers are disabled"
- **Cause**: Feature gate not enabled (older clusters < 1.25)
- **Fix**: Ephemeral containers are stable since K8s 1.25; upgrade cluster

### Can't see app's processes from debug container
- **Cause**: Process namespace not shared
- **Fix**: Pod must have `shareProcessNamespace: true`; or use `--share-processes` with `--copy-to`

### Debug container can't access pod's volumes
- **Cause**: Ephemeral containers don't automatically mount existing volumes
- **Fix**: Use `--copy-to` approach to create a copy with volume access; or access via /proc/1/root

### "unable to create ephemeral container" — RBAC denied
- **Cause**: User lacks `patch` permission on pods/ephemeralcontainers
- **Fix**: Add RBAC rule: `resources: ["pods/ephemeralcontainers"], verbs: ["patch"]`

## Best Practices

1. **Use `nicolaka/netshoot` for network issues** — comprehensive networking toolkit
2. **Use `--target` to share process namespace** — see app's processes and files
3. **Use `--copy-to` for CrashLoopBackOff** — debug a copy without affecting original
4. **Node debugging via `kubectl debug node/`** — full host access when needed
5. **Don't leave debug pods running** — they consume resources; exit when done
6. **Use profiles (1.28+)** — `netadmin` for tcpdump, `sysadmin` for full access
7. **Keep debug images small** — busybox/alpine for quick attach; netshoot for network

## Key Takeaways

- `kubectl debug -it <pod> --image=<img>` — attach debug container without restart
- Ephemeral containers share pod's network namespace (same IP, same ports)
- `--target=<container>` enables process namespace sharing (see app's /proc)
- `--copy-to` creates a pod copy — useful for CrashLoopBackOff debugging
- `kubectl debug node/<name>` — privileged pod with host filesystem at /host
- Ephemeral containers can't be removed from pod spec (but stop after exit)
- Stable since Kubernetes 1.25 — no feature gate needed
