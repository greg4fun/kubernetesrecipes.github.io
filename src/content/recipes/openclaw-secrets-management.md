---
title: "Secure Secrets Management for OpenClaw"
description: "Manage API keys, bot tokens, and credentials for OpenClaw on Kubernetes using Kubernetes Secrets, External Secrets Operator, and Sealed Secrets."
category: "security"
difficulty: "intermediate"
timeToComplete: "20 minutes"
kubernetesVersion: "1.28+"
prerequisites:
  - "OpenClaw deployed on Kubernetes"
  - "kubectl configured with cluster-admin permissions"
relatedRecipes:
  - "sealed-secrets-gitops"
  - "update-ca-certificates-kubernetes"
  - "openclaw-networkpolicy-security"
  - "openclaw-kubernetes-deployment"
  - "external-secrets-operator"
  - "oidc-authentication-kubernetes"
tags:
  - openclaw
  - secrets
  - security
  - api-keys
  - vault
  - external-secrets
publishDate: "2026-02-26"
author: "Luca Berton"
---

> 💡 **Quick Answer:** Store API keys (Anthropic, OpenAI) and bot tokens (Discord, Telegram) in Kubernetes Secrets. Reference them as `envFrom.secretRef` in your OpenClaw deployment. For production, use External Secrets Operator to sync from AWS Secrets Manager, HashiCorp Vault, or GCP Secret Manager.
>
> ```yaml
> envFrom:
>   - secretRef:
>       name: openclaw-secrets
> ```
>
> **Key concept:** OpenClaw reads API keys from environment variables. Kubernetes Secrets inject these variables securely without embedding them in ConfigMaps or YAML.
>
> **Gotcha:** Kubernetes Secrets are base64-encoded, not encrypted. Use RBAC to restrict access, or use Sealed Secrets/External Secrets for true encryption.

## The Problem

OpenClaw needs multiple credentials:

- **AI provider keys** — Anthropic, OpenAI, Google
- **Bot tokens** — Discord, Telegram
- **Third-party APIs** — Weather, email, calendar integrations
- Hardcoding these in ConfigMaps or deployment YAML is insecure

## The Solution

Use Kubernetes Secrets with optional External Secrets Operator for centralized, encrypted secret management.

## Method 1: Kubernetes Secrets (Basic)

```yaml
# openclaw-secrets.yaml
apiVersion: v1
kind: Secret
metadata:
  name: openclaw-secrets
  namespace: openclaw
type: Opaque
stringData:
  ANTHROPIC_API_KEY: "sk-ant-your-key-here"
  DISCORD_TOKEN: "your-discord-bot-token"
  TELEGRAM_BOT_TOKEN: "123456789:ABCdef"
  OPENAI_API_KEY: "sk-your-openai-key"
  BRAVE_SEARCH_API_KEY: "BSA-your-key"
```

## Method 2: External Secrets Operator

```yaml
# Install ESO
# helm install external-secrets external-secrets/external-secrets -n external-secrets --create-namespace

# external-secret.yaml
apiVersion: external-secrets.io/v1beta1
kind: ExternalSecret
metadata:
  name: openclaw-secrets
  namespace: openclaw
spec:
  refreshInterval: 1h
  secretStoreRef:
    name: aws-secretsmanager
    kind: ClusterSecretStore
  target:
    name: openclaw-secrets
    creationPolicy: Owner
  data:
    - secretKey: ANTHROPIC_API_KEY
      remoteRef:
        key: openclaw/anthropic
        property: api_key
    - secretKey: DISCORD_TOKEN
      remoteRef:
        key: openclaw/discord
        property: bot_token
    - secretKey: TELEGRAM_BOT_TOKEN
      remoteRef:
        key: openclaw/telegram
        property: bot_token
```

## Method 3: Sealed Secrets (GitOps-safe)

```bash
# Install kubeseal
brew install kubeseal

# Encrypt secret for safe Git storage
kubectl create secret generic openclaw-secrets \
  --namespace openclaw \
  --from-literal=ANTHROPIC_API_KEY="sk-ant-your-key" \
  --from-literal=DISCORD_TOKEN="your-token" \
  --dry-run=client -o yaml | \
  kubeseal --format=yaml > openclaw-sealed-secret.yaml

# The sealed secret is safe to commit to Git
```

## RBAC Lockdown

```yaml
# openclaw-secret-rbac.yaml
apiVersion: rbac.authorization.k8s.io/v1
kind: Role
metadata:
  name: openclaw-secret-reader
  namespace: openclaw
rules:
  - apiGroups: [""]
    resources: ["secrets"]
    resourceNames: ["openclaw-secrets"]
    verbs: ["get"]
---
apiVersion: rbac.authorization.k8s.io/v1
kind: RoleBinding
metadata:
  name: openclaw-secret-binding
  namespace: openclaw
subjects:
  - kind: ServiceAccount
    name: openclaw-sa
    namespace: openclaw
roleRef:
  kind: Role
  name: openclaw-secret-reader
  apiGroup: rbac.authorization.k8s.io
```

## Best Practices

1. **Never put API keys in ConfigMaps** — ConfigMaps are not access-controlled by default
2. **Use External Secrets for production** — Centralized rotation and audit
3. **RBAC on secrets** — Restrict who can read `openclaw-secrets`
4. **Rotate keys regularly** — Set up automatic rotation in your secret manager
5. **Audit access** — Enable Kubernetes audit logging for secret reads

## Key Takeaways

- **OpenClaw reads credentials from environment variables** — use Kubernetes Secrets to inject them
- **Kubernetes Secrets are base64, not encrypted** — use RBAC or ESO for real security
- **External Secrets Operator** syncs from Vault/AWS/GCP for production deployments
- **Sealed Secrets** enable GitOps-safe encrypted secret storage
- **Rotate API keys** regularly and use audit logging to track access
