---
title: "How to Use Sealed Secrets for GitOps"
description: "Encrypt Kubernetes secrets for safe Git storage with Sealed Secrets. Learn to seal, manage, and rotate secrets in GitOps workflows securely."
category: "security"
difficulty: "intermediate"
timeToComplete: "25 minutes"
kubernetesVersion: "1.28+"
prerequisites:
  - "A running Kubernetes cluster"
  - "kubectl configured with appropriate permissions"
  - "Helm 3 installed"
  - "A Git repository for GitOps"
relatedRecipes:
  - "secrets-management-best-practices"
  - "external-secrets-operator"
  - "argocd-gitops"
tags:
  - sealed-secrets
  - gitops
  - security
  - encryption
  - secrets
  - bitnami
publishDate: "2026-01-28"
author: "Luca Berton"
---

## The Problem

You want to store Kubernetes secrets in Git for GitOps workflows, but plain Secrets are base64-encoded (not encrypted) and expose sensitive data if the repository is compromised.

## The Solution

Use Bitnami Sealed Secrets to encrypt secrets client-side using a public key. Only the cluster's Sealed Secrets controller can decrypt them, making it safe to store encrypted secrets in Git.

## How Sealed Secrets Work

```
Sealed Secrets Workflow:

┌──────────────────────────────────────────────────────────────────┐
│                        DEVELOPER WORKSTATION                      │
│                                                                   │
│  ┌─────────────┐    kubeseal     ┌──────────────────┐            │
│  │   Secret    │ ───────────────►│  SealedSecret    │            │
│  │  (plain)    │   (public key)  │   (encrypted)    │            │
│  └─────────────┘                 └────────┬─────────┘            │
│                                           │                       │
└───────────────────────────────────────────┼───────────────────────┘
                                            │ git push
                                            ▼
┌──────────────────────────────────────────────────────────────────┐
│                         GIT REPOSITORY                            │
│                                                                   │
│  ┌──────────────────────────────────────────────────────┐        │
│  │  sealed-secrets/                                      │        │
│  │    ├── database-credentials.yaml (encrypted)         │        │
│  │    ├── api-keys.yaml (encrypted)                     │        │
│  │    └── tls-certs.yaml (encrypted)                    │        │
│  └──────────────────────────────────────────────────────┘        │
│                                                                   │
└───────────────────────────────────────────┼───────────────────────┘
                                            │ GitOps sync
                                            ▼
┌──────────────────────────────────────────────────────────────────┐
│                      KUBERNETES CLUSTER                           │
│                                                                   │
│  ┌─────────────────────────────────────────────────────────────┐ │
│  │  Sealed Secrets Controller                                   │ │
│  │                                                              │ │
│  │  ┌──────────────┐  decrypt   ┌─────────────┐                │ │
│  │  │ SealedSecret │ ──────────►│   Secret    │                │ │
│  │  │ (encrypted)  │ (priv key) │  (plain)    │                │ │
│  │  └──────────────┘            └─────────────┘                │ │
│  └─────────────────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────────────┘
```

## Step 1: Install Sealed Secrets Controller

### Using Helm

```bash
# Add Bitnami repo
helm repo add sealed-secrets https://bitnami-labs.github.io/sealed-secrets
helm repo update

# Install controller
helm install sealed-secrets sealed-secrets/sealed-secrets \
  --namespace kube-system \
  --set fullnameOverride=sealed-secrets-controller

# Verify installation
kubectl get pods -n kube-system -l app.kubernetes.io/name=sealed-secrets
```

### Using kubectl

```bash
kubectl apply -f https://github.com/bitnami-labs/sealed-secrets/releases/download/v0.25.0/controller.yaml

# Verify
kubectl get pods -n kube-system -l name=sealed-secrets-controller
```

## Step 2: Install kubeseal CLI

