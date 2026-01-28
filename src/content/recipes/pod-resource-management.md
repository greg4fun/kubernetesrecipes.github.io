---
title: "How to Configure Pod Resource Management"
description: "Set CPU and memory requests and limits effectively. Understand QoS classes, resource quotas, and optimize container resource allocation."
category: "configuration"
difficulty: "beginner"
publishDate: "2026-01-22"
tags: ["resources", "cpu", "memory", "limits", "requests", "qos"]
---

# How to Configure Pod Resource Management

Resource requests and limits control how Kubernetes schedules and constrains containers. Proper configuration ensures stability, fair resource sharing, and cost optimization.

## Resource Requests and Limits

```yaml
# resource-pod.yaml
apiVersion: v1
kind: Pod
metadata:
  name: web-app
spec:
  containers:
    - name: app
      image: myapp:v1
      resources:
        requests:
          cpu: "250m"      # 0.25 CPU cores
          memory: "256Mi"  # 256 mebibytes
        limits:
          cpu: "1"         # 1 CPU core
          memory: "512Mi"  # 512 mebibytes
```

## Resource Units

```yaml
# CPU units
cpu: "100m"    # 100 millicores (0.1 CPU)
cpu: "0.5"     # 500 millicores (0.5 CPU)
cpu: "1"       # 1 CPU core
cpu: "2"       # 2 CPU cores

# Memory units
memory: "128Mi"   # 128 mebibytes (MiB)
memory: "1Gi"     # 1 gibibyte (GiB)
memory: "256M"    # 256 megabytes (MB) - decimal
memory: "1G"      # 1 gigabyte (GB) - decimal

# Use binary units (Mi, Gi) for memory - matches how Linux reports
```

## Requests vs Limits

```yaml
# Requests: Guaranteed minimum resources
# - Used for scheduling decisions
# - Pod won't be scheduled if node lacks requested resources
# - Container gets at least this much

# Limits: Maximum allowed resources
# - CPU: Throttled when exceeding limit
# - Memory: OOMKilled when exceeding limit

resources:
  requests:
    cpu: "250m"      # Scheduler ensures this is available
    memory: "256Mi"  # Minimum guaranteed memory
  limits:
    cpu: "1"         # Container throttled above this
    memory: "512Mi"  # Container killed if exceeds this
```

## QoS Classes

```yaml
# Kubernetes assigns QoS class based on resource configuration

# 1. Guaranteed - Highest priority
# Requests = Limits for all containers
apiVersion: v1
kind: Pod
metadata:
  name: guaranteed-pod
spec:
  containers:
    - name: app
      resources:
        requests:
          cpu: "500m"
          memory: "256Mi"
        limits:
          cpu: "500m"      # Same as request
          memory: "256Mi"  # Same as request
---
# 2. Burstable - Medium priority
# Requests < Limits, or only requests set
apiVersion: v1
kind: Pod
metadata:
  name: burstable-pod
spec:
  containers:
    - name: app
      resources:
        requests:
          cpu: "250m"
          memory: "128Mi"
        limits:
          cpu: "1"         # Higher than request
          memory: "512Mi"  # Higher than request
---
# 3. BestEffort - Lowest priority (evicted first)
# No requests or limits set
apiVersion: v1
kind: Pod
metadata:
  name: besteffort-pod
spec:
  containers:
    - name: app
      image: myapp:v1
      # No resources specified
```

```bash
# Check pod QoS class
kubectl get pod <pod> -o jsonpath='{.status.qosClass}'
```

## Deployment with Resources

```yaml
# deployment-resources.yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: web-app
spec:
  replicas: 3
  selector:
    matchLabels:
      app: web-app
  template:
    metadata:
      labels:
        app: web-app
    spec:
      containers:
        - name: app
          image: nginx:alpine
          ports:
            - containerPort: 80
          resources:
            requests:
              cpu: "100m"
              memory: "128Mi"
            limits:
              cpu: "500m"
              memory: "256Mi"
```

## Multi-Container Resources

```yaml
# multi-container-resources.yaml
apiVersion: v1
kind: Pod
metadata:
  name: multi-container
spec:
  containers:
    - name: app
      image: myapp:v1
      resources:
        requests:
          cpu: "500m"
          memory: "512Mi"
        limits:
          cpu: "1"
          memory: "1Gi"
    - name: sidecar
      image: fluentd:v1
      resources:
        requests:
          cpu: "100m"
          memory: "128Mi"
        limits:
          cpu: "200m"
          memory: "256Mi"
  # Total pod requests: 600m CPU, 640Mi memory
  # Total pod limits: 1.2 CPU, 1.25Gi memory
```

