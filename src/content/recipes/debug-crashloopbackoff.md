---
title: "How to Debug CrashLoopBackOff Pods"
description: "Master troubleshooting Kubernetes pods stuck in CrashLoopBackOff. Learn systematic debugging techniques, common causes, and solutions."
category: "troubleshooting"
difficulty: "beginner"
timeToComplete: "15 minutes"
kubernetesVersion: "1.28+"
prerequisites:
  - "A running Kubernetes cluster"
  - "kubectl configured to access your cluster"
relatedRecipes:
  - "troubleshooting-pending-pvc"
  - "liveness-readiness-probes"
tags:
  - troubleshooting
  - crashloopbackoff
  - debugging
  - logs
  - pods
publishDate: "2026-01-21"
author: "Luca Berton"
---

## The Problem

Your pod is in CrashLoopBackOff state, repeatedly crashing and restarting with increasing backoff delays.

## Understanding CrashLoopBackOff

CrashLoopBackOff means:
1. The container starts
2. The container crashes or exits
3. Kubernetes restarts it
4. It crashes again
5. Kubernetes increases the wait time before the next restart

Backoff delays: 10s → 20s → 40s → ... → 5 minutes (max)

## Step 1: Check Pod Status

```bash
# Get pod status
kubectl get pods

# Output example:
# NAME    READY   STATUS             RESTARTS   AGE
# myapp   0/1     CrashLoopBackOff   5          10m
```

## Step 2: Describe the Pod

```bash
kubectl describe pod myapp
```

Look for:
- **Events**: Shows restart history and reasons
- **Last State**: Exit code and reason
- **Containers**: Image, command, and configuration

Key exit codes:
| Code | Meaning |
|------|---------|
| 0 | Graceful exit (shouldn't restart) |
| 1 | Application error |
| 137 | OOMKilled (out of memory) |
| 139 | Segmentation fault |
| 143 | SIGTERM (graceful shutdown) |

## Step 3: Check Container Logs

```bash
# Current container logs
kubectl logs myapp

# Previous container logs (before crash)
kubectl logs myapp --previous

# Follow logs
kubectl logs myapp -f

# Specific container in multi-container pod
kubectl logs myapp -c container-name
```

## Common Causes and Solutions

### 1. Application Error (Exit Code 1)

**Symptoms:**
```
Last State:     Terminated
  Exit Code:    1
```

**Solutions:**
- Check logs for error messages
- Verify environment variables
- Check configuration files
- Test the image locally:

```bash
docker run -it myapp:tag
```

### 2. OOMKilled (Exit Code 137)

**Symptoms:**
```
Last State:     Terminated
  Reason:       OOMKilled
  Exit Code:    137
```

**Solution:** Increase memory limit:

```yaml
resources:
  limits:
    memory: "512Mi"  # Increase this
```

### 3. Missing Configuration

**Symptoms:**
```
Error: ConfigMap "myapp-config" not found
```

**Solution:** Create the missing ConfigMap/Secret:

```bash
kubectl create configmap myapp-config --from-file=config.yaml
```

### 4. Image Pull Error

**Symptoms:**
```
Warning  Failed     ImagePullBackOff
```

**Solution:** Check image name and registry credentials:

```bash
# Verify image exists
docker pull myapp:tag

# Create registry secret
kubectl create secret docker-registry regcred \
  --docker-server=registry.example.com \
  --docker-username=user \
  --docker-password=password
```

### 5. Failing Health Checks

**Symptoms:**
```
Liveness probe failed: connection refused
```

**Solution:** Fix or adjust probe configuration:

```yaml
livenessProbe:
  httpGet:
    path: /health
    port: 8080
  initialDelaySeconds: 30  # Give app time to start
  periodSeconds: 10
  failureThreshold: 3
```

### 6. Permission Errors

**Symptoms:**
```
Error: permission denied
```

**Solution:** Fix security context:

```yaml
securityContext:
  runAsUser: 1000
  runAsGroup: 1000
  fsGroup: 1000
```

### 7. Wrong Command/Entrypoint

**Symptoms:**
Container exits immediately.

**Solution:** Verify the command:

```yaml
containers:
- name: myapp
  image: myapp:tag
  command: ["/bin/sh", "-c"]
  args: ["./start.sh"]  # Ensure this script exists
```

## Debug with Ephemeral Containers

For running pods (Kubernetes 1.25+):

```bash
kubectl debug myapp -it --image=busybox --target=myapp
```

## Debug by Running a Shell

Replace the command temporarily:

```yaml
containers:
- name: myapp
  image: myapp:tag
  command: ["/bin/sh"]
  args: ["-c", "sleep 3600"]  # Keep container running
```

Then exec into it:

```bash
kubectl exec -it myapp -- /bin/sh
```

## Quick Debugging Checklist

```bash
# 1. Get pod events
kubectl describe pod myapp | grep -A 20 Events

# 2. Get logs
kubectl logs myapp --previous

# 3. Check exit code
kubectl get pod myapp -o jsonpath='{.status.containerStatuses[0].lastState.terminated.exitCode}'

# 4. Check resource usage
kubectl top pod myapp

# 5. Check events in namespace
kubectl get events --sort-by=.metadata.creationTimestamp
```

## Prevention Tips

1. **Always set resource limits** to prevent OOMKills
2. **Use proper health checks** with adequate delays
3. **Test images locally** before deploying
4. **Use init containers** for dependencies
5. **Log to stdout/stderr** for easy debugging

## One-Liner Debug Commands

```bash
# Get all failing pods
kubectl get pods --field-selector=status.phase=Failed

# Get pods with restarts
kubectl get pods -o wide | awk '$5 > 0'

# Watch events
kubectl get events -w

# Get last termination reason
kubectl get pod myapp -o jsonpath='{.status.containerStatuses[0].lastState.terminated.reason}'
```

## Key Takeaways

- Check logs first with `kubectl logs --previous`
- Exit code 137 = memory issue
- Exit code 1 = application error
- Use `kubectl describe pod` for events
- Debug by overriding the command to sleep

---

## 📘 Go Further with Kubernetes Recipes

**Love this recipe? There's so much more!** This is just one of **100+ hands-on recipes** in our comprehensive **[Kubernetes Recipes book](/book)**.

Inside the book, you'll master:
- ✅ Production-ready deployment strategies
- ✅ Advanced networking and security patterns  
- ✅ Observability, monitoring, and troubleshooting
- ✅ Real-world best practices from industry experts

> *"The practical, recipe-based approach made complex Kubernetes concepts finally click for me."*

**👉 [Get Your Copy Now](/book)** — Start building production-grade Kubernetes skills today!