```bash
# macOS
brew install kubeseal

# Linux
KUBESEAL_VERSION=0.25.0
wget "https://github.com/bitnami-labs/sealed-secrets/releases/download/v${KUBESEAL_VERSION}/kubeseal-${KUBESEAL_VERSION}-linux-amd64.tar.gz"
tar -xvzf kubeseal-${KUBESEAL_VERSION}-linux-amd64.tar.gz
sudo install -m 755 kubeseal /usr/local/bin/kubeseal

# Verify
kubeseal --version
```

## Step 3: Fetch the Public Key

```bash
# Fetch and save the public key (for offline sealing)
kubeseal --fetch-cert \
  --controller-name=sealed-secrets-controller \
  --controller-namespace=kube-system \
  > pub-sealed-secrets.pem

# View certificate info
openssl x509 -in pub-sealed-secrets.pem -text -noout
```

## Step 4: Create and Seal Secrets

### Method 1: Seal an Existing Secret File

```yaml
# secret.yaml (DO NOT commit this!)
apiVersion: v1
kind: Secret
metadata:
  name: database-credentials
  namespace: production
type: Opaque
stringData:
  username: admin
  password: super-secret-password
  connection-string: "postgresql://admin:super-secret-password@db.example.com:5432/myapp"
```

```bash
# Seal the secret
kubeseal --format yaml < secret.yaml > sealed-secret.yaml

# Or using the public key file (offline)
kubeseal --format yaml --cert pub-sealed-secrets.pem < secret.yaml > sealed-secret.yaml

# Delete the plain secret!
rm secret.yaml
```

### Method 2: Create from Literal Values

```bash
# Create secret and seal in one command
kubectl create secret generic api-keys \
  --namespace=production \
  --dry-run=client \
  --from-literal=stripe-key=sk_live_xxx \
  --from-literal=sendgrid-key=SG.xxx \
  -o yaml | kubeseal --format yaml > sealed-api-keys.yaml
```

### Method 3: Create from Files

```bash
# Seal secrets from files
kubectl create secret generic tls-certs \
  --namespace=production \
  --dry-run=client \
  --from-file=tls.crt=./server.crt \
  --from-file=tls.key=./server.key \
  -o yaml | kubeseal --format yaml > sealed-tls-certs.yaml
```

## Sealed Secret Output

```yaml
# sealed-secret.yaml (Safe to commit!)
apiVersion: bitnami.com/v1alpha1
kind: SealedSecret
metadata:
  name: database-credentials
  namespace: production
spec:
  encryptedData:
    username: AgBy8hCi...base64-encrypted-data...
    password: AgCE9Kpl...base64-encrypted-data...
    connection-string: AgAH7xRt...base64-encrypted-data...
  template:
    metadata:
      name: database-credentials
      namespace: production
    type: Opaque
```

## Scoping Options

### Strict Scope (Default)

Sealed secret is bound to both name AND namespace:

```bash
kubeseal --format yaml --scope strict < secret.yaml > sealed-secret.yaml
```

### Namespace-Wide Scope

Can be used with any name within the namespace:

```bash
kubeseal --format yaml --scope namespace-wide < secret.yaml > sealed-secret.yaml
```

### Cluster-Wide Scope

Can be used with any name in any namespace:

```bash
kubeseal --format yaml --scope cluster-wide < secret.yaml > sealed-secret.yaml
```

### Set Scope in Secret Annotation

```yaml
apiVersion: v1
kind: Secret
metadata:
  name: my-secret
  namespace: default
  annotations:
    sealedsecrets.bitnami.com/namespace-wide: "true"
    # OR
    # sealedsecrets.bitnami.com/cluster-wide: "true"
type: Opaque
stringData:
  key: value
```

## Template Customization

### Add Labels and Annotations

```yaml
apiVersion: bitnami.com/v1alpha1
kind: SealedSecret
metadata:
  name: database-credentials
  namespace: production
spec:
  encryptedData:
    password: AgBy8hCi...
  template:
    metadata:
      name: database-credentials
      namespace: production
      labels:
        app: myapp
        environment: production
      annotations:
        description: "Database credentials managed by sealed-secrets"
    type: Opaque
```

