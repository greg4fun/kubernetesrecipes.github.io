---
title: "How to Use External Secrets Operator"
description: "Sync secrets from external providers like AWS Secrets Manager, HashiCorp Vault, and Azure Key Vault into Kubernetes using External Secrets Operator."
category: "security"
difficulty: "intermediate"
publishDate: "2026-01-22"
tags: ["secrets", "external-secrets", "vault", "aws", "security"]
---

# How to Use External Secrets Operator

External Secrets Operator (ESO) syncs secrets from external providers into Kubernetes. Centralize secret management using AWS Secrets Manager, HashiCorp Vault, Azure Key Vault, or GCP Secret Manager.

## Install External Secrets Operator

```bash
helm repo add external-secrets https://charts.external-secrets.io
helm install external-secrets external-secrets/external-secrets \
  --namespace external-secrets \
  --create-namespace
```

## AWS Secrets Manager Setup

```yaml
# aws-secret-store.yaml
apiVersion: external-secrets.io/v1beta1
kind: SecretStore
metadata:
  name: aws-secrets-manager
  namespace: default
spec:
  provider:
    aws:
      service: SecretsManager
      region: us-east-1
      auth:
        secretRef:
          accessKeyIDSecretRef:
            name: aws-credentials
            key: access-key
          secretAccessKeySecretRef:
            name: aws-credentials
            key: secret-key
---
# Create AWS credentials secret
apiVersion: v1
kind: Secret
metadata:
  name: aws-credentials
type: Opaque
stringData:
  access-key: AKIAIOSFODNN7EXAMPLE
  secret-key: wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY
```

## External Secret from AWS

```yaml
# external-secret-aws.yaml
apiVersion: external-secrets.io/v1beta1
kind: ExternalSecret
metadata:
  name: database-credentials
  namespace: default
spec:
  refreshInterval: 1h
  secretStoreRef:
    name: aws-secrets-manager
    kind: SecretStore
  target:
    name: db-secret  # Kubernetes secret to create
    creationPolicy: Owner
  data:
    - secretKey: username
      remoteRef:
        key: prod/database
        property: username
    - secretKey: password
      remoteRef:
        key: prod/database
        property: password
```

## HashiCorp Vault Setup

```yaml
# vault-secret-store.yaml
apiVersion: external-secrets.io/v1beta1
kind: SecretStore
metadata:
  name: vault-backend
  namespace: default
spec:
  provider:
    vault:
      server: "https://vault.example.com:8200"
      path: "secret"
      version: "v2"
      auth:
        kubernetes:
          mountPath: "kubernetes"
          role: "external-secrets"
          serviceAccountRef:
            name: external-secrets-sa
```

```yaml
# external-secret-vault.yaml
apiVersion: external-secrets.io/v1beta1
kind: ExternalSecret
metadata:
  name: api-keys
spec:
  refreshInterval: 15m
  secretStoreRef:
    name: vault-backend
    kind: SecretStore
  target:
    name: api-keys-secret
  data:
    - secretKey: stripe-key
      remoteRef:
        key: secret/data/api-keys
        property: stripe
    - secretKey: sendgrid-key
      remoteRef:
        key: secret/data/api-keys
        property: sendgrid
```

## ClusterSecretStore (Cluster-Wide)

```yaml
# cluster-secret-store.yaml
apiVersion: external-secrets.io/v1beta1
kind: ClusterSecretStore
metadata:
  name: global-aws-store
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
```

## Sync Entire Secret

```yaml
# sync-all-keys.yaml
apiVersion: external-secrets.io/v1beta1
kind: ExternalSecret
metadata:
  name: app-config
spec:
  refreshInterval: 30m
  secretStoreRef:
    name: aws-secrets-manager
    kind: SecretStore
  target:
    name: app-config-secret
  dataFrom:
    - extract:
        key: prod/app-config  # Sync all key-value pairs
```

## Template Secret Data

```yaml
# templated-secret.yaml
apiVersion: external-secrets.io/v1beta1
kind: ExternalSecret
metadata:
  name: database-url
spec:
  refreshInterval: 1h
  secretStoreRef:
    name: aws-secrets-manager
    kind: SecretStore
  target:
    name: database-url-secret
    template:
      engineVersion: v2
      data:
        DATABASE_URL: "postgresql://{{ .username }}:{{ .password }}@db.example.com:5432/{{ .database }}"
  data:
    - secretKey: username
      remoteRef:
        key: prod/database
        property: username
    - secretKey: password
      remoteRef:
        key: prod/database
        property: password
    - secretKey: database
      remoteRef:
        key: prod/database
        property: dbname
```

## Azure Key Vault Setup

```yaml
# azure-secret-store.yaml
apiVersion: external-secrets.io/v1beta1
kind: SecretStore
metadata:
  name: azure-keyvault
spec:
  provider:
    azurekv:
      vaultUrl: "https://my-keyvault.vault.azure.net"
      authType: ManagedIdentity
      identityId: "/subscriptions/.../userAssignedIdentities/my-identity"
```

## GCP Secret Manager Setup

```yaml
# gcp-secret-store.yaml
apiVersion: external-secrets.io/v1beta1
kind: SecretStore
metadata:
  name: gcp-secrets
spec:
  provider:
    gcpsm:
      projectID: my-gcp-project
      auth:
        workloadIdentity:
          clusterLocation: us-central1
          clusterName: my-cluster
          serviceAccountRef:
            name: external-secrets-sa
```

## Use in Deployment

```yaml
# deployment.yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: myapp
spec:
  template:
    spec:
      containers:
        - name: app
          image: myapp:v1
          envFrom:
            - secretRef:
                name: db-secret  # Created by ExternalSecret
          env:
            - name: API_KEY
              valueFrom:
                secretKeyRef:
                  name: api-keys-secret
                  key: stripe-key
```

## Check Sync Status

```bash
# List external secrets
kubectl get externalsecrets

# Check sync status
kubectl describe externalsecret database-credentials

# View created secret
kubectl get secret db-secret -o yaml
```

## Summary

External Secrets Operator bridges external secret managers with Kubernetes. Configure SecretStores for your provider, create ExternalSecrets to define sync rules, and reference the created Kubernetes secrets in your workloads. Secrets auto-refresh based on the configured interval.

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
