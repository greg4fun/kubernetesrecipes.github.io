---
title: "K8s ResourceQuota and LimitRange Guide"
description: "Configure Kubernetes ResourceQuota and LimitRange for namespace resource management. CPU and memory quotas, pod count limits, and default container limits."
publishDate: "2026-05-02"
author: "Luca Berton"
category: "configuration"
difficulty: "intermediate"
timeToComplete: "10 minutes"
kubernetesVersion: "1.28+"
tags:
  - "resource-quotas"
  - "limitrange"
  - "multi-tenancy"
  - "configuration"
  - "cka"
relatedRecipes:
  - "resource-limits-requests"
  - "kubernetes-namespace-guide"
  - "kubernetes-resource-optimization-strategies"
  - "vertical-pod-autoscaler"
---

> 💡 **Quick Answer:** `ResourceQuota` limits total resources per namespace: `requests.cpu: "10"` caps total CPU requests at 10 cores. `LimitRange` sets per-container defaults and min/max: `default.cpu: 500m` gives containers 500m CPU limit if unspecified. When ResourceQuota is set, ALL pods must specify resource requests — use LimitRange to provide defaults.

## The Problem

Without quotas, one namespace can consume all cluster resources:

- Team A deploys 100 replicas, starving Team B
- Developers forget resource limits, pods use unlimited CPU/memory
- No guardrails on how many PVCs, Services, or ConfigMaps are created
- Resource planning is impossible without usage limits

## The Solution

### ResourceQuota

```yaml
apiVersion: v1
kind: ResourceQuota
metadata:
  name: team-quota
  namespace: team-a
spec:
  hard:
    # Compute
    requests.cpu: "10"
    requests.memory: 20Gi
    limits.cpu: "20"
    limits.memory: 40Gi
    
    # Object counts
    pods: "50"
    services: "10"
    services.loadbalancers: "2"
    services.nodeports: "5"
    persistentvolumeclaims: "20"
    configmaps: "30"
    secrets: "30"
    replicationcontrollers: "10"
    
    # Storage
    requests.storage: 200Gi
    
    # Per StorageClass
    fast-ssd.storageclass.storage.k8s.io/requests.storage: 100Gi
    fast-ssd.storageclass.storage.k8s.io/persistentvolumeclaims: "10"
```

```bash
# Check quota usage
kubectl describe resourcequota team-quota -n team-a
# Name:             team-quota
# Resource          Used    Hard
# --------          ----    ----
# configmaps        5       30
# limits.cpu        3       20
# limits.memory     6Gi     40Gi
# pods              8       50
# requests.cpu      1500m   10
# requests.memory   4Gi     20Gi
# services          3       10
```

### LimitRange

```yaml
apiVersion: v1
kind: LimitRange
metadata:
  name: resource-limits
  namespace: team-a
spec:
  limits:
  # Container defaults and constraints
  - type: Container
    default:            # Default limits (if not specified)
      cpu: 500m
      memory: 256Mi
    defaultRequest:     # Default requests (if not specified)
      cpu: 100m
      memory: 128Mi
    max:                # Maximum allowed
      cpu: "4"
      memory: 8Gi
    min:                # Minimum allowed
      cpu: 50m
      memory: 64Mi
  
  # Pod-level constraints
  - type: Pod
    max:
      cpu: "8"
      memory: 16Gi
    min:
      cpu: 100m
      memory: 128Mi
  
  # PVC constraints
  - type: PersistentVolumeClaim
    max:
      storage: 100Gi
    min:
      storage: 1Gi
```

### How They Work Together

```bash
# Scenario: Team namespace with both ResourceQuota and LimitRange

# 1. Developer creates pod WITHOUT resource specs:
kubectl run nginx --image=nginx -n team-a
# LimitRange injects: requests.cpu=100m, limits.cpu=500m
# ResourceQuota: 100m added to used requests, 500m to used limits ✅

# 2. Developer requests too much:
# Pod spec: requests.cpu=20  (exceeds quota hard limit of 10)
# Error: exceeded quota: requests.cpu, requested: 20, limited: 10 ❌

# 3. Developer requests below LimitRange min:
# Pod spec: requests.cpu=10m  (below min 50m)
# Error: minimum cpu usage per Container is 50m ❌
```

### Scoped Quotas

```yaml
# Quota only for high-priority pods
apiVersion: v1
kind: ResourceQuota
metadata:
  name: high-priority-quota
  namespace: team-a
spec:
  hard:
    pods: "10"
    requests.cpu: "20"
  scopeSelector:
    matchExpressions:
    - scopeName: PriorityClass
      operator: In
      values: ["high"]

---
# Quota for BestEffort pods (no requests/limits)
apiVersion: v1
kind: ResourceQuota
metadata:
  name: besteffort-quota
  namespace: team-a
spec:
  hard:
    pods: "5"
  scopes:
  - BestEffort
```

### Monitor Quota Usage

```bash
# All quotas in cluster
kubectl get resourcequota -A

# Prometheus metrics
# kube_resourcequota{namespace="team-a",resource="requests.cpu",type="hard"} 10
# kube_resourcequota{namespace="team-a",resource="requests.cpu",type="used"} 3.5

# Alert when approaching quota
# expr: kube_resourcequota{type="used"} / kube_resourcequota{type="hard"} > 0.9
```

## Common Issues

**"forbidden: exceeded quota" on pod creation**

Namespace quota reached. Check: `kubectl describe resourcequota -n <ns>`. Request increase or optimize resource requests.

**Pod rejected: "must specify requests" with ResourceQuota**

When ResourceQuota sets compute limits, ALL containers must specify requests. Add LimitRange to provide defaults.

**LimitRange defaults not applied to existing pods**

LimitRange only applies to NEW pods. Existing pods keep their original specs. Restart pods to pick up new defaults.

## Best Practices

- **Always pair ResourceQuota with LimitRange** — quota needs requests, LimitRange provides defaults
- **Set quotas per team namespace** — prevents resource monopolization
- **Monitor usage vs limits** — alert at 80% to prevent surprises
- **Include object count quotas** — prevent ConfigMap/Secret sprawl
- **Review and adjust quarterly** — usage patterns change over time

## Key Takeaways

- ResourceQuota caps total resources and object counts per namespace
- LimitRange sets per-container defaults, min, and max constraints
- When ResourceQuota is set, ALL pods must have resource requests
- LimitRange auto-injects defaults for pods without explicit requests
- Monitor quota usage with `kubectl describe resourcequota` or Prometheus
