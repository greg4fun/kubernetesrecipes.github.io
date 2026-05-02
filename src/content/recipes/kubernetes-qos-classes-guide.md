---
title: "K8s QoS Classes: Guaranteed vs Burstable"
description: "Understand Kubernetes QoS classes for pod eviction priority. Guaranteed, Burstable, and BestEffort resource configurations and eviction behavior under pressure."
publishDate: "2026-05-02"
author: "Luca Berton"
category: "configuration"
difficulty: "intermediate"
timeToComplete: "8 minutes"
kubernetesVersion: "1.28+"
tags:
  - "qos"
  - "resource-management"
  - "eviction"
  - "configuration"
  - "cka"
relatedRecipes:
  - "resource-limits-requests"
  - "kubernetes-resource-quota-limitrange"
  - "kubernetes-priority-preemption-guide"
  - "debug-oom-killed"
---

> 💡 **Quick Answer:** Kubernetes assigns QoS classes based on resource specs: **Guaranteed** (requests == limits for ALL containers), **Burstable** (at least one request or limit set), **BestEffort** (no requests or limits). Under memory pressure, eviction order: BestEffort first → Burstable → Guaranteed last. Always set requests=limits for critical workloads to get Guaranteed QoS.

## The Problem

When a node runs out of memory:

- Which pods get killed first?
- How does Kubernetes decide eviction priority?
- How do you protect critical workloads from eviction?
- What's the relationship between resource specs and eviction?

## The Solution

### QoS Class Assignment

```yaml
# GUARANTEED — requests == limits for ALL containers
apiVersion: v1
kind: Pod
metadata:
  name: guaranteed-pod
spec:
  containers:
  - name: app
    image: myapp:v2
    resources:
      requests:
        cpu: 500m
        memory: 256Mi
      limits:
        cpu: 500m         # Same as request
        memory: 256Mi     # Same as request
  - name: sidecar
    image: fluent-bit:3.0
    resources:
      requests:
        cpu: 100m
        memory: 64Mi
      limits:
        cpu: 100m         # Same as request
        memory: 64Mi      # Same as request
# QoS: Guaranteed ✅ (ALL containers have requests == limits)

---
# BURSTABLE — at least one request or limit, but not Guaranteed
apiVersion: v1
kind: Pod
metadata:
  name: burstable-pod
spec:
  containers:
  - name: app
    image: myapp:v2
    resources:
      requests:
        cpu: 100m
        memory: 128Mi
      limits:
        cpu: 500m         # Different from request
        memory: 512Mi     # Different from request
# QoS: Burstable (requests ≠ limits)

---
# BESTEFFORT — no requests or limits at all
apiVersion: v1
kind: Pod
metadata:
  name: besteffort-pod
spec:
  containers:
  - name: app
    image: myapp:v2
    # No resources specified
# QoS: BestEffort (first to be evicted)
```

### Check QoS Class

```bash
# View pod's QoS class
kubectl get pod my-pod -o jsonpath='{.status.qosClass}'
# Guaranteed

# All pods with QoS classes
kubectl get pods -o custom-columns=\
NAME:.metadata.name,\
QOS:.status.qosClass,\
CPU_REQ:.spec.containers[0].resources.requests.cpu,\
CPU_LIM:.spec.containers[0].resources.limits.cpu,\
MEM_REQ:.spec.containers[0].resources.requests.memory,\
MEM_LIM:.spec.containers[0].resources.limits.memory
```

### Eviction Order

```
Node under memory pressure → kubelet evicts pods:

1. BestEffort pods (no resources) → evicted FIRST
   - Sorted by memory usage (highest usage evicted first)

2. Burstable pods (requests < limits) → evicted SECOND
   - Sorted by memory usage relative to request
   - Pod using 400Mi/256Mi request (156% over) evicted before
     pod using 300Mi/256Mi request (117% over)

3. Guaranteed pods (requests == limits) → evicted LAST
   - Only evicted if they exceed their limits
   - Or if system-reserved is insufficient

Within same QoS: higher memory usage = evicted first
PriorityClass also affects eviction order (lower priority first)
```

### QoS Decision Tree

```
Has ANY container with NO requests AND NO limits?
  ├── ALL containers have no requests/limits → BestEffort
  └── Some have, some don't → Burstable

ALL containers have BOTH cpu AND memory requests AND limits?
  ├── ALL requests == ALL limits → Guaranteed
  └── Any request ≠ limit → Burstable

Otherwise → Burstable
```

### OOM Score Adjustment

```bash
# Kubernetes sets OOM score adj based on QoS:
# Guaranteed:  -997  (almost never OOM killed)
# Burstable:   2-999 (proportional to memory usage vs request)
# BestEffort:  1000  (first to be OOM killed)

# Check OOM score
kubectl exec my-pod -- cat /proc/1/oom_score_adj
# -997  (Guaranteed)
```

### Production Patterns

```yaml
# Critical service — Guaranteed
apiVersion: apps/v1
kind: Deployment
metadata:
  name: payment-service
spec:
  template:
    spec:
      containers:
      - name: payment
        resources:
          requests:
            cpu: "1"
            memory: 1Gi
          limits:
            cpu: "1"
            memory: 1Gi

---
# Standard service — Burstable (cost-efficient)
apiVersion: apps/v1
kind: Deployment
metadata:
  name: web-frontend
spec:
  template:
    spec:
      containers:
      - name: web
        resources:
          requests:
            cpu: 100m
            memory: 256Mi
          limits:
            cpu: "1"
            memory: 1Gi

---
# Batch job — BestEffort (acceptable to evict)
apiVersion: batch/v1
kind: Job
metadata:
  name: data-analysis
spec:
  template:
    spec:
      containers:
      - name: analyze
        image: analysis:v1
        # No resources — use whatever's available
```

## Common Issues

**Pod evicted despite having resources**

Burstable QoS — using more than requested. Set requests=limits for Guaranteed protection.

**Guaranteed pod still OOM killed**

Pod exceeded its memory limit (which equals request). The limit is enforced by cgroups regardless of QoS.

**All pods BestEffort after LimitRange**

LimitRange `default` sets limits but not requests (or vice versa). Ensure both are set for Guaranteed QoS.

## Best Practices

- **Guaranteed for critical services** — database, payment, auth
- **Burstable for standard workloads** — web servers, APIs (cost-efficient)
- **BestEffort only for truly disposable** — batch jobs, dev workloads
- **Combine with PriorityClass** — QoS + priority = comprehensive eviction control
- **Monitor actual usage** — `kubectl top` to right-size requests

## Key Takeaways

- QoS class is automatically assigned based on resource requests and limits
- Guaranteed (requests=limits) → last to be evicted, highest protection
- BestEffort (no resources) → first to be evicted
- Burstable (everything else) → evicted proportional to usage over request
- Set requests=limits on ALL containers in critical pods for Guaranteed QoS
