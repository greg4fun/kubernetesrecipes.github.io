---
title: "How to Manage Kubernetes Secrets Securely"
description: "Best practices for managing secrets in Kubernetes. Learn encryption at rest, secret rotation, and integration with external secret stores."
category: "security"
difficulty: "intermediate"
publishDate: "2026-01-22"
tags: ["secrets", "security", "encryption", "best-practices", "management"]
---

# How to Manage Kubernetes Secrets Securely

Kubernetes secrets require careful handling to protect sensitive data. Learn encryption, access control, rotation strategies, and external secret management integration.

## Create Secrets Properly

```bash
# Create from literal values (avoid shell history exposure)
kubectl create secret generic db-credentials \
  --from-literal=username=admin \
  --from-literal=password='S3cur3P@ss!'

# Create from files
kubectl create secret generic tls-certs \
  --from-file=tls.crt=./server.crt \
  --from-file=tls.key=./server.key

# Create from env file
kubectl create secret generic app-secrets \
  --from-env-file=.env.production
```

## Secret Types

```yaml
# opaque-secret.yaml
apiVersion: v1
kind: Secret
metadata:
  name: app-secrets
type: Opaque
stringData:  # Use stringData for plain text (auto base64 encoded)
  api-key: "sk-1234567890"
  database-url: "postgres://user:pass@host:5432/db"
---
# docker-registry-secret.yaml
apiVersion: v1
kind: Secret
metadata:
  name: regcred
type: kubernetes.io/dockerconfigjson
data:
  .dockerconfigjson: <base64-encoded-docker-config>
---
# tls-secret.yaml
apiVersion: v1
kind: Secret
metadata:
  name: tls-secret
type: kubernetes.io/tls
data:
  tls.crt: <base64-encoded-cert>
  tls.key: <base64-encoded-key>
```

## Enable Encryption at Rest

```yaml
# /etc/kubernetes/encryption-config.yaml
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
      - identity: {}  # Fallback for reading unencrypted secrets
```

```bash
# Generate encryption key
head -c 32 /dev/urandom | base64

# Add to API server configuration
# --encryption-provider-config=/etc/kubernetes/encryption-config.yaml

# Re-encrypt existing secrets
kubectl get secrets --all-namespaces -o json | \
  kubectl replace -f -
```

## RBAC for Secrets

```yaml
# secret-rbac.yaml
apiVersion: rbac.authorization.k8s.io/v1
kind: Role
metadata:
  name: secret-reader
  namespace: production
rules:
  - apiGroups: [""]
    resources: ["secrets"]
    resourceNames: ["app-config", "db-credentials"]  # Specific secrets only
    verbs: ["get"]
---
apiVersion: rbac.authorization.k8s.io/v1
kind: RoleBinding
metadata:
  name: app-secret-reader
  namespace: production
roleRef:
  apiGroup: rbac.authorization.k8s.io
  kind: Role
  name: secret-reader
subjects:
  - kind: ServiceAccount
    name: myapp
    namespace: production
```

## Use Secrets in Pods

```yaml
# pod-with-secrets.yaml
apiVersion: v1
kind: Pod
metadata:
  name: secure-app
spec:
  serviceAccountName: myapp
  containers:
    - name: app
      image: myapp:v1
      env:
        # Single secret key as env var
        - name: DATABASE_PASSWORD
          valueFrom:
            secretKeyRef:
              name: db-credentials
              key: password
      envFrom:
        # All keys from secret as env vars
        - secretRef:
            name: app-config
      volumeMounts:
        # Mount secret as files
        - name: certs
          mountPath: /etc/ssl/certs
          readOnly: true
  volumes:
    - name: certs
      secret:
        secretName: tls-certs
        defaultMode: 0400  # Restrictive permissions
```

## Immutable Secrets

```yaml
# immutable-secret.yaml
apiVersion: v1
kind: Secret
metadata:
  name: static-config
type: Opaque
immutable: true  # Cannot be modified after creation
stringData:
  config: "static-value"
```

## Secret Rotation Strategy

