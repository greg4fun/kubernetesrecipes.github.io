---
title: "How to Configure RBAC and Service Accounts"
description: "Master Kubernetes RBAC (Role-Based Access Control) to secure your cluster. Learn to create Roles, ClusterRoles, and bind them to ServiceAccounts."
category: "security"
difficulty: "intermediate"
timeToComplete: "30 minutes"
kubernetesVersion: "1.28+"
prerequisites:
  - "A running Kubernetes cluster with RBAC enabled"
  - "kubectl configured with cluster-admin privileges"
relatedRecipes:
  - "networkpolicy-deny-all"
  - "pod-security-standards"
tags:
  - rbac
  - security
  - service-account
  - role
  - permissions
publishDate: "2026-01-21"
author: "Luca Berton"
---

> **💡 Quick Answer:** RBAC = Role (namespace) or ClusterRole (cluster-wide) + RoleBinding/ClusterRoleBinding. Create ServiceAccount: `kubectl create sa myapp`. Create Role with `rules: [{apiGroups: [""], resources: ["pods"], verbs: ["get", "list"]}]`. Bind with RoleBinding. Test permissions: `kubectl auth can-i get pods --as=system:serviceaccount:default:myapp`.

## The Problem

You need to control who (users or applications) can access what resources in your Kubernetes cluster with fine-grained permissions.

## The Solution

Implement RBAC (Role-Based Access Control) using Roles, ClusterRoles, RoleBindings, and ClusterRoleBindings to grant specific permissions.

## RBAC Concepts

| Resource | Scope | Purpose |
|----------|-------|---------|
| Role | Namespace | Grants permissions within a namespace |
| ClusterRole | Cluster | Grants permissions cluster-wide |
| RoleBinding | Namespace | Binds Role/ClusterRole to users in a namespace |
| ClusterRoleBinding | Cluster | Binds ClusterRole to users cluster-wide |

## Step 1: Create a ServiceAccount

```yaml
apiVersion: v1
kind: ServiceAccount
metadata:
  name: app-service-account
  namespace: production
```

Apply it:

```bash
kubectl apply -f service-account.yaml
```

## Step 2: Create a Role

Create a Role with specific permissions:

```yaml
apiVersion: rbac.authorization.k8s.io/v1
kind: Role
metadata:
  name: pod-reader
  namespace: production
rules:
- apiGroups: [""]
  resources: ["pods"]
  verbs: ["get", "list", "watch"]
- apiGroups: [""]
  resources: ["pods/log"]
  verbs: ["get"]
```

## Step 3: Bind the Role

Bind the Role to the ServiceAccount:

```yaml
apiVersion: rbac.authorization.k8s.io/v1
kind: RoleBinding
metadata:
  name: read-pods
  namespace: production
subjects:
- kind: ServiceAccount
  name: app-service-account
  namespace: production
roleRef:
  kind: Role
  name: pod-reader
  apiGroup: rbac.authorization.k8s.io
```

## Common RBAC Patterns

### Read-Only Access to All Resources

```yaml
apiVersion: rbac.authorization.k8s.io/v1
kind: ClusterRole
metadata:
  name: read-only
rules:
- apiGroups: [""]
  resources: ["*"]
  verbs: ["get", "list", "watch"]
- apiGroups: ["apps"]
  resources: ["*"]
  verbs: ["get", "list", "watch"]
```

### Deployment Manager

```yaml
apiVersion: rbac.authorization.k8s.io/v1
kind: Role
metadata:
  name: deployment-manager
  namespace: production
rules:
- apiGroups: ["apps"]
  resources: ["deployments"]
  verbs: ["get", "list", "watch", "create", "update", "patch", "delete"]
- apiGroups: [""]
  resources: ["pods"]
  verbs: ["get", "list", "watch"]
- apiGroups: [""]
  resources: ["services"]
  verbs: ["get", "list", "watch", "create", "update", "patch"]
```

### CI/CD Pipeline Account

```yaml
apiVersion: rbac.authorization.k8s.io/v1
kind: Role
metadata:
  name: cicd-deployer
  namespace: production
rules:
- apiGroups: ["apps"]
  resources: ["deployments", "replicasets"]
  verbs: ["get", "list", "watch", "create", "update", "patch"]
- apiGroups: [""]
  resources: ["services", "configmaps", "secrets"]
  verbs: ["get", "list", "watch", "create", "update", "patch"]
- apiGroups: [""]
  resources: ["pods"]
  verbs: ["get", "list", "watch", "delete"]
- apiGroups: ["networking.k8s.io"]
  resources: ["ingresses"]
  verbs: ["get", "list", "watch", "create", "update", "patch"]
```

## Using ServiceAccount in Pods

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: myapp
  namespace: production
spec:
  replicas: 1
  selector:
    matchLabels:
      app: myapp
  template:
    metadata:
      labels:
        app: myapp
    spec:
      serviceAccountName: app-service-account
      automountServiceAccountToken: true
      containers:
      - name: myapp
        image: myapp:latest
```

## ClusterRole for Cross-Namespace Access

```yaml
apiVersion: rbac.authorization.k8s.io/v1
kind: ClusterRole
metadata:
  name: namespace-lister
rules:
- apiGroups: [""]
  resources: ["namespaces"]
  verbs: ["get", "list", "watch"]
- apiGroups: [""]
  resources: ["pods"]
  verbs: ["get", "list"]
---
apiVersion: rbac.authorization.k8s.io/v1
kind: ClusterRoleBinding
metadata:
  name: list-namespaces
subjects:
- kind: ServiceAccount
  name: monitoring-sa
  namespace: monitoring
roleRef:
  kind: ClusterRole
  name: namespace-lister
  apiGroup: rbac.authorization.k8s.io
```

## Verifying Permissions

Check what a ServiceAccount can do:

```bash
# Check if SA can list pods
kubectl auth can-i list pods \
  --as=system:serviceaccount:production:app-service-account \
  -n production

# Check all permissions
kubectl auth can-i --list \
  --as=system:serviceaccount:production:app-service-account \
  -n production
```

## Debugging RBAC Issues

```bash
# View all roles in namespace
kubectl get roles -n production

# View role details
kubectl describe role pod-reader -n production

# View bindings
kubectl get rolebindings -n production

# Check who can perform an action
kubectl auth can-i create deployments --as=jane -n production
```

## Best Practices

### 1. Principle of Least Privilege

Only grant the minimum permissions needed:

```yaml
rules:
- apiGroups: [""]
  resources: ["pods"]
  resourceNames: ["specific-pod"]  # Limit to specific resources
  verbs: ["get"]
```

### 2. Disable Auto-Mount When Not Needed

```yaml
spec:
  automountServiceAccountToken: false
```

### 3. Use Separate ServiceAccounts Per Application

Don't use the default ServiceAccount for applications.

### 4. Audit Regularly

```bash
# List all cluster role bindings
kubectl get clusterrolebindings -o wide

# Find over-privileged bindings
kubectl get clusterrolebindings -o json | jq '.items[] | select(.roleRef.name=="cluster-admin")'
```

## Common Verbs Reference

| Verb | Description |
|------|-------------|
| get | Read a specific resource |
| list | List resources |
| watch | Watch for changes |
| create | Create new resources |
| update | Update existing resources |
| patch | Partially update resources |
| delete | Delete resources |
| deletecollection | Delete multiple resources |

## Key Takeaways

- Use Roles for namespace-scoped permissions
- Use ClusterRoles for cluster-wide permissions
- Create dedicated ServiceAccounts for each application
- Follow the principle of least privilege
- Regularly audit RBAC configurations

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
