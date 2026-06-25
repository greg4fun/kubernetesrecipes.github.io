---
title: "Kubernetes CPU 200m Memory 256Mi: Limits Format"
description: "Use Kubernetes container resources limits with cpu 200m and memory 256Mi. Copy YAML syntax, convert millicores and Mi/Gi, and avoid Mi vs M mistakes."
publishDate: "2026-04-12"
author: "Luca Berton"
category: "configuration"
tags:
  - "resource-limits"
  - "cpu"
  - "memory"
  - "qos-classes"
  - "resource-management"
difficulty: "beginner"
timeToComplete: "10 minutes"
relatedRecipes:
  - "kubernetes-resource-format-syntax"
  - "kubernetes-resource-requests-limits"
  - "resource-limits-requests"
  - "vertical-pod-autoscaler-setup"
  - "kubernetes-oomkilled-troubleshooting"
  - "kubernetes-1-36-l3-cache-topology-cpu-manager"
  - "kubernetes-1-36-pod-level-resources"
---

> 💡 **Quick Answer:** Use `cpu: "200m"` and `memory: "256Mi"` under `resources.requests` or `resources.limits`. `200m` means 200 millicores, or 0.2 CPU core. `256Mi` means 256 MiB, or 268,435,456 bytes. Quote CPU and memory values in YAML for consistency.

## The Problem

Kubernetes resource specifications use compact unit formats that are easy to misread. Search queries like `container resources limits cpu 200m memory 256mi` are asking for three things: the exact YAML structure, what the CPU value means, and whether `256Mi` is the right memory suffix.

Common mistakes include putting CPU and memory outside the `resources` block, confusing `Mi` with `M`, or setting limits without understanding requests. Those mistakes lead to OOMKilled pods, CPU throttling, Pending pods, or wasted cluster capacity.

```mermaid
flowchart TB
    subgraph CPU["CPU Units"]
        M100["100m = 0.1 CPU"]
        M200["200m = 0.2 CPU"]
        M500["500m = 0.5 CPU"]
        C1["1 = 1 full core"]
        C2["2 = 2 full cores"]
    end
    subgraph MEM["Memory Units"]
        MI128["128Mi = 128 MiB"]
        MI256["256Mi = 256 MiB"]
        MI512["512Mi = 512 MiB"]
        GI1["1Gi = 1 GiB"]
        GI4["4Gi = 4 GiB"]
    end
```

## The Solution

### Copy-Paste Format for `cpu 200m memory 256Mi`

Use this structure inside each container:

```yaml
resources:
  requests:
    cpu: "200m"
    memory: "256Mi"
  limits:
    cpu: "500m"
    memory: "256Mi"
```

| Field | Example | Meaning |
|-------|---------|---------|
| `requests.cpu` | `"200m"` | Reserve 0.2 CPU core for scheduling |
| `requests.memory` | `"256Mi"` | Reserve 256 MiB for scheduling |
| `limits.cpu` | `"500m"` | Throttle above 0.5 CPU core |
| `limits.memory` | `"256Mi"` | Kill/restart if the container exceeds 256 MiB |

### Resource Specification Syntax

```yaml
apiVersion: v1
kind: Pod
metadata:
  name: example
spec:
  containers:
    - name: app
      image: nginx
      resources:
        requests:          # Minimum guaranteed resources
          cpu: "200m"      # 0.2 CPU cores
          memory: "256Mi"  # 256 MiB RAM
        limits:            # Maximum allowed resources
          cpu: "500m"      # 0.5 CPU cores
          memory: "256Mi"  # 256 MiB RAM
```

### CPU Units

