---
title: "K8s PriorityClass: Pod Scheduling Priority"
description: "Configure Kubernetes PriorityClass for pod scheduling priority and preemption. System-critical pods, resource guarantees, and preemption policies."
publishDate: "2026-05-02"
author: "Luca Berton"
category: "deployments"
difficulty: "intermediate"
timeToComplete: "8 minutes"
kubernetesVersion: "1.28+"
tags:
  - "priority"
  - "preemption"
  - "scheduling"
  - "resource-management"
  - "cka"
relatedRecipes:
  - "kubernetes-resource-quota-limitrange"
  - "kubernetes-pod-disruption-budget"
  - "kubernetes-node-affinity-guide"
  - "kubernetes-topology-spread-constraints"
---

> 💡 **Quick Answer:** Create `PriorityClass` with a value (0-1000000000): higher = more important. Assign with `priorityClassName` in pod spec. When resources are scarce, higher-priority pods preempt (evict) lower-priority ones. Built-in classes: `system-cluster-critical` (2000000000) and `system-node-critical` (2000001000). Set `preemptionPolicy: Never` if a pod should be prioritized for scheduling but shouldn't evict others.

## The Problem

Without priorities, all pods are equal:

- Critical production pods wait behind batch jobs
- System components can be evicted by user workloads
- No guaranteed scheduling order during resource pressure
- Cluster-critical infrastructure has no protection

## The Solution

### Create PriorityClasses

```yaml
# Production — highest user priority
apiVersion: scheduling.k8s.io/v1
kind: PriorityClass
metadata:
  name: production-critical
value: 1000000
globalDefault: false
description: "Production-critical workloads"

---
# Standard workloads
apiVersion: scheduling.k8s.io/v1
kind: PriorityClass
metadata:
  name: standard
value: 100000
globalDefault: true           # Default for pods without priorityClassName
description: "Standard workloads"

---
# Batch/background jobs
apiVersion: scheduling.k8s.io/v1
kind: PriorityClass
metadata:
  name: batch-low
value: 10000
preemptionPolicy: Never       # Don't evict others, just queue ahead
description: "Low priority batch jobs"

---
# Best-effort / preemptible
apiVersion: scheduling.k8s.io/v1
kind: PriorityClass
metadata:
  name: preemptible
value: 1000
description: "Can be evicted by any higher-priority pod"
```

### Use PriorityClass

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: payment-service
spec:
  replicas: 3
  selector:
    matchLabels:
      app: payment
  template:
    metadata:
      labels:
        app: payment
    spec:
      priorityClassName: production-critical
      containers:
      - name: payment
        image: payment:v2
        resources:
          requests:
            cpu: 500m
            memory: 512Mi
```

### Built-in System Priorities

```bash
# These exist by default — DON'T modify them
kubectl get priorityclasses

# system-node-critical    2000001000   # kubelet, kube-proxy
# system-cluster-critical 2000000000   # CoreDNS, kube-apiserver
# User range: 0 — 1000000000

# Example: CoreDNS uses system-cluster-critical
kubectl get deployment coredns -n kube-system -o jsonpath='{.spec.template.spec.priorityClassName}'
# system-cluster-critical
```

### Preemption Flow

```
Scenario: Cluster at capacity, high-priority pod created

1. Scheduler tries to place high-priority pod → no room
2. Scheduler finds nodes with lower-priority pods
3. Lower-priority pods evicted (graceful termination)
4. High-priority pod scheduled on freed resources
5. Evicted pods go back to Pending (rescheduled if room)

Note: Preemption respects PDB — won't violate PodDisruptionBudgets
```

### ResourceQuota with Priority

```yaml
# Limit how many high-priority pods a namespace can create
apiVersion: v1
kind: ResourceQuota
metadata:
  name: production-quota
  namespace: team-a
spec:
  hard:
    pods: "10"
    requests.cpu: "20"
  scopeSelector:
    matchExpressions:
    - scopeName: PriorityClass
      operator: In
      values: ["production-critical"]
```

## Common Issues

**Low-priority pods constantly evicted**

Too many high-priority workloads. Review priority assignments — not everything is "critical."

**Preemption not happening**

`preemptionPolicy: Never` set on the PriorityClass, or PDB protects the lower-priority pods.

**All pods use highest priority**

Teams gaming the system. Use ResourceQuota with PriorityClass scope to limit high-priority pod counts.

## Best Practices

- **3-5 priority tiers** — system, production, standard, batch, preemptible
- **Set `globalDefault: true`** on standard tier — pods without priority get a reasonable default
- **`preemptionPolicy: Never`** for batch jobs — prioritize scheduling without evicting
- **Combine with ResourceQuota** — prevent priority abuse
- **Don't use values > 1000000000** — reserved for system classes

## Key Takeaways

- PriorityClass assigns scheduling priority; higher values scheduled first
- Preemption evicts lower-priority pods to make room for higher-priority ones
- Built-in system classes protect cluster infrastructure
- `preemptionPolicy: Never` = priority without eviction
- Use 3-5 tiers and set a `globalDefault` for unprioritized pods
