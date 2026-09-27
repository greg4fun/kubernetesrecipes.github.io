---
title: "Kubernetes ResourceQuota and LimitRange Examples"
description: "Kubernetes ResourceQuota and LimitRange YAML: namespace CPU/memory/GPU quotas, object counts, storage-class and priority scopes, default container limits."
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
  - "governance"
relatedRecipes:
  - "resource-quota-exceeded-error"
  - "resourcequota-limitrange-gpu"
  - "kubernetes-multi-tenancy-enterprise"
  - "kubernetes-resource-requests-limits"
  - "kubernetes-namespace-guide"
  - "kubernetes-vertical-pod-autoscaler-vpa"
  - "kubernetes-projected-volumes"
  - "kubernetes-qos-classes-guide"
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

    # Extended resources (GPUs): only the requests. prefix is allowed
    requests.nvidia.com/gpu: "4"

    # Any namespaced object type via count/<resource>.<group>
    count/deployments.apps: "20"
    count/jobs.batch: "50"
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
    maxLimitRequestRatio:   # limit may be at most 4x the request
      cpu: "4"
  
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

`Terminating` / `NotTerminating` scope by `activeDeadlineSeconds` instead — useful to give Jobs and other bounded-lifetime pods their own budget:

```yaml
apiVersion: v1
kind: ResourceQuota
metadata:
  name: terminating-quota
  namespace: team-a
spec:
  hard:
    pods: "100"
    requests.cpu: "20"
  scopes:
    - Terminating   # pods with activeDeadlineSeconds set (Jobs)
---
apiVersion: v1
kind: ResourceQuota
metadata:
  name: long-running-quota
  namespace: team-a
spec:
  hard:
    pods: "30"
    requests.cpu: "10"
  scopes:
    - NotTerminating   # everything else
```

### Quota for a CI/CD Namespace

```yaml
apiVersion: v1
kind: ResourceQuota
metadata:
  name: ci-quota
  namespace: ci-builds
spec:
  hard:
    pods: "20"                       # cap concurrent builds
    requests.cpu: "10"
    requests.memory: 20Gi
    limits.cpu: "20"
    limits.memory: 40Gi
    requests.ephemeral-storage: 50Gi # build artifacts, layer caches
    limits.ephemeral-storage: 100Gi
```

### Monitor Quota Usage

```bash
# All quotas in cluster
kubectl get resourcequota -A

# Prometheus metrics
# kube_resourcequota{namespace="team-a",resource="requests.cpu",type="hard"} 10
# kube_resourcequota{namespace="team-a",resource="requests.cpu",type="used"} 3.5
```

```yaml
# Alertmanager rule: fire before teams hit the wall
- alert: ResourceQuotaHighUsage
  expr: |
    kube_resourcequota{type="used"} / kube_resourcequota{type="hard"} > 0.9
  for: 5m
  labels:
    severity: warning
  annotations:
    summary: "Namespace {{ $labels.namespace }} quota near limit"
```

### Complete Multi-Tenant Namespace

Bundling Namespace + ResourceQuota + LimitRange + a default-deny NetworkPolicy into one apply is the fastest way to onboard a new team safely:

```yaml
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
kind: LimitRange
metadata:
  name: default-limits
  namespace: team-alpha
spec:
  limits:
    - type: Container
      defaultRequest:
        cpu: 100m
        memory: 256Mi
      default:
        cpu: 500m
        memory: 512Mi
      max:
        cpu: "4"
        memory: 8Gi
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

## Common Issues

**"forbidden: exceeded quota" on pod creation**

Namespace quota reached. Check: `kubectl describe resourcequota -n <ns>`. Request increase or optimize resource requests.

**Pod rejected: "must specify limits.cpu,requests.cpu..."**

For every compute resource the quota tracks (`requests.cpu`, `limits.memory`, ...), each container must set that value. Add a LimitRange with `default`/`defaultRequest` so pods without specs get them injected. Full error walkthrough: [ResourceQuota exceeded](/recipes/troubleshooting/resource-quota-exceeded-error/).

**Deployment shows fewer ready replicas, no pod errors**

Quota rejections happen at pod creation by the ReplicaSet controller, so the Deployment looks fine. Check `kubectl describe rs <rs>` or `kubectl get events -n <ns> --field-selector reason=FailedCreate`.

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
- For every compute resource a quota tracks, each pod must specify it (LimitRange can inject defaults)
- LimitRange auto-injects defaults for pods without explicit requests
- Monitor quota usage with `kubectl describe resourcequota` or Prometheus

## Frequently Asked Questions

### What is the difference between ResourceQuota and LimitRange?

ResourceQuota caps the *total* consumption and object counts of a namespace. LimitRange applies *per object* (container, pod, PVC): it injects default requests/limits and enforces min/max. Quota says "this team gets 10 CPUs"; LimitRange says "no container over 4 CPUs, default 500m".

### Does ResourceQuota apply to existing pods?

No. Quota is enforced at admission, so creating a quota never evicts running pods — usage is simply recorded, and new pods are rejected while usage is over the hard limit. The same goes for LimitRange defaults: only new pods get them.

### How do I set a GPU quota per namespace?

Use `requests.nvidia.com/gpu: "4"` under `spec.hard`. Extended resources can't be overcommitted, so the `limits.` form isn't allowed. See [GPU ResourceQuota and LimitRange](/recipes/configuration/resourcequota-limitrange-gpu/).

### How do I check how much quota is left?

`kubectl describe resourcequota -n <ns>` shows Used vs Hard for each resource. In Prometheus, `kube_resourcequota{type="used"} / kube_resourcequota{type="hard"}` from kube-state-metrics.

