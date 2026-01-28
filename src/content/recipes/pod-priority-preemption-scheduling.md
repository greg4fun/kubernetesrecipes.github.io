---
title: "How to Configure Pod Priority and Preemption"
description: "Control Kubernetes scheduling with Pod Priority and Preemption. Learn to prioritize critical workloads and ensure important pods get scheduled first."
category: "deployments"
difficulty: "intermediate"
timeToComplete: "20 minutes"
kubernetesVersion: "1.28+"
prerequisites:
  - "A running Kubernetes cluster"
  - "kubectl configured with cluster-admin privileges"
  - "Understanding of Kubernetes scheduling concepts"
relatedRecipes:
  - "pod-disruption-budgets"
  - "resource-quotas"
  - "node-taints-tolerations"
tags:
  - priority
  - preemption
  - scheduling
  - critical-workloads
  - resource-management
publishDate: "2026-01-28"
author: "Luca Berton"
---

## The Problem

When cluster resources are constrained, you need to ensure critical workloads (databases, monitoring, payment services) get scheduled before less important ones (batch jobs, dev environments). Without priority, scheduling is first-come-first-served.

## The Solution

Use PriorityClasses to define importance levels for pods. Higher priority pods can preempt (evict) lower priority pods when resources are scarce.

## How Priority and Preemption Works

```
Pod Priority and Preemption Flow:

┌─────────────────────────────────────────────────────────────────┐
│                      SCHEDULING QUEUE                            │
│                                                                  │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │  Pods sorted by priority (highest first)                  │   │
│  │                                                           │   │
│  │  1. [Priority: 1000000] system-critical-pod              │   │
│  │  2. [Priority: 100000]  database-pod                     │   │
│  │  3. [Priority: 10000]   api-pod                          │   │
│  │  4. [Priority: 1000]    web-pod                          │   │
│  │  5. [Priority: 0]       batch-job-pod                    │   │
│  └──────────────────────────────────────────────────────────┘   │
│                              │                                   │
│                              ▼                                   │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │                    SCHEDULER                              │   │
│  │                                                           │   │
│  │  1. Try to schedule highest priority pod                 │   │
│  │  2. If no resources available:                           │   │
│  │     - Find lower priority pods to preempt               │   │
│  │     - Evict them to make room                           │   │
│  │  3. Schedule high priority pod                          │   │
│  └──────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
```

## Step 1: Create PriorityClasses

### System-Critical Priority (Built-in)

```bash
# View built-in priority classes
kubectl get priorityclasses

# Output:
# NAME                      VALUE        GLOBAL-DEFAULT
# system-cluster-critical   2000000000   false
# system-node-critical      2000001000   false
```

### Custom PriorityClasses

```yaml
# priority-classes.yaml
---
# Critical business applications (databases, payment)
apiVersion: scheduling.k8s.io/v1
kind: PriorityClass
metadata:
  name: critical
value: 1000000
globalDefault: false
preemptionPolicy: PreemptLowerPriority
description: "Critical business applications that should never be preempted by non-critical workloads"
---
# High priority (APIs, core services)
apiVersion: scheduling.k8s.io/v1
kind: PriorityClass
metadata:
  name: high
value: 100000
globalDefault: false
preemptionPolicy: PreemptLowerPriority
description: "High priority applications like APIs and core services"
---
# Medium priority (standard applications)
apiVersion: scheduling.k8s.io/v1
kind: PriorityClass
metadata:
  name: medium
value: 10000
globalDefault: true  # Default for pods without priority
preemptionPolicy: PreemptLowerPriority
description: "Standard applications - default priority"
---
# Low priority (batch jobs, dev workloads)
apiVersion: scheduling.k8s.io/v1
kind: PriorityClass
metadata:
  name: low
value: 1000
globalDefault: false
preemptionPolicy: PreemptLowerPriority
description: "Low priority batch jobs and development workloads"
---
# Best-effort (can be preempted anytime)
apiVersion: scheduling.k8s.io/v1
kind: PriorityClass
metadata:
  name: best-effort
value: 0
globalDefault: false
preemptionPolicy: Never  # Won't preempt others
description: "Best-effort workloads that can be preempted and won't preempt others"
```

```bash
kubectl apply -f priority-classes.yaml
```

## Step 2: Assign Priority to Pods

### Critical Database Deployment

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: postgres-primary
  namespace: production
