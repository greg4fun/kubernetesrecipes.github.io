---
title: "Kubernetes Ephemeral Containers: kubectl debug Guide"
description: "Debug running and distroless pods with kubectl debug ephemeral containers: --target, --copy-to for CrashLoopBackOff, node debugging, profiles and RBAC."
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
  - "crashloopbackoff-troubleshooting"
  - "kubernetes-debug-pods"
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
# - --target puts you in the app container's PID namespace (PID 1 = app)
# - Volumes are NOT mounted; reach the app filesystem via /proc/1/root

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

# Copy, swap the image (e.g. a debug build) and share processes across containers
kubectl debug my-crashing-pod -it \
  --copy-to=debug-pod \
  --share-processes \
  --set-image=app=myorg/app:1.4.2-debug \
  --container=app \
  -- sh

kubectl delete pod debug-pod   # copies are normal pods — clean up
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
# --target joins the app container's PID namespace
# (--share-processes is only valid together with --copy-to)
kubectl debug -it my-pod \
  --image=busybox:1.36 \
  --target=app

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

# Profiles add appropriate security contexts automatically:
# legacy | general | baseline | restricted | netadmin (NET_ADMIN+NET_RAW) | sysadmin (privileged)
```

### Language- and GPU-Specific Debug Images

```bash
# JVM: jcmd needs to run as the same UID as the target process
kubectl debug -it my-java-pod --image=eclipse-temurin:17-jdk --target=app -- \
  jcmd 1 Thread.print

# Trace syscalls (needs SYS_PTRACE)
kubectl debug -it my-pod --image=nicolaka/netshoot --target=app --profile=sysadmin -- strace -fp 1

# GPU state from inside the pod (the GPU is already allocated to the pod)
kubectl debug -it my-gpu-pod \
  --image=nvcr.io/nvidia/cuda:12.4.0-base-ubuntu22.04 --target=model-server -- nvidia-smi
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
- **Cause**: `--target` omitted (or the container runtime doesn't support targeting)
- **Fix**: Pass `--target=<container>`; for a copy, use `--copy-to ... --share-processes`

### Permission denied on /proc/1/root or /proc/1/environ
- **Cause**: Debug container runs as a different UID or lacks `SYS_PTRACE`
- **Fix**: Match the app UID, or use `--profile=sysadmin` (blocked under Pod Security `restricted`)

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
5. **Don't leave debug pods running** — `--copy-to` pods and `node/` debug pods must be deleted manually
6. **Pre-approve debug images** — pin versions and mirror them for air-gapped/OpenShift clusters
7. **Use profiles (1.28+)** — `netadmin` for tcpdump, `sysadmin` for full access
8. **Keep debug images small** — busybox/alpine for quick attach; netshoot for network

## Key Takeaways

- `kubectl debug -it <pod> --image=<img>` — attach debug container without restart
- Ephemeral containers share pod's network namespace (same IP, same ports)
- `--target=<container>` enables process namespace sharing (see app's /proc)
- `--copy-to` creates a pod copy — useful for CrashLoopBackOff debugging
- `kubectl debug node/<name>` — privileged pod with host filesystem at /host
- Ephemeral containers can't be removed from pod spec (but stop after exit)
- Stable since Kubernetes 1.25 — no feature gate needed

## Frequently Asked Questions

### What is an ephemeral container in Kubernetes?

A temporary container added to a running pod via the `pods/ephemeralcontainers` subresource. It has no ports, probes or resource guarantees, is never restarted, and can't be removed once added — it only disappears when the pod is deleted. GA since Kubernetes 1.25.

### How do I debug a distroless container without a shell?

Run `kubectl debug -it <pod> --image=busybox:1.36 --target=<container>`. The debug container brings its own shell and tools while sharing the pod's network and the target's PID namespace, so `/proc/1/root` exposes the app's filesystem.

### How do I debug a pod in CrashLoopBackOff?

Ephemeral containers need a running pod, so use `kubectl debug <pod> -it --copy-to=<name> --container=<app> -- sh` to create a copy whose command is replaced by a shell. See [CrashLoopBackOff troubleshooting](/recipes/troubleshooting/crashloopbackoff-troubleshooting/).

### What RBAC permission does kubectl debug need?

`patch` on `pods/ephemeralcontainers` for attaching to a pod, `create` on `pods` for `--copy-to` and `node/` debugging, plus `get` on `pods` and `create` on `pods/attach`.

### Does kubectl debug work on OpenShift?

Yes for pods (`kubectl debug` / `oc debug`), subject to SCCs — profiles like `sysadmin` need a privileged SCC. For nodes, `oc debug node/<name>` is the usual path.

