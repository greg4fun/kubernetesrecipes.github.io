---
title: "Helm Secrets Mgmt with SOPS & Age Encryption"
description: "Encrypt Helm values files using SOPS with Age or GPG keys. Manage secrets in Git safely with helm-secrets plugin for transparent encrypt/decrypt workflows."
category: "helm"
difficulty: "intermediate"
publishDate: "2026-04-07"
tags: ["helm", "secrets", "sops", "encryption", "gitops"]
author: "Luca Berton"
relatedRecipes:
  - "kubernetes-cluster-autoscaler-advanced"
  - "karpenter-node-autoscaling-kubernetes"
  - "kubeflow-operator-platform"
---

> 💡 **Quick Answer:** Encrypt Helm values files using SOPS with Age or GPG keys. Manage secrets in Git safely with helm-secrets plugin for transparent encrypt/decrypt workflows.

## The Problem

Helm values files often contain database passwords, API keys, and TLS certificates. Storing them in Git as plaintext is a security risk. You need encryption at rest in Git with transparent decryption during `helm install/upgrade`.

## The Solution

### Install Tools

```bash
# Install SOPS
brew install sops  # macOS
# or download from https://github.com/getsops/sops/releases

# Install Age (modern encryption, replaces GPG)
brew install age
# or: go install filippo.io/age/cmd/...@latest

# Install helm-secrets plugin
helm plugin install https://github.com/jkroepke/helm-secrets
```

### Generate Encryption Keys

```bash
# Generate an Age key pair
age-keygen -o ~/.config/sops/age/keys.txt
# Public key: age1xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx

# For teams: each member generates their own key
# Share public keys, keep private keys secret

# Create .sops.yaml config in repo root
cat > .sops.yaml << 'EOF'
creation_rules:
  - path_regex: .*secrets.*\.yaml$
    age: >-
      age1abc123...,
      age1def456...
EOF
```

### Encrypt Values Files

```yaml
# values-secrets.yaml (before encryption)
database:
  password: super-secret-password
  connectionString: postgresql://admin:super-secret-password@db.example.com:5432/mydb
apiKeys:
  stripe: sk_live_xxxxxxxxxxxxxxxx
  sendgrid: SG.xxxxxxxxxxxxxxxxxxxx
tls:
  cert: |
    -----BEGIN CERTIFICATE-----
    MIIEpDCCA4ygAwIBAgIRAJ...
    -----END CERTIFICATE-----
  key: |
    -----BEGIN PRIVATE KEY-----
    MIIEvgIBADANBgkqhki...
    -----END PRIVATE KEY-----
```

```bash
# Encrypt the file
sops --encrypt --in-place values-secrets.yaml

# Or encrypt specific keys only (leave structure visible)
sops --encrypt --encrypted-regex '^(password|connectionString|apiKeys|cert|key)$' \
  --in-place values-secrets.yaml
```

```yaml
# values-secrets.yaml (after encryption — safe for Git)
database:
  password: ENC[AES256_GCM,data:xxxx,iv:xxxx,tag:xxxx,type:str]
  connectionString: ENC[AES256_GCM,data:xxxx,iv:xxxx,tag:xxxx,type:str]
apiKeys:
  stripe: ENC[AES256_GCM,data:xxxx,iv:xxxx,tag:xxxx,type:str]
  sendgrid: ENC[AES256_GCM,data:xxxx,iv:xxxx,tag:xxxx,type:str]
sops:
  age:
    - recipient: age1abc123...
      enc: |
        -----BEGIN AGE ENCRYPTED FILE-----
        ...
        -----END AGE ENCRYPTED FILE-----
```

### Use with Helm

```bash
# helm-secrets transparently decrypts during install/upgrade
helm secrets install my-release ./my-chart \
  --values values.yaml \
  --values values-secrets.yaml

helm secrets upgrade my-release ./my-chart \
  --values values.yaml \
  --values values-secrets.yaml

# Diff before upgrading
helm secrets diff upgrade my-release ./my-chart \
  --values values.yaml \
  --values values-secrets.yaml

# View decrypted values (for debugging)
helm secrets view values-secrets.yaml

# Edit encrypted file (decrypts in editor, re-encrypts on save)
helm secrets edit values-secrets.yaml
```

### ArgoCD Integration

```yaml
# ArgoCD with helm-secrets
apiVersion: argoproj.io/v1alpha1
kind: Application
metadata:
  name: my-app
spec:
  source:
    repoURL: https://github.com/myorg/my-app
    path: charts/my-app
    helm:
      valueFiles:
        - values.yaml
        - secrets+age-import:///helm-secrets-private-keys/keys.txt?values-secrets.yaml
---
# Mount Age keys in ArgoCD repo-server
apiVersion: v1
kind: Secret
metadata:
  name: helm-secrets-private-keys
  namespace: argocd
stringData:
  keys.txt: |
    # created: 2024-01-01
    # public key: age1abc123...
    AGE-SECRET-KEY-1XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX
```

### Flux Integration

```yaml
apiVersion: helm.toolkit.fluxcd.io/v2beta2
kind: HelmRelease
metadata:
  name: my-app
spec:
  chart:
    spec:
      chart: ./charts/my-app
      sourceRef:
        kind: GitRepository
        name: my-app
  valuesFrom:
    - kind: Secret
      name: my-app-secrets      # Decrypted by Flux SOPS integration
  decryption:
    provider: sops
    secretRef:
      name: sops-age-key
```

```mermaid
graph LR
    A[Developer] --> B[sops encrypt]
    B --> C[Encrypted values in Git]
    C --> D{Deploy tool}
    D -->|helm-secrets| E[Decrypt + helm install]
    D -->|ArgoCD| F[Decrypt + sync]
    D -->|Flux| G[Decrypt + reconcile]
    E --> H[Kubernetes Secrets]
    F --> H
    G --> H
```

## Common Issues

| Issue | Cause | Fix |
|-------|-------|-----|
| Can't decrypt | Missing Age private key | Export `SOPS_AGE_KEY_FILE` |
| Wrong key used | .sops.yaml path_regex mismatch | Check regex matches your file path |
| ArgoCD can't decrypt | Missing key in repo-server | Mount Age key as Secret volume |
| Merge conflicts in encrypted files | SOPS metadata changes | Decrypt, merge, re-encrypt |

## Best Practices

- **Use Age over GPG** — simpler key management, no keyring complexity
- **Encrypt only secrets** — use `--encrypted-regex` to keep structure visible
- **Rotate keys periodically** — update .sops.yaml and re-encrypt all files
- **Store .sops.yaml in repo** — everyone uses the same encryption config
- **Never commit plaintext secrets** — use pre-commit hooks to prevent accidents

## Key Takeaways

- SOPS + Age encrypts secrets at rest in Git — safe for version control
- helm-secrets plugin provides transparent decrypt during install/upgrade
- ArgoCD and Flux both support SOPS decryption natively
- Age keys are simpler than GPG — one file, no keyring management
- Encrypt only sensitive values to keep diffs readable
