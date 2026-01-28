---
title: "How to Configure Resource Limits and Requests"
description: "Set CPU and memory requests and limits for containers. Understand QoS classes, resource quotas, and best practices for right-sizing workloads."
category: "configuration"
difficulty: "beginner"
publishDate: "2026-01-22"
tags: ["resources", "limits", "requests", "qos", "capacity-planning"]
---

# How to Configure Resource Limits and Requests

Resource requests and limits control how much CPU and memory containers can use. Proper configuration ensures efficient cluster utilization and prevents resource contention.

## Basic Resource Configuration

```yaml
# pod-with-resources.yaml
apiVersion: v1
kind: Pod
metadata:
  name: web-app
spec:
  containers:
    - name: app
      image: nginx:latest
      resources:
        requests:
          memory: "256Mi"
          cpu: "250m"      # 250 millicores = 0.25 CPU
        limits:
          memory: "512Mi"
          cpu: "500m"      # 500 millicores = 0.5 CPU
```

## Understanding CPU Units

```yaml
# CPU is measured in millicores (m) or cores
resources:
  requests:
    cpu: "100m"    # 100 millicores = 0.1 CPU
    cpu: "0.1"     # Same as 100m
    cpu: "1"       # 1 full CPU core
    cpu: "1500m"   # 1.5 CPU cores
    cpu: "2"       # 2 CPU cores
```

## Understanding Memory Units

```yaml
# Memory uses binary (Ki, Mi, Gi) or decimal (K, M, G) units
resources:
  requests:
    memory: "64Mi"      # 64 Mebibytes
    memory: "128M"      # 128 Megabytes
    memory: "1Gi"       # 1 Gibibyte
    memory: "1G"        # 1 Gigabyte
    memory: "1073741824" # Bytes
```

## QoS Classes

### Guaranteed QoS

```yaml
# All containers have equal requests and limits
apiVersion: v1
kind: Pod
metadata:
  name: guaranteed-pod
spec:
  containers:
    - name: app
      image: nginx:latest
      resources:
        requests:
          memory: "256Mi"
          cpu: "500m"
        limits:
          memory: "256Mi"   # Equal to request
          cpu: "500m"       # Equal to request
```

### Burstable QoS

```yaml
# Requests set but lower than limits
apiVersion: v1
kind: Pod
metadata:
  name: burstable-pod
spec:
  containers:
    - name: app
      image: nginx:latest
      resources:
        requests:
          memory: "128Mi"
          cpu: "250m"
        limits:
          memory: "512Mi"   # Higher than request
          cpu: "1000m"      # Higher than request
```

### BestEffort QoS

```yaml
# No requests or limits set (not recommended)
apiVersion: v1
kind: Pod
metadata:
  name: besteffort-pod
spec:
  containers:
    - name: app
      image: nginx:latest
      # No resources specified
```

## Check QoS Class

```bash
# View pod QoS class
kubectl get pod my-pod -o jsonpath='{.status.qosClass}'

# Describe pod for QoS details
kubectl describe pod my-pod | grep "QoS Class"
```

## Deployment with Resources

```yaml
# deployment-resources.yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: api-server
spec:
  replicas: 3
  selector:
    matchLabels:
      app: api-server
  template:
    metadata:
      labels:
        app: api-server
    spec:
      containers:
        - name: api
          image: myapi:v1
          ports:
            - containerPort: 8080
          resources:
            requests:
              memory: "512Mi"
              cpu: "500m"
            limits:
              memory: "1Gi"
              cpu: "1000m"
          # Probes to ensure healthy pods
          readinessProbe:
            httpGet:
              path: /health
              port: 8080
            initialDelaySeconds: 5
          livenessProbe:
            httpGet:
              path: /health
              port: 8080
            initialDelaySeconds: 15
```

## Multiple Containers

```yaml
# multi-container-resources.yaml
apiVersion: v1
kind: Pod
metadata:
  name: multi-container
spec:
  containers:
    - name: main-app
      image: myapp:v1
      resources:
        requests:
          memory: "256Mi"
          cpu: "500m"
        limits:
          memory: "512Mi"
          cpu: "1000m"
    - name: sidecar
      image: logging-agent:v1
      resources:
        requests:
          memory: "64Mi"
          cpu: "100m"
        limits:
          memory: "128Mi"
          cpu: "200m"
```

## Init Container Resources

```yaml
# init-container-resources.yaml
apiVersion: v1
kind: Pod
metadata:
  name: app-with-init
spec:
  initContainers:
    - name: init-db
      image: busybox:latest
      command: ['sh', '-c', 'until nc -z db-service 5432; do sleep 2; done']
      resources:
        requests:
          memory: "32Mi"
          cpu: "50m"
        limits:
          memory: "64Mi"
          cpu: "100m"
  containers:
    - name: app
      image: myapp:v1
      resources:
        requests:
          memory: "256Mi"
          cpu: "500m"
        limits:
          memory: "512Mi"
          cpu: "1000m"
```

## LimitRange for Defaults