### Create Docker Registry Secret

```bash
kubectl create secret docker-registry regcred \
  --namespace=production \
  --docker-server=registry.example.com \
  --docker-username=user \
  --docker-password=password \
  --dry-run=client -o yaml | kubeseal --format yaml > sealed-regcred.yaml
```

### Create TLS Secret

```bash
kubectl create secret tls app-tls \
  --namespace=production \
  --cert=./tls.crt \
  --key=./tls.key \
  --dry-run=client -o yaml | kubeseal --format yaml > sealed-app-tls.yaml
```

## GitOps Integration

### ArgoCD Application

```yaml
apiVersion: argoproj.io/v1alpha1
kind: Application
metadata:
  name: production-secrets
  namespace: argocd
spec:
  project: default
  source:
    repoURL: https://github.com/myorg/k8s-configs
    targetRevision: main
    path: sealed-secrets/production
  destination:
    server: https://kubernetes.default.svc
    namespace: production
  syncPolicy:
    automated:
      prune: true
      selfHeal: true
```

### Flux Kustomization

```yaml
apiVersion: kustomize.toolkit.fluxcd.io/v1
kind: Kustomization
metadata:
  name: sealed-secrets
  namespace: flux-system
spec:
  interval: 10m
  path: ./sealed-secrets
  prune: true
  sourceRef:
    kind: GitRepository
    name: flux-system
  decryption:
    provider: sops  # If using SOPS alongside
```

### Repository Structure

```
k8s-configs/
├── sealed-secrets/
│   ├── production/
│   │   ├── database-credentials.yaml
│   │   ├── api-keys.yaml
│   │   └── tls-certs.yaml
│   ├── staging/
│   │   ├── database-credentials.yaml
│   │   └── api-keys.yaml
│   └── kustomization.yaml
└── apps/
    └── ...
```

## Secret Rotation

### Update an Existing Sealed Secret

```bash
# Create new secret with updated values
kubectl create secret generic database-credentials \
  --namespace=production \
  --dry-run=client \
  --from-literal=username=admin \
  --from-literal=password=NEW-super-secret-password \
  -o yaml | kubeseal --format yaml > sealed-secret.yaml

# Commit and push
git add sealed-secret.yaml
git commit -m "Rotate database credentials"
git push

# GitOps will sync and update the secret
```

### Merge Updates (Keep Existing Keys)

```bash
# Seal only the new/changed value
echo -n "new-password" | kubeseal \
  --raw \
  --namespace production \
  --name database-credentials \
  --from-file=/dev/stdin

# Output: AgBy8hCi...encrypted...
# Manually update the encryptedData field in your sealed secret
```

## Key Management

### Backup Sealing Keys

```bash
# Backup the private key (CRITICAL!)
kubectl get secret -n kube-system \
  -l sealedsecrets.bitnami.com/sealed-secrets-key \
  -o yaml > sealed-secrets-master-key.yaml

# Store securely (NOT in Git!)
# Use a secure vault or encrypted backup
```

### Restore Keys to New Cluster

```bash
# Apply the backup key before installing controller
kubectl apply -f sealed-secrets-master-key.yaml

# Then install the controller
helm install sealed-secrets sealed-secrets/sealed-secrets \
  --namespace kube-system
```

### Key Rotation

```bash
# Controller generates new key automatically (every 30 days by default)
# Old keys are kept for decryption

# Force key rotation
kubectl annotate sealedsecret database-credentials \
  sealedsecrets.bitnami.com/managed=true \
  --overwrite

# Re-encrypt all secrets with new key
kubeseal --re-encrypt < sealed-secret.yaml > sealed-secret-new.yaml
```

### Configure Key Rotation Period

```bash
helm upgrade sealed-secrets sealed-secrets/sealed-secrets \
  --namespace kube-system \
  --set keyRenewPeriod=720h  # 30 days
```

## Multi-Cluster Setup

### Share Keys Across Clusters

