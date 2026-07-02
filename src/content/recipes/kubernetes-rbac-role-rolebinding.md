---
title: "K8s RBAC: Role and RoleBinding Guide"
description: "Configure Kubernetes RBAC with Role, ClusterRole, RoleBinding, and ClusterRoleBinding. Service account permissions, least privilege, and audit examples."
publishDate: "2026-05-02"
author: "Luca Berton"
category: "security"
difficulty: "intermediate"
timeToComplete: "12 minutes"
kubernetesVersion: "1.28+"
tags:
  - "rbac"
  - "security"
  - "service-accounts"
  - "cka"
  - "authorization"
relatedRecipes:
  - "kubernetes-namespace-guide"
  - "kubernetes-secret-types-guide"
  - "kubernetes-security-context-guide"
  - "kubernetes-audit-logging-guide"
  - "kubernetes-serviceaccount-guide"
---

> 💡 **Quick Answer:** RBAC uses four objects: **Role** (namespace permissions), **ClusterRole** (cluster-wide permissions), **RoleBinding** (grants Role to user/group/SA in a namespace), **ClusterRoleBinding** (grants ClusterRole cluster-wide). Create a Role with `rules: [{apiGroups: [""], resources: ["pods"], verbs: ["get", "list"]}]`, then bind it with a RoleBinding to a user or ServiceAccount.

## The Problem

Without RBAC, anyone with cluster access can do anything:

- Developers could delete production namespaces
- CI/CD service accounts could read all secrets
- No audit trail of who did what
- Compliance requirements (SOC 2, PCI-DSS) mandate least-privilege

## The Solution

### Role (Namespace-Scoped)

```yaml
apiVersion: rbac.authorization.k8s.io/v1
kind: Role
metadata:
  name: pod-reader
  namespace: production
rules:
- apiGroups: [""]           # core API group
  resources: ["pods", "pods/log"]
  verbs: ["get", "list", "watch"]
- apiGroups: ["apps"]
  resources: ["deployments"]
  verbs: ["get", "list"]

---
# Bind to a user
apiVersion: rbac.authorization.k8s.io/v1
kind: RoleBinding
metadata:
  name: read-pods
  namespace: production
subjects:
- kind: User
  name: jane@example.com
  apiGroup: rbac.authorization.k8s.io
roleRef:
  kind: Role
  name: pod-reader
  apiGroup: rbac.authorization.k8s.io
```

### ClusterRole (Cluster-Wide)

```yaml
apiVersion: rbac.authorization.k8s.io/v1
kind: ClusterRole
metadata:
  name: node-viewer
rules:
- apiGroups: [""]
  resources: ["nodes"]
  verbs: ["get", "list", "watch"]
- apiGroups: [""]
  resources: ["namespaces"]
  verbs: ["get", "list"]

---
# ClusterRoleBinding — applies everywhere
apiVersion: rbac.authorization.k8s.io/v1
kind: ClusterRoleBinding
metadata:
  name: view-nodes
subjects:
- kind: Group
  name: developers
  apiGroup: rbac.authorization.k8s.io
roleRef:
  kind: ClusterRole
  name: node-viewer
  apiGroup: rbac.authorization.k8s.io
```

### Service Account RBAC

```yaml
# Create service account
apiVersion: v1
kind: ServiceAccount
metadata:
  name: ci-deployer
  namespace: production

---
# Role for CI/CD
apiVersion: rbac.authorization.k8s.io/v1
kind: Role
metadata:
  name: deployer
  namespace: production
rules:
- apiGroups: ["apps"]
  resources: ["deployments"]
  verbs: ["get", "list", "create", "update", "patch"]
- apiGroups: [""]
  resources: ["services", "configmaps"]
  verbs: ["get", "list", "create", "update"]
- apiGroups: [""]
  resources: ["secrets"]
  verbs: ["get"]      # Read only, no create/delete

---
apiVersion: rbac.authorization.k8s.io/v1
kind: RoleBinding
metadata:
  name: ci-deployer-binding
  namespace: production
subjects:
- kind: ServiceAccount
  name: ci-deployer
  namespace: production
roleRef:
  kind: Role
  name: deployer
  apiGroup: rbac.authorization.k8s.io
```

### Common Verb Patterns

```yaml
# Read-only
verbs: ["get", "list", "watch"]

# Read-write (no delete)
verbs: ["get", "list", "watch", "create", "update", "patch"]

# Full access
verbs: ["get", "list", "watch", "create", "update", "patch", "delete"]

# Admin (includes subresources)
verbs: ["*"]

# Specific subresources
- apiGroups: [""]
  resources: ["pods/exec"]     # kubectl exec
  verbs: ["create"]
- apiGroups: [""]
  resources: ["pods/log"]      # kubectl logs
  verbs: ["get"]
- apiGroups: [""]
  resources: ["pods/portforward"]  # kubectl port-forward
  verbs: ["create"]
```

### Check Permissions

```bash
# Can I do X?
kubectl auth can-i create deployments -n production
# yes

# Can a specific user do X?
kubectl auth can-i delete pods --as=jane@example.com -n production
# no

# Can a service account do X?
kubectl auth can-i get secrets --as=system:serviceaccount:production:ci-deployer -n production
# yes

# List all permissions for current user
kubectl auth can-i --list -n production
```

### Aggregated ClusterRoles

```yaml
# Auto-aggregate into built-in roles
apiVersion: rbac.authorization.k8s.io/v1
kind: ClusterRole
metadata:
  name: custom-metrics-reader
  labels:
    rbac.authorization.k8s.io/aggregate-to-view: "true"    # Added to 'view' ClusterRole
    rbac.authorization.k8s.io/aggregate-to-edit: "true"    # Added to 'edit' ClusterRole
rules:
- apiGroups: ["custom.metrics.k8s.io"]
  resources: ["*"]
  verbs: ["get", "list"]
```

### Built-in ClusterRoles

| ClusterRole | Permissions |
|-------------|------------|
| `cluster-admin` | Full access to everything |
| `admin` | Full access within a namespace |
| `edit` | Read/write most resources (no RBAC, no ResourceQuota) |
| `view` | Read-only access (no secrets) |

```bash
# Quick namespace admin
kubectl create rolebinding jane-admin \
  --clusterrole=admin \
  --user=jane@example.com \
  -n production

# Quick read-only access
kubectl create rolebinding devs-view \
  --clusterrole=view \
  --group=developers \
  -n production
```

## Common Issues

**"forbidden: User cannot list resource"**

Missing RBAC permission. Check: `kubectl auth can-i list pods --as=<user> -n <ns>`. Add the verb/resource to the Role.

**RoleBinding in wrong namespace**

RoleBinding must be in the same namespace as the Role it references. Use ClusterRoleBinding for cross-namespace.

**ServiceAccount token not working**

K8s 1.24+ doesn't auto-create long-lived SA tokens. Use `kubectl create token <sa>` or create a Secret manually.

## Best Practices

- **Least privilege always** — start with `view`, add permissions as needed
- **Use Groups over Users** — easier to manage team permissions
- **Namespace-scoped Roles** over ClusterRoles — limit blast radius
- **Never bind `cluster-admin` to service accounts** — use specific permissions
- **Audit regularly** — `kubectl auth can-i --list` for each service account

## Key Takeaways

- Four RBAC objects: Role, ClusterRole, RoleBinding, ClusterRoleBinding
- Roles are namespace-scoped; ClusterRoles are cluster-wide
- `kubectl auth can-i` checks permissions for any user/SA
- Built-in roles (view, edit, admin) cover most common patterns
- Always follow least-privilege — grant only what's needed
