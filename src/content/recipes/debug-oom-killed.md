---
title: "How to Debug OOMKilled Pods"
description: "Troubleshoot Kubernetes pods killed due to Out of Memory (OOM). Learn to identify memory leaks, set proper limits, and prevent OOMKilled errors."
category: "troubleshooting"
difficulty: "intermediate"
publishDate: "2026-01-22"
tags: ["oom", "memory", "troubleshooting", "debugging", "resources"]
---

# How to Debug OOMKilled Pods

OOMKilled occurs when a container exceeds its memory limit or the node runs out of memory. Learn to diagnose, fix, and prevent OOM issues in Kubernetes.

## Identifying OOMKilled Pods

```bash
# Find OOMKilled pods
kubectl get pods --all-namespaces -o json | jq -r '
  .items[] |
  select(.status.containerStatuses[]?.lastState.terminated.reason == "OOMKilled") |
  [.metadata.namespace, .metadata.name] | @tsv'

# Check specific pod status
kubectl describe pod myapp-pod

# Look for this in output:
#   Last State:     Terminated
#     Reason:       OOMKilled
#     Exit Code:    137
```

## Check Current Memory Usage

```bash
# Pod memory usage
kubectl top pod myapp-pod

# Container-level usage
kubectl top pod myapp-pod --containers

# Node memory usage
kubectl top nodes

# Detailed node memory
kubectl describe node <node-name> | grep -A5 "Allocated resources"
```

## Analyze Memory with Debug Container

```bash
# Attach debug container (Kubernetes 1.25+)
kubectl debug myapp-pod -it --image=busybox --target=myapp

# Inside debug container, check memory
cat /proc/meminfo
cat /sys/fs/cgroup/memory/memory.usage_in_bytes
cat /sys/fs/cgroup/memory/memory.limit_in_bytes

# For cgroups v2
cat /sys/fs/cgroup/memory.current
cat /sys/fs/cgroup/memory.max
```

## Check Container Memory Limits

```yaml
# deployment.yaml - Proper memory configuration
apiVersion: apps/v1
kind: Deployment
metadata:
  name: myapp
spec:
  template:
    spec:
      containers:
        - name: myapp
          image: myapp:v1
          resources:
            requests:
              memory: "256Mi"  # Scheduling guarantee
            limits:
              memory: "512Mi"  # Hard limit (OOMKilled if exceeded)
```

## Memory Debugging for Java Applications

```yaml
# java-app.yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: java-app
spec:
  template:
    spec:
      containers:
        - name: app
          image: java-app:v1
          resources:
            requests:
              memory: "1Gi"
            limits:
              memory: "2Gi"
          env:
            # Let JVM respect container limits
            - name: JAVA_OPTS
              value: >-
                -XX:+UseContainerSupport
                -XX:MaxRAMPercentage=75.0
                -XX:InitialRAMPercentage=50.0
                -XX:+HeapDumpOnOutOfMemoryError
                -XX:HeapDumpPath=/tmp/heapdump.hprof
            # Or explicit sizing
            - name: JAVA_TOOL_OPTIONS
              value: "-Xmx1536m -Xms512m"
          volumeMounts:
            - name: heap-dumps
              mountPath: /tmp
      volumes:
        - name: heap-dumps
          emptyDir:
            sizeLimit: 2Gi
```

## Memory Debugging for Node.js

```yaml
# nodejs-app.yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: nodejs-app
spec:
  template:
    spec:
      containers:
        - name: app
          image: nodejs-app:v1
          resources:
            limits:
              memory: "512Mi"
          env:
            # Set Node.js heap limit (in MB)
            - name: NODE_OPTIONS
              value: "--max-old-space-size=384"
          command:
            - node
            - --expose-gc
            - --max-old-space-size=384
            - app.js
```

## Memory Debugging for Python

```yaml
# python-app.yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: python-app
spec:
  template:
    spec:
      containers:
        - name: app
          image: python-app:v1
          resources:
            limits:
              memory: "512Mi"
          env:
            # Enable memory profiling
            - name: PYTHONTRACEMALLOC
              value: "1"
            # Reduce memory fragmentation
            - name: MALLOC_TRIM_THRESHOLD_
              value: "65536"
```

