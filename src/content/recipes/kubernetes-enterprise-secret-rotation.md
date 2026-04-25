---
title: "Automated Secret Rotation on Kubernetes"
description: "Implement zero-downtime secret rotation with External Secrets Operator, HashiCorp Vault dynamic secrets, and rolling restarts for enterprise compliance."
publishDate: "2026-04-08"
author: "Luca Berton"
category: "security"
tags:
  - "secret-rotation"
  - "vault"
  - "external-secrets"
  - "compliance"
  - "zero-downtime"
difficulty: "advanced"
timeToComplete: "40 minutes"
relatedRecipes:
  - "kubernetes-secret-key-rotation-automation"
  - "kubernetes-secrets-management-guide"
  - "kubernetes-oidc-enterprise-sso"
  - "kubernetes-audit-logging-compliance"
---

> 💡 **Quick Answer:** Use External Secrets Operator to sync secrets from Vault/AWS Secrets Manager with `refreshInterval: 1h`. Vault dynamic secrets auto-expire. Combine with Reloader or stakater to trigger rolling restarts when secrets change — zero-downtime rotation.

## The Problem

Enterprise compliance (SOC2, PCI-DSS) requires regular secret rotation — typically every 90 days for service credentials and 24 hours for database passwords. Manual rotation is error-prone and causes outages when pods use stale credentials. You need automated rotation that updates secrets and restarts affected workloads without downtime.

```mermaid
flowchart LR
    VAULT["HashiCorp Vault<br/>(Secret Source)"] -->|"Sync every 1h"| ESO["External Secrets<br/>Operator"]
    ESO -->|"Update K8s Secret"| SECRET["Kubernetes Secret"]
    SECRET -->|"Detect change"| RELOADER["Stakater Reloader"]
    RELOADER -->|"Rolling restart"| DEPLOY["Deployment<br/>(picks up new secret)"]
    DEPLOY -->|"Zero downtime"| PODS["New Pods<br/>(fresh credentials)"]
```

## The Solution

### External Secrets Operator with Vault

```bash
# Install External Secrets Operator
helm repo add external-secrets https://charts.external-secrets.io
helm install external-secrets external-secrets/external-secrets \
  -n external-secrets --create-namespace
```

```yaml
# ClusterSecretStore pointing to Vault
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
            name: external-secrets
            namespace: external-secrets
---
# ExternalSecret with automatic refresh
apiVersion: external-secrets.io/v1beta1
kind: ExternalSecret
metadata:
  name: database-credentials
  namespace: production
spec:
  refreshInterval: 1h  # Check for updates every hour
  secretStoreRef:
    name: vault-backend
    kind: ClusterSecretStore
  target:
    name: database-credentials
    creationPolicy: Owner
    template:
      type: Opaque
      data:
        DB_HOST: "{{ .host }}"
        DB_USER: "{{ .username }}"
        DB_PASS: "{{ .password }}"
        DB_CONNECTION_STRING: "postgresql://{{ .username }}:{{ .password }}@{{ .host }}:5432/appdb"
  data:
    - secretKey: host
      remoteRef:
        key: production/database
        property: host
    - secretKey: username
      remoteRef:
        key: production/database
        property: username
    - secretKey: password
      remoteRef:
        key: production/database
        property: password
```

### Vault Dynamic Database Secrets

```bash
# Configure Vault database engine (one-time)
vault secrets enable database

vault write database/config/postgres \
  plugin_name=postgresql-database-plugin \
  connection_url="postgresql://{{username}}:{{password}}@postgres.example.com:5432/appdb" \
  allowed_roles="app-readonly,app-readwrite" \
  username="vault-admin" \
  password="vault-admin-password"

# Create role with 24h TTL (auto-rotation)
vault write database/roles/app-readwrite \
  db_name=postgres \
  creation_statements="CREATE ROLE \"{{name}}\" WITH LOGIN PASSWORD '{{password}}' VALID UNTIL '{{expiration}}'; GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO \"{{name}}\";" \
  default_ttl="24h" \
  max_ttl="48h"
```

```yaml
# ExternalSecret using Vault dynamic secrets
apiVersion: external-secrets.io/v1beta1
kind: ExternalSecret
metadata:
  name: db-dynamic-creds
  namespace: production
spec:
  refreshInterval: 12h  # Refresh before 24h TTL expires
  secretStoreRef:
    name: vault-backend
    kind: ClusterSecretStore
  target:
    name: db-dynamic-creds
    creationPolicy: Owner
  dataFrom:
    - extract:
        key: database/creds/app-readwrite
```

### Auto-Restart on Secret Change (Stakater Reloader)

```bash
# Install Reloader
helm repo add stakater https://stakater.github.io/stakater-charts
helm install reloader stakater/reloader -n kube-system
```

```yaml
# Annotate deployment to auto-restart on secret change
apiVersion: apps/v1
kind: Deployment
metadata:
  name: api-gateway
  namespace: production
  annotations:
    reloader.stakater.com/auto: "true"  # Watch all referenced secrets/configmaps
spec:
  replicas: 3
  strategy:
    type: RollingUpdate
    rollingUpdate:
      maxUnavailable: 1
      maxSurge: 1
  template:
    spec:
      containers:
        - name: api
          image: registry.example.com/api-gateway:v2.5.0
          envFrom:
            - secretRef:
                name: database-credentials
```

### Rotation Schedule

| Secret Type | Rotation Period | Method | Restart Required |
|------------|----------------|--------|-----------------|
| Database passwords | 24h | Vault dynamic secrets | Yes (Reloader) |
| API keys | 90 days | ESO refresh from Vault | Yes (Reloader) |
| TLS certificates | 90 days | cert-manager auto-renewal | No (live reload) |
| OAuth client secrets | 90 days | ESO refresh from Vault | Yes (Reloader) |
| Encryption keys | 365 days | Manual rotation + envelope encryption | No (dual-key period) |

## Common Issues

| Issue | Cause | Fix |
|-------|-------|-----|
| Pods crash after rotation | Application doesn't handle new credentials | Use connection pooling with reconnect logic |
| Vault lease expired | refreshInterval > secret TTL | Set refreshInterval to half the TTL |
| Reloader triggers too many restarts | Multiple secrets changing at once | Use `reloader.stakater.com/search: "true"` with specific annotations |
| Old pods still using old credentials | Rolling update not complete | Ensure PDB allows at least 1 pod restart |

## Best Practices

- **Dynamic secrets over static** — Vault dynamic secrets auto-expire; no rotation needed
- **Refresh before expiry** — set `refreshInterval` to half the secret TTL
- **Rolling restarts** — Reloader + RollingUpdate strategy ensures zero-downtime rotation
- **Dual-key period** — for encryption keys, support both old and new keys during transition
- **Audit secret access** — enable Vault audit log + K8s audit logging for compliance
- **Test rotation in staging** — verify applications handle credential changes gracefully

## Key Takeaways

- External Secrets Operator syncs secrets from Vault/cloud providers with automatic refresh
- Vault dynamic secrets provide time-limited credentials that auto-expire (no manual rotation)
- Stakater Reloader triggers rolling restarts when referenced secrets change
- Combine all three for fully automated, zero-downtime secret rotation
- Set refresh intervals to half the secret TTL to ensure rotation happens before expiry