spec:
  replicas: 1
  selector:
    matchLabels:
      app: postgres
      role: primary
  template:
    metadata:
      labels:
        app: postgres
        role: primary
    spec:
      priorityClassName: critical  # Highest custom priority
      containers:
        - name: postgres
          image: postgres:15
          resources:
            requests:
              cpu: "1"
              memory: "2Gi"
            limits:
              cpu: "2"
              memory: "4Gi"
          ports:
            - containerPort: 5432
```

### High Priority API Service

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: payment-api
  namespace: production
spec:
  replicas: 3
  selector:
    matchLabels:
      app: payment-api
  template:
    metadata:
      labels:
        app: payment-api
    spec:
      priorityClassName: high
      containers:
        - name: api
          image: payment-api:1.0
          resources:
            requests:
              cpu: "500m"
              memory: "512Mi"
            limits:
              cpu: "1"
              memory: "1Gi"
```

### Low Priority Batch Job

```yaml
apiVersion: batch/v1
kind: Job
metadata:
  name: data-processing
  namespace: batch
spec:
  template:
    spec:
      priorityClassName: low
      restartPolicy: OnFailure
      containers:
        - name: processor
          image: data-processor:1.0
          resources:
            requests:
              cpu: "2"
              memory: "4Gi"
```

### Best-Effort Development Pod

```yaml
apiVersion: v1
kind: Pod
metadata:
  name: dev-environment
  namespace: development
spec:
  priorityClassName: best-effort
  containers:
    - name: dev
      image: ubuntu:22.04
      command: ["sleep", "infinity"]
      resources:
        requests:
          cpu: "500m"
          memory: "1Gi"
```

## Step 3: Preemption Policies

### PreemptLowerPriority (Default)

Allows the pod to preempt lower-priority pods:

```yaml
apiVersion: scheduling.k8s.io/v1
kind: PriorityClass
metadata:
  name: can-preempt
value: 50000
preemptionPolicy: PreemptLowerPriority  # Default behavior
```

### Never Preempt

Pod won't preempt others, but can still be preempted:

```yaml
apiVersion: scheduling.k8s.io/v1
kind: PriorityClass
metadata:
  name: no-preemption
value: 50000
preemptionPolicy: Never  # Won't evict other pods
description: "High priority but won't preempt - will wait for resources"
```

## Step 4: Protect Pods from Preemption

### Use Pod Disruption Budgets

```yaml
apiVersion: policy/v1
kind: PodDisruptionBudget
metadata:
  name: postgres-pdb
  namespace: production
spec:
  minAvailable: 1
  selector:
    matchLabels:
      app: postgres
```

### Combine with High Priority

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: protected-service
spec:
  replicas: 3
  template:
    spec:
      priorityClassName: critical
      # PDB + High Priority = Maximum protection
```

## Step 5: Resource Quotas with Priority

### Limit Resources per Priority

```yaml
apiVersion: v1
kind: ResourceQuota
metadata:
  name: critical-quota
  namespace: production
spec:
  hard:
    pods: "10"
    requests.cpu: "20"
    requests.memory: "40Gi"
  scopeSelector:
    matchExpressions:
      - scopeName: PriorityClass
        operator: In
        values: ["critical"]
---
apiVersion: v1
kind: ResourceQuota
metadata:
  name: low-priority-quota
  namespace: production
spec:
  hard:
    pods: "50"
    requests.cpu: "10"
    requests.memory: "20Gi"
  scopeSelector:
    matchExpressions:
      - scopeName: PriorityClass
        operator: In
        values: ["low", "best-effort"]
```

## Preemption Scenarios

### Scenario 1: Resource Shortage

```
Before (Node at capacity):
┌──────────────────────────────────────┐
│ Node: 8 CPU available                │
│                                      │
│ [low-priority-job: 4 CPU]           │
│ [low-priority-job: 4 CPU]           │
│                                      │
│ Pending: [critical-db: 4 CPU]       │
└──────────────────────────────────────┘

After (Preemption):
┌──────────────────────────────────────┐
│ Node: 8 CPU available                │
│                                      │
│ [critical-db: 4 CPU] ← Scheduled    │
│ [low-priority-job: 4 CPU]           │
│                                      │
│ Evicted: low-priority-job           │
└──────────────────────────────────────┘
```

### Scenario 2: Multiple Preemptions

```yaml
# High priority pod needs 6 CPU
apiVersion: v1
kind: Pod
metadata:
  name: important-pod
spec:
  priorityClassName: high
  containers:
    - name: app
      resources:
        requests:
          cpu: "6"

# May preempt multiple low-priority pods to get 6 CPU
```

## Monitoring Priority and Preemption

### Check Pod Priority

```bash
# View pod priorities
kubectl get pods -A -o custom-columns=\
NAMESPACE:.metadata.namespace,\
NAME:.metadata.name,\
PRIORITY:.spec.priority,\
PRIORITY_CLASS:.spec.priorityClassName

