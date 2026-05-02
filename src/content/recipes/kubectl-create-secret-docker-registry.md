---
title: "kubectl create secret docker-registry"
description: "Create Kubernetes Docker registry secrets with --docker-password-stdin. Authenticate to private registries and configure imagePullSecrets securely."
publishDate: "2026-04-30"
author: "Luca Berton"
category: "configuration"
difficulty: "beginner"
timeToComplete: "10 minutes"
kubernetesVersion: "1.28+"
tags:
  - "kubectl"
  - "secrets"
  - "registry"
  - "docker"
  - "authentication"
  - "security"
relatedRecipes:
  - "quay-registry-kubernetes-guide"
  - "openshift-idms-itms-mirror-rules"
  - "containerd-certs-d-registry-ca-trust"
---

> 💡 **Quick Answer:** Use `kubectl create secret docker-registry` with `--docker-password-stdin` to create registry credentials without exposing the password in shell history: `echo $TOKEN | kubectl create secret docker-registry my-registry --docker-server=registry.example.com --docker-username=user --docker-password-stdin`. Then reference it in pods via `imagePullSecrets` or attach it to a ServiceAccount for automatic use.

## The Problem

Kubernetes needs credentials to pull images from private registries. Common mistakes:

- Password visible in shell history (`--docker-password=mysecret`)
- Secret created in wrong namespace
- `imagePullSecrets` not configured on pod or ServiceAccount
- Secret format doesn't match registry authentication scheme
- Credentials expire but secret isn't updated

## The Solution

### Create Secret with --docker-password-stdin

```bash
# ✅ SECURE — password from stdin (not in shell history)
echo "$REGISTRY_PASSWORD" | kubectl create secret docker-registry my-registry \
  --docker-server=registry.example.com \
  --docker-username=myuser \
  --docker-password-stdin \
  -n my-namespace

# ❌ INSECURE — password visible in shell history and ps output
kubectl create secret docker-registry my-registry \
  --docker-server=registry.example.com \
  --docker-username=myuser \
  --docker-password=mysecret    # Don't do this!
```

### Common Registry Servers

```bash
# Docker Hub
echo "$DOCKERHUB_TOKEN" | kubectl create secret docker-registry dockerhub \
  --docker-server=https://index.docker.io/v1/ \
  --docker-username=myuser \
  --docker-password-stdin

# GitHub Container Registry (ghcr.io)
echo "$GITHUB_TOKEN" | kubectl create secret docker-registry ghcr \
  --docker-server=ghcr.io \
  --docker-username=myuser \
  --docker-password-stdin

# AWS ECR (token from aws ecr get-login-password)
aws ecr get-login-password --region us-east-1 | \
  kubectl create secret docker-registry ecr \
  --docker-server=123456789.dkr.ecr.us-east-1.amazonaws.com \
  --docker-username=AWS \
  --docker-password-stdin

# Google Artifact Registry
cat key.json | kubectl create secret docker-registry gar \
  --docker-server=us-docker.pkg.dev \
  --docker-username=_json_key \
  --docker-password-stdin

# Quay.io
echo "$QUAY_TOKEN" | kubectl create secret docker-registry quay \
  --docker-server=quay.io \
  --docker-username=myuser \
  --docker-password-stdin

# Self-hosted with custom CA (secret + CA trust separately)
echo "$REG_PASSWORD" | kubectl create secret docker-registry internal-reg \
  --docker-server=registry.example.com:5000 \
  --docker-username=admin \
  --docker-password-stdin
```

### Use in Pods

```yaml
# Option 1: imagePullSecrets on the Pod
apiVersion: v1
kind: Pod
metadata:
  name: my-app
spec:
  containers:
  - name: app
    image: registry.example.com/myapp:v1.0
  imagePullSecrets:
  - name: my-registry

---
# Option 2: Attach to ServiceAccount (automatic for all pods)
apiVersion: v1
kind: ServiceAccount
metadata:
  name: default
  namespace: my-namespace
imagePullSecrets:
- name: my-registry
```

```bash
# Attach secret to existing ServiceAccount
kubectl patch serviceaccount default -n my-namespace \
  -p '{"imagePullSecrets": [{"name": "my-registry"}]}'

# Verify ServiceAccount has the secret
kubectl get sa default -n my-namespace -o yaml | grep -A5 imagePullSecrets
```

