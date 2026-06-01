---
title: "Kubernetes Secrets Management Best Practices"
description: "Manage Kubernetes Secrets securely with best practices. External Secrets Operator, sealed secrets, RBAC restrictions, encryption at rest, secret rotation, and integration with HashiCorp Vault and AWS Secrets Manager."
tags:
  - "secrets"
  - "security"
  - "external-secrets"
  - "vault"
  - "encryption"
category: "security"
publishDate: "2026-06-01"
author: "Luca Berton"
difficulty: "intermediate"
relatedRecipes:
  - "kubernetes-rbac-role-based-access-control"
  - "kubernetes-configmap-management"
  - "kubernetes-security-checklist"
---

> 💡 **Quick Answer:** Kubernetes Secrets are base64-encoded (NOT encrypted) by default. For production: 1) Enable encryption at rest (`EncryptionConfiguration`), 2) Use External Secrets Operator to sync from Vault/AWS/GCP, 3) Restrict access with RBAC, 4) Never commit Secrets to Git, 5) Mount as volumes (not env vars) for rotation support. Sealed Secrets allows safe Git storage via asymmetric encryption.

## The Problem

- Kubernetes Secrets are only base64-encoded — anyone with RBAC access can decode them
- Secrets stored in etcd unencrypted by default
- Can't commit Secrets to Git (GitOps anti-pattern)
- No built-in secret rotation mechanism
- Need to sync secrets from external vaults (HashiCorp Vault, AWS SM, GCP SM)
- `kubectl get secret -o yaml` exposes values to anyone with read access

## The Solution

### Enable Encryption at Rest

```yaml
# /etc/kubernetes/encryption-config.yaml (on control plane)
apiVersion: apiserver.config.k8s.io/v1
kind: EncryptionConfiguration
resources:
  - resources:
      - secrets
    providers:
      - aescbc:
          keys:
            - name: key1
              secret: <base64-encoded-32-byte-key>
      - identity: {}    # Fallback for reading unencrypted secrets
```

```bash
# Generate encryption key
head -c 32 /dev/urandom | base64

# Add to kube-apiserver:
# --encryption-provider-config=/etc/kubernetes/encryption-config.yaml

# Re-encrypt existing secrets
kubectl get secrets -A -o json | kubectl replace -f -
```

### External Secrets Operator (ESO)

```bash
helm repo add external-secrets https://charts.external-secrets.io
helm install external-secrets external-secrets/external-secrets \
  --namespace external-secrets --create-namespace
```

```yaml
# Connect to AWS Secrets Manager
apiVersion: external-secrets.io/v1beta1
kind: SecretStore
metadata:
  name: aws-secrets
  namespace: production
spec:
  provider:
    aws:
      service: SecretsManager
      region: eu-west-1
      auth:
        jwt:
          serviceAccountRef:
            name: external-secrets-sa
---
# Sync specific secret from AWS
apiVersion: external-secrets.io/v1beta1
kind: ExternalSecret
metadata:
  name: db-credentials
  namespace: production
spec:
  refreshInterval: 1h              # Sync every hour
  secretStoreRef:
    name: aws-secrets
    kind: SecretStore
  target:
    name: db-credentials           # K8s Secret name created
    creationPolicy: Owner
  data:
    - secretKey: username           # Key in K8s Secret
      remoteRef:
        key: production/database   # AWS SM secret name
        property: username          # JSON key in AWS secret
    - secretKey: password
      remoteRef:
        key: production/database
        property: password
```

### External Secrets with HashiCorp Vault

```yaml
apiVersion: external-secrets.io/v1beta1
kind: SecretStore
metadata:
  name: vault-store
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
            name: vault-auth-sa
---
apiVersion: external-secrets.io/v1beta1
kind: ExternalSecret
metadata:
  name: app-secrets
  namespace: production
spec:
  refreshInterval: 15m
  secretStoreRef:
    name: vault-store
    kind: SecretStore
  target:
    name: app-secrets
  data:
    - secretKey: API_KEY
      remoteRef:
        key: secret/data/production/api
        property: key
    - secretKey: DB_PASSWORD
      remoteRef:
        key: secret/data/production/database
        property: password
```

