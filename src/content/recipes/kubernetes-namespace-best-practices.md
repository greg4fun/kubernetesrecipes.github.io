---
title: "Kubernetes Namespace Best Practices"
description: "Organize Kubernetes clusters with namespace best practices. Separation strategies, resource quotas, network policies, RBAC per namespace, naming conventions, and when to use multiple namespaces vs clusters."
tags:
  - "namespaces"
  - "multi-tenancy"
  - "resource-quotas"
  - "organization"
  - "best-practices"
category: "configuration"
publishDate: "2026-06-01"
author: "Luca Berton"
difficulty: "beginner"
relatedRecipes:
  - "kubernetes-rbac-role-based-access-control"
  - "kubernetes-resource-management"
  - "kubernetes-networkpolicy-default-deny-examples"
---

> 💡 **Quick Answer:** Use namespaces to separate environments (dev/staging/prod), teams, or applications. Apply ResourceQuotas to prevent resource hogging, NetworkPolicies for network isolation, and RBAC Roles for access control per namespace. Don't over-namespace — most clusters need 5-20 namespaces, not hundreds.

## The Problem

- All resources in `default` namespace — no isolation, hard to manage
- Teams competing for cluster resources without limits
- No access control separation between teams/environments
- Can't apply different policies to different workloads
- Naming collisions between applications from different teams

## The Solution

### Namespace Organization Patterns

```text
Pattern 1: By Environment
├── dev
├── staging
├── production
└── (system namespaces)

Pattern 2: By Team
├── team-frontend
├── team-backend
├── team-data
├── team-ml
└── shared-infra

Pattern 3: By Application (Microservices)
├── app-ecommerce
├── app-payments
├── app-notifications
├── app-analytics
└── platform

Pattern 4: Combined (Recommended)
├── production-frontend
├── production-backend
├── staging
├── dev
├── monitoring
├── logging
├── ingress
└── cert-manager
```

### Create Namespace with Labels

```yaml
apiVersion: v1
kind: Namespace
metadata:
  name: production
  labels:
    environment: production
    team: platform
    kubernetes.io/metadata.name: production    # Auto-label (K8s 1.22+)
  annotations:
    owner: "platform-team@example.com"
    budget: "engineering"
```

### Resource Quotas

```yaml
apiVersion: v1
kind: ResourceQuota
metadata:
  name: production-quota
  namespace: production
spec:
  hard:
    requests.cpu: "20"
    requests.memory: "40Gi"
    limits.cpu: "40"
    limits.memory: "80Gi"
    pods: "100"
    services: "20"
    persistentvolumeclaims: "30"
    requests.nvidia.com/gpu: "8"
---
# Limit ranges for individual pods
apiVersion: v1
kind: LimitRange
metadata:
  name: default-limits
  namespace: production
spec:
  limits:
    - default:
        cpu: "500m"
        memory: "512Mi"
      defaultRequest:
        cpu: "100m"
        memory: "128Mi"
      max:
        cpu: "4"
        memory: "8Gi"
      min:
        cpu: "50m"
        memory: "64Mi"
      type: Container
```

### RBAC Per Namespace

```yaml
# Team can manage their namespace
apiVersion: rbac.authorization.k8s.io/v1
kind: Role
metadata:
  name: team-admin
  namespace: team-frontend
rules:
  - apiGroups: ["", "apps", "batch"]
    resources: ["*"]
    verbs: ["*"]
  - apiGroups: ["networking.k8s.io"]
    resources: ["ingresses", "networkpolicies"]
    verbs: ["*"]
---
apiVersion: rbac.authorization.k8s.io/v1
kind: RoleBinding
metadata:
  name: frontend-team-admin
  namespace: team-frontend
roleRef:
  apiGroup: rbac.authorization.k8s.io
  kind: Role
  name: team-admin
subjects:
  - kind: Group
    name: "frontend-developers"
    apiGroup: rbac.authorization.k8s.io
```

### Namespace vs Cluster: When to Separate

```text
Use Namespaces when:                    Use Separate Clusters when:
├── Same trust level                    ├── Different trust levels
├── Shared infrastructure               ├── Compliance isolation required
├── Resource quotas sufficient           ├── Different K8s versions needed
├── Network policies provide isolation  ├── Hard multi-tenancy (untrusted)
├── Same team/org                       ├── Different regions/DCs
└── Development vs staging              └── Customer-dedicated environments
```

## Common Issues

### Can't see resources — "No resources found in default namespace"
- **Cause**: Resources are in another namespace; forgot `-n` flag
- **Fix**: Use `kubectl get pods -A` (all namespaces); or set default: `kubectl config set-context --current --namespace=production`

### ResourceQuota blocking deployments
- **Cause**: Pods don't set resource requests/limits; quota requires them
- **Fix**: Add requests/limits to all pods; or set LimitRange for defaults

### Cross-namespace service access
- **Cause**: Services are namespace-scoped; need full DNS name
- **Fix**: Use `<service>.<namespace>.svc.cluster.local` for cross-namespace access

## Best Practices

1. **Never use `default` for production** — create explicit namespaces
2. **Apply ResourceQuotas** — prevent one team from consuming all resources
3. **Set LimitRange defaults** — pods without limits get sensible defaults
4. **RBAC per namespace** — teams can only access their namespaces
5. **NetworkPolicy per namespace** — default deny + explicit allows
6. **Label namespaces** — enables namespace-based NetworkPolicy selectors
7. **5-20 namespaces is typical** — don't over-namespace (one per microservice is too many)
8. **Set default namespace in context** — `kubectl config set-context --current --namespace=X`

## Key Takeaways

- Namespaces provide logical isolation: resource quotas, RBAC, network policies
- Not physical isolation — pods in different namespaces share nodes and network
- Label namespaces for NetworkPolicy cross-namespace rules
- ResourceQuota prevents resource hogging; LimitRange sets per-pod defaults
- Cross-namespace access: `<service>.<namespace>.svc.cluster.local`
- Typical patterns: by environment, by team, or combined
- Use separate clusters for hard multi-tenancy or compliance requirements
