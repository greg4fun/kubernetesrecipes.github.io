---
title: "Kubernetes Namespaces: Complete Guide"
description: "Create and manage Kubernetes namespaces for multi-tenant isolation. Resource quotas, RBAC per namespace, network policies, and LimitRange configuration."
publishDate: "2026-05-02"
author: "Luca Berton"
category: "configuration"
difficulty: "beginner"
timeToComplete: "10 minutes"
kubernetesVersion: "1.28+"
tags:
  - "namespaces"
  - "multi-tenancy"
  - "rbac"
  - "resource-quotas"
  - "configuration"
relatedRecipes:
  - "resource-limits-requests"
  - "networkpolicy-deny-all"
  - "kubernetes-labels-best-practices"
  - "kubernetes-resource-quota-limitrange"
---

> 💡 **Quick Answer:** `kubectl create namespace production` creates a namespace. Use namespaces to isolate teams, environments, or applications. Apply `ResourceQuota` to limit CPU/memory per namespace, `LimitRange` for per-pod defaults, RBAC `RoleBinding` for access control, and `NetworkPolicy` for network isolation. Default namespaces: `default`, `kube-system`, `kube-public`, `kube-node-lease`.

## The Problem

Without namespaces, all resources share a flat namespace:

- Teams overwrite each other's ConfigMaps/Secrets
- No resource consumption limits per team or environment
- No network isolation between applications
- RBAC can't scope permissions per team

## The Solution

### Create and Manage Namespaces

```bash
# Create namespace
kubectl create namespace production
kubectl create namespace staging
kubectl create namespace dev

# Create from YAML
cat <<EOF | kubectl apply -f -
apiVersion: v1
kind: Namespace
metadata:
  name: production
  labels:
    env: production
    team: platform
EOF

# List namespaces
kubectl get namespaces

# Set default namespace for kubectl
kubectl config set-context --current --namespace=production

# Delete namespace (deletes ALL resources inside)
kubectl delete namespace staging
```

### Resource Quotas per Namespace

```yaml
apiVersion: v1
kind: ResourceQuota
metadata:
  name: team-quota
  namespace: production
spec:
  hard:
    requests.cpu: "10"
    requests.memory: 20Gi
    limits.cpu: "20"
    limits.memory: 40Gi
    pods: "50"
    services: "10"
    persistentvolumeclaims: "20"
    configmaps: "30"
    secrets: "30"
```

```bash
# Check quota usage
kubectl describe resourcequota team-quota -n production
# Used   Hard
# ----   ----
# cpu    3      10
# memory 8Gi    20Gi
# pods   12     50
```

### LimitRange (Per-Pod Defaults)

```yaml
apiVersion: v1
kind: LimitRange
metadata:
  name: default-limits
  namespace: production
spec:
  limits:
  - default:
      cpu: 500m
      memory: 256Mi
    defaultRequest:
      cpu: 100m
      memory: 128Mi
    max:
      cpu: "4"
      memory: 8Gi
    min:
      cpu: 50m
      memory: 64Mi
    type: Container
```

### RBAC per Namespace

```yaml
# Developer role — read/write in their namespace
apiVersion: rbac.authorization.k8s.io/v1
kind: Role
metadata:
  name: developer
  namespace: production
rules:
- apiGroups: ["", "apps", "batch"]
  resources: ["pods", "deployments", "services", "configmaps", "jobs"]
  verbs: ["get", "list", "watch", "create", "update", "delete"]
- apiGroups: [""]
  resources: ["secrets"]
  verbs: ["get", "list"]    # Read but no create/delete

---
apiVersion: rbac.authorization.k8s.io/v1
kind: RoleBinding
metadata:
  name: dev-team-binding
  namespace: production
subjects:
- kind: Group
  name: dev-team
  apiGroup: rbac.authorization.k8s.io
roleRef:
  kind: Role
  name: developer
  apiGroup: rbac.authorization.k8s.io
```

### Network Isolation

```yaml
# Default deny all traffic in namespace
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: default-deny
  namespace: production
spec:
  podSelector: {}
  policyTypes:
  - Ingress
  - Egress

---
# Allow only same-namespace traffic
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: allow-same-namespace
  namespace: production
spec:
  podSelector: {}
  ingress:
  - from:
    - podSelector: {}
  egress:
  - to:
    - podSelector: {}
  - to:    # Allow DNS
    - namespaceSelector: {}
      podSelector:
        matchLabels:
          k8s-app: kube-dns
    ports:
    - port: 53
      protocol: UDP
```

### Cross-Namespace Communication

```bash
# Services are accessible across namespaces via DNS
# Format: <service>.<namespace>.svc.cluster.local
curl http://api-service.production.svc.cluster.local:8080

# Short form (if DNS search path includes namespace)
curl http://api-service.production:8080
```

## Common Issues

**"forbidden: exceeded quota"**

ResourceQuota reached. Check usage: `kubectl describe resourcequota -n <ns>`. Request quota increase or optimize resource requests.

**Pods missing resource requests when ResourceQuota set**

When a ResourceQuota exists, ALL pods must specify requests/limits. Set a LimitRange to provide defaults.

**Can't delete namespace — stuck in Terminating**

Finalizer blocking deletion. Check: `kubectl get namespace <ns> -o yaml | grep finalizers`. Remove stuck finalizer if safe.

## Best Practices

- **One namespace per team/environment** — `team-frontend-prod`, `team-backend-staging`
- **Always set ResourceQuota** — prevents noisy-neighbor problems
- **Always set LimitRange** — provides defaults when pods forget requests
- **Default deny NetworkPolicy** — opt-in network access per namespace
- **Label namespaces** — enables namespace-level NetworkPolicy selectors

## Key Takeaways

- Namespaces provide logical isolation for multi-tenant Kubernetes clusters
- ResourceQuota limits aggregate resource usage per namespace
- LimitRange sets per-pod defaults and min/max constraints
- RBAC RoleBindings scope permissions to a specific namespace
- Cross-namespace service access: `service.namespace.svc.cluster.local`
