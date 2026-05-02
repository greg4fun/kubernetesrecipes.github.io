---
title: "External Secrets Operator: Vault and Cloud"
description: "Sync secrets from HashiCorp Vault, AWS Secrets Manager, Azure Key Vault, and GCP Secret Manager into Kubernetes with External Secrets Operator."
publishDate: "2026-05-02"
author: "Luca Berton"
category: "security"
difficulty: "intermediate"
timeToComplete: "10 minutes"
kubernetesVersion: "1.28+"
tags:
  - "secrets"
  - "vault"
  - "security"
  - "external-secrets"
  - "configuration"
relatedRecipes:
  - "kubernetes-secret-types-guide"
  - "kubernetes-cert-manager-guide"
  - "kubernetes-rbac-role-rolebinding"
---

> 💡 **Quick Answer:** External Secrets Operator (ESO) syncs secrets from external stores into Kubernetes Secrets. Install: `helm install external-secrets external-secrets/external-secrets -n external-secrets --create-namespace`. Create a `SecretStore` (provider config) + `ExternalSecret` (what to sync). Secrets auto-refresh on schedule. Supports Vault, AWS SM, Azure KV, GCP SM, 1Password, Doppler.

## The Problem

Kubernetes Secrets have limitations:

- Base64-encoded, not encrypted at rest by default
- No automatic rotation
- Hard to share across clusters
- No audit trail for secret access
- Teams already use Vault/cloud secret managers

## The Solution

### Install External Secrets Operator

```bash
helm repo add external-secrets https://charts.external-secrets.io
helm install external-secrets external-secrets/external-secrets \
  -n external-secrets --create-namespace

# Verify
kubectl get pods -n external-secrets
```

### HashiCorp Vault

```yaml
# SecretStore (namespace-scoped)
apiVersion: external-secrets.io/v1beta1
kind: SecretStore
metadata:
  name: vault
  namespace: production
spec:
  provider:
    vault:
      server: "https://vault.example.com"
      path: "secret"
      version: "v2"
      auth:
        kubernetes:
          mountPath: "kubernetes"
          role: "production-app"
          serviceAccountRef:
            name: vault-auth

---
# ExternalSecret
apiVersion: external-secrets.io/v1beta1
kind: ExternalSecret
metadata:
  name: db-credentials
  namespace: production
spec:
  refreshInterval: 1h              # Sync every hour
  secretStoreRef:
    name: vault
    kind: SecretStore
  target:
    name: db-credentials           # K8s Secret name
    creationPolicy: Owner
  data:
  - secretKey: username            # Key in K8s Secret
    remoteRef:
      key: production/database     # Vault path
      property: username           # Vault key
  - secretKey: password
    remoteRef:
      key: production/database
      property: password
```

### AWS Secrets Manager

```yaml
apiVersion: external-secrets.io/v1beta1
kind: ClusterSecretStore
metadata:
  name: aws-secrets
spec:
  provider:
    aws:
      service: SecretsManager
      region: us-east-1
      auth:
        jwt:
          serviceAccountRef:
            name: external-secrets-sa
            namespace: external-secrets

---
apiVersion: external-secrets.io/v1beta1
kind: ExternalSecret
metadata:
  name: api-keys
  namespace: production
spec:
  refreshInterval: 30m
  secretStoreRef:
    name: aws-secrets
    kind: ClusterSecretStore
  target:
    name: api-keys
  data:
  - secretKey: stripe-key
    remoteRef:
      key: production/stripe
      property: api_key
  - secretKey: sendgrid-key
    remoteRef:
      key: production/sendgrid
      property: api_key
```

### Azure Key Vault

```yaml
apiVersion: external-secrets.io/v1beta1
kind: SecretStore
metadata:
  name: azure-kv
spec:
  provider:
    azurekv:
      tenantId: "xxx-xxx-xxx"
      vaultUrl: "https://myvault.vault.azure.net"
      authSecretRef:
        clientId:
          name: azure-creds
          key: client-id
        clientSecret:
          name: azure-creds
          key: client-secret
```

### Sync Entire Secret (dataFrom)

```yaml
apiVersion: external-secrets.io/v1beta1
kind: ExternalSecret
metadata:
  name: all-db-secrets
spec:
  refreshInterval: 1h
  secretStoreRef:
    name: vault
  target:
    name: all-db-secrets
  dataFrom:
  - extract:
      key: production/database
      # All key-value pairs from this Vault path
      # become keys in the K8s Secret
```

### Template Secrets

```yaml
apiVersion: external-secrets.io/v1beta1
kind: ExternalSecret
metadata:
  name: db-connection
spec:
  secretStoreRef:
    name: vault
  target:
    name: db-connection
    template:
      engineVersion: v2
      data:
        connection-string: "postgresql://{{ .username }}:{{ .password }}@db.production:5432/mydb"
        config.yaml: |
          database:
            host: db.production
            port: 5432
            username: {{ .username }}
            password: {{ .password }}
  data:
  - secretKey: username
    remoteRef:
      key: production/database
      property: username
  - secretKey: password
    remoteRef:
      key: production/database
      property: password
```

### Check Status

```bash
# List external secrets
kubectl get externalsecret -A
# NAME             STORE   REFRESH   STATUS
# db-credentials   vault   1h        SecretSynced

# Describe for details
kubectl describe externalsecret db-credentials

# Check the created K8s Secret
kubectl get secret db-credentials -o yaml

# List secret stores
kubectl get secretstore -A
kubectl get clustersecretstore
```

## Common Issues

**ExternalSecret stuck "SecretSyncedError"**

Auth failure to external provider. Check: SecretStore auth config, RBAC/IAM permissions, network connectivity.

**Secret not updating after rotation**

`refreshInterval` not elapsed. Default is 1h. Set shorter for critical secrets. Check `status.refreshTime`.

**SecretStore "InvalidProviderConfig"**

Missing auth credentials or wrong vault URL. Verify with `kubectl describe secretstore <name>`.

## Best Practices

- **ClusterSecretStore for shared providers** — avoid duplicating config per namespace
- **Short refreshInterval for critical secrets** — 5-15m for database credentials
- **Use templates** for connection strings — avoid composing in app
- **RBAC on ExternalSecret resources** — not everyone should create them
- **Monitor sync status** — alert on SecretSyncedError

## Key Takeaways

- ESO syncs external secrets into K8s Secrets automatically
- SecretStore defines the provider, ExternalSecret defines what to sync
- Supports Vault, AWS, Azure, GCP, 1Password, Doppler, and more
- Auto-refresh on configurable interval — secrets stay up to date
- Templates enable composing connection strings from individual secret values
