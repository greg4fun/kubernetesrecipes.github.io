---
title: "Kyverno ReBAC Multi-Tenant RBAC Automation"
description: "Implement Relationship-Based Access Control (ReBAC) with Kyverno to automate multi-tenant RBAC at scale: dynamic RoleBindings, namespace"
tags:
  - "kyverno"
  - "rbac"
  - "multi-tenancy"
  - "rebac"
  - "automation"
category: "security"
publishDate: "2026-05-06"
author: "Luca Berton"
difficulty: "advanced"
relatedRecipes:
  - "kyverno-cel-policy-model"
  - "kyverno-iso27001-compliance"
  - "kyverno-drift-prevention-gitops"
  - "kubernetes-rbac-role-clusterrole"
---

> 💡 **Quick Answer:** Use Kyverno's `generate` rules to implement ReBAC (Relationship-Based Access Control) — automatically creating RoleBindings, NetworkPolicies, and ResourceQuotas when namespaces are created, based on tenant labels and hierarchical relationships.

## The Problem

At scale (100+ tenants, 500+ namespaces), manual RBAC management:

- Doesn't scale — too many RoleBindings to maintain by hand
- Creates drift — forgot to create binding in new namespace
- Lacks hierarchy — parent org should inherit access to child namespaces
- No relationship model — team A can access team B's namespace (how?)

## The Solution

### Automatic RoleBinding Generation on Namespace Create

```yaml
apiVersion: kyverno.io/v1
kind: ClusterPolicy
metadata:
  name: rebac-namespace-rbac
spec:
  rules:
    - name: generate-tenant-admin-binding
      match:
        any:
          - resources:
              kinds:
                - Namespace
              selector:
                matchExpressions:
                  - key: tenant
                    operator: Exists
      generate:
        apiVersion: rbac.authorization.k8s.io/v1
        kind: RoleBinding
        name: "tenant-admin"
        namespace: "{{ request.object.metadata.name }}"
        synchronize: true
        data:
          metadata:
            labels:
              managed-by: kyverno-rebac
              tenant: "{{ request.object.metadata.labels.tenant }}"
          roleRef:
            apiGroup: rbac.authorization.k8s.io
            kind: ClusterRole
            name: admin
          subjects:
            - apiGroup: rbac.authorization.k8s.io
              kind: Group
              name: "tenant-{{ request.object.metadata.labels.tenant }}-admins"

    - name: generate-tenant-viewer-binding
      match:
        any:
          - resources:
              kinds:
                - Namespace
              selector:
                matchExpressions:
                  - key: tenant
                    operator: Exists
      generate:
        apiVersion: rbac.authorization.k8s.io/v1
        kind: RoleBinding
        name: "tenant-viewer"
        namespace: "{{ request.object.metadata.name }}"
        synchronize: true
        data:
          roleRef:
            apiGroup: rbac.authorization.k8s.io
            kind: ClusterRole
            name: view
          subjects:
            - apiGroup: rbac.authorization.k8s.io
              kind: Group
              name: "tenant-{{ request.object.metadata.labels.tenant }}-viewers"
```

### Hierarchical Tenant Access (Parent → Child)

```yaml
apiVersion: kyverno.io/v1
kind: ClusterPolicy
metadata:
  name: rebac-hierarchy
spec:
  rules:
    - name: parent-org-access
      match:
        any:
          - resources:
              kinds:
                - Namespace
              selector:
                matchExpressions:
                  - key: org
                    operator: Exists
                  - key: team
                    operator: Exists
      generate:
        apiVersion: rbac.authorization.k8s.io/v1
        kind: RoleBinding
        name: "org-admin-access"
        namespace: "{{ request.object.metadata.name }}"
        synchronize: true
        data:
          metadata:
            labels:
              rebac/relationship: "org-to-team"
              rebac/org: "{{ request.object.metadata.labels.org }}"
          roleRef:
            apiGroup: rbac.authorization.k8s.io
            kind: ClusterRole
            name: admin
          subjects:
            - apiGroup: rbac.authorization.k8s.io
              kind: Group
              name: "org-{{ request.object.metadata.labels.org }}-admins"
```

### Auto-Generate NetworkPolicy per Tenant