## Create Memory Monitoring

```yaml
# memory-monitoring.yaml
apiVersion: monitoring.coreos.com/v1
kind: PrometheusRule
metadata:
  name: memory-alerts
spec:
  groups:
    - name: memory
      rules:
        # Alert before OOM
        - alert: ContainerMemoryHigh
          expr: |
            (container_memory_working_set_bytes / container_spec_memory_limit_bytes) > 0.9
          for: 5m
          labels:
            severity: warning
          annotations:
            summary: "Container {{ $labels.container }} using >90% memory"
            description: "{{ $labels.pod }} is at {{ $value | humanizePercentage }} of limit"
        
        # Track OOMKilled events
        - alert: ContainerOOMKilled
          expr: |
            kube_pod_container_status_last_terminated_reason{reason="OOMKilled"} == 1
          labels:
            severity: critical
          annotations:
            summary: "Container {{ $labels.container }} was OOMKilled"
```

## Vertical Pod Autoscaler for Right-Sizing

```yaml
# vpa.yaml
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
    updateMode: "Off"  # Just recommend, don't auto-update
  resourcePolicy:
    containerPolicies:
      - containerName: myapp
        minAllowed:
          memory: "128Mi"
        maxAllowed:
          memory: "4Gi"
```

Check recommendations:

```bash
kubectl describe vpa myapp-vpa
```

## Investigate with Ephemeral Debug Container

```yaml
# debug-pod.yaml - Full debugging capabilities
apiVersion: v1
kind: Pod
metadata:
  name: memory-debug
spec:
  containers:
    - name: debug
      image: alpine:latest
      command: ["sleep", "infinity"]
      securityContext:
        capabilities:
          add: ["SYS_PTRACE"]
      resources:
        limits:
          memory: "256Mi"
```

```bash
# Run memory profiling tools
kubectl exec -it memory-debug -- sh

# Install tools
apk add --no-cache procps htop

# Monitor memory
watch -n 1 'cat /proc/meminfo | grep -E "MemTotal|MemFree|Buffers|Cached"'
```

## Node-Level OOM Investigation

```bash
# Check node events for OOM
kubectl get events --field-selector reason=OOMKilling -A

# Check kubelet logs
journalctl -u kubelet | grep -i oom

# Check kernel OOM killer logs
dmesg | grep -i "out of memory"
dmesg | grep -i "killed process"

# Check node memory pressure
kubectl describe node <node> | grep -A5 Conditions
```

## Memory Limit Best Practices

```yaml
# Recommended configuration
apiVersion: apps/v1
kind: Deployment
metadata:
  name: myapp
spec:
  template:
    spec:
      containers:
        - name: myapp
          resources:
            requests:
              # Set to expected average usage
              memory: "256Mi"
            limits:
              # Set 1.5-2x requests for burst headroom
              # But not too high to prevent node-level OOM
              memory: "512Mi"
```

## Quick Fixes

```bash
# Increase memory limit temporarily
kubectl set resources deployment myapp \
  --limits=memory=1Gi --requests=memory=512Mi

# Scale down to reduce node pressure
kubectl scale deployment myapp --replicas=2

# Restart pod to clear memory
kubectl rollout restart deployment myapp
```

## Common Causes and Solutions

| Cause | Solution |
|-------|----------|
| Memory leak | Profile app, fix leak, implement GC |
| Limit too low | Increase limit based on profiling |
| JVM heap misconfigured | Use `-XX:MaxRAMPercentage` |
| Large file processing | Stream instead of loading fully |
| Unbounded caches | Add size limits, use LRU eviction |
| Node memory exhaustion | Add nodes, use resource quotas |

## Summary

OOMKilled errors indicate memory limit violations. Debug by checking container and node memory usage, analyze application memory patterns, set appropriate limits with headroom, and use VPA for recommendations. For production, implement memory alerting to catch issues before they cause OOMKilled events.
