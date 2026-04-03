---
title: "Fix RBAC Permission Denied Errors"
description: "Debug RBAC forbidden and unauthorized errors in Kubernetes. Covers ClusterRole vs Role scope and service account permissions."
category: "security"
difficulty: "intermediate"
publishDate: "2026-04-02"
tags: ["rbac", "forbidden", "permissions", "serviceaccount", "troubleshooting"]
author: "Luca Berton"
relatedRecipes:
  - "admission-webhooks"
  - "kubernetes-security-posture-hardening"
---

> 💡 **Quick Answer:** Debug forbidden and unauthorized errors in Kubernetes RBAC. Covers ClusterRole vs Role scope, RoleBinding targeting, service account tokens, and permission auditing.

## The Problem

This is a common issue in Kubernetes security that catches both beginners and experienced operators.

## The Solution

### Step 1: Identify the Exact Error

```bash
# Typical RBAC error
# Error from server (Forbidden): pods is forbidden: User "system:serviceaccount:default:myapp"
# cannot list resource "pods" in API group "" in the namespace "production"
```

Parse the error:
- **Who:** `system:serviceaccount:default:myapp` (ServiceAccount `myapp` in namespace `default`)
- **What:** `list pods`
- **Where:** namespace `production`

### Step 2: Check Current Permissions

```bash
# Can this SA do the thing?
kubectl auth can-i list pods -n production --as=system:serviceaccount:default:myapp
# no

# What CAN this SA do?
kubectl auth can-i --list --as=system:serviceaccount:default:myapp -n production
```

### Step 3: Fix — Create the Right Binding

```yaml
# Role (namespace-scoped)
apiVersion: rbac.authorization.k8s.io/v1
kind: Role
metadata:
  name: pod-reader
  namespace: production      # Must match target namespace
rules:
  - apiGroups: [""]
    resources: ["pods"]
    verbs: ["get", "list", "watch"]
---
# RoleBinding
apiVersion: rbac.authorization.k8s.io/v1
kind: RoleBinding
metadata:
  name: myapp-pod-reader
  namespace: production      # Must match Role namespace
subjects:
  - kind: ServiceAccount
    name: myapp
    namespace: default       # SA's home namespace
roleRef:
  kind: Role
  name: pod-reader
  apiGroup: rbac.authorization.k8s.io
```

**Key gotcha:** A RoleBinding in namespace `production` can reference a ServiceAccount from namespace `default`. The RoleBinding's namespace determines WHERE the permissions apply.

### Common Mistakes

```bash
# Wrong: ClusterRoleBinding when you need namespace-scoped
# ClusterRoleBinding grants permissions in ALL namespaces

# Wrong: Role in namespace A, RoleBinding in namespace B
# The Role and RoleBinding must be in the SAME namespace

# Wrong: Forgot to set serviceAccountName on the pod
kubectl get pod myapp-abc123 -o jsonpath='{.spec.serviceAccountName}'
# "default" — using the default SA which has no permissions
```

## Best Practices

- **Monitor proactively** with Prometheus alerts before issues become incidents
- **Document runbooks** for your team's most common failure scenarios
- **Use `kubectl describe` and events** as your first debugging tool
- **Automate recovery** where possible with operators or scripts

## Key Takeaways

- Always check events and logs first — Kubernetes tells you what's wrong
- Most issues have clear error messages pointing to the root cause
- Prevention through monitoring and proper configuration beats reactive debugging
- Keep this recipe bookmarked for quick reference during incidents
