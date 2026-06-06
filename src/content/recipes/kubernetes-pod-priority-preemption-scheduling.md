---
title: "Kubernetes Pod Priority and Preemption"
description: "Configure pod priority and preemption in Kubernetes for critical workloads. PriorityClass definitions, preemption behavior, protecting system"
tags:
  - "priority"
  - "preemption"
  - "scheduling"
  - "priorityclass"
  - "resource-management"
category: "configuration"
publishDate: "2026-06-01"
author: "Luca Berton"
difficulty: "intermediate"
relatedRecipes:
  - "kubernetes-pod-disruption-budget"
  - "kubernetes-taint-toleration"
---

> 💡 **Quick Answer:** PriorityClass assigns a numeric priority (0-1000000000) to pods. Higher-priority pods get scheduled first and can preempt (evict) lower-priority pods when the cluster is full. Create PriorityClasses for your workload tiers (critical/high/normal/low), then reference them in pod specs with `priorityClassName`. System-critical pods use priority > 1000000000.

## The Problem

- Critical production pods can't schedule because batch jobs consumed all resources
- No distinction between must-run services and best-effort workloads
- Cluster full — need to automatically make room for important pods
- System components (DNS, monitoring) must never be evicted
- Want to run low-priority workloads that yield resources when needed

## The Solution

### Define PriorityClasses

```yaml
# System critical (highest priority — reserved for cluster components)
apiVersion: scheduling.k8s.io/v1
kind: PriorityClass
metadata:
  name: system-critical
value: 1000000000
globalDefault: false
preemptionPolicy: PreemptLowerPriority
description: "System-critical pods (DNS, ingress, monitoring)"
---
# Production workloads
apiVersion: scheduling.k8s.io/v1
kind: PriorityClass
metadata:
  name: production-high
value: 100000
globalDefault: false
preemptionPolicy: PreemptLowerPriority
description: "Production services that must always run"
---
# Default priority for most workloads
apiVersion: scheduling.k8s.io/v1
kind: PriorityClass
metadata:
  name: production-normal
value: 50000
globalDefault: true    # Applied to pods without explicit priority
preemptionPolicy: PreemptLowerPriority
description: "Standard production workloads"
---
# Low priority (batch, dev, preemptible)
apiVersion: scheduling.k8s.io/v1
kind: PriorityClass
metadata:
  name: batch-low
value: 10000
globalDefault: false
preemptionPolicy: PreemptLowerPriority
description: "Batch jobs and non-critical workloads"
---
# Best effort (can be preempted, never preempts others)
apiVersion: scheduling.k8s.io/v1
kind: PriorityClass
metadata:
  name: best-effort
value: 1
globalDefault: false
preemptionPolicy: Never    # Won't evict others to schedule
description: "Best-effort workloads, will be preempted first"
```

### Use PriorityClass in Pods

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: payment-service
  namespace: production
spec:
  replicas: 3
  template:
    spec:
      priorityClassName: production-high    # High priority — preempts lower
      containers:
        - name: app
          image: registry.example.com/payment:v2
          resources:
            requests:
              cpu: "500m"
              memory: "512Mi"
---
apiVersion: batch/v1
kind: Job
metadata:
  name: data-processing
spec:
  template:
    spec:
      priorityClassName: batch-low    # Low priority — preempted by production
      containers:
        - name: worker
          image: registry.example.com/batch-worker:v1
          resources:
            requests:
              cpu: "2"
              memory: "4Gi"
```

### How Preemption Works

```text
Scenario: Cluster is full, high-priority pod can't schedule

1. Scheduler identifies pending pod with priority 100000
2. Scheduler finds nodes where evicting lower-priority pods would make room
3. Scheduler picks node with minimum disruption (fewest evictions)
4. Lower-priority pods get graceful termination (terminationGracePeriodSeconds)
5. After eviction, high-priority pod schedules on that node

Protection:
- PDB (PodDisruptionBudget) is respected during preemption
- Pods with higher or equal priority are never evicted
- System pods (priority > 1B) are never evicted by user workloads
```

### Non-Preempting Priority (Queue Ordering Only)

```yaml
# High scheduling priority but won't evict others
apiVersion: scheduling.k8s.io/v1
kind: PriorityClass
metadata:
  name: high-priority-no-preempt
value: 90000
preemptionPolicy: Never    # Schedules first, but waits for resources
description: "High scheduling priority without preemption"
```

### Built-in System PriorityClasses

```bash
kubectl get priorityclasses
# NAME                      VALUE        GLOBAL-DEFAULT
# system-cluster-critical   2000000000   false
# system-node-critical      2000001000   false
# (your custom classes)

# system-node-critical: kubelet, kube-proxy (per-node essentials)
# system-cluster-critical: CoreDNS, metrics-server (cluster-wide essentials)
```

### Practical Priority Tier Design

```text
Priority Tier       │ Value       │ Preempts │ Use Case
────────────────────┼─────────────┼──────────┼──────────────────────────
system-node-critical│ 2000001000  │ All      │ kubelet, kube-proxy
system-cluster-crit │ 2000000000  │ All user │ CoreDNS, ingress, CNI
platform-critical   │ 1000000     │ User     │ Monitoring, logging, mesh
production-high     │ 100000      │ Normal+  │ Payment, auth services
production-normal   │ 50000 (def) │ Low+     │ Standard services
batch-normal        │ 20000       │ Low+     │ Scheduled batch jobs
batch-low           │ 10000       │ Best-eff │ Backfill jobs
best-effort         │ 1 (Never)   │ None     │ Dev experiments, spot-like
────────────────────┴─────────────┴──────────┴──────────────────────────
```

## Common Issues

### Critical pod not preempting lower-priority pods
- **Cause**: PDB protecting the lower-priority pods; or no single node eviction would free enough resources
- **Fix**: Review PDB settings; ensure lower-priority pods have lower `value`; check node resource distribution

### All batch jobs getting killed constantly
- **Cause**: Cluster too full — production workloads keep preempting batch
- **Fix**: Add dedicated batch nodes with taints; or use cluster autoscaler to add capacity

### Pods without PriorityClass get priority 0
- **Cause**: No `globalDefault: true` PriorityClass defined
- **Fix**: Create a PriorityClass with `globalDefault: true` for a sensible default

### Preemption cascade (chain reaction)
- **Cause**: Evicted pod triggers rescheduling which preempts another pod
- **Fix**: Use clear priority tiers with gaps between values; set PDBs on critical workloads

## Best Practices

1. **Define 4-6 priority tiers** — don't over-complicate; clear hierarchy
2. **Set a `globalDefault`** — prevents pods from getting priority 0
3. **Use `preemptionPolicy: Never` for batch** — queue fairly without disruption
4. **Protect with PDB** — critical services should have PodDisruptionBudgets
5. **Gap between values** — leaves room for new tiers without reshuffling
6. **Don't use priorities > 1B** — reserved for system components
7. **Combine with resource quotas** — prevent low-priority namespaces from hoarding

## Key Takeaways

- PriorityClass: numeric value (higher = more important) + preemption policy
- Higher-priority pods schedule first AND can evict lower-priority pods
- `preemptionPolicy: Never` — high queue priority without eviction power
- Built-in: `system-node-critical` (2000001000) and `system-cluster-critical` (2000000000)
- `globalDefault: true` — applied to pods without explicit `priorityClassName`
- PDBs are respected during preemption — protected pods won't be evicted
- Design 4-6 clear tiers: system → platform → production → batch → best-effort
