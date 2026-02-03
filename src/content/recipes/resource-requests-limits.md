---
title: "How to Set Resource Requests and Limits Properly"
description: "Master Kubernetes resource management with proper CPU and memory requests and limits. Avoid OOMKills, throttling, and resource contention."
category: "configuration"
difficulty: "beginner"
timeToComplete: "20 minutes"
kubernetesVersion: "1.28+"
prerequisites:
  - "A running Kubernetes cluster"
  - "kubectl configured to access your cluster"
  - "Basic understanding of containers"
relatedRecipes:
  - "vertical-pod-autoscaler"
  - "horizontal-pod-autoscaler"
tags:
  - resources
  - cpu
  - memory
  - limits
  - requests
  - qos
publishDate: "2026-01-21"
author: "Luca Berton"
---

> 💡 **Quick Answer:** **Requests** = guaranteed minimum (used for scheduling); **Limits** = maximum allowed (enforced at runtime). CPU limits throttle; memory limits OOMKill. Set requests to average usage, limits to peak usage. Use `kubectl top pods` to measure actual consumption.
>
> **Key formula:** Start with `requests.cpu: 100m`, `requests.memory: 128Mi`; set limits 2-3x requests.
>
> **Gotcha:** Memory limit OOMKills are immediate; CPU throttling degrades performance but pod survives. No limits = pod can consume entire node.

## The Problem

Your pods are being OOMKilled, CPU throttled, or scheduled to nodes without enough resources, causing performance issues.

## The Solution

Configure appropriate resource requests (guaranteed minimums) and limits (maximum allowed) for your containers.

## Understanding Requests vs Limits

| Type | Purpose | Behavior |
|------|---------|----------|
| **Request** | Minimum guaranteed resources | Used for scheduling decisions |
| **Limit** | Maximum allowed resources | Enforced at runtime |

## Basic Configuration

```yaml
apiVersion: v1
kind: Pod
metadata:
  name: myapp
spec:
  containers:
  - name: myapp
    image: myapp:latest
    resources:
      requests:
        memory: "128Mi"
        cpu: "100m"
      limits:
        memory: "256Mi"
        cpu: "500m"
```

## CPU Resources

CPU is measured in millicores (m):
- `1000m` = 1 CPU core
- `100m` = 0.1 CPU core (10%)
- `500m` = 0.5 CPU core (50%)

### CPU Behavior

- **Request**: Scheduler ensures node has this much CPU available
- **Limit**: Container is throttled if it exceeds this

```yaml
resources:
  requests:
    cpu: "250m"    # 25% of a core guaranteed
  limits:
    cpu: "1"       # Can burst up to 1 full core
```

## Memory Resources

Memory is measured in bytes:
- `128Mi` = 128 Mebibytes
- `1Gi` = 1 Gibibyte
- `256M` = 256 Megabytes (decimal)

### Memory Behavior

- **Request**: Scheduler ensures node has this much memory
- **Limit**: Container is OOMKilled if it exceeds this

```yaml
resources:
  requests:
    memory: "256Mi"    # 256 MiB guaranteed
  limits:
    memory: "512Mi"    # OOMKilled if exceeds 512 MiB
```

## Quality of Service (QoS) Classes

Kubernetes assigns QoS classes based on resource configuration:

### Guaranteed

Requests = Limits for all containers:

```yaml
resources:
  requests:
    memory: "256Mi"
    cpu: "500m"
  limits:
    memory: "256Mi"
    cpu: "500m"
```

- Highest priority
- Last to be evicted
- Best for critical workloads

### Burstable

Requests < Limits:

```yaml
resources:
  requests:
    memory: "128Mi"
    cpu: "100m"
  limits:
    memory: "256Mi"
    cpu: "500m"
```

- Medium priority
- Evicted after BestEffort pods
- Good for typical applications

### BestEffort

No requests or limits set:

```yaml
resources: {}
```

- Lowest priority
- First to be evicted
- Avoid in production

## Guidelines for Setting Values

### Starting Point

```yaml
# Conservative starting values
resources:
  requests:
    memory: "128Mi"
    cpu: "100m"
  limits:
    memory: "256Mi"
    cpu: "500m"
```

### Web Applications

```yaml
resources:
  requests:
    memory: "256Mi"
    cpu: "250m"
  limits:
    memory: "512Mi"
    cpu: "1"
```

### Background Workers

```yaml
resources:
  requests:
    memory: "512Mi"
    cpu: "500m"
  limits:
    memory: "1Gi"
    cpu: "2"
```

### Java Applications

Java needs more memory for JVM heap:

```yaml
resources:
  requests:
    memory: "1Gi"
    cpu: "500m"
  limits:
    memory: "2Gi"
    cpu: "2"
```

## Finding the Right Values

### 1. Observe Current Usage

```bash
# View resource usage
kubectl top pods
kubectl top nodes

# Get detailed metrics
kubectl describe pod myapp | grep -A5 "Limits:"
```

### 2. Use Metrics Server

```bash
# Install metrics server if not present
kubectl apply -f https://github.com/kubernetes-sigs/metrics-server/releases/latest/download/components.yaml
```

### 3. Use Vertical Pod Autoscaler

VPA provides recommendations:

```bash
kubectl describe vpa myapp-vpa
```

## Namespace-Level Controls

### LimitRange

Set defaults and constraints:

```yaml
apiVersion: v1
kind: LimitRange
metadata:
  name: default-limits
  namespace: production
spec:
  limits:
  - default:
      memory: "256Mi"
      cpu: "500m"
    defaultRequest:
      memory: "128Mi"
      cpu: "100m"
    max:
      memory: "2Gi"
      cpu: "2"
    min:
      memory: "64Mi"
      cpu: "50m"
    type: Container
```

### ResourceQuota

Limit total namespace resources:

```yaml
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

## Common Mistakes

### 1. No Limits Set

```yaml
# BAD - can consume all node resources
resources:
  requests:
    memory: "128Mi"
    cpu: "100m"
  # No limits!
```

### 2. Limits Too Low

```yaml
# BAD - will cause OOMKill
resources:
  limits:
    memory: "64Mi"  # Too small for most apps
```

### 3. Requests Too High

```yaml
# BAD - wastes resources
resources:
  requests:
    memory: "4Gi"   # Way more than needed
    cpu: "2"
```

### 4. Memory Limit < Request

```yaml
# INVALID - will be rejected
resources:
  requests:
    memory: "512Mi"
  limits:
    memory: "256Mi"  # Must be >= request
```

## Troubleshooting

### Pod OOMKilled

```bash
kubectl describe pod myapp | grep -i oom
kubectl get events --field-selector reason=OOMKilled
```

Solution: Increase memory limit.

### Pod Pending (Insufficient Resources)

```bash
kubectl describe pod myapp | grep -i insufficient
```

Solution: Reduce requests or add nodes.

### CPU Throttling

Check if container is being throttled:

```bash
kubectl exec myapp -- cat /sys/fs/cgroup/cpu/cpu.stat
```

Solution: Increase CPU limit or remove it.

## Best Practices

1. **Always set requests** for production workloads
2. **Set memory limits** to prevent runaway consumption
3. **CPU limits are optional** - consider removing if causing issues
4. **Use VPA** to find optimal values
5. **Monitor and adjust** based on actual usage
6. **Start conservative** and increase as needed

## Key Takeaways

- Requests guarantee resources for scheduling
- Limits cap maximum resource usage
- Memory exceeding limit = OOMKill
- CPU exceeding limit = throttling
- Use QoS Guaranteed for critical workloads
- Monitor actual usage to right-size resources

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
