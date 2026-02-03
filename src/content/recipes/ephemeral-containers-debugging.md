---
title: "How to Use Ephemeral Containers for Debugging"
description: "Debug running pods using ephemeral containers without restarting. Learn kubectl debug techniques for troubleshooting production workloads."
category: "troubleshooting"
difficulty: "intermediate"
publishDate: "2026-01-22"
tags: ["debugging", "ephemeral", "kubectl", "troubleshooting", "containers"]
---

> 💡 **Quick Answer:** Debug running pods without restart using `kubectl debug -it <pod> --image=busybox --target=<container>`. The `--target` flag shares the process namespace so you can see and interact with processes in the target container. Use `nicolaka/netshoot` for network debugging tools.
>
> **Key command:** `kubectl debug -it mypod --image=nicolaka/netshoot --target=mycontainer -- bash`
>
> **Gotcha:** Ephemeral containers require Kubernetes 1.25+ (GA); they can't be removed once added—pod must be deleted to clean up.

# How to Use Ephemeral Containers for Debugging

Ephemeral containers allow you to debug running pods by attaching temporary containers with debugging tools. Troubleshoot issues without restarting pods or modifying deployments.

## Basic Ephemeral Container

```bash
# Add debug container to running pod
kubectl debug -it myapp-pod --image=busybox --target=myapp

# --target shares process namespace with specified container
# You can see processes from the target container
```

## Debug with Full Tools

```bash
# Use netshoot for network debugging
kubectl debug -it myapp-pod --image=nicolaka/netshoot --target=myapp

# Inside the container:
# - curl, wget for HTTP testing
# - dig, nslookup for DNS
# - tcpdump, netstat for network analysis
# - iperf for bandwidth testing
```

## Debug Distroless/Minimal Images

```bash
# Many production images have no shell
# Ephemeral container provides debugging tools

kubectl debug -it myapp-pod --image=busybox:1.28 -- sh

# Now you can:
ls /proc/1/root/    # Access target filesystem
cat /proc/1/root/app/config.yaml
```

## Copy Pod for Debugging

```bash
# Create debug copy with different image
kubectl debug myapp-pod -it --copy-to=myapp-debug \
  --container=myapp --image=myapp:debug

# Copy with all containers replaced
kubectl debug myapp-pod -it --copy-to=myapp-debug \
  --set-image=*=busybox
```

## Debug with Shared Process Namespace

```yaml
# The --target flag shares process namespace
# Allows seeing processes from target container

# Inside ephemeral container:
ps aux
# Shows processes from both containers

# Access target's filesystem via /proc
ls /proc/1/root/app/
cat /proc/1/root/etc/hosts
```

## Debug CrashLoopBackOff Pods

```bash
# Copy pod and change command to prevent crash
kubectl debug myapp-pod -it --copy-to=myapp-debug \
  --container=myapp -- sh

# Or override entrypoint
kubectl debug myapp-pod -it --copy-to=myapp-debug \
  --set-image=myapp=myapp:latest \
  --share-processes \
  -- sleep infinity
```

## Node-Level Debugging

```bash
# Debug node issues with host access
kubectl debug node/node-1 -it --image=busybox

# Inside debug pod (runs on specified node):
chroot /host  # Access node's filesystem

# Check node processes
ps aux

# View node logs
journalctl -u kubelet

# Check disk space
df -h
```

## Debug with Specific Capabilities

```bash
# Run with network debugging capabilities
kubectl debug -it myapp-pod \
  --image=nicolaka/netshoot \
  --target=myapp \
  --profile=netadmin

# Profiles available:
# - general: General debugging
# - baseline: Restricted security context
# - restricted: Highly restricted
# - netadmin: Network administration
# - sysadmin: System administration
```

## Attach to Running Container

```bash
# Attach to existing container (if it has shell)
kubectl attach -it myapp-pod -c myapp

# Execute command in running container
kubectl exec -it myapp-pod -c myapp -- sh

# If container lacks shell, use ephemeral container instead
```

## Debug with Volume Access

```bash
# Ephemeral container can access pod's volumes
kubectl debug -it myapp-pod --image=busybox --target=myapp

# Inside ephemeral container:
ls /mnt/data  # If myapp mounts a volume at /mnt/data
```

## Custom Debug Container Spec

```yaml
# Apply ephemeral container via patch
kubectl patch pod myapp-pod --subresource=ephemeralcontainers -p '{
  "spec": {
    "ephemeralContainers": [{
      "name": "debug",
      "image": "nicolaka/netshoot",
      "command": ["sleep", "infinity"],
      "stdin": true,
      "tty": true,
      "targetContainerName": "myapp",
      "securityContext": {
        "capabilities": {
          "add": ["NET_ADMIN", "SYS_PTRACE"]
        }
      }
    }]
  }
}'

# Attach to it
kubectl attach -it myapp-pod -c debug
```

## Debugging Techniques

```bash
# Network debugging
kubectl debug -it myapp-pod --image=nicolaka/netshoot -- sh

# Test DNS resolution
nslookup kubernetes.default
dig +short myservice.default.svc.cluster.local

# Test HTTP connectivity
curl -v http://backend-service:8080/health

# Capture traffic
tcpdump -i any -n port 8080

# Check network connections
netstat -tlnp
ss -tlnp
```

```bash
# Process debugging
kubectl debug -it myapp-pod --image=busybox --target=myapp -- sh

# View process tree
ps auxf

# Check open files
ls -la /proc/1/fd/

# View environment variables
cat /proc/1/environ | tr '\0' '\n'

# Check memory maps
cat /proc/1/maps
```

## Cleanup

```bash
# Ephemeral containers cannot be removed
# They remain until pod is deleted

# List ephemeral containers
kubectl get pod myapp-pod -o jsonpath='{.spec.ephemeralContainers[*].name}'

# Delete debug copy pods
kubectl delete pod myapp-debug
```

## Check Cluster Support

```bash
# Verify ephemeral containers enabled (Kubernetes 1.25+)
kubectl api-resources | grep ephemeral

# Check if feature is enabled
kubectl debug --help | grep ephemeral
```

## Summary

Ephemeral containers enable non-disruptive debugging of running pods. Use `kubectl debug` to attach containers with debugging tools, share process namespaces with distroless containers, and debug nodes directly. Essential for troubleshooting production issues without downtime.

---

## 📘 Go Further with Kubernetes Recipes

**Love this recipe? There's so much more!** This is just one of **100+ hands-on recipes** in our comprehensive **[Kubernetes Recipes book](https://amzn.to/3DzC8QA)**.

Inside the book, you'll master:
- ✅ Production-ready deployment strategies
- ✅ Advanced networking and security patterns  
- ✅ Observability, monitoring, and troubleshooting
- ✅ Real-world best practices from industry experts

> *"The practical, recipe-based approach made complex Kubernetes concepts finally click for me."*

**👉 [Get Your Copy Now](https://amzn.to/3DzC8QA)** — Start building production-grade Kubernetes skills today!
