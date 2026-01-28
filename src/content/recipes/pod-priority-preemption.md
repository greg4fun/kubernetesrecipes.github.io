---
title: "How to Configure Pod Priority and Preemption"
description: "Set pod priorities to ensure critical workloads get scheduled first. Configure preemption to evict lower-priority pods when resources are scarce."
category: "deployments"
difficulty: "intermediate"
publishDate: "2026-01-22"
tags: ["priority", "preemption", "scheduling", "resources", "workloads"]
---

# How to Configure Pod Priority and Preemption

Pod priority determines scheduling order and preemption behavior. Higher-priority pods can preempt (evict) lower-priority pods when cluster resources are insufficient.

## Create Priority Classes

```yaml
# priority-classes.yaml
apiVersion: scheduling.k8s.io/v1
kind: PriorityClass
metadata:
  name: critical
value: 1000000
globalDefault: false
preemptionPolicy: PreemptLowerPriority
description: "Critical system workloads"
---
apiVersion: scheduling.k8s.io/v1
kind: PriorityClass
metadata:
  name: high-priority
value: 100000
globalDefault: false
preemptionPolicy: PreemptLowerPriority
description: "Production applications"
---
apiVersion: scheduling.k8s.io/v1
kind: PriorityClass
metadata:
  name: default-priority
value: 10000
globalDefault: true  # Default for all pods
preemptionPolicy: PreemptLowerPriority
description: "Standard workloads"
---
apiVersion: scheduling.k8s.io/v1
kind: PriorityClass
metadata:
  name: low-priority
value: 1000
globalDefault: false
preemptionPolicy: Never  # Won't preempt other pods
description: "Batch jobs and non-critical workloads"
```

## Assign Priority to Pods

```yaml
# critical-deployment.yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: payment-service
spec:
  replicas: 3
  selector:
    matchLabels:
      app: payment-service
  template:
    metadata:
      labels:
        app: payment-service
    spec:
      priorityClassName: critical
      containers:
        - name: payment
          image: payment-service:v1
          resources:
            requests:
              cpu: 500m
              memory: 512Mi
            limits:
              cpu: 1000m
              memory: 1Gi
```

## Low Priority Batch Jobs

```yaml
# batch-job.yaml
apiVersion: batch/v1
kind: Job
metadata:
  name: data-processing
spec:
  template:
    spec:
      priorityClassName: low-priority
      restartPolicy: OnFailure
      containers:
        - name: processor
          image: data-processor:v1
          resources:
            requests:
              cpu: 2
              memory: 4Gi
```

## Non-Preempting Priority

```yaml
# non-preempting.yaml
apiVersion: scheduling.k8s.io/v1
kind: PriorityClass
metadata:
  name: high-priority-no-preempt
value: 100000
preemptionPolicy: Never  # High priority but won't evict others
description: "High priority without preemption"
---
apiVersion: apps/v1
kind: Deployment
metadata:
  name: important-but-patient
spec:
  template:
    spec:
      priorityClassName: high-priority-no-preempt
      containers:
        - name: app
          image: myapp:v1
```

## System Critical Pods

```yaml
# Kubernetes has built-in system priority classes:
# - system-cluster-critical (2000000000)
# - system-node-critical (2000001000)

# Use for critical cluster components only
apiVersion: apps/v1
kind: DaemonSet
metadata:
  name: node-monitor
  namespace: kube-system
spec:
  selector:
    matchLabels:
      app: node-monitor
  template:
    metadata:
      labels:
        app: node-monitor
    spec:
      priorityClassName: system-node-critical
      containers:
        - name: monitor
          image: node-monitor:v1
```

## Priority-Based Resource Allocation

```yaml
# Combine with ResourceQuota for priority-based limits
apiVersion: v1
kind: ResourceQuota
metadata:
  name: high-priority-quota
  namespace: production
spec:
  hard:
    pods: "100"
    requests.cpu: "50"
    requests.memory: 100Gi
  scopeSelector:
    matchExpressions:
      - operator: In
        scopeName: PriorityClass
        values:
          - high-priority
          - critical
---
apiVersion: v1
kind: ResourceQuota
metadata:
  name: low-priority-quota
  namespace: production
spec:
  hard:
    pods: "20"
    requests.cpu: "10"
    requests.memory: 20Gi
  scopeSelector:
    matchExpressions:
      - operator: In
        scopeName: PriorityClass
        values:
          - low-priority
```

## Preemption Behavior

```yaml
# When high-priority pod can't be scheduled:
# 1. Scheduler identifies nodes where pod could fit if lower-priority pods removed
# 2. Lower-priority pods are gracefully terminated (respecting terminationGracePeriodSeconds)
# 3. High-priority pod is scheduled once resources are freed

# Pod with graceful shutdown
apiVersion: v1
kind: Pod
metadata:
  name: preemptible-pod
spec:
  priorityClassName: low-priority
  terminationGracePeriodSeconds: 30  # Time to cleanup before force kill
  containers:
    - name: app
      image: myapp:v1
      lifecycle:
        preStop:
          exec:
            command: ["/bin/sh", "-c", "sleep 10 && /app/shutdown.sh"]
```

## Monitor Priority and Preemption

```bash
# List priority classes
kubectl get priorityclasses

# Check pod priorities
kubectl get pods -o custom-columns=\
NAME:.metadata.name,\
PRIORITY:.spec.priority,\
PRIORITY_CLASS:.spec.priorityClassName

# View preemption events
kubectl get events --field-selector reason=Preempted

# Describe to see scheduling decisions
kubectl describe pod <pod-name> | grep -A5 Events
```

## Best Practices

```yaml
# 1. Reserve high priorities for truly critical workloads
# 2. Set appropriate resource requests to minimize preemption
# 3. Use PodDisruptionBudgets to protect critical pods
# 4. Consider non-preempting priority for important but flexible workloads

apiVersion: policy/v1
kind: PodDisruptionBudget
metadata:
  name: critical-pdb
spec:
  minAvailable: 2
  selector:
    matchLabels:
      app: critical-app
```

## Prometheus Alerts for Preemption

```yaml
# alert-preemption.yaml
apiVersion: monitoring.coreos.com/v1
kind: PrometheusRule
metadata:
  name: preemption-alerts
spec:
  groups:
    - name: preemption
      rules:
        - alert: HighPreemptionRate
          expr: |
            increase(scheduler_preemption_victims[1h]) > 10
          for: 5m
          labels:
            severity: warning
          annotations:
            summary: "High pod preemption rate"
            description: "{{ $value }} pods preempted in the last hour"
```

## Summary

Pod priority ensures critical workloads get scheduled first and can preempt lower-priority pods when resources are scarce. Use priority classes to categorize workloads, combine with ResourceQuotas for fine-grained control, and set preemptionPolicy to Never for pods that shouldn't evict others.

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