| Format | Value | Meaning |
|--------|:-----:|---------|
| \`100m\` | 0.1 | 10% of one CPU core |
| \`200m\` | 0.2 | 20% of one CPU core |
| \`250m\` | 0.25 | 25% of one CPU core |
| \`500m\` | 0.5 | Half a CPU core |
| \`1\` | 1.0 | One full CPU core |
| \`1000m\` | 1.0 | Same as \`1\` (1000 millicores) |
| \`1500m\` | 1.5 | One and a half cores |
| \`2\` | 2.0 | Two full CPU cores |
| \`0.1\` | 0.1 | Same as \`100m\` |

> **Rule:** \`m\` = millicores. 1 CPU = 1000m. Always use \`m\` suffix for consistency.

### Memory Units

| Format | Bytes | Power |
|--------|------:|:-----:|
| \`128Mi\` | 134,217,728 | 2^27 |
| \`256Mi\` | 268,435,456 | 2^28 |
| \`512Mi\` | 536,870,912 | 2^29 |
| \`1Gi\` | 1,073,741,824 | 2^30 |
| \`2Gi\` | 2,147,483,648 | 2^31 |
| \`4Gi\` | 4,294,967,296 | 2^32 |

#### \`Mi\` vs \`M\` (Important!)

| Suffix | Base | Example |
|--------|:----:|---------|
| \`Ki\` | 2^10 = 1,024 | \`256Ki\` = 262,144 bytes |
| \`Mi\` | 2^20 = 1,048,576 | \`256Mi\` = 268,435,456 bytes |
| \`Gi\` | 2^30 = 1,073,741,824 | \`1Gi\` = 1,073,741,824 bytes |
| \`K\` | 10^3 = 1,000 | \`256K\` = 256,000 bytes |
| \`M\` | 10^6 = 1,000,000 | \`256M\` = 256,000,000 bytes |
| \`G\` | 10^9 = 1,000,000,000 | \`1G\` = 1,000,000,000 bytes |

> **Always use \`Mi\`/\`Gi\` (binary).** \`256M\` is ~4.6% less than \`256Mi\` — enough to cause unexpected OOMKilled.

### Requests vs Limits

```yaml
resources:
  requests:        # Scheduling: "I need at least this much"
    cpu: "200m"    # Scheduler finds a node with 200m available
    memory: "256Mi" # Scheduler finds a node with 256Mi available
  limits:          # Hard cap: "Never use more than this"
    cpu: "500m"    # CPU throttled above 500m (not killed)
    memory: "256Mi" # OOMKilled if exceeds 256Mi
```

| Aspect | Requests | Limits |
|--------|----------|--------|
| Purpose | Scheduling guarantee | Hard ceiling |
| CPU behavior | Guaranteed minimum | Throttled above limit |
| Memory behavior | Guaranteed minimum | **OOMKilled** above limit |
| Default if not set | 0 (or LimitRange default) | Unlimited (or LimitRange default) |

### QoS Classes

Kubernetes assigns QoS classes based on how you set requests and limits:

| QoS Class | Condition | Eviction Priority |
|-----------|-----------|:-:|
| **Guaranteed** | requests = limits for ALL containers | Last (safest) |
| **Burstable** | At least one request set, but requests ≠ limits | Middle |
| **BestEffort** | No requests or limits set | First (most likely evicted) |

```yaml
# Guaranteed QoS (recommended for production)
resources:
  requests:
    cpu: "500m"
    memory: "256Mi"
  limits:
    cpu: "500m"       # Same as request
    memory: "256Mi"   # Same as request

# Burstable QoS (allows bursting)
resources:
  requests:
    cpu: "200m"
    memory: "256Mi"
  limits:
    cpu: "500m"       # Higher than request
    memory: "512Mi"   # Higher than request

# BestEffort QoS (NOT recommended)
# No resources block at all
```

### Common Patterns

```yaml
# Web application
resources:
  requests:
    cpu: "200m"
    memory: "256Mi"
  limits:
    cpu: "500m"
    memory: "256Mi"

# API server
resources:
  requests:
    cpu: "500m"
    memory: "512Mi"
  limits:
    cpu: "1"
    memory: "1Gi"

# Database
resources:
  requests:
    cpu: "1"
    memory: "2Gi"
  limits:
    cpu: "2"
    memory: "4Gi"

# GPU workload
resources:
  requests:
    cpu: "4"
    memory: "16Gi"
  limits:
    cpu: "8"
    memory: "32Gi"
    nvidia.com/gpu: 1
```

### Check Resource Usage

```bash
# Current resource requests and limits
kubectl describe pod <pod-name> | grep -A6 "Limits\|Requests"

