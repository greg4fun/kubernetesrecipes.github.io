---
title: "Fix Admission Webhook Timeout Errors"
description: "Debug admission webhook failures blocking pod creation and deployments. Identify failing webhooks, check timeout settings, and implement failurePolicy correctly."
publishDate: "2026-03-19"
author: "Luca Berton"
category: "troubleshooting"
difficulty: "intermediate"
timeToComplete: "15 minutes"
kubernetesVersion: "1.28+"
tags:
  - webhook
  - admission
  - timeout
  - api-server
  - troubleshooting
relatedRecipes:
  - "operator-subscription-stuck"
  - "openshift-acs-kubernetes"
---
> 💡 **Quick Answer:** If pods fail with "Internal error: failed calling webhook", check `kubectl get validatingwebhookconfigurations` and `mutatingwebhookconfigurations`. Find the failing webhook, check if its backend pod is running, and set `failurePolicy: Ignore` temporarily to unblock the cluster.

## The Problem

Pod creation, deployments, and other API operations fail with errors like:
```
Error from server (InternalError): Internal error occurred: failed calling webhook "validate.example.com":
  Post "https://webhook-svc.my-ns.svc:443/validate": context deadline exceeded
```

An admission webhook is unreachable or timing out, blocking ALL matching API requests.

## The Solution

### Step 1: Identify the Failing Webhook

```bash
# List all validating webhooks
kubectl get validatingwebhookconfigurations
# NAME                          WEBHOOKS   AGE
# my-policy-validator           1          30d

# List all mutating webhooks
kubectl get mutatingwebhookconfigurations
# NAME                          WEBHOOKS   AGE
# my-sidecar-injector           1          30d

# Check which one is failing (look at the error message for the URL)
kubectl describe validatingwebhookconfiguration my-policy-validator
```

### Step 2: Check the Webhook Backend

```bash
# Find the Service the webhook points to
kubectl get validatingwebhookconfiguration my-policy-validator -o json | \
  jq '.webhooks[].clientConfig.service'
# {"name": "webhook-svc", "namespace": "policy-system", "port": 443}

# Check if the Service has endpoints
kubectl get endpoints webhook-svc -n policy-system
# If <none> → the webhook pod is down

# Check the pod
kubectl get pods -n policy-system -l app=webhook
kubectl logs -n policy-system -l app=webhook --since=5m
```

### Step 3: Immediate Fix — Set failurePolicy to Ignore

```bash
# Unblock the cluster by ignoring webhook failures temporarily
kubectl patch validatingwebhookconfiguration my-policy-validator --type=json \
  -p='[{"op":"replace","path":"/webhooks/0/failurePolicy","value":"Ignore"}]'
```

**failurePolicy options:**
- `Fail` (default for most) — API request is rejected if webhook is unreachable → blocks everything
- `Ignore` — API request proceeds even if webhook fails → cluster keeps working

### Step 4: Fix the Root Cause

```bash
# Restart the webhook deployment
kubectl rollout restart deploy webhook -n policy-system

# Check TLS certificates (most common issue)
kubectl get secret webhook-tls -n policy-system -o jsonpath='{.data.tls\.crt}' | \
  base64 -d | openssl x509 -noout -dates
# If expired → renew the cert

# Increase timeout if the webhook is slow but functional
kubectl patch validatingwebhookconfiguration my-policy-validator --type=json \
  -p='[{"op":"replace","path":"/webhooks/0/timeoutSeconds","value":10}]'
```

## Common Issues

### Webhook Blocks Its Own Namespace

A webhook that matches all namespaces can block operations in its own namespace, creating a deadlock:
```yaml
# Add namespace exclusion
webhooks:
  - namespaceSelector:
      matchExpressions:
        - key: kubernetes.io/metadata.name
          operator: NotIn
          values: ["policy-system"]   # Exclude webhook's own namespace
```

### Webhook Installed by Operator — Recreates After Deletion

Don't delete the webhook config — the operator will recreate it. Instead, fix the operator or scale down the operator temporarily.

## Best Practices

- **Use `failurePolicy: Ignore`** for non-critical webhooks (logging, metrics)
- **Use `failurePolicy: Fail`** only for security-critical webhooks
- **Set `timeoutSeconds: 5`** (default is 10) — fail fast rather than slow down the API
- **Exclude system namespaces** from webhook scope — prevent self-locking
- **Monitor webhook latency** with API server metrics: `apiserver_admission_webhook_admission_duration_seconds`

## Key Takeaways

- Webhook timeouts block ALL matching API operations — not just the webhook's own resources
- Check if the webhook Service has running endpoints first
- `failurePolicy: Ignore` is the emergency escape hatch
- Expired TLS certs are the #1 cause of webhook failures
- Always exclude the webhook's own namespace from its matching rules
