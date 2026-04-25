---
title: "kubectl create secret docker-registry Guide"
description: "Create Kubernetes docker-registry secrets with kubectl. Private registry auth, --docker-password-stdin, imagePullSecrets, service account attachment."
publishDate: "2026-04-12"
author: "Luca Berton"
category: "configuration"
tags:
  - "secrets"
  - "docker-registry"
  - "imagepullsecrets"
  - "private-registry"
  - "authentication"
difficulty: "beginner"
timeToComplete: "10 minutes"
relatedRecipes:
  - "kubernetes-imagepullbackoff-troubleshooting"
  - "quay-robot-account-kubernetes"
  - "copy-nim-image-internal-quay-registry"
  - "kubernetes-secrets-management"
  - "secrets-management-best-practices"
---

> 💡 **Quick Answer:** \`kubectl create secret docker-registry\` creates a Kubernetes Secret containing Docker registry credentials. Use \`--docker-password-stdin\` to avoid passwords in shell history. Reference the secret in pod spec \`imagePullSecrets\` or attach to a ServiceAccount for cluster-wide use.

## The Problem

Pulling images from private registries (Docker Hub authenticated, GHCR, Quay, ECR, ACR, NGC, Harbor) requires authentication. Kubernetes needs registry credentials stored as a Secret of type \`kubernetes.io/dockerconfigjson\`, properly referenced in pod specs.

## The Solution

### Basic Usage

```bash
kubectl create secret docker-registry regcred \
  --docker-server=registry.example.com \
  --docker-username=myuser \
  --docker-password=mypassword \
  --docker-email=user@example.com
```

### Using --docker-password-stdin (Recommended)

Avoid passwords appearing in shell history or process lists:

```bash
# From environment variable
echo $REGISTRY_PASSWORD | kubectl create secret docker-registry regcred \
  --docker-server=registry.example.com \
  --docker-username=myuser \
  --docker-password-stdin

# From a file
kubectl create secret docker-registry regcred \
  --docker-server=registry.example.com \
  --docker-username=myuser \
  --docker-password-stdin < /path/to/password-file

# From a password manager
pass show registry/password | kubectl create secret docker-registry regcred \
  --docker-server=registry.example.com \
  --docker-username=myuser \
  --docker-password-stdin
```

### Common Registries

```bash
# Docker Hub (authenticated — higher rate limits)
kubectl create secret docker-registry dockerhub \
  --docker-server=https://index.docker.io/v1/ \
  --docker-username=myuser \
  --docker-password-stdin <<< "$DOCKERHUB_TOKEN"

# GitHub Container Registry (GHCR)
kubectl create secret docker-registry ghcr \
  --docker-server=ghcr.io \
  --docker-username=myuser \
  --docker-password-stdin <<< "$GITHUB_PAT"

# Quay.io
kubectl create secret docker-registry quay \
  --docker-server=quay.io \
  --docker-username="myorg+robot" \
  --docker-password-stdin <<< "$QUAY_TOKEN"

# NVIDIA NGC
kubectl create secret docker-registry ngc \
  --docker-server=nvcr.io \
  --docker-username='$oauthtoken' \
  --docker-password-stdin <<< "$NGC_API_KEY"

# AWS ECR (token expires every 12h)
aws ecr get-login-password --region us-east-1 | \
  kubectl create secret docker-registry ecr \
    --docker-server=123456789.dkr.ecr.us-east-1.amazonaws.com \
    --docker-username=AWS \
    --docker-password-stdin

# Azure ACR
kubectl create secret docker-registry acr \
  --docker-server=myregistry.azurecr.io \
  --docker-username=$ACR_SP_ID \
  --docker-password-stdin <<< "$ACR_SP_PASSWORD"

# Harbor
kubectl create secret docker-registry harbor \
  --docker-server=harbor.example.com \
  --docker-username=admin \
  --docker-password-stdin <<< "$HARBOR_PASSWORD"
```

### Reference in Pod Spec

```yaml
apiVersion: v1
kind: Pod
metadata:
  name: my-app
spec:
  imagePullSecrets:
    - name: regcred        # Must match secret name
  containers:
    - name: app
      image: registry.example.com/myapp:v1.0
```

### Attach to ServiceAccount (Cluster-Wide)

```bash
# All pods using 'default' SA get pull credentials automatically
kubectl patch serviceaccount default \
  -p '{"imagePullSecrets": [{"name": "regcred"}]}'

# Or for a specific service account
kubectl patch serviceaccount my-app-sa \
  -p '{"imagePullSecrets": [{"name": "regcred"}]}'
```

### Create in Specific Namespace

```bash
kubectl create secret docker-registry regcred \
  --docker-server=registry.example.com \
  --docker-username=myuser \
  --docker-password-stdin \
  -n production <<< "$REGISTRY_PASSWORD"
```

### YAML Equivalent

```yaml
apiVersion: v1
kind: Secret
metadata:
  name: regcred
type: kubernetes.io/dockerconfigjson
data:
  .dockerconfigjson: <base64-encoded-docker-config>
```

Generate the base64 value:

```bash
# Create the JSON manually
echo -n '{"auths":{"registry.example.com":{"username":"myuser","password":"mypassword","auth":"bXl1c2VyOm15cGFzc3dvcmQ="}}}' | base64 -w0
```

### Multiple Registries in One Secret

```bash
# Create from existing Docker config (supports multiple registries)
kubectl create secret generic regcred \
  --from-file=.dockerconfigjson=$HOME/.docker/config.json \
  --type=kubernetes.io/dockerconfigjson
```

### Verify the Secret

```bash
# Check secret exists
kubectl get secret regcred

# Decode and inspect
kubectl get secret regcred -o jsonpath='{.data.\.dockerconfigjson}' | base64 -d | jq .
# {
#   "auths": {
#     "registry.example.com": {
#       "username": "myuser",
#       "password": "mypassword",
#       "auth": "bXl1c2VyOm15cGFzc3dvcmQ="
#     }
#   }
# }
```

## Common Issues

| Issue | Cause | Fix |
|-------|-------|-----|
| \`unauthorized: authentication required\` | Wrong credentials or expired token | Recreate secret with correct credentials |
| Secret in wrong namespace | Pod and secret in different namespaces | Create secret in the pod's namespace |
| \`--docker-password-stdin\` not working | No stdin input | Pipe or redirect: \`echo $PASS \| ...\` |
| ECR token expired | AWS ECR tokens expire every 12 hours | Use ECR credential helper or CronJob to refresh |
| imagePullSecrets ignored | Not in pod spec AND not on ServiceAccount | Add to either pod spec or patch SA |
| Special chars in password | Shell interprets \`$\`, \`!\`, etc. | Use single quotes or \`--docker-password-stdin\` |

## Best Practices

- **Always use \`--docker-password-stdin\`** — never put passwords in command arguments
- **Attach to ServiceAccount** — avoids adding \`imagePullSecrets\` to every pod
- **Use robot/service accounts** — not personal credentials for production
- **Rotate secrets regularly** — especially for registries with expiring tokens
- **One secret per registry** — easier to manage and rotate
- **Namespace-scope secrets** — create in each namespace that needs them

## Key Takeaways

- \`kubectl create secret docker-registry\` creates registry auth secrets
- \`--docker-password-stdin\` keeps passwords out of shell history
- Reference in pod \`imagePullSecrets\` or attach to ServiceAccount
- NGC uses \`$oauthtoken\` as username, API key as password
- Secrets are namespace-scoped — must exist in the pod's namespace
- For multiple registries, use \`--from-file=.dockerconfigjson\`
