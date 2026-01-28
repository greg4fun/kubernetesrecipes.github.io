---
title: "How to Manage Kubernetes Namespaces Effectively"
description: "Master Kubernetes namespace organization for multi-team environments. Learn resource quotas, network policies, and RBAC per namespace."
category: "configuration"
difficulty: "beginner"
timeToComplete: "20 minutes"
kubernetesVersion: "1.28+"
prerequisites:
  - "A running Kubernetes cluster"
  - "kubectl configured with admin privileges"
relatedRecipes:
  - "rbac-service-accounts"
  - "resource-requests-limits"
tags:
  - namespaces
  - multi-tenancy
  - organization
  - quotas
  - isolation
publishDate: "2026-01-21"
author: "Luca Berton"
---

## The Problem

You have multiple teams or applications sharing a Kubernetes cluster and need to organize, isolate, and control resources between them.

## The Solution

Use namespaces to create logical boundaries with resource quotas, network policies, and RBAC controls.

## Understanding Namespaces

Namespaces provide:
- **Logical separation** of resources
- **Resource quota** enforcement
- **RBAC** boundaries
- **Network policy** isolation
- **Easier management** of related resources

### Default Namespaces

| Namespace | Purpose |
|-----------|---------|
| `default` | Default for resources without namespace |
| `kube-system` | Kubernetes system components |
| `kube-public` | Publicly accessible data |
| `kube-node-lease` | Node heartbeat leases |

## Creating Namespaces

### Basic Namespace

```yaml
apiVersion: v1
kind: Namespace
metadata:
  name: production
  labels:
    environment: production
    team: platform
```

### Namespace with Annotations

```yaml
apiVersion: v1
kind: Namespace
metadata:
  name: team-backend
  labels:
    team: backend
    cost-center: engineering
  annotations:
    owner: "backend-team@example.com"
    description: "Backend services for the main application"
```

Apply:
```bash
kubectl apply -f namespace.yaml
```

Or create directly:
```bash
kubectl create namespace staging
```

## Resource Quotas

Limit resources per namespace:

```yaml
apiVersion: v1
kind: ResourceQuota
metadata:
  name: compute-quota
  namespace: team-backend
spec:
  hard:
    # Compute resources
    requests.cpu: "10"
    requests.memory: "20Gi"
    limits.cpu: "20"
    limits.memory: "40Gi"
    
    # Object counts
    pods: "50"
    services: "20"
    secrets: "50"
    configmaps: "50"
    persistentvolumeclaims: "10"
    
    # Storage
    requests.storage: "100Gi"
```

Check quota usage:
```bash
kubectl describe resourcequota compute-quota -n team-backend
```

## LimitRanges

Set default and max limits for containers:

```yaml
apiVersion: v1
kind: LimitRange
metadata:
  name: default-limits
  namespace: team-backend
spec:
  limits:
  - type: Container
    default:
      cpu: "500m"
      memory: "256Mi"
    defaultRequest:
      cpu: "100m"
      memory: "128Mi"
    max:
      cpu: "2"
      memory: "2Gi"
    min:
      cpu: "50m"
      memory: "64Mi"
  - type: PersistentVolumeClaim
    max:
      storage: "10Gi"
    min:
      storage: "1Gi"
```

## Network Isolation

### Default Deny All

```yaml
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: default-deny-all
  namespace: team-backend
spec:
  podSelector: {}
  policyTypes:
  - Ingress
  - Egress
```

### Allow Within Namespace

```yaml
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: allow-same-namespace
  namespace: team-backend
spec:
  podSelector: {}
  policyTypes:
  - Ingress
  ingress:
  - from:
    - podSelector: {}  # Same namespace
```

### Allow from Specific Namespace

```yaml
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: allow-from-monitoring
  namespace: team-backend
spec:
  podSelector: {}
  policyTypes:
  - Ingress
  ingress:
  - from:
    - namespaceSelector:
        matchLabels:
          name: monitoring
```

## RBAC Per Namespace

### Namespace Admin Role

