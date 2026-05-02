---
title: "kubectl exec: Run Commands in Pods"
description: "Use kubectl exec to run commands inside running pods. Interactive shell, multi-container pods, debugging techniques, and security considerations."
publishDate: "2026-05-02"
author: "Luca Berton"
category: "troubleshooting"
difficulty: "beginner"
timeToComplete: "8 minutes"
kubernetesVersion: "1.28+"
tags:
  - "kubectl"
  - "troubleshooting"
  - "debugging"
  - "cka"
  - "pods"
relatedRecipes:
  - "ephemeral-containers-debugging"
  - "kubectl-describe-pod-events"
  - "kubectl-get-pods-examples"
  - "kubernetes-kubectl-debug-guide"
---

> 💡 **Quick Answer:** `kubectl exec -it <pod> -- /bin/sh` opens an interactive shell inside a running pod. For multi-container pods, add `-c <container>`. Use `kubectl exec <pod> -- <command>` for one-off commands without interactive mode. The `--` separator is mandatory to distinguish kubectl flags from the command to run inside the container.

## The Problem

Pods are running but you need to:

- Debug network connectivity from inside the pod
- Check files, configs, or environment variables
- Run database queries or health checks
- Inspect process state or memory usage

## The Solution

### Basic exec

```bash
# Interactive shell
kubectl exec -it my-pod -- /bin/sh
kubectl exec -it my-pod -- /bin/bash
kubectl exec -it my-pod -- sh   # shorthand

# One-off command
kubectl exec my-pod -- cat /etc/resolv.conf
kubectl exec my-pod -- env
kubectl exec my-pod -- ps aux
kubectl exec my-pod -- ls -la /app

# Multi-container pod — specify container
kubectl exec -it my-pod -c sidecar -- sh

# Pod in specific namespace
kubectl exec -it my-pod -n production -- sh
```

### Common Debugging Commands

```bash
# Network troubleshooting
kubectl exec my-pod -- nslookup kubernetes.default
kubectl exec my-pod -- wget -qO- http://my-service:8080/health
kubectl exec my-pod -- curl -s http://localhost:8080/metrics
kubectl exec my-pod -- netstat -tlnp
kubectl exec my-pod -- cat /etc/hosts

# File system
kubectl exec my-pod -- df -h
kubectl exec my-pod -- du -sh /data/*
kubectl exec my-pod -- find /app -name "*.log" -size +10M

# Process inspection
kubectl exec my-pod -- top -bn1
kubectl exec my-pod -- cat /proc/1/status | grep VmRSS

# Environment
kubectl exec my-pod -- env | sort
kubectl exec my-pod -- printenv DB_HOST
```

### Copy Files In/Out

```bash
# Copy file from pod to local
kubectl cp my-pod:/app/config.yaml ./config.yaml

# Copy file to pod
kubectl cp ./patch.sql my-pod:/tmp/patch.sql

# Copy from specific container
kubectl cp my-pod:/var/log/app.log ./app.log -c app

# Tar-based copy (handles permissions better)
kubectl exec my-pod -- tar cf - /app/data | tar xf - -C ./backup/
```

### When exec Doesn't Work

```bash
# Distroless/minimal images — no shell
kubectl exec my-pod -- sh
# OCI runtime exec failed: exec failed: unable to start: container has no /bin/sh

# Solution: Use ephemeral containers (K8s 1.25+)
kubectl debug -it my-pod --image=busybox:1.36 --target=my-container

# Or debug with a copy
kubectl debug my-pod -it --copy-to=debug-pod --image=busybox:1.36 --share-processes
```

### Security: Exec Audit

```bash
# Check RBAC — who can exec into pods?
kubectl auth can-i create pods/exec --as=developer
# yes/no

# Restrict exec via RBAC
apiVersion: rbac.authorization.k8s.io/v1
kind: Role
metadata:
  name: no-exec
rules:
- apiGroups: [""]
  resources: ["pods"]
  verbs: ["get", "list"]
# Note: no "pods/exec" resource = no exec permission
```

## Common Issues

**"error: unable to upgrade connection"**

API server can't reach kubelet. Check network between API server and node, or kubelet not running.

**"command terminated with exit code 137"**

Container was OOM killed during the exec session. Increase memory limits.

**"container not found" in multi-container pod**

Specify the container: `-c <container-name>`. List containers: `kubectl get pod <pod> -o jsonpath='{.spec.containers[*].name}'`.

## Best Practices

- **Always use `--` separator** — prevents flag confusion
- **Use `-it` for interactive shells** — `-i` stdin, `-t` TTY allocation
- **Prefer ephemeral containers** over exec for production debugging
- **Audit exec usage** — enable Kubernetes audit logging for `pods/exec`
- **Don't modify running containers** — changes are lost on restart

## Key Takeaways

- `kubectl exec -it <pod> -- sh` is the go-to debugging command
- Use `-c <container>` for multi-container pods
- `kubectl cp` for file transfer, but exec with tar is more reliable
- Ephemeral containers (`kubectl debug`) work when exec doesn't (distroless images)
- Restrict `pods/exec` via RBAC for security — it's equivalent to SSH access