```yaml
# versioned-secret.yaml
apiVersion: v1
kind: Secret
metadata:
  name: db-credentials-v2
  labels:
    app: myapp
    version: "2"
type: Opaque
stringData:
  username: admin
  password: NewSecurePassword123!
---
# Update deployment to use new secret
apiVersion: apps/v1
kind: Deployment
metadata:
  name: myapp
spec:
  template:
    metadata:
      annotations:
        # Force rollout on secret change
        secret-version: "v2"
    spec:
      containers:
        - name: app
          envFrom:
            - secretRef:
                name: db-credentials-v2
```

## Sealed Secrets (GitOps Safe)

```bash
# Install Sealed Secrets controller
kubectl apply -f https://github.com/bitnami-labs/sealed-secrets/releases/download/v0.24.0/controller.yaml

# Install kubeseal CLI
brew install kubeseal

# Create sealed secret
kubectl create secret generic my-secret \
  --from-literal=password=secret123 \
  --dry-run=client -o yaml | \
  kubeseal --format yaml > sealed-secret.yaml
```

```yaml
# sealed-secret.yaml (safe to commit to Git)
apiVersion: bitnami.com/v1alpha1
kind: SealedSecret
metadata:
  name: my-secret
  namespace: default
spec:
  encryptedData:
    password: AgBy3i4OJSWK+PiTySYZZA9rO43cGDEq...
```

## Secret Store CSI Driver

```bash
# Install Secrets Store CSI Driver
helm repo add secrets-store-csi-driver https://kubernetes-sigs.github.io/secrets-store-csi-driver/charts
helm install csi-secrets-store secrets-store-csi-driver/secrets-store-csi-driver \
  --namespace kube-system
```

```yaml
# aws-secrets-provider.yaml
apiVersion: secrets-store.csi.x-k8s.io/v1
kind: SecretProviderClass
metadata:
  name: aws-secrets
spec:
  provider: aws
  parameters:
    objects: |
      - objectName: "prod/db-credentials"
        objectType: "secretsmanager"
        jmesPath:
          - path: username
            objectAlias: db_username
          - path: password
            objectAlias: db_password
  secretObjects:
    - secretName: db-creds-k8s
      type: Opaque
      data:
        - objectName: db_username
          key: username
        - objectName: db_password
          key: password
---
# Pod using CSI secret
apiVersion: v1
kind: Pod
metadata:
  name: app
spec:
  containers:
    - name: app
      image: myapp:v1
      volumeMounts:
        - name: secrets
          mountPath: /mnt/secrets
          readOnly: true
  volumes:
    - name: secrets
      csi:
        driver: secrets-store.csi.k8s.io
        readOnly: true
        volumeAttributes:
          secretProviderClass: aws-secrets
```

## Audit Secret Access

```yaml
# audit-policy.yaml
apiVersion: audit.k8s.io/v1
kind: Policy
rules:
  - level: Metadata
    resources:
      - group: ""
        resources: ["secrets"]
    verbs: ["get", "list", "watch"]
  - level: RequestResponse
    resources:
      - group: ""
        resources: ["secrets"]
    verbs: ["create", "update", "patch", "delete"]
```

## Best Practices Checklist

```yaml
# 1. Enable encryption at rest
# 2. Use RBAC to limit secret access
# 3. Don't log secrets or print in error messages
# 4. Use short-lived secrets when possible
# 5. Rotate secrets regularly
# 6. Audit secret access
# 7. Use external secret managers for production
# 8. Never commit secrets to Git (use Sealed Secrets)
# 9. Use immutable secrets for static config
# 10. Mount secrets as files, not env vars when possible
```

## Summary

Secure secret management requires encryption at rest, strict RBAC, regular rotation, and audit logging. Use Sealed Secrets for GitOps workflows and external secret managers (AWS Secrets Manager, Vault) for production. Mount secrets as files with restrictive permissions rather than environment variables when possible.

---

## 📘 Go Further with Kubernetes Recipes

**Love this recipe? There's so much more!** This is just one of **100+ hands-on recipes** in our comprehensive **[Kubernetes Recipes book](https://amzn.to/3DzC8QA)**.

Inside the book, you'll master:
- ✅ Production-ready deployment strategies
- ✅ Advanced networking and security patterns  
- ✅ Observability, monitoring, and troubleshooting
- ✅ Real-world best practices from industry experts

> *"The practical, recipe-based approach made complex Kubernetes concepts finally click for me."*

**👉 [Get Your Copy Now](https://amzn.to/3DzC8QA)** — Start building production-grade Kubernetes skills today!