```yaml
apiVersion: rbac.authorization.k8s.io/v1
kind: Role
metadata:
  name: namespace-admin
  namespace: team-backend
rules:
- apiGroups: ["", "apps", "batch", "networking.k8s.io"]
  resources: ["*"]
  verbs: ["*"]
---
apiVersion: rbac.authorization.k8s.io/v1
kind: RoleBinding
metadata:
  name: backend-team-admin
  namespace: team-backend
subjects:
- kind: Group
  name: backend-developers
  apiGroup: rbac.authorization.k8s.io
roleRef:
  kind: Role
  name: namespace-admin
  apiGroup: rbac.authorization.k8s.io
```

### Read-Only Access

```yaml
apiVersion: rbac.authorization.k8s.io/v1
kind: Role
metadata:
  name: namespace-viewer
  namespace: team-backend
rules:
- apiGroups: ["", "apps", "batch"]
  resources: ["*"]
  verbs: ["get", "list", "watch"]
---
apiVersion: rbac.authorization.k8s.io/v1
kind: RoleBinding
metadata:
  name: qa-team-viewer
  namespace: team-backend
subjects:
- kind: Group
  name: qa-team
  apiGroup: rbac.authorization.k8s.io
roleRef:
  kind: Role
  name: namespace-viewer
  apiGroup: rbac.authorization.k8s.io
```

## Namespace Organization Strategies

### By Environment

```
├── development
├── staging
├── production
```

### By Team

```
├── team-frontend
├── team-backend
├── team-data
├── team-platform
```

### By Application

```
├── app-web
├── app-api
├── app-worker
```

### Combined Strategy

```
├── prod-frontend
├── prod-backend
├── prod-shared
├── staging-frontend
├── staging-backend
├── dev-frontend
├── dev-backend
```

## Complete Namespace Setup

```yaml
# 1. Namespace
apiVersion: v1
kind: Namespace
metadata:
  name: team-backend
  labels:
    team: backend
    environment: production
---
# 2. Resource Quota
apiVersion: v1
kind: ResourceQuota
metadata:
  name: compute-quota
  namespace: team-backend
spec:
  hard:
    requests.cpu: "10"
    requests.memory: "20Gi"
    limits.cpu: "20"
    limits.memory: "40Gi"
    pods: "50"
---
# 3. Limit Range
apiVersion: v1
kind: LimitRange
metadata:
  name: default-limits
  namespace: team-backend
spec:
  limits:
  - type: Container
    default:
      cpu: "500m"
      memory: "256Mi"
    defaultRequest:
      cpu: "100m"
      memory: "128Mi"
---
# 4. Network Policy
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: default-deny-ingress
  namespace: team-backend
spec:
  podSelector: {}
  policyTypes:
  - Ingress
---
# 5. Service Account
apiVersion: v1
kind: ServiceAccount
metadata:
  name: team-backend-sa
  namespace: team-backend
```

## Working with Namespaces

### Set Default Namespace

```bash
# Set for current context
kubectl config set-context --current --namespace=team-backend

# Or use kubens
kubens team-backend
```

### View Resources Across Namespaces

```bash
# All pods in all namespaces
kubectl get pods -A

# Specific resource across namespaces
kubectl get deployments --all-namespaces
```

### Cross-Namespace Service Access

Services can be accessed across namespaces:
```
<service-name>.<namespace>.svc.cluster.local
```

Example:
```yaml
env:
- name: DATABASE_HOST
  value: "postgres.database.svc.cluster.local"
```

## Namespace Cleanup

### Delete Namespace (and all resources)

```bash
kubectl delete namespace team-backend
```

⚠️ **Warning**: This deletes ALL resources in the namespace!

### Delete Resources But Keep Namespace

```bash
kubectl delete all --all -n team-backend
```

## Best Practices

### 1. Use Labels Consistently

```yaml
metadata:
  labels:
    team: backend
    environment: production
    cost-center: engineering
```

### 2. Always Set Resource Quotas

Prevent runaway resource consumption.

### 3. Apply Network Policies

Default to deny, explicitly allow needed traffic.

### 4. Use Namespace-Scoped RBAC

Grant minimal permissions per namespace.

### 5. Document Namespace Purpose

Use annotations for ownership and purpose.

## Key Takeaways

- Namespaces provide logical isolation in Kubernetes
- Use ResourceQuotas to limit resource consumption
- Use LimitRanges for default container limits
- Apply NetworkPolicies for network isolation
- Configure RBAC for access control per namespace

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
