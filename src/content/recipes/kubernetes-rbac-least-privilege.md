---
title: "RBAC Least Privilege Kubernetes"
description: "Configure Kubernetes RBAC with least-privilege Roles, ClusterRoles, and service account bindings. Audit permissions, restrict secrets access, and namespace-scoped roles."
publishDate: "2026-04-24"
author: "Luca Berton"
category: "security"
difficulty: "intermediate"
timeToComplete: "15 minutes"
kubernetesVersion: "1.28+"
tags:
  - rbac
  - security
  - least-privilege
  - service-account
  - roles
relatedRecipes:
  - "kubernetes-audit-logging-enterprise"
  - "pod-security-context-kubernetes"
  - "kubernetes-pod-security-admission"
  - "openshift-scc-security-context-constraints"
---

> 💡 **Quick Answer:** Use namespace-scoped `Role` (not `ClusterRole`) wherever possible, bind to specific `ServiceAccount` (not `default`), never grant `*` verbs on secrets, and audit with `kubectl auth can-i --list --as=system:serviceaccount:ns:sa`.

## The Problem

The default Kubernetes `ServiceAccount` in each namespace may have more permissions than needed. Common RBAC mistakes: granting `cluster-admin` to CI/CD pipelines, using `ClusterRoleBinding` when `RoleBinding` suffices, and wildcard verbs on sensitive resources like secrets.

## The Solution

### Application Service Account

```yaml
apiVersion: v1
kind: ServiceAccount
metadata:
  name: my-app
  namespace: production
automountServiceAccountToken: false
---
apiVersion: rbac.authorization.k8s.io/v1
kind: Role
metadata:
  name: my-app-role
  namespace: production
rules:
  - apiGroups: [""]
    resources: ["configmaps"]
    verbs: ["get", "watch"]
    resourceNames: ["my-app-config"]
  - apiGroups: [""]
    resources: ["secrets"]
    verbs: ["get"]
    resourceNames: ["my-app-tls"]
---
apiVersion: rbac.authorization.k8s.io/v1
kind: RoleBinding
metadata:
  name: my-app-binding
  namespace: production
roleRef:
  apiGroup: rbac.authorization.k8s.io
  kind: Role
  name: my-app-role
subjects:
  - kind: ServiceAccount
    name: my-app
    namespace: production
```

### CI/CD Runner (Minimal Permissions)

```yaml
apiVersion: rbac.authorization.k8s.io/v1
kind: Role
metadata:
  name: cicd-runner
  namespace: staging
rules:
  - apiGroups: ["apps"]
    resources: ["deployments"]
    verbs: ["get", "list", "patch", "update"]
  - apiGroups: [""]
    resources: ["pods"]
    verbs: ["get", "list", "watch"]
  - apiGroups: [""]
    resources: ["pods/log"]
    verbs: ["get"]
```

### Audit Permissions

```bash
# What can this service account do?
kubectl auth can-i --list \
  --as=system:serviceaccount:production:my-app \
  -n production

# Can it read secrets?
kubectl auth can-i get secrets \
  --as=system:serviceaccount:production:my-app \
  -n production

# Find overprivileged ClusterRoleBindings
kubectl get clusterrolebindings -o json | \
  jq '.items[] | select(.roleRef.name=="cluster-admin") | .subjects[]'
```

## Common Issues

**Pod can't read ConfigMaps after RBAC lockdown**

Set `automountServiceAccountToken: true` (or mount token explicitly) and ensure the Role includes the specific ConfigMap name in `resourceNames`.

**"forbidden" errors in CI/CD pipeline**

Check which ServiceAccount the runner uses and what Role is bound. Use `kubectl auth can-i` to debug.

## Best Practices

- **`automountServiceAccountToken: false`** by default — only mount when the pod needs API access
- **`resourceNames`** to restrict access to specific ConfigMaps/Secrets — not all in the namespace
- **Role (not ClusterRole)** for application workloads — namespace-scoped by default
- **Separate ServiceAccount per application** — don't share the `default` SA
- **Audit regularly** — `kubectl auth can-i --list` for each service account

## Key Takeaways

- Default ServiceAccount may have more permissions than expected — always create dedicated SAs
- Use `resourceNames` to restrict access to specific resources, not all of a type
- `automountServiceAccountToken: false` prevents unnecessary API server access
- `kubectl auth can-i` is your RBAC debugging tool
- Role + RoleBinding for namespaced access; ClusterRole + ClusterRoleBinding only when truly needed
