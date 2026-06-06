---
title: "Kubernetes OOMKilled Troubleshooting and Prevention"
description: "Debug and prevent OOMKilled container terminations in Kubernetes. Understand memory limits, diagnose memory leaks, configure resource requests, and implement"
tags:
  - "oomkilled"
  - "troubleshooting"
  - "memory"
  - "resource-limits"
  - "out-of-memory"
category: "troubleshooting"
publishDate: "2026-06-01"
author: "Luca Berton"
difficulty: "beginner"
relatedRecipes:
  - "kubernetes-vpa-vertical-pod-autoscaler"
  - "kubernetes-qos-classes-guide"
---

> 💡 **Quick Answer:** `OOMKilled` (exit code 137) means the container exceeded its memory limit and the kernel OOM-killer terminated it. Fix by: 1) Increasing `resources.limits.memory`, 2) Fixing memory leaks in your application, 3) Using VPA to auto-right-size, or 4) Reducing memory footprint (heap size, cache limits). Check current usage with `kubectl top pod` before adjusting.

## The Problem

- Container keeps restarting with `OOMKilled` reason (exit code 137)
- Application works locally but OOMs in Kubernetes
- Memory limit set too low or application has a memory leak
- Node-level OOM (no container limit) kills random pods
- Java/Python applications consume more memory than expected due to runtime overhead

## The Solution

### Diagnose OOMKilled

```bash
# Check pod status
kubectl get pod <pod-name> -n <namespace>
# NAME      READY   STATUS      RESTARTS   AGE
# my-app    0/1     OOMKilled   5          10m

# Get detailed termination info
kubectl describe pod <pod-name> -n <namespace>
# Last State: Terminated
#   Reason:   OOMKilled
#   Exit Code: 137

# Check previous container's last state
kubectl get pod <pod-name> -o jsonpath='{.status.containerStatuses[0].lastState.terminated}'
# {"exitCode":137,"reason":"OOMKilled","startedAt":"...","finishedAt":"..."}

# Check current memory usage (before OOM)
kubectl top pod <pod-name> -n <namespace>
# NAME      CPU(cores)   MEMORY(bytes)
# my-app    50m          245Mi

# Check memory limit
kubectl get pod <pod-name> -o jsonpath='{.spec.containers[0].resources.limits.memory}'
# 256Mi  ← if usage is 245Mi, container is about to OOM
```

### Fix: Increase Memory Limit

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: my-app
spec:
  template:
    spec:
      containers:
        - name: app
          image: registry.example.com/app:v1
          resources:
            requests:
              memory: "256Mi"    # Scheduler guarantee
              cpu: "100m"
            limits:
              memory: "512Mi"    # Hard cap — OOMKilled if exceeded
              cpu: "500m"        # CPU is throttled, not killed
```

### Fix: Java Application Memory

```yaml
# Java apps need JVM heap + metaspace + native memory
# Rule of thumb: container limit = 1.5-2x max heap
containers:
  - name: java-app
    image: registry.example.com/java-app:v1
    env:
      - name: JAVA_OPTS
        value: "-Xms256m -Xmx384m -XX:MaxMetaspaceSize=128m"
      # Container limit should be >= Xmx + Metaspace + ~100MB overhead
    resources:
      requests:
        memory: "512Mi"
      limits:
        memory: "640Mi"    # 384 heap + 128 metaspace + 128 overhead
```

### Fix: Python Application Memory

```yaml
# Python: watch for pandas/numpy large datasets, model loading
containers:
  - name: python-app
    env:
      # Limit Python's memory allocator
      - name: PYTHONMALLOC
        value: "malloc"    # Use system malloc (more predictable)
      - name: MALLOC_TRIM_THRESHOLD_
        value: "65536"     # Release memory back to OS sooner
    resources:
      limits:
        memory: "1Gi"
```

### Use VPA for Auto-Sizing

```yaml
# Vertical Pod Autoscaler recommends correct memory limits
apiVersion: autoscaling.k8s.io/v1
kind: VerticalPodAutoscaler
metadata:
  name: my-app-vpa
spec:
  targetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: my-app
  updatePolicy:
    updateMode: "Auto"    # Auto | Off | Initial
  resourcePolicy:
    containerPolicies:
      - containerName: app
        minAllowed:
          memory: "128Mi"
        maxAllowed:
          memory: "4Gi"
```

### Monitor Memory Usage Over Time

```bash
# Prometheus query: containers near memory limit
container_memory_working_set_bytes{container!=""}
/
container_spec_memory_limit_bytes{container!=""} > 0.8

# Count OOMKilled events
increase(kube_pod_container_status_last_terminated_reason{reason="OOMKilled"}[1h])

# Memory usage trend
rate(container_memory_working_set_bytes{pod="my-app-xxx"}[5m])
```

## Common Issues

### OOMKilled immediately on start (exit code 137, 0 restarts then dies)
- **Cause**: Application startup memory exceeds limit (model loading, large init)
- **Fix**: Increase limit; or reduce startup memory (lazy loading, streaming)

### OOMKilled after running for hours
- **Cause**: Memory leak — gradual increase until limit hit
- **Fix**: Profile application memory; fix leak; or add periodic restart with `livenessProbe`

### Pod killed but no `OOMKilled` reason shown
- **Cause**: Node-level OOM — kernel killed the pod (no container limit set)
- **Fix**: Always set memory limits; check `dmesg` on node for OOM messages

### Container shows 137 exit code but reason is blank
- **Cause**: Pod was evicted by kubelet (memory pressure)
- **Fix**: Set `requests` properly so scheduler places on nodes with capacity

## Best Practices

1. **Always set memory limits** — prevents runaway containers from killing other pods
2. **Set requests = typical usage** — limits = peak usage (1.5-2x requests)
3. **Use VPA in recommendation mode** — observe before auto-adjusting
4. **Monitor memory/limit ratio** — alert when >80% consistently
5. **JVM: set `-Xmx` to 70-80% of container limit** — leave room for native memory
6. **Profile before guessing** — use `kubectl top`, Prometheus, or profilers
7. **Consider QoS class** — Guaranteed (requests=limits) pods are last to be evicted

## Key Takeaways

- `OOMKilled` = container exceeded `resources.limits.memory` (exit code 137)
- CPU limits throttle; memory limits **kill** — critical difference
- Java: container limit ≥ Xmx + Metaspace + ~100-200MB native overhead
- `kubectl top pod` shows current usage; compare against limit to predict OOM
- VPA auto-recommends correct memory limits based on actual usage history
- Node-level OOM evicts pods by QoS: BestEffort first, then Burstable, then Guaranteed
- Always set both `requests` (scheduling) and `limits` (hard cap)
