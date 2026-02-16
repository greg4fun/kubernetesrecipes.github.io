---
draft: false
title: "OpenShift Multi-Tenant TLS: One Certificate per Tenant IngressController"
description: "Set up tenant-isolated TLS in OpenShift by assigning a dedicated certificate Secret to each IngressController."
category: "security"
difficulty: "intermediate"
timeToComplete: "20 minutes"
kubernetesVersion: "OpenShift 4.12+"
prerequisites:
  - "Cluster admin or ingress admin permissions"
  - "One IngressController per tenant"
  - "Valid certificate and private key files"
relatedRecipes:
  - "openshift-tenant-secret-rotation"
  - "openshift-deploy-new-certificate-per-tenant"
  - "cert-manager-certificates"
tags: ["openshift", "multi-tenant", "ingress", "tls", "certificates", "security"]
publishDate: "2026-02-16"
updatedDate: "2026-02-16"
author: "Luca Berton"
---

> **💡 Quick Answer:** In OpenShift multi-tenant ingress, create one `kubernetes.io/tls` Secret per tenant in `openshift-ingress`, then reference that Secret in each tenant `IngressController.spec.defaultCertificate.name`. This keeps certificate ownership and blast radius isolated by tenant.

# OpenShift Multi-Tenant TLS: One Certificate per Tenant IngressController

In a shared OpenShift cluster, each tenant should have an isolated ingress path and its own TLS certificate lifecycle. The common pattern is one `IngressController` per tenant, each pointing to its own default certificate Secret.

## Architecture Pattern

- One `IngressController` per tenant (for example: `tenant-a`, `tenant-b`)
- One router deployment per tenant (`router-tenant-a`, `router-tenant-b`)
- One TLS Secret per tenant in namespace `openshift-ingress`
- One wildcard or SAN certificate per tenant ingress domain

## 1) Verify Tenant IngressControllers

```bash
oc get ingresscontroller -n openshift-ingress-operator
```

Expected output includes one entry per tenant.

## 2) Create a Dedicated TLS Secret Per Tenant

```bash
# Tenant A
oc create secret tls tenant-a-default-cert \
  --cert=tenant-a.crt \
  --key=tenant-a.key \
  -n openshift-ingress \
  --dry-run=client -o yaml | oc apply -f -

# Tenant B
oc create secret tls tenant-b-default-cert \
  --cert=tenant-b.crt \
  --key=tenant-b.key \
  -n openshift-ingress \
  --dry-run=client -o yaml | oc apply -f -
```

Using `--dry-run=client -o yaml | oc apply -f -` is optional but recommended for safe idempotent updates.

## 3) Assign Secret to the Right IngressController

```bash
# Tenant A
oc patch ingresscontroller tenant-a \
  -n openshift-ingress-operator \
  --type=merge \
  -p '{"spec":{"defaultCertificate":{"name":"tenant-a-default-cert"}}}'

# Tenant B
oc patch ingresscontroller tenant-b \
  -n openshift-ingress-operator \
  --type=merge \
  -p '{"spec":{"defaultCertificate":{"name":"tenant-b-default-cert"}}}'
```

## 4) Validate Certificate Mapping

```bash
oc get ingresscontroller tenant-a -n openshift-ingress-operator -o jsonpath='{.spec.defaultCertificate.name}{"\n"}'
oc get ingresscontroller tenant-b -n openshift-ingress-operator -o jsonpath='{.spec.defaultCertificate.name}{"\n"}'
```

## Certificate Design Tips for Multi-Tenant Clusters

- Use distinct certificate CN/SANs per tenant domain.
- Keep private keys tenant-scoped and access-limited.
- Prefer short-lived certs with automated renewal.
- Track expiration with alerts (for example, Prometheus rules on certificate expiry metrics).

## Troubleshooting

- If the Secret exists but is not used, verify `spec.defaultCertificate.name` matches exactly.
- If handshakes still present old cert, check router rollout state with:

```bash
oc get pods -n openshift-ingress -l ingresscontroller.operator.openshift.io/deployment-ingresscontroller=tenant-a
```

## Related Recipes

- [Rotate OpenShift Tenant Secrets Safely](./openshift-tenant-secret-rotation)
- [Deploy a New Certificate for Each OpenShift Tenant](./openshift-deploy-new-certificate-per-tenant)