### Create from Existing Docker Config

```bash
# If you already have ~/.docker/config.json with credentials
kubectl create secret generic my-registry \
  --from-file=.dockerconfigjson=$HOME/.docker/config.json \
  --type=kubernetes.io/dockerconfigjson \
  -n my-namespace

# Or from a specific config file
kubectl create secret generic my-registry \
  --from-file=.dockerconfigjson=/path/to/config.json \
  --type=kubernetes.io/dockerconfigjson
```

### Verify Secret

```bash
# Check secret exists and type is correct
kubectl get secret my-registry -n my-namespace
# NAME          TYPE                             DATA   AGE
# my-registry   kubernetes.io/dockerconfigjson   1      5s

# Decode and verify contents
kubectl get secret my-registry -n my-namespace -o jsonpath='{.data.\.dockerconfigjson}' | base64 -d | jq .
# {
#   "auths": {
#     "registry.example.com": {
#       "username": "myuser",
#       "password": "...",
#       "auth": "base64(user:pass)"
#     }
#   }
# }

# Test pull with the secret
kubectl run test-pull --image=registry.example.com/myapp:v1.0 \
  --overrides='{"spec":{"imagePullSecrets":[{"name":"my-registry"}]}}' \
  --restart=Never
kubectl get pod test-pull
kubectl delete pod test-pull
```

### Update Existing Secret

```bash
# Delete and recreate (simplest)
kubectl delete secret my-registry -n my-namespace
echo "$NEW_PASSWORD" | kubectl create secret docker-registry my-registry \
  --docker-server=registry.example.com \
  --docker-username=myuser \
  --docker-password-stdin \
  -n my-namespace

# Or patch in-place
NEW_AUTH=$(echo -n '{"auths":{"registry.example.com":{"username":"myuser","password":"newpass","auth":"'$(echo -n myuser:newpass | base64)'"}}}' | base64 -w0)
kubectl patch secret my-registry -n my-namespace \
  -p "{\"data\":{\".dockerconfigjson\":\"${NEW_AUTH}\"}}"
```

### Multiple Registries in One Secret

```bash
# Create config.json with multiple registries
cat > /tmp/docker-config.json << 'EOF'
{
  "auths": {
    "registry.example.com": {
      "auth": "dXNlcjpwYXNz"
    },
    "ghcr.io": {
      "auth": "dXNlcjp0b2tlbg=="
    },
    "quay.io": {
      "auth": "dXNlcjpwYXNz"
    }
  }
}
EOF

kubectl create secret generic all-registries \
  --from-file=.dockerconfigjson=/tmp/docker-config.json \
  --type=kubernetes.io/dockerconfigjson

rm /tmp/docker-config.json
```

## Common Issues

**"ErrImagePull: unauthorized: authentication required"**

Secret exists but not referenced. Add `imagePullSecrets` to the pod spec or patch the ServiceAccount.

**Secret in wrong namespace**

Registry secrets must be in the SAME namespace as the pod. Create the secret in every namespace that needs it, or use a ServiceAccount.

**"--docker-password-stdin" flag not recognized**

kubectl version too old. Update kubectl to 1.20+. Workaround: pipe via `--docker-password=$(cat /path/to/token)`.

**ECR token expires every 12 hours**

AWS ECR tokens are temporary. Use a CronJob or external-secrets-operator to refresh the secret automatically.

## Best Practices

- **Always `--docker-password-stdin`** — never put passwords in CLI arguments
- **Attach to ServiceAccount** — automatic for all pods, no per-pod config
- **One secret per registry** — easier to rotate and audit
- **Automate rotation** — especially for ECR/GCR tokens that expire
- **Use external-secrets-operator** — syncs registry creds from Vault/AWS/GCP

## Key Takeaways

- `--docker-password-stdin` keeps credentials out of shell history
- Registry secrets must be in the same namespace as the pod
- Attach to ServiceAccount for cluster-wide automatic pull auth
- Create from existing `~/.docker/config.json` for multi-registry setups
- ECR/GCR tokens expire — automate rotation with CronJobs or external-secrets
