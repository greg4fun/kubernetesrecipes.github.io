---
title: "How to Configure Resource Quotas"
description: "Limit resource consumption per namespace with ResourceQuotas. Control CPU, memory, storage, and object counts to ensure fair cluster sharing."
category: "configuration"
difficulty: "intermediate"
publishDate: "2026-01-22"
tags: ["resource-quota", "limits", "multi-tenancy", "capacity", "governance"]
---

> 💡 **Quick Answer:** Create `ResourceQuota` to limit namespace-wide resources: compute (`requests.cpu`, `limits.memory`), storage (`requests.storage`, `persistentvolumeclaims`), and objects (`count/pods`, `count/services`). Quotas enforce limits—requests exceeding quota are rejected.
>
> **Key command:** `kubectl create quota team-quota --hard=cpu=10,memory=20Gi,pods=50 -n team-namespace`
>
> **Gotcha:** Combine with `LimitRange` to set default and max per-container limits; quota alone doesn't set per-pod constraints.

# How to Configure Resource Quotas

ResourceQuotas limit aggregate resource consumption per namespace. They're essential for multi-tenant clusters to ensure fair sharing and prevent resource exhaustion.

## Basic Resource Quota

```yaml
# basic-quota.yaml
apiVersion: v1
kind: ResourceQuota
metadata:
  name: compute-quota
  namespace: team-alpha
spec:
  hard:
    # CPU limits
    requests.cpu: "10"
    limits.cpu: "20"
    
    # Memory limits
    requests.memory: 20Gi
    limits.memory: 40Gi
    
    # Pod count
    pods: "50"
```

```bash
kubectl apply -f basic-quota.yaml

# Check quota usage
kubectl get resourcequota -n team-alpha
kubectl describe resourcequota compute-quota -n team-alpha
```

## Storage Quota

```yaml
# storage-quota.yaml
apiVersion: v1
kind: ResourceQuota
metadata:
  name: storage-quota
  namespace: team-alpha
spec:
  hard:
    # Total storage requests
    requests.storage: 100Gi
    
    # PVC count
    persistentvolumeclaims: "10"
    
    # Storage class specific
    requests.storage.fast-ssd: 50Gi
    persistentvolumeclaims.fast-ssd: "5"
    
    requests.storage.standard: 100Gi
    persistentvolumeclaims.standard: "10"
```

## Object Count Quota

```yaml
# object-quota.yaml
apiVersion: v1
kind: ResourceQuota
metadata:
  name: object-quota
  namespace: team-alpha
spec:
  hard:
    # Core objects
    pods: "100"
    services: "20"
    secrets: "50"
    configmaps: "50"
    
    # Service types
    services.loadbalancers: "2"
    services.nodeports: "5"
    
    # Workloads
    count/deployments.apps: "20"
    count/statefulsets.apps: "5"
    count/jobs.batch: "10"
    count/cronjobs.batch: "5"
```

## Quota with Scopes

```yaml
# scoped-quota.yaml
# Only applies to specific pods
apiVersion: v1
kind: ResourceQuota
metadata:
  name: best-effort-quota
  namespace: team-alpha
spec:
  hard:
    pods: "20"
  scopes:
    - BestEffort  # Only BestEffort QoS pods
---
apiVersion: v1
kind: ResourceQuota
metadata:
  name: not-best-effort-quota
  namespace: team-alpha
spec:
  hard:
    pods: "30"
    requests.cpu: "10"
    requests.memory: 20Gi
  scopes:
    - NotBestEffort  # Burstable and Guaranteed pods
```

## Priority Class Quota

```yaml
# priority-quota.yaml
apiVersion: v1
kind: ResourceQuota
metadata:
  name: high-priority-quota
  namespace: team-alpha
spec:
  hard:
    pods: "10"
    requests.cpu: "5"
    requests.memory: 10Gi
  scopeSelector:
    matchExpressions:
      - operator: In
        scopeName: PriorityClass
        values:
          - high-priority
          - critical
```

## Terminating vs Non-Terminating

```yaml
# terminating-quota.yaml
# For jobs and pods with activeDeadlineSeconds
apiVersion: v1
kind: ResourceQuota
metadata:
  name: terminating-quota
  namespace: team-alpha
spec:
  hard:
    pods: "100"
    requests.cpu: "20"
    requests.memory: 40Gi
  scopes:
    - Terminating
---
# For long-running pods
apiVersion: v1
kind: ResourceQuota
metadata:
  name: long-running-quota
  namespace: team-alpha
spec:
  hard:
    pods: "30"
    requests.cpu: "10"
    requests.memory: 20Gi
  scopes:
    - NotTerminating
```

## LimitRange (Default Limits)

```yaml
# limit-range.yaml
# Set defaults when pods don't specify limits
apiVersion: v1
kind: LimitRange
metadata:
  name: default-limits
  namespace: team-alpha
spec:
  limits:
    # Container defaults
    - type: Container
      default:
        cpu: "500m"
        memory: "512Mi"
      defaultRequest:
        cpu: "100m"
        memory: "128Mi"
      max:
        cpu: "2"
        memory: "4Gi"
      min:
        cpu: "50m"
        memory: "64Mi"
    
    # Pod limits
    - type: Pod
      max:
        cpu: "4"
        memory: "8Gi"
    
    # PVC limits
    - type: PersistentVolumeClaim
      min:
        storage: "1Gi"
      max:
        storage: "50Gi"
```