# Sort by priority
kubectl get pods -A -o json | jq -r '
  .items | sort_by(.spec.priority) | reverse | 
  .[] | "\(.spec.priority // 0)\t\(.metadata.namespace)/\(.metadata.name)"
' | head -20
```

### Check Preemption Events

```bash
# View preemption events
kubectl get events -A --field-selector reason=Preempted

# Watch for preemption
kubectl get events -A -w --field-selector reason=Preempted
```

### Prometheus Metrics

```yaml
apiVersion: monitoring.coreos.com/v1
kind: PrometheusRule
metadata:
  name: priority-alerts
spec:
  groups:
    - name: pod-priority
      rules:
        - alert: CriticalPodsPending
          expr: |
            kube_pod_status_phase{phase="Pending"} 
            * on(namespace, pod) group_left(priority_class) 
            kube_pod_info{priority_class="critical"} > 0
          for: 5m
          labels:
            severity: critical
          annotations:
            summary: "Critical pod {{ $labels.pod }} is pending"
            
        - alert: HighPreemptionRate
          expr: |
            increase(scheduler_preemption_attempts_total[1h]) > 10
          for: 5m
          labels:
            severity: warning
          annotations:
            summary: "High preemption rate detected - consider adding capacity"
```

## Best Practices

### 1. Priority Class Strategy

```yaml
# Recommended priority levels:
# 2000000000 - system-cluster-critical (built-in)
# 2000001000 - system-node-critical (built-in)
# 1000000    - critical (databases, stateful apps)
# 100000     - high (APIs, core services)
# 10000      - medium (standard apps) - DEFAULT
# 1000       - low (batch, dev)
# 0          - best-effort (can always be preempted)
```

### 2. Always Set a Default

```yaml
apiVersion: scheduling.k8s.io/v1
kind: PriorityClass
metadata:
  name: default-priority
value: 10000
globalDefault: true  # Applied to pods without priorityClassName
```

### 3. Combine with Resource Requests

```yaml
# Priority alone doesn't guarantee resources
# Always set appropriate resource requests
spec:
  priorityClassName: critical
  containers:
    - name: app
      resources:
        requests:
          cpu: "1"      # Scheduler uses this for decisions
          memory: "2Gi"
```

### 4. Document Priority Assignment

```yaml
# Add annotations explaining priority
metadata:
  annotations:
    priority-reason: "Payment processing - revenue critical"
    priority-owner: "payments-team@company.com"
spec:
  priorityClassName: critical
```

## Verification Commands

```bash
# List all priority classes
kubectl get priorityclasses

# Check which pods use which priority class
kubectl get pods -A -o jsonpath='{range .items[*]}{.metadata.namespace}/{.metadata.name}: {.spec.priorityClassName}{"\n"}{end}'

# Find pods without priority class (using default)
kubectl get pods -A -o json | jq -r '
  .items[] | select(.spec.priorityClassName == null) | 
  "\(.metadata.namespace)/\(.metadata.name)"
'

# Check pending pods by priority
kubectl get pods -A --field-selector=status.phase=Pending \
  -o custom-columns=NAME:.metadata.name,PRIORITY:.spec.priority
```

## Common Pitfalls

| Issue | Cause | Solution |
|-------|-------|----------|
| Critical pods pending | No resources even after preemption | Add cluster capacity or reduce requests |
| Unexpected preemptions | Default priority too low | Set appropriate globalDefault PriorityClass |
| Batch jobs never run | Always preempted | Use `preemptionPolicy: Never` or dedicated node pool |
| Priority ignored | Resources not requested | Always set resource requests |

## Summary

Pod Priority and Preemption ensures critical workloads get scheduled during resource contention. Define clear priority classes, assign them appropriately, and combine with PDBs and resource quotas for comprehensive workload management.

---

## 📘 Go Further with Kubernetes Recipes

**Love this recipe? There's so much more!** This is just one of **100+ hands-on recipes** in our comprehensive **[Kubernetes Recipes book](/book)**.

Inside the book, you'll master:
- ✅ Production-ready deployment strategies
- ✅ Advanced networking and security patterns  
- ✅ Observability, monitoring, and troubleshooting
- ✅ Real-world best practices from industry experts

> *"The practical, recipe-based approach made complex Kubernetes concepts finally click for me."*

**👉 [Get Your Copy Now](/book)** — Start building production-grade Kubernetes skills today!