## Init Container Resources

```yaml
# init-container-resources.yaml
apiVersion: v1
kind: Pod
metadata:
  name: with-init
spec:
  initContainers:
    - name: init-db
      image: busybox
      command: ["sh", "-c", "until nc -z db 5432; do sleep 1; done"]
      resources:
        requests:
          cpu: "50m"
          memory: "64Mi"
        limits:
          cpu: "100m"
          memory: "128Mi"
  containers:
    - name: app
      image: myapp:v1
      resources:
        requests:
          cpu: "250m"
          memory: "256Mi"
        limits:
          cpu: "500m"
          memory: "512Mi"
  # Effective requests: max(init, sum(containers))
  # = max(50m, 250m) CPU = 250m
```

## View Resource Usage

```bash
# Node resource usage
kubectl top nodes

# Pod resource usage
kubectl top pods
kubectl top pods -n production --sort-by=memory

# Container-level usage
kubectl top pods --containers

# Describe node for allocatable resources
kubectl describe node <node> | grep -A 10 "Allocatable"

# Check pod resource configuration
kubectl get pod <pod> -o jsonpath='{.spec.containers[*].resources}'
```

## LimitRange (Namespace Defaults)

```yaml
# limitrange.yaml
apiVersion: v1
kind: LimitRange
metadata:
  name: default-limits
  namespace: development
spec:
  limits:
    - type: Container
      default:          # Default limits if not specified
        cpu: "500m"
        memory: "256Mi"
      defaultRequest:   # Default requests if not specified
        cpu: "100m"
        memory: "128Mi"
      min:              # Minimum allowed
        cpu: "50m"
        memory: "64Mi"
      max:              # Maximum allowed
        cpu: "2"
        memory: "2Gi"
    - type: Pod
      max:
        cpu: "4"
        memory: "8Gi"
```

## ResourceQuota (Namespace Limits)

```yaml
# resourcequota.yaml
apiVersion: v1
kind: ResourceQuota
metadata:
  name: compute-quota
  namespace: development
spec:
  hard:
    requests.cpu: "10"
    requests.memory: "20Gi"
    limits.cpu: "20"
    limits.memory: "40Gi"
    pods: "50"
    persistentvolumeclaims: "10"
    services: "20"
```

```bash
# Check quota usage
kubectl get resourcequota -n development
kubectl describe resourcequota compute-quota -n development
```

## Rightsizing Resources

```bash
# Check current usage vs requests
kubectl top pods -n production

# Use Vertical Pod Autoscaler recommendations
kubectl describe vpa my-app-vpa

# Common starting points:
# Web app: 100-500m CPU, 128-512Mi memory
# API server: 250m-1 CPU, 256Mi-1Gi memory
# Database: 500m-2 CPU, 1-4Gi memory
# Worker: varies by workload
```

## Memory Management

```yaml
# JVM application with proper memory settings
apiVersion: v1
kind: Pod
metadata:
  name: java-app
spec:
  containers:
    - name: app
      image: java-app:v1
      env:
        # Set JVM heap to 75% of container limit
        - name: JAVA_OPTS
          value: "-XX:MaxRAMPercentage=75.0"
      resources:
        requests:
          memory: "1Gi"
        limits:
          memory: "2Gi"
```

## OOMKilled Debugging

```bash
# Check for OOMKilled
kubectl get pod <pod> -o jsonpath='{.status.containerStatuses[*].lastState}'

# Describe pod for OOM events
kubectl describe pod <pod> | grep -i oom

# Check node memory pressure
kubectl describe node <node> | grep -i memory

# Solution: Increase memory limit or fix memory leak
```

## Summary

Resource requests guarantee minimum resources and drive scheduling decisions. Limits cap maximum usage - CPU is throttled, memory triggers OOMKill. QoS classes (Guaranteed, Burstable, BestEffort) determine eviction priority during node pressure. Use LimitRange for namespace defaults and ResourceQuota for total limits. Monitor with `kubectl top` and rightsize based on actual usage. Set memory limits carefully to avoid OOMKilled containers, and use appropriate JVM flags for Java applications.

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