### Sealed Secrets (GitOps-Safe)

```bash
# Install controller
helm repo add sealed-secrets https://bitnami-labs.github.io/sealed-secrets
helm install sealed-secrets sealed-secrets/sealed-secrets \
  --namespace kube-system

# Install kubeseal CLI
brew install kubeseal

# Seal a secret (safe to commit to Git)
kubectl create secret generic db-creds \
  --from-literal=password=supersecret \
  --dry-run=client -o yaml | \
  kubeseal --format yaml > sealed-db-creds.yaml

# Apply sealed secret → controller decrypts → creates real Secret
kubectl apply -f sealed-db-creds.yaml
```

```yaml
# sealed-db-creds.yaml (safe for Git)
apiVersion: bitnami.com/v1alpha1
kind: SealedSecret
metadata:
  name: db-creds
  namespace: production
spec:
  encryptedData:
    password: AgBR7h5Z3...encrypted...base64...
```

### RBAC: Restrict Secret Access

```yaml
# Only allow specific ServiceAccount to read secrets
apiVersion: rbac.authorization.k8s.io/v1
kind: Role
metadata:
  name: secret-reader
  namespace: production
rules:
  - apiGroups: [""]
    resources: ["secrets"]
    resourceNames: ["app-secrets", "db-credentials"]  # Specific secrets only
    verbs: ["get"]
---
# Deny secret listing for most users
apiVersion: rbac.authorization.k8s.io/v1
kind: Role
metadata:
  name: developer
  namespace: production
rules:
  - apiGroups: [""]
    resources: ["pods", "services", "configmaps"]
    verbs: ["*"]
  # NO secrets access
```

### Mount as Volume (Supports Rotation)

```yaml
spec:
  containers:
    - name: app
      volumeMounts:
        - name: secrets
          mountPath: /etc/secrets
          readOnly: true
  volumes:
    - name: secrets
      secret:
        secretName: app-secrets
        # Files updated automatically when Secret changes
        # (kubelet sync period: ~1 min)
```

## Common Issues

### Secret not syncing from external store
- **Cause**: Auth misconfigured; IAM role missing permissions; network can't reach vault
- **Fix**: Check ExternalSecret status: `kubectl get externalsecret -o yaml`; verify SecretStore connectivity

### "Error creating: secrets is forbidden" after RBAC restriction
- **Cause**: ServiceAccount lacks create/update permission on secrets
- **Fix**: Add appropriate RBAC rules; check which SA the pod uses

### Sealed Secret not decrypting
- **Cause**: Wrong namespace (sealed secrets are namespace-scoped by default); or controller key rotated
- **Fix**: Re-seal with correct namespace; or use `--scope cluster-wide`

### env vars not updating after secret rotation
- **Cause**: Env vars from secrets are set at pod creation — not live-updated
- **Fix**: Use volume mounts (auto-updated by kubelet); or restart pods after rotation

## Best Practices

1. **Never commit plain Secrets to Git** — use Sealed Secrets or External Secrets
2. **Enable encryption at rest** — protects against etcd compromise
3. **External Secrets Operator** — single source of truth in Vault/AWS/GCP
4. **Mount as volumes, not env vars** — supports automatic rotation
5. **RBAC with `resourceNames`** — restrict to specific secrets, not all
6. **Rotate secrets regularly** — ESO `refreshInterval` automates this
7. **Audit secret access** — enable Kubernetes audit logging for secret reads
8. **Don't log secret values** — ensure apps don't print secrets to stdout

## Key Takeaways

- K8s Secrets are base64-encoded only — not encrypted by default
- Enable `EncryptionConfiguration` for at-rest encryption in etcd
- External Secrets Operator syncs from Vault/AWS/GCP/Azure → K8s Secrets
- Sealed Secrets: encrypt secrets client-side, safe to commit to Git
- Volume mounts update automatically; env vars require pod restart
- RBAC `resourceNames` limits access to specific named secrets
- `refreshInterval` in ExternalSecret enables automatic rotation
