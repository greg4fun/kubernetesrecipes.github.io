---
title: "External Secrets Operator on OpenShift"
description: "Manage Kubernetes secrets from external vaults using External Secrets Operator on OpenShift. Covers ExternalSecret CRD, SecretStore configuration, and GitOps"
tags:
  - "secrets"
  - "security"
  - "openshift"
  - "gitops"
  - "external-secrets"
category: "security"
publishDate: "2026-05-05"
author: "Luca Berton"
difficulty: "intermediate"
relatedRecipes:
  - "external-secrets-operator"
  - "runai-backend-architecture-openshift"
  - "nvidia-gpu-operator-gitops-openshift"
  - "kubernetes-secret-types-guide"
---

> 💡 **Quick Answer:** External Secrets Operator (ESO) syncs secrets from external vaults (HashiCorp Vault, AWS Secrets Manager, Azure Key Vault) into Kubernetes Secrets. Define `ExternalSecret` CRDs in GitOps repos — no plaintext secrets in Git, automatic rotation, audit trail.

## The Problem

In GitOps workflows, you can't store secrets in Git. You need:

- Secrets sourced from an external vault
- Automatic sync when vault values change
- No plaintext in Git repos — only references
- Multi-namespace secret distribution
- Integration with ArgoCD without manual intervention

## The Solution

### ExternalSecret Custom Resource

```yaml
apiVersion: external-secrets.io/v1
kind: ExternalSecret
metadata:
  name: app-client-secret
  namespace: app-control-plane
spec:
  refreshInterval: 1h
  secretStoreRef:
    name: vault-backend
    kind: ClusterSecretStore
  target:
    name: app-client-secret
    creationPolicy: Owner
  data:
    - secretKey: client-id
      remoteRef:
        key: secret/data/app/credentials
        property: client_id
    - secretKey: client-secret
      remoteRef:
        key: secret/data/app/credentials
        property: client_secret
```

### ClusterSecretStore (Vault Backend)

```yaml
apiVersion: external-secrets.io/v1beta1
kind: ClusterSecretStore
metadata:
  name: vault-backend
spec:
  provider:
    vault:
      server: "https://vault.example.com"
      path: "secret"
      version: "v2"
      auth:
        kubernetes:
          mountPath: "kubernetes"
          role: "external-secrets"
          serviceAccountRef:
            name: external-secrets-sa
            namespace: external-secrets
```

### GitOps Pattern (ArgoCD + ESO)

```text
Git Repository (safe to commit):
├── namespaces/
│   ├── app-control-plane/
│   │   ├── external-secret.yaml    ← Reference only (no values)
│   │   ├── deployment.yaml
│   │   └── service.yaml

Vault (actual secrets):
├── secret/data/app/credentials
│   ├── client_id: "actual-client-id"
│   └── client_secret: "actual-secret-value"

Runtime (Kubernetes):
├── Secret/app-client-secret        ← Created by ESO from Vault
│   ├── client-id: <base64>
│   └── client-secret: <base64>
```

### Multiple Environments

```yaml
# Same ExternalSecret template, different ClusterSecretStore per env
apiVersion: external-secrets.io/v1
kind: ExternalSecret
metadata:
  name: db-credentials
  namespace: production
spec:
  refreshInterval: 30m
  secretStoreRef:
    name: vault-production    # Points to prod vault path
    kind: ClusterSecretStore
  target:
    name: db-credentials
  data:
    - secretKey: username
      remoteRef:
        key: secret/data/production/database
        property: username
    - secretKey: password
      remoteRef:
        key: secret/data/production/database
        property: password
---
apiVersion: external-secrets.io/v1
kind: ExternalSecret
metadata:
  name: db-credentials
  namespace: staging
spec:
  refreshInterval: 30m
  secretStoreRef:
    name: vault-staging       # Points to staging vault path
    kind: ClusterSecretStore
  target:
    name: db-credentials
  data:
    - secretKey: username
      remoteRef:
        key: secret/data/staging/database
        property: username
    - secretKey: password
      remoteRef:
        key: secret/data/staging/database
        property: password
```

### Verify Secret Sync

```bash
# Check ExternalSecret status
oc get externalsecret -n app-control-plane
# NAME               STORE           REFRESH   STATUS
# app-client-secret  vault-backend   1h        SecretSynced

# Check the created Secret
oc get secret app-client-secret -n app-control-plane -o yaml

# Check sync events
oc describe externalsecret app-client-secret -n app-control-plane

# Force refresh
oc annotate externalsecret app-client-secret -n app-control-plane \
  force-sync=$(date +%s) --overwrite
```

### Common Use Cases in AI Platforms

```yaml
# Run:ai registry credentials
apiVersion: external-secrets.io/v1
kind: ExternalSecret
metadata:
  name: runai-reg-creds
  namespace: runai-backend
spec:
  refreshInterval: 6h
  secretStoreRef:
    name: vault-backend
    kind: ClusterSecretStore
  target:
    name: runai-reg-creds
    template:
      type: kubernetes.io/dockerconfigjson
      data:
        .dockerconfigjson: |
          {{ .dockerconfig }}
  data:
    - secretKey: dockerconfig
      remoteRef:
        key: secret/data/registry/runai
        property: dockerconfigjson
---
# OAuth2 credentials for OTel Collector
apiVersion: external-secrets.io/v1
kind: ExternalSecret
metadata:
  name: otel-oauth2-creds
  namespace: runai-backend
spec:
  refreshInterval: 1h
  secretStoreRef:
    name: vault-backend
    kind: ClusterSecretStore
  target:
    name: otel-oauth2-creds
  data:
    - secretKey: client-id
      remoteRef:
        key: secret/data/telemetry/oauth2
        property: client_id
    - secretKey: client-secret
      remoteRef:
        key: secret/data/telemetry/oauth2
        property: client_secret
```

## Common Issues

### ExternalSecret stuck in "SecretSyncedError"
- **Cause**: Vault path doesn't exist or permissions denied
- **Fix**: Verify vault policy allows the ESO service account to read the path

### Secret not updating after vault change
- **Cause**: `refreshInterval` hasn't elapsed
- **Fix**: Annotate with `force-sync` or reduce refresh interval

### ArgoCD shows Secret as "OutOfSync"
- **Cause**: ArgoCD detects the Secret (created by ESO) but doesn't manage it
- **Fix**: Add `argocd.argoproj.io/compare-options: IgnoreExtraneous` annotation

## Best Practices

1. **Never store secret values in Git** — only ExternalSecret references
2. **Use ClusterSecretStore** for shared vault backends across namespaces
3. **Set `refreshInterval`** based on rotation policy (1h default, 30m for critical)
4. **`creationPolicy: Owner`** — ESO owns the Secret lifecycle (deleted when ExternalSecret deleted)
5. **Template secrets** for specific types (dockerconfigjson, TLS, etc.)
6. **Audit vault access** — ESO service account should have minimal read-only policy

## Key Takeaways

- External Secrets Operator bridges GitOps and secret management
- ExternalSecret CRD references vault paths — safe to store in Git
- Automatic sync with configurable refresh intervals
- Works with HashiCorp Vault, AWS SM, Azure KV, GCP SM
- Essential for AI platform secrets: registry creds, OAuth2, API keys
- ArgoCD + ESO = fully declarative infrastructure without secret exposure
