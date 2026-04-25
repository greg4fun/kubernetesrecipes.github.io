---
draft: false
title: "Deploy a New Certificate Each OpenShift Tenant"
description: "Replace and activate new TLS certificates tenant by tenant in OpenShift IngressController deployments with verification steps and rollback guidance."
category: "security"
difficulty: "intermediate"
timeToComplete: "30 minutes"
kubernetesVersion: "OpenShift 4.12+"
prerequisites:
  - "Per-tenant IngressController already configured"
  - "New certificate and private key per tenant"
  - "Access to openshift-ingress and openshift-ingress-operator namespaces"
relatedRecipes:
  - "openshift-multi-tenant-certificates"
  - "openshift-tenant-secret-rotation"
  - "ingress-tls-certificates"
tags: ["openshift", "tls", "certificates", "ingresscontroller", "tenant", "operations"]
publishDate: "2026-02-16"
updatedDate: "2026-02-16"
author: "Luca Berton"
---

> **💡 Quick Answer:** For each tenant: create/update the TLS Secret in `openshift-ingress`, ensure the tenant `IngressController` points to it, restart only that tenant router deployment if needed, then verify served certificate SANs externally.


This workflow updates certificates safely in a multi-tenant OpenShift cluster without broad impact across tenants.

## Per-Tenant Change Workflow

1. Prepare `tls.crt` and `tls.key` for one tenant.
2. Replace (or apply) tenant TLS secret.
3. Confirm `IngressController` points to that secret.
4. Restart only tenant router deployment if old cert is still served.
5. Validate certificate chain and SANs.

## 1) Prepare Tenant Certificate Files

For each tenant domain, verify SANs include the expected ingress hostnames, for example:

- `DNS:*.apps.tenant-a.example.com`
- `DNS:*.apps.tenant-b.example.com`

## 2) Update the Tenant TLS Secret

```bash
# Tenant A
oc create secret tls tenant-a-default-cert \
  --cert=tls.crt \
  --key=tls.key \
  -n openshift-ingress \
  --dry-run=client -o yaml | oc apply -f -
```

## 3) Confirm IngressController Binding

```bash
oc get ingresscontroller tenant-a \
  -n openshift-ingress-operator \
  -o jsonpath='{.spec.defaultCertificate.name}{"\n"}'
```

If needed:

```bash
oc patch ingresscontroller tenant-a \
  -n openshift-ingress-operator \
  --type=merge \
  -p '{"spec":{"defaultCertificate":{"name":"tenant-a-default-cert"}}}'
```

## 4) Restart Only the Tenant Router (When Required)

```bash
oc rollout restart deployment/router-tenant-a -n openshift-ingress
oc rollout status deployment/router-tenant-a -n openshift-ingress --timeout=180s
```

Do not restart unrelated tenant routers.

## 5) Verify the New Certificate Is Active

```bash
# External verification
openssl s_client -connect app.tenant-a.example.com:443 -servername app.tenant-a.example.com </dev/null 2>/dev/null | openssl x509 -noout -subject -issuer -dates -ext subjectAltName

# Router logs (optional)
oc logs deployment/router-tenant-a -n openshift-ingress --tail=100
```

## Rollback

If validation fails, re-apply previous tenant secret material and repeat rollout restart only for that tenant router.

## Production Tips

- Apply one tenant at a time.
- Use maintenance windows for high-traffic tenants.
- Keep old certificate material securely until rollback window expires.
- Monitor TLS errors and HTTP 5xx during the rollout.

## Related Recipes

- [OpenShift Multi-Tenant TLS: One Certificate per Tenant IngressController](/recipes/security/openshift-multi-tenant-certificates/)
- [Rotate OpenShift Tenant Secrets Safely](/recipes/security/openshift-tenant-secret-rotation/)
