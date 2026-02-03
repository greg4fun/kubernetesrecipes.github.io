---
title: "How to Configure Resource Quotas per Namespace"
description: "Implement resource quotas to limit CPU, memory, and object counts per namespace. Ensure fair resource allocation across teams and environments."
category: "configuration"
difficulty: "intermediate"
publishDate: "2026-01-22"
tags: ["resourcequota", "limits", "namespaces", "governance", "multitenancy"]
---

> 💡 **Quick Answer:** Create `ResourceQuota` in a namespace to limit total `requests.cpu`, `requests.memory`, `limits.cpu`, `limits.memory`, and object counts (`pods`, `services`, `secrets`). Once quota exists, all pods must specify resource requests/limits to be created.
>
> **Key command:** `kubectl describe resourcequota -n <namespace>` shows current usage vs limits.
>
> **Gotcha:** When ResourceQuota exists, pods without resource requests fail to create—also create a `LimitRange` to set defaults.

# How to Configure Resource Quotas per Namespace

Resource quotas limit resource consumption per namespace, enabling fair multi-tenancy and preventing resource exhaustion. Configure quotas for CPU, memory, storage, and object counts.

## Basic Resource Quota

```yaml
# resource-quota.yaml
apiVersion: v1
kind: ResourceQuota
metadata:
  name: team-quota
  namespace: team-a
spec:
  hard:
    # Compute resources
    requests.cpu: "10"
    requests.memory: 20Gi
    limits.cpu: "20"
    limits.memory: 40Gi
    
    # Object counts
    pods: "50"
    services: "10"
    secrets: "20"
    configmaps: "20"
    persistentvolumeclaims: "10"
```

## Verify Quota Usage

```bash
# Check quota status
kubectl describe resourcequota team-quota -n team-a

# Output:
# Name:            team-quota
# Namespace:       team-a
# Resource         Used    Hard
# --------         ----    ----
# limits.cpu       4       20
# limits.memory    8Gi     40Gi
# pods             12      50
# requests.cpu     2       10
# requests.memory  4Gi     20Gi
```

## Quota for Different QoS Classes

```yaml
# qos-quota.yaml
apiVersion: v1
kind: ResourceQuota
metadata:
  name: best-effort-quota
  namespace: development
spec:
  hard:
    pods: "10"
  scopeSelector:
    matchExpressions:
      - operator: In
        scopeName: PriorityClass
        values: ["low"]
---
apiVersion: v1
kind: ResourceQuota
metadata:
  name: guaranteed-quota
  namespace: development
spec:
  hard:
    pods: "5"
  scopeSelector:
    matchExpressions:
      - operator: In
        scopeName: PriorityClass
        values: ["high"]
```

## Storage Quota

```yaml
# storage-quota.yaml
apiVersion: v1
kind: ResourceQuota
metadata:
  name: storage-quota
  namespace: team-a
spec:
  hard:
    # Total storage
    requests.storage: 100Gi
    persistentvolumeclaims: "20"
    
    # Per StorageClass limits
    fast-ssd.storageclass.storage.k8s.io/requests.storage: 50Gi
    fast-ssd.storageclass.storage.k8s.io/persistentvolumeclaims: "5"
    
    standard.storageclass.storage.k8s.io/requests.storage: 100Gi
    standard.storageclass.storage.k8s.io/persistentvolumeclaims: "15"
```

## Object Count Quota

```yaml
# count-quota.yaml
apiVersion: v1
kind: ResourceQuota
metadata:
  name: object-counts
  namespace: team-a
spec:
  hard:
    # Core objects
    pods: "100"
    services: "20"
    services.loadbalancers: "2"
    services.nodeports: "5"
    secrets: "50"
    configmaps: "50"
    
    # Workload objects
    count/deployments.apps: "20"
    count/replicasets.apps: "40"
    count/statefulsets.apps: "10"
    count/jobs.batch: "20"
    count/cronjobs.batch: "5"
    
    # Networking objects
    count/ingresses.networking.k8s.io: "10"
```

## LimitRange (Default Limits)

```yaml
# limit-range.yaml
apiVersion: v1
kind: LimitRange
metadata:
  name: default-limits
  namespace: team-a
spec:
  limits:
    # Default container limits
    - type: Container
      default:
        cpu: "500m"
        memory: "512Mi"
      defaultRequest:
        cpu: "100m"
        memory: "128Mi"
      min:
        cpu: "50m"
        memory: "64Mi"
      max:
        cpu: "2"
        memory: "4Gi"
    
    # Pod limits
    - type: Pod
      max:
        cpu: "4"
        memory: "8Gi"
    
    # PVC limits
    - type: PersistentVolumeClaim
      min:
        storage: 1Gi
      max:
        storage: 50Gi
```

## Multi-Tier Quotas

```yaml
# development-quota.yaml
apiVersion: v1
kind: ResourceQuota
metadata:
  name: dev-quota
  namespace: development
spec:
  hard:
    requests.cpu: "5"
    requests.memory: 10Gi
    limits.cpu: "10"
    limits.memory: 20Gi
    pods: "30"
---
# staging-quota.yaml
apiVersion: v1
kind: ResourceQuota
metadata:
  name: staging-quota
  namespace: staging
spec:
  hard:
    requests.cpu: "10"
    requests.memory: 20Gi
    limits.cpu: "20"
    limits.memory: 40Gi
    pods: "50"
---
# production-quota.yaml
apiVersion: v1
kind: ResourceQuota
metadata:
  name: prod-quota
  namespace: production
spec:
  hard:
    requests.cpu: "50"
    requests.memory: 100Gi
    limits.cpu: "100"
    limits.memory: 200Gi
    pods: "200"
```

## Quota with Priority Classes

```yaml
# priority-class.yaml
apiVersion: scheduling.k8s.io/v1
kind: PriorityClass
metadata:
  name: high-priority
value: 1000000
globalDefault: false
---
apiVersion: scheduling.k8s.io/v1
kind: PriorityClass
metadata:
  name: low-priority
value: 1000
globalDefault: true
---
# Quota limiting high-priority pods
apiVersion: v1
kind: ResourceQuota
metadata:
  name: high-priority-quota
  namespace: team-a
spec:
  hard:
    pods: "10"
  scopeSelector:
    matchExpressions:
      - operator: In
        scopeName: PriorityClass
        values: ["high-priority"]
```

## Monitoring Quota Usage

```yaml
# PrometheusRule for quota alerts
apiVersion: monitoring.coreos.com/v1
kind: PrometheusRule
metadata:
  name: quota-alerts
spec:
  groups:
    - name: quota
      rules:
        - alert: ResourceQuotaNearLimit
          expr: |
            (kube_resourcequota{type="used"} / kube_resourcequota{type="hard"}) > 0.9
          for: 5m
          labels:
            severity: warning
          annotations:
            summary: "Namespace {{ $labels.namespace }} quota near limit"
            description: "{{ $labels.resource }} is at {{ $value | humanizePercentage }}"
```

## Test Quota Enforcement

```bash
# Try to exceed quota
kubectl run test --image=nginx --restart=Never -n team-a \
  --requests='cpu=100,memory=200Gi'

# Error: exceeded quota: team-quota, requested: memory=200Gi, 
# used: memory=4Gi, limited: memory=20Gi

# Check remaining capacity
kubectl describe quota -n team-a
```

## Summary

Resource quotas enforce fair usage across namespaces. Combine with LimitRange to set defaults and prevent unbounded resource requests. Monitor quota usage with Prometheus alerts to proactively manage capacity.

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
