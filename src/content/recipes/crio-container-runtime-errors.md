---
title: "Debug CRI-O Container Runtime Errors"
description: "Troubleshoot CRI-O issues on OpenShift nodes. Fix image pull failures, container start errors, storage driver problems, and CNI networking plugin failures."
publishDate: "2026-03-19"
author: "Luca Berton"
category: "troubleshooting"
difficulty: "intermediate"
timeToComplete: "15 minutes"
kubernetesVersion: "1.28+"
tags:
  - cri-o
  - container-runtime
  - openshift
  - troubleshooting
  - pods
relatedRecipes:
  - "node-not-ready-troubleshooting"
  - "rhcos-openshift-node-management"
  - "machineconfig-registries-conf"
---
> 💡 **Quick Answer:** Check CRI-O status with `systemctl status crio` on the node (via `oc debug node/<name>`). Common fixes: restart CRI-O for transient errors, clean up storage with `crictl rmi --prune` for disk pressure, check `/etc/containers/registries.conf` for pull failures.

## The Problem

Pods fail to start on specific nodes. You see events like "Failed to pull image", "Error creating container", or "NetworkPlugin cni failed". The container runtime (CRI-O) on that node is having issues, but kubelet is running fine.

## The Solution

### Step 1: Identify CRI-O Issues

```bash
# Check pod events for runtime errors
kubectl describe pod <failing-pod>
# Events:
#   Warning  Failed     Failed to pull image "myapp:latest": rpc error: ...
#   Warning  Failed     Error response from daemon: ...

# Debug into the affected node
oc debug node/worker-2
chroot /host
```

### Step 2: Check CRI-O Status

```bash
systemctl status crio
# Look for: active (running) or failed/degraded

# Check recent CRI-O logs
journalctl -u crio --since "10 minutes ago" --no-pager | tail -30
```

### Step 3: Common CRI-O Errors and Fixes

**Image pull failure:**
```bash
# Test pulling the image directly
crictl pull registry.example.com/myapp:latest
# If auth error: check /etc/containers/registries.conf and pull secrets
# If TLS error: check /etc/pki/ca-trust/source/anchors/
```

**Storage full:**
```bash
# Check CRI-O storage usage
df -h /var/lib/containers
crictl images | wc -l

# Prune unused images
crictl rmi --prune

# Remove stopped containers
crictl rm $(crictl ps -a --state exited -q)
```

**CNI plugin error:**
```bash
# Check CNI configuration
ls /etc/cni/net.d/
cat /etc/cni/net.d/10-ovn-kubernetes.conf

# Check CNI plugin binaries
ls /opt/cni/bin/

# Restart CRI-O to reload CNI
systemctl restart crio
```

**Container stuck in Created state:**
```bash
# List all containers on the node
crictl ps -a

# Check specific container logs
crictl logs <container-id>

# Force remove stuck container
crictl rm -f <container-id>
```

### Step 4: Restart CRI-O (Last Resort)

```bash
# Restart CRI-O on the affected node
systemctl restart crio

# Wait for kubelet to reconnect
systemctl status kubelet
# Pods will be restarted by kubelet
```

## Common Issues

### CRI-O Storage Driver Corruption

```bash
# Symptoms: "layer not known" or "invalid argument" errors
# Fix: reset storage (WARNING: deletes all local containers and images)
systemctl stop crio
rm -rf /var/lib/containers/storage
systemctl start crio
# Images will be re-pulled as pods restart
```

### Registries.conf Misconfiguration

```bash
cat /etc/containers/registries.conf
# Verify mirrors and unqualified-search-registries are correct
# This file is managed by MCO — don't edit manually, use MachineConfig
```

## Best Practices

- **Monitor CRI-O with Prometheus** — `container_runtime_crio_*` metrics
- **Set up log rotation** for container logs — prevents disk pressure
- **Keep images small** — reduces pull times and storage usage
- **Use image pre-pulling** for large images on GPU nodes
- **Never manually edit files on RHCOS** — use MachineConfig instead

## Key Takeaways

- CRI-O is the container runtime on OpenShift — all container lifecycle goes through it
- Use `crictl` (not `docker`) for debugging containers on the node
- Image pull failures: check registries.conf, pull secrets, and CA certificates
- Disk full: prune images and clean stopped containers
- CNI errors: check plugin config and try restarting CRI-O