## Quota + LimitRange Together

```yaml
# Combined quota and limits
# Apply together to ensure pods have defaults and namespace has bounds

# 1. LimitRange ensures all containers have requests/limits
apiVersion: v1
kind: LimitRange
metadata:
  name: limits
  namespace: team-alpha
spec:
  limits:
    - type: Container
      defaultRequest:
        cpu: "100m"
        memory: "128Mi"
      default:
        cpu: "500m"
        memory: "512Mi"
---
# 2. ResourceQuota enforces namespace totals
apiVersion: v1
kind: ResourceQuota
metadata:
  name: quota
  namespace: team-alpha
spec:
  hard:
    requests.cpu: "10"
    requests.memory: 20Gi
    limits.cpu: "20"
    limits.memory: 40Gi
```

## Multi-Tenant Namespace Setup

```yaml
# namespace-setup.yaml
apiVersion: v1
kind: Namespace
metadata:
  name: team-alpha
  labels:
    team: alpha
    environment: production
---
apiVersion: v1
kind: ResourceQuota
metadata:
  name: compute-quota
  namespace: team-alpha
spec:
  hard:
    requests.cpu: "20"
    requests.memory: 40Gi
    limits.cpu: "40"
    limits.memory: 80Gi
    pods: "100"
---
apiVersion: v1
kind: ResourceQuota
metadata:
  name: storage-quota
  namespace: team-alpha
spec:
  hard:
    requests.storage: 200Gi
    persistentvolumeclaims: "20"
---
apiVersion: v1
kind: LimitRange
metadata:
  name: default-limits
  namespace: team-alpha
spec:
  limits:
    - type: Container
      defaultRequest:
        cpu: "100m"
        memory: "256Mi"
      default:
        cpu: "500m"
        memory: "512Mi"
      max:
        cpu: "4"
        memory: "8Gi"
---
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: default-deny
  namespace: team-alpha
spec:
  podSelector: {}
  policyTypes:
    - Ingress
    - Egress
```

## Check Quota Status

```bash
# View quota usage
kubectl get resourcequota -n team-alpha

# Detailed quota info
kubectl describe resourcequota compute-quota -n team-alpha

# Output example:
# Name:            compute-quota
# Namespace:       team-alpha
# Resource         Used   Hard
# --------         ----   ----
# limits.cpu       8      20
# limits.memory    16Gi   40Gi
# pods             25     50
# requests.cpu     4      10
# requests.memory  8Gi    20Gi

# Check why pod is rejected
kubectl describe pod <pending-pod>
# Look for: "exceeded quota" message
```

## Quota Enforcement

```yaml
# When quota is exceeded, pod creation fails:
# Error: pods "my-pod" is forbidden: exceeded quota: compute-quota,
# requested: requests.cpu=500m, used: requests.cpu=9500m, limited: requests.cpu=10

# Fix: Either reduce request or increase quota
```

## Quota for CI/CD

```yaml
# ci-namespace-quota.yaml
apiVersion: v1
kind: ResourceQuota
metadata:
  name: ci-quota
  namespace: ci-builds
spec:
  hard:
    # Limit concurrent builds
    pods: "20"
    
    # Build resources
    requests.cpu: "10"
    requests.memory: 20Gi
    limits.cpu: "20"
    limits.memory: 40Gi
    
    # Ephemeral storage for builds
    requests.ephemeral-storage: 50Gi
    limits.ephemeral-storage: 100Gi
```

## Monitor Quota Usage

```yaml
# Prometheus query for quota usage
# Percent used
kube_resourcequota{type="used"} / kube_resourcequota{type="hard"} * 100

# Alert on high usage
- alert: ResourceQuotaHighUsage
  expr: |
    kube_resourcequota{type="used"} / kube_resourcequota{type="hard"} > 0.9
  for: 5m
  labels:
    severity: warning
  annotations:
    summary: "Namespace {{ $labels.namespace }} quota near limit"
```

## Best Practices

```markdown
1. Always pair ResourceQuota with LimitRange
   - Quota requires requests/limits on pods
   - LimitRange provides defaults

2. Start with monitoring, then enforce
   - Observe actual usage first
   - Set quotas based on real needs

3. Leave headroom
   - Don't set quotas at exact current usage
   - Allow for growth and bursting

4. Use scopes for different workload types
   - Separate quotas for jobs vs services
   - Different limits for priority classes

5. Automate namespace provisioning
   - Include quotas in namespace templates
   - Consistent setup across teams
```

## Summary

ResourceQuotas limit aggregate resource consumption per namespace, essential for multi-tenant clusters. Combine with LimitRange to ensure pods have default requests/limits. Use scopes to apply different quotas based on pod characteristics like QoS class or priority. Monitor quota usage to adjust limits as needed and prevent teams from being blocked. Always provide appropriate headroom for workload variability.

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