```yaml
apiVersion: kyverno.io/v1
kind: ClusterPolicy
metadata:
  name: rebac-network-isolation
spec:
  rules:
    - name: tenant-network-isolation
      match:
        any:
          - resources:
              kinds:
                - Namespace
              selector:
                matchExpressions:
                  - key: tenant
                    operator: Exists
      generate:
        apiVersion: networking.k8s.io/v1
        kind: NetworkPolicy
        name: "tenant-isolation"
        namespace: "{{ request.object.metadata.name }}"
        synchronize: true
        data:
          spec:
            podSelector: {}
            policyTypes:
              - Ingress
              - Egress
            ingress:
              - from:
                  - namespaceSelector:
                      matchLabels:
                        tenant: "{{ request.object.metadata.labels.tenant }}"
                  - namespaceSelector:
                      matchLabels:
                        kubernetes.io/metadata.name: "ingress-nginx"
            egress:
              - to:
                  - namespaceSelector:
                      matchLabels:
                        tenant: "{{ request.object.metadata.labels.tenant }}"
              - to:
                  - namespaceSelector:
                      matchLabels:
                        kubernetes.io/metadata.name: "kube-dns"
                ports:
                  - port: 53
                    protocol: UDP
```

### Auto-Generate ResourceQuota per Tenant

```yaml
apiVersion: kyverno.io/v1
kind: ClusterPolicy
metadata:
  name: rebac-resource-quota
spec:
  rules:
    - name: standard-tenant-quota
      match:
        any:
          - resources:
              kinds:
                - Namespace
              selector:
                matchLabels:
                  tenant-tier: standard
      generate:
        apiVersion: v1
        kind: ResourceQuota
        name: "tenant-quota"
        namespace: "{{ request.object.metadata.name }}"
        synchronize: true
        data:
          spec:
            hard:
              requests.cpu: "8"
              requests.memory: "32Gi"
              limits.cpu: "16"
              limits.memory: "64Gi"
              pods: "50"
              services: "20"
              persistentvolumeclaims: "10"

    - name: premium-tenant-quota
      match:
        any:
          - resources:
              kinds:
                - Namespace
              selector:
                matchLabels:
                  tenant-tier: premium
      generate:
        apiVersion: v1
        kind: ResourceQuota
        name: "tenant-quota"
        namespace: "{{ request.object.metadata.name }}"
        synchronize: true
        data:
          spec:
            hard:
              requests.cpu: "32"
              requests.memory: "128Gi"
              limits.cpu: "64"
              limits.memory: "256Gi"
              pods: "200"
              services: "50"
              persistentvolumeclaims: "50"
              requests.nvidia.com/gpu: "8"
```

### Onboarding a New Tenant

```bash
# Single command creates everything via Kyverno generate rules:
kubectl create namespace team-alpha \
  --dry-run=client -o yaml | \
  kubectl label -f - --local \
    tenant=alpha \
    org=engineering \
    team=alpha \
    tenant-tier=premium \
    compliance/iso27001=true \
  -o yaml | kubectl apply -f -

# Kyverno automatically generates:
# ✅ RoleBinding: tenant-admin (Group: tenant-alpha-admins → admin)
# ✅ RoleBinding: tenant-viewer (Group: tenant-alpha-viewers → view)
# ✅ RoleBinding: org-admin-access (Group: org-engineering-admins → admin)
# ✅ NetworkPolicy: tenant-isolation (only alpha namespaces can talk)
# ✅ ResourceQuota: tenant-quota (premium tier limits)
```

## Common Issues

### Generated resources not created
- **Cause**: Kyverno controller doesn't have RBAC to create RoleBindings
- **Fix**: Ensure Kyverno ClusterRole includes `rbac.authorization.k8s.io` permissions

### synchronize: true causes unwanted overwrites
- **Cause**: Manual edits to generated resources get reverted
- **Fix**: Use `synchronize: false` if tenants need to customize; or use labels to exclude

### Group names don't match IdP
- **Cause**: IdP groups use different naming convention
- **Fix**: Adjust `subjects[].name` template to match IdP group format

## Best Practices

1. **Labels are your relationship model** — `tenant`, `org`, `team`, `tier`
2. **`synchronize: true`** ensures drift correction (generated resources match policy)
3. **Hierarchical labels** enable parent→child access patterns
4. **One namespace = one tenant unit** — don't mix tenants per namespace
5. **Test with `kyverno apply`** before deploying policies
6. **Audit generated resources** periodically for orphans

## Key Takeaways

- ReBAC in Kubernetes = labels on namespaces + Kyverno generate rules
- Single namespace creation triggers all access controls automatically
- Hierarchy: org→team relationship via label matching in generate rules
- NetworkPolicy generation ensures tenant network isolation by default
- ResourceQuota generation prevents tenant resource abuse
- `synchronize: true` = continuous enforcement (no drift)
- Scales to 1000+ namespaces without manual RoleBinding management