# Actual resource usage
kubectl top pod <pod-name>
# NAME       CPU(cores)   MEMORY(bytes)
# my-app     145m         189Mi

# Node resource allocation
kubectl describe node <node> | grep -A5 "Allocated"
# CPU Requests: 4200m (52%), CPU Limits: 8000m (100%)
# Memory Requests: 6Gi (40%), Memory Limits: 12Gi (75%)

# Check QoS class
kubectl get pod <pod-name> -o jsonpath='{.status.qosClass}'
# Guaranteed
```

## Common Issues

| Issue | Cause | Fix |
|-------|-------|-----|
| OOMKilled | Memory usage exceeds limit | Increase memory limit or optimize app |
| CPU throttling | CPU usage exceeds limit | Increase CPU limit or optimize app |
| Pod stuck Pending | Requests exceed available node resources | Reduce requests or add nodes |
| \`256M\` vs \`256Mi\` confusion | Decimal vs binary units | Always use \`Mi\`/\`Gi\` (binary) |
| BestEffort eviction | No requests/limits set | Always set at least requests |
| Wasted resources | Limits too high vs actual usage | Use VPA recommendations or \`kubectl top\` |

## Best Practices

- **Always set both requests AND limits** — prevents BestEffort QoS
- **Use \`Mi\`/\`Gi\` not \`M\`/\`G\`** — binary units match how Linux reports memory
- **Set memory requests = limits** for Guaranteed QoS — prevents OOMKilled surprises
- **Allow CPU bursting** — CPU limits > requests lets pods burst during spikes
- **Use VPA for right-sizing** — let Vertical Pod Autoscaler recommend values
- **Quote numeric values** — \`cpu: "1"\` not \`cpu: 1\` to avoid YAML type issues

## FAQ

### What is the format for `cpu: 200m memory: 256Mi`?

It is the standard Kubernetes resource format. `cpu: "200m"` requests 0.2 of a CPU core (200 millicores) and `memory: "256Mi"` requests 256 mebibytes (268,435,456 bytes). Both go under `resources.requests` and/or `resources.limits`:

```yaml
resources:
  requests:
    cpu: "200m"
    memory: "256Mi"
  limits:
    cpu: "500m"
    memory: "256Mi"
```

### What is the syntax for `cpu 500m memory 256Mi`?

`cpu: "500m"` = 0.5 CPU core; `memory: "256Mi"` = 256 MiB. A common production pattern is `requests` of `cpu: "200m"` / `memory: "256Mi"` with `limits` of `cpu: "500m"` / `memory: "256Mi"` — letting CPU burst while capping memory.

### Is `200m` CPU the same as `0.2`?

Yes. `200m` (200 millicores) and `0.2` are identical. Kubernetes recommends the `m` suffix for clarity — `200m` is unambiguous, whereas `0.2` can be mistaken for a typo.

### Is `256Mi` the same as `256M`?

No. `256Mi` = 256 × 1024² = 268,435,456 bytes (binary). `256M` = 256 × 1000² = 256,000,000 bytes (decimal). `256M` is ~4.6% smaller and is a frequent cause of unexpected `OOMKilled`. Always use `Mi`/`Gi`.

### Do `cpu 250m memory 128Mi` and `cpu 200m memory 256Mi` use the same format?

Yes — only the values change. `250m` = 0.25 core, `128Mi` = 128 MiB; `200m` = 0.2 core, `256Mi` = 256 MiB. The YAML keys (`cpu`, `memory`) and structure (`requests`/`limits`) are identical for every value.

## Key Takeaways

- CPU: millicores (\`200m\` = 0.2 cores, \`1\` = 1 core, \`1000m\` = 1 core)
- Memory: binary units (\`256Mi\`, \`1Gi\`) — always use \`Mi\`/\`Gi\`, not \`M\`/\`G\`
- Requests = scheduling guarantee, Limits = hard cap
- CPU is throttled above limit, Memory is OOMKilled above limit
- Guaranteed QoS (requests = limits) is safest for production workloads
- Use \`kubectl top\` and VPA to right-size resources based on actual usage
