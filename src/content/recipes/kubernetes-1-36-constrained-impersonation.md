---
title: "Kubernetes 1.36 Constrained Impersonation"
description: "Use constrained impersonation in Kubernetes 1.36 to limit which identities a user can impersonate. Tighter RBAC control for multi-tenant clusters."
tags:
  - "kubernetes-1.36"
  - "rbac"
  - "security"
  - "impersonation"
  - "multi-tenancy"
category: "security"
publishDate: "2026-05-03"
author: "Luca Berton"
difficulty: "advanced"
relatedRecipes:
  - "kubernetes-rbac-guide"
  - "kubernetes-1-36-pod-certificates"
  - "kubernetes-1-36-external-sa-token-signing"
---

> 💡 **Quick Answer:** Kubernetes 1.36 introduces **Constrained Impersonation** (KEP-5284). RBAC rules can now limit *which specific users or groups* a service can impersonate, replacing the all-or-nothing impersonation model.

## The Problem

Current impersonation RBAC is too broad:

```yaml
# ❌ This grants impersonation of ANY user
apiVersion: rbac.authorization.k8s.io/v1
kind: ClusterRole
metadata:
  name: impersonator
rules:
  - apiGroups: [""]
    resources: ["users"]
    verbs: ["impersonate"]
    # No way to restrict WHICH users can be impersonated!
```

A CI/CD system that needs to impersonate `deploy-bot` can also impersonate `cluster-admin`. This is a privilege escalation vector.

## The Solution

Constrained impersonation adds `resourceNames` support for impersonation rules.

### Restrict Impersonation to Specific Users

```yaml
apiVersion: rbac.authorization.k8s.io/v1
kind: ClusterRole
metadata:
  name: ci-impersonator
rules:
  - apiGroups: [""]
    resources: ["users"]
    verbs: ["impersonate"]
    resourceNames:
      - "deploy-bot"
      - "test-runner"
  - apiGroups: [""]
    resources: ["groups"]
    verbs: ["impersonate"]
    resourceNames:
      - "system:ci-runners"
```

### Restrict Impersonation to Specific ServiceAccounts

```yaml
apiVersion: rbac.authorization.k8s.io/v1
kind: ClusterRole
metadata:
  name: namespace-admin-impersonator
rules:
  - apiGroups: [""]
    resources: ["serviceaccounts"]
    verbs: ["impersonate"]
    resourceNames:
      - "system:serviceaccount:production:deployer"
      - "system:serviceaccount:staging:deployer"
```

### Multi-Tenant Gateway Pattern

```yaml
# API gateway can only impersonate tenant-specific identities
apiVersion: rbac.authorization.k8s.io/v1
kind: ClusterRole
metadata:
  name: gateway-impersonator
rules:
  - apiGroups: [""]
    resources: ["users"]
    verbs: ["impersonate"]
    resourceNames:
      - "tenant-a-admin"
      - "tenant-b-admin"
      - "tenant-c-admin"
  - apiGroups: [""]
    resources: ["groups"]
    verbs: ["impersonate"]
    resourceNames:
      - "tenant-a-users"
      - "tenant-b-users"
      - "tenant-c-users"
  - apiGroups: ["authentication.k8s.io"]
    resources: ["userextras/tenant-id"]
    verbs: ["impersonate"]
    resourceNames:
      - "tenant-a"
      - "tenant-b"
      - "tenant-c"
---
apiVersion: rbac.authorization.k8s.io/v1
kind: ClusterRoleBinding
metadata:
  name: gateway-impersonation
subjects:
  - kind: ServiceAccount
    name: api-gateway
    namespace: gateway-system
roleRef:
  kind: ClusterRole
  name: gateway-impersonator
  apiGroup: rbac.authorization.k8s.io
```

### Using Constrained Impersonation

```bash
# Gateway service impersonates tenant user
kubectl --as=tenant-a-admin get pods -n tenant-a
# ✅ Allowed (tenant-a-admin is in resourceNames)

kubectl --as=cluster-admin get pods -n kube-system
# ❌ Forbidden (cluster-admin is NOT in resourceNames)

# Verify impersonation constraints
kubectl auth can-i impersonate users/tenant-a-admin \
  --as=system:serviceaccount:gateway-system:api-gateway
# yes

kubectl auth can-i impersonate users/cluster-admin \
  --as=system:serviceaccount:gateway-system:api-gateway
# no
```

## Common Issues

### Impersonation denied after upgrade
- **Cause**: Existing broad impersonation rules may interact differently with constrained rules
- **Fix**: Audit impersonation ClusterRoles; add explicit `resourceNames` for required identities

### CI/CD pipeline broken
- **Cause**: Pipeline impersonated a user not in the new `resourceNames` list
- **Fix**: Add the required user/SA to the constrained impersonation role

## Best Practices

1. **Always use `resourceNames`** — never grant unconstrained impersonation
2. **Audit existing impersonation roles** — `kubectl get clusterroles -o json | jq '.items[] | select(.rules[]?.verbs[]? == "impersonate")'`
3. **Use ServiceAccount identities** — more specific than user names
4. **Separate roles per tenant** — each tenant's gateway gets its own impersonation role
5. **Log impersonation events** — audit logs show who impersonated whom

## Key Takeaways

- Constrained Impersonation is available in **Kubernetes 1.36** (KEP-5284)
- `resourceNames` now works on impersonation rules — restrict which identities can be assumed
- Prevents privilege escalation through unconstrained impersonation
- Essential for multi-tenant clusters with shared API gateways
- Audit existing impersonation roles to add constraints
