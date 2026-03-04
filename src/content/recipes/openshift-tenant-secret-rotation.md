---
draft: false
title: "Rotate OpenShift Tenant Secrets Safely"
description: "Implement low-risk secret rotation in OpenShift multi-tenant environments using versioned Secrets and controlled rollouts."
category: "security"
difficulty: "intermediate"
timeToComplete: "25 minutes"
kubernetesVersion: "OpenShift 4.12+"
prerequisites:
  - "Access to tenant namespaces"
  - "Existing app deployment that consumes secrets"
  - "Change window or rollout policy"
relatedRecipes:
  - "openshift-multi-tenant-certificates"
  - "openshift-deploy-new-certificate-per-tenant"
  - "secrets-management-best-practices"
tags: ["openshift", "multi-tenant", "secrets", "rotation", "security", "operations"]
publishDate: "2026-02-16"
updatedDate: "2026-02-16"
author: "Luca Berton"
---

> **💡 Quick Answer:** Rotate tenant secrets with a versioned pattern (`<name>-v2`), update workloads to reference the new Secret, trigger controlled rollout, validate traffic, then retire the old Secret after rollback window.


Secret rotation in multi-tenant clusters should minimize cross-tenant impact and avoid abrupt app outages. The safest approach is versioned secrets with gradual rollout.

## Recommended Rotation Pattern

1. Create new secret version (`api-credentials-v2`).
2. Update deployment/statefulset to use the new secret name.
3. Roll out and validate tenant workloads.
4. Keep old secret briefly for rollback.
5. Remove old secret when stable.

## 1) Create the New Versioned Secret

```bash
oc -n tenant-a create secret generic api-credentials-v2 \
  --from-literal=API_KEY='new-key-value' \
  --from-literal=API_SECRET='new-secret-value' \
  --dry-run=client -o yaml | oc apply -f -
```

## 2) Update Workload Reference

```bash
oc -n tenant-a patch deployment tenant-a-app \
  --type='json' \
  -p='[
    {"op":"replace","path":"/spec/template/spec/containers/0/envFrom/0/secretRef/name","value":"api-credentials-v2"}
  ]'
```

If your manifest is GitOps-managed, commit this change in Git instead of using live patching.

## 3) Force a Rollout and Watch Health

```bash
oc rollout restart deployment/tenant-a-app -n tenant-a
oc rollout status deployment/tenant-a-app -n tenant-a --timeout=180s
oc get pods -n tenant-a
```

## 4) Validate Tenant Functionality

```bash
# Example checks
oc logs deployment/tenant-a-app -n tenant-a --tail=100
oc get events -n tenant-a --sort-by=.lastTimestamp
```

## 5) Remove Old Secret After Stabilization

```bash
oc delete secret api-credentials-v1 -n tenant-a
```

Keep old secrets until your rollback window closes.

## Operational Guardrails

- Rotate secrets tenant-by-tenant, not cluster-wide at once.
- Avoid sharing one secret across multiple tenants.
- Restrict RBAC so tenant service accounts read only tenant secrets.
- Automate secret rotation cadence and expiration checks.

## Related Recipes

- [OpenShift Multi-Tenant TLS: One Certificate per Tenant IngressController](/recipes/security/openshift-multi-tenant-certificates/)
- [Deploy a New Certificate for Each OpenShift Tenant](/recipes/security/openshift-deploy-new-certificate-per-tenant/)
