---
title: "Fix OOMKilled Kubernetes Guide"
description: "Troubleshoot and fix OOMKilled errors in Kubernetes. Memory limit tuning, Java heap sizing, memory leak detection, and VPA recommendations."
publishDate: "2026-04-25"
author: "Luca Berton"
category: "troubleshooting"
difficulty: "beginner"
timeToComplete: "15 minutes"
kubernetesVersion: "1.28+"
tags:
  - "oomkilled"
  - "memory"
  - "troubleshooting"
  - "resources"
relatedRecipes:
  - "kubernetes-rbac-troubleshooting"
  - "kubernetes-pod-security-standards"
  - "kubernetes-rbac-least-privilege"
  - "kubectl-exec-into-pod"
---

> 💡 **Quick Answer:** Troubleshoot and fix OOMKilled errors in Kubernetes. Memory limit tuning, Java heap sizing, memory leak detection, and VPA recommendations.

## The Problem

OOMKilled (exit code 137) means the Linux kernel's Out-of-Memory killer terminated your container because it exceeded `resources.limits.memory` — or the node itself ran out of memory. Left undiagnosed, it looks like a random crash loop instead of the memory problem it actually is.

## The Solution

### Identify OOMKilled Pods

```bash
# Find every OOMKilled pod cluster-wide
kubectl get pods --all-namespaces -o json | jq -r '
  .items[] |
  select(.status.containerStatuses[]?.lastState.terminated.reason == "OOMKilled") |
  [.metadata.namespace, .metadata.name] | @tsv'

# Confirm on a specific pod
kubectl describe pod myapp-pod
#   Last State:     Terminated
#     Reason:       OOMKilled
#     Exit Code:    137
```

### Check Current Memory Usage

```bash
kubectl top pod myapp-pod --containers
kubectl top nodes
kubectl describe node <node-name> | grep -A5 "Allocated resources"

# Or attach a debug container (Kubernetes 1.25+) and read cgroups directly
kubectl debug myapp-pod -it --image=busybox --target=myapp
cat /sys/fs/cgroup/memory.current   # cgroups v2
cat /sys/fs/cgroup/memory.max
```

### Set Requests and Limits with Headroom

```yaml
resources:
  requests:
    memory: "256Mi"   # scheduling guarantee — set to expected average usage
  limits:
    memory: "512Mi"   # hard limit — OOMKilled if exceeded; 1.5-2x requests is a reasonable start
```

### Fix Runtime-Specific Memory Behavior

Most OOMKills in managed runtimes come from the runtime not knowing about the container's cgroup limit:

```yaml
# Java: let the JVM respect the container limit instead of the host's
env:
  - name: JAVA_OPTS
    value: >-
      -XX:+UseContainerSupport
      -XX:MaxRAMPercentage=75.0
      -XX:+HeapDumpOnOutOfMemoryError
      -XX:HeapDumpPath=/tmp/heapdump.hprof
```

```yaml
# Node.js: cap the V8 heap below the container's memory limit
env:
  - name: NODE_OPTIONS
    value: "--max-old-space-size=384"   # for a 512Mi limit
```

```yaml
# Python: enable tracemalloc to find leaks, reduce allocator fragmentation
env:
  - name: PYTHONTRACEMALLOC
    value: "1"
  - name: MALLOC_TRIM_THRESHOLD_
    value: "65536"
```

### Alert Before the Kill, Not After

```yaml
apiVersion: monitoring.coreos.com/v1
kind: PrometheusRule
metadata:
  name: memory-alerts
spec:
  groups:
    - name: memory
      rules:
        - alert: ContainerMemoryHigh
          expr: (container_memory_working_set_bytes / container_spec_memory_limit_bytes) > 0.9
          for: 5m
          labels: {severity: warning}
        - alert: ContainerOOMKilled
          expr: kube_pod_container_status_last_terminated_reason{reason="OOMKilled"} == 1
          labels: {severity: critical}
```

### Right-Size with VPA

```yaml
apiVersion: autoscaling.k8s.io/v1
kind: VerticalPodAutoscaler
metadata:
  name: myapp-vpa
spec:
  targetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: myapp
  updatePolicy:
    updateMode: "Off"   # recommend only, don't auto-apply
  resourcePolicy:
    containerPolicies:
      - containerName: myapp
        minAllowed: {memory: "128Mi"}
        maxAllowed: {memory: "4Gi"}
```

```bash
kubectl describe vpa myapp-vpa   # read the recommendation
```

### Node-Level OOM

```bash
kubectl get events --field-selector reason=OOMKilling -A
journalctl -u kubelet | grep -i oom
dmesg | grep -i "out of memory"
kubectl describe node <node> | grep -A5 Conditions
```

## Common Issues

| Cause | Fix |
|-------|-----|
| Memory leak | Profile the app (pprof/VisualVM/heapdump), fix the leak |
| Limit set too low | Increase based on `kubectl top` / VPA recommendations |
| JVM heap misconfigured | Use `-XX:MaxRAMPercentage`, not a fixed `-Xmx` guess |
| Large file processing | Stream instead of loading the whole file into memory |
| Unbounded cache | Add a size limit and LRU eviction |
| Node memory exhaustion | Add nodes, or set namespace ResourceQuotas |

## Best Practices

- Set `requests.memory` to typical usage and `limits.memory` to 1.5-2x that for burst headroom — not so high it risks node-level pressure
- Let each runtime respect the container's cgroup limit explicitly (`MaxRAMPercentage`, `--max-old-space-size`) rather than guessing
- Alert at 90% of the memory limit — an alert before the kill is actionable, an alert after is a postmortem
- Use VPA in `"Off"` mode first to get sized recommendations before enabling auto-update
- Check node-level OOM (`dmesg`, kubelet logs) when the killed process isn't your container — noisy neighbors can starve the whole node

## Key Takeaways

- OOMKilled = exit code 137 = the container exceeded `resources.limits.memory`, or the node ran out of memory
- Diagnose with `kubectl describe pod` (Last State: OOMKilled) and `kubectl top pod --containers`
- Runtime memory settings (JVM, Node.js, Python) need to match the container limit — the runtime doesn't detect it automatically
- Alert at 90% utilization to catch it before the kill, not just after
- VPA in recommendation-only mode is the fastest way to find the right limit without guessing