```yaml
# limitrange.yaml
apiVersion: v1
kind: LimitRange
metadata:
  name: default-limits
  namespace: production
spec:
  limits:
    - type: Container
      default:           # Default limits
        memory: "256Mi"
        cpu: "500m"
      defaultRequest:    # Default requests
        memory: "128Mi"
        cpu: "250m"
      min:               # Minimum allowed
        memory: "64Mi"
        cpu: "100m"
      max:               # Maximum allowed
        memory: "2Gi"
        cpu: "2000m"
    - type: Pod
      max:
        memory: "4Gi"
        cpu: "4000m"
```

## ResourceQuota

```yaml
# resourcequota.yaml
apiVersion: v1
kind: ResourceQuota
metadata:
  name: compute-quota
  namespace: production
spec:
  hard:
    requests.cpu: "10"
    requests.memory: "20Gi"
    limits.cpu: "20"
    limits.memory: "40Gi"
    pods: "50"
```

```bash
# Check quota usage
kubectl describe resourcequota compute-quota -n production
```

## View Resource Usage

```bash
# Pod resource usage
kubectl top pods

# Node resource usage
kubectl top nodes

# Detailed pod resources
kubectl describe pod my-pod | grep -A 5 "Requests\|Limits"

# Check if pods are being throttled
kubectl get pods -o json | jq '.items[] | {name: .metadata.name, cpu_limit: .spec.containers[].resources.limits.cpu}'
```

## Ephemeral Storage

```yaml
# ephemeral-storage.yaml
apiVersion: v1
kind: Pod
metadata:
  name: storage-demo
spec:
  containers:
    - name: app
      image: nginx:latest
      resources:
        requests:
          memory: "256Mi"
          cpu: "500m"
          ephemeral-storage: "1Gi"
        limits:
          memory: "512Mi"
          cpu: "1000m"
          ephemeral-storage: "2Gi"
```

## Extended Resources (GPUs)

```yaml
# gpu-resources.yaml
apiVersion: v1
kind: Pod
metadata:
  name: gpu-pod
spec:
  containers:
    - name: cuda-app
      image: nvidia/cuda:latest
      resources:
        requests:
          memory: "4Gi"
          cpu: "2"
          nvidia.com/gpu: 1
        limits:
          memory: "8Gi"
          cpu: "4"
          nvidia.com/gpu: 1
```

## Vertical Pod Autoscaler Recommendations

```bash
# Install VPA and get recommendations
kubectl get vpa my-app-vpa -o yaml

# VPA provides recommended resources based on actual usage
# recommendations:
#   containerRecommendations:
#     - containerName: app
#       lowerBound:
#         cpu: 250m
#         memory: 256Mi
#       target:
#         cpu: 500m
#         memory: 512Mi
#       upperBound:
#         cpu: 1000m
#         memory: 1Gi
```

## Right-Sizing Guidelines

```yaml
# Start with these ratios and adjust based on metrics:

# Web servers / APIs
resources:
  requests:
    memory: "256Mi"
    cpu: "250m"
  limits:
    memory: "512Mi"
    cpu: "500m"

# Background workers
resources:
  requests:
    memory: "512Mi"
    cpu: "500m"
  limits:
    memory: "1Gi"
    cpu: "1000m"

# Databases
resources:
  requests:
    memory: "1Gi"
    cpu: "1000m"
  limits:
    memory: "2Gi"
    cpu: "2000m"

# Cache (Redis, Memcached)
resources:
  requests:
    memory: "512Mi"
    cpu: "250m"
  limits:
    memory: "1Gi"
    cpu: "500m"
```

## Monitoring for Right-Sizing

```bash
# Prometheus queries for resource analysis

# CPU usage vs requests
# container_cpu_usage_seconds_total / kube_pod_container_resource_requests{resource="cpu"}

# Memory usage vs requests  
# container_memory_working_set_bytes / kube_pod_container_resource_requests{resource="memory"}

# Find over-provisioned pods (using < 50% of requests)
# CPU: rate(container_cpu_usage_seconds_total[5m]) / kube_pod_container_resource_requests{resource="cpu"} < 0.5
```

## Best Practices

```yaml
# production-pod.yaml
apiVersion: v1
kind: Pod
metadata:
  name: production-app
spec:
  containers:
    - name: app
      image: myapp:v1.2.3
      resources:
        # Always set requests (for scheduling)
        requests:
          memory: "256Mi"
          cpu: "250m"
        # Always set limits (to prevent resource exhaustion)
        limits:
          memory: "512Mi"
          cpu: "1000m"
          # Tip: Set memory limit = 2x request for burstable workloads
          # Set CPU limit higher to allow bursting
```

## Summary

Resource requests determine scheduling and are guaranteed to the container. Limits cap resource usage and trigger OOMKilled (memory) or throttling (CPU) when exceeded. Use Guaranteed QoS for critical workloads, Burstable for typical applications. Monitor actual usage to right-size resources, and use LimitRanges and ResourceQuotas to enforce policies namespace-wide.

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