```bash
# Export from source cluster
kubectl get secret -n kube-system \
  -l sealedsecrets.bitnami.com/sealed-secrets-key \
  -o yaml > sealing-key.yaml

# Apply to target cluster BEFORE installing controller
kubectl apply -f sealing-key.yaml --context target-cluster

# Install controller on target cluster
helm install sealed-secrets sealed-secrets/sealed-secrets \
  --namespace kube-system \
  --kube-context target-cluster
```

### Per-Environment Keys (Recommended)

```bash
# Fetch public key for each environment
kubeseal --fetch-cert --context prod-cluster > pub-prod.pem
kubeseal --fetch-cert --context staging-cluster > pub-staging.pem

# Seal secrets for specific environment
kubeseal --cert pub-prod.pem < secret.yaml > sealed-secret-prod.yaml
kubeseal --cert pub-staging.pem < secret.yaml > sealed-secret-staging.yaml
```

## Troubleshooting

### Check Controller Logs

```bash
kubectl logs -n kube-system -l app.kubernetes.io/name=sealed-secrets
```

### Verify SealedSecret Status

```bash
kubectl get sealedsecret database-credentials -n production -o yaml

# Check for status conditions
kubectl describe sealedsecret database-credentials -n production
```

### Common Issues

```bash
# Error: "no key could decrypt secret"
# Solution: Ensure controller has the correct private key

# Error: "namespace mismatch"
# Solution: Seal with correct namespace or use namespace-wide scope

# Error: "name mismatch" 
# Solution: Sealed secret name must match original secret name (strict scope)

# Verify secret was created
kubectl get secret database-credentials -n production
```

### Decrypt for Debugging (NOT recommended in production)

```bash
# Only if you have access to the private key
kubectl get secret -n kube-system \
  -l sealedsecrets.bitnami.com/sealed-secrets-key \
  -o jsonpath='{.items[0].data.tls\.key}' | base64 -d > private-key.pem

# Decrypt (use only for debugging!)
kubeseal --recovery-unseal --recovery-private-key private-key.pem < sealed-secret.yaml
```

## Best Practices

### 1. Never Commit Plain Secrets

```bash
# Add to .gitignore
echo "*.secret.yaml" >> .gitignore
echo "*-secret.yaml" >> .gitignore
echo "!*-sealed-secret.yaml" >> .gitignore
```

### 2. Pre-commit Hook

```bash
#!/bin/bash
# .git/hooks/pre-commit

# Check for plain Kubernetes secrets
if git diff --cached --name-only | xargs grep -l "kind: Secret" 2>/dev/null | grep -v "SealedSecret"; then
  echo "ERROR: Plain Kubernetes Secret detected!"
  echo "Please seal the secret before committing."
  exit 1
fi
```

### 3. Use Namespace-Specific Directories

```
sealed-secrets/
├── production/
├── staging/
└── development/
```

### 4. Document Secret Structure

```yaml
# sealed-secrets/production/README.md
# Database Credentials
# - username: Database admin username
# - password: Database admin password
# - connection-string: Full connection string

# To update:
# 1. Create plain secret locally
# 2. kubeseal --format yaml < secret.yaml > database-credentials.yaml
# 3. Delete plain secret
# 4. Commit and push
```

## Summary

Sealed Secrets enables secure GitOps workflows by encrypting secrets client-side. Only the cluster's controller can decrypt them, making it safe to store encrypted secrets in version control while maintaining full GitOps automation.

---

## 📘 Go Further with Kubernetes Recipes

**Love this recipe? There's so much more!** This is just one of **100+ hands-on recipes** in our comprehensive **[Kubernetes Recipes book](/book)**.

Inside the book, you'll master:
- ✅ Production-ready deployment strategies
- ✅ Advanced networking and security patterns  
- ✅ Observability, monitoring, and troubleshooting
- ✅ Real-world best practices from industry experts

> *"The practical, recipe-based approach made complex Kubernetes concepts finally click for me."*

**👉 [Get Your Copy Now](/book)** — Start building production-grade Kubernetes skills today!
