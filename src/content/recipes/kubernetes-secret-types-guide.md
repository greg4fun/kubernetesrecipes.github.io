---
title: "K8s Secrets: Types and Usage Guide"
description: "Create and manage Kubernetes Secrets: Opaque, docker-registry, TLS, and basic-auth types. Mount as volumes, inject as env vars, and encrypt at rest."
publishDate: "2026-05-02"
author: "Luca Berton"
category: "security"
difficulty: "beginner"
timeToComplete: "10 minutes"
kubernetesVersion: "1.28+"
tags:
  - "secrets"
  - "security"
  - "encryption"
  - "configuration"
  - "cka"
relatedRecipes:
  - "kubernetes-configmap-guide"
  - "kubectl-create-secret-docker-registry"
  - "external-secrets-operator"
  - "image-pull-secrets"
  - "kubernetes-serviceaccount-guide"
  - "kubernetes-external-secrets-guide"
---

> 💡 **Quick Answer:** `kubectl create secret generic my-secret --from-literal=password=s3cr3t` creates an Opaque secret. Values are base64-encoded (NOT encrypted) by default. Mount as volume or env var same as ConfigMaps. Enable encryption at rest in `EncryptionConfiguration`. Secret types: `Opaque` (arbitrary data), `kubernetes.io/dockerconfigjson` (registry auth), `kubernetes.io/tls` (cert + key), `kubernetes.io/basic-auth` (username + password).

## The Problem

Applications need credentials, API keys, and certificates:

- Hardcoding in images exposes them in registries
- ConfigMaps store data in plain text, visible to anyone with namespace access
- No standardized format for different credential types
- Base64 ≠ encryption — Secrets need additional protection

## The Solution

### Create Secrets

```bash
# Opaque (generic) secret
kubectl create secret generic db-creds \
  --from-literal=username=admin \
  --from-literal=password='P@ssw0rd!'

# From file
kubectl create secret generic tls-cert \
  --from-file=cert.pem \
  --from-file=key.pem

# Docker registry secret
kubectl create secret docker-registry regcred \
  --docker-server=registry.example.com \
  --docker-username=user \
  --docker-password=pass

# TLS secret
kubectl create secret tls my-tls \
  --cert=tls.crt \
  --key=tls.key

# Generate YAML (values auto-base64-encoded)
kubectl create secret generic my-secret \
  --from-literal=api-key=abc123 \
  --dry-run=client -o yaml
```

### Secret Types

```yaml
# Opaque — arbitrary key-value pairs
apiVersion: v1
kind: Secret
metadata:
  name: db-creds
type: Opaque
data:
  username: YWRtaW4=          # base64 of "admin"
  password: UEBzc3cwcmQh      # base64 of "P@ssw0rd!"

---
# Use stringData for plain text (auto-encoded)
apiVersion: v1
kind: Secret
metadata:
  name: db-creds
type: Opaque
stringData:                    # Plain text — K8s encodes it
  username: admin
  password: "P@ssw0rd!"

---
# Docker registry
apiVersion: v1
kind: Secret
metadata:
  name: regcred
type: kubernetes.io/dockerconfigjson
data:
  .dockerconfigjson: <base64-encoded-docker-config>

---
# TLS
apiVersion: v1
kind: Secret
metadata:
  name: tls-secret
type: kubernetes.io/tls
data:
  tls.crt: <base64-cert>
  tls.key: <base64-key>
```

### Use in Pods

```yaml
apiVersion: v1
kind: Pod
metadata:
  name: app
spec:
  containers:
  - name: app
    image: myapp:v1
    # As environment variables
    env:
    - name: DB_PASSWORD
      valueFrom:
        secretKeyRef:
          name: db-creds
          key: password
    # All keys as env vars
    envFrom:
    - secretRef:
        name: db-creds
    
    # As volume mount
    volumeMounts:
    - name: certs
      mountPath: /etc/tls
      readOnly: true
  
  # Image pull secret
  imagePullSecrets:
  - name: regcred
  
  volumes:
  - name: certs
    secret:
      secretName: tls-secret
      defaultMode: 0400    # Read-only by owner
```

### Encryption at Rest

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
        secret: <base64-32-byte-key>
  - identity: {}    # Fallback for reading unencrypted secrets
```

```bash
# Generate encryption key
head -c 32 /dev/urandom | base64

# Verify secrets are encrypted
ETCDCTL_API=3 etcdctl get /registry/secrets/default/db-creds | hexdump -C
# Should show encrypted data, not plain base64
```

### Decode Secrets

```bash
# View secret (base64 encoded)
kubectl get secret db-creds -o yaml

# Decode a specific key
kubectl get secret db-creds -o jsonpath='{.data.password}' | base64 -d

# Decode all keys
kubectl get secret db-creds -o json | jq '.data | to_entries[] | "\(.key): \(.value | @base64d)"'
```

## Common Issues

**"error decoding secret data"**

Value not valid base64. Use `stringData` instead of `data` for plain text values.

**Secret not updating in pod**

Same as ConfigMap — env vars don't auto-update. Volume mounts update with delay. Restart pod for env var changes.

**"imagePullSecrets" not working**

Secret must be in the same namespace as the pod. Check type is `kubernetes.io/dockerconfigjson`.

## Best Practices

- **Use `stringData` in YAML** — no manual base64 encoding
- **Enable encryption at rest** — base64 is encoding, not encryption
- **Use External Secrets Operator** for production — sync from Vault, AWS SM, etc.
- **Set `defaultMode: 0400`** on volume mounts — restrict file permissions
- **RBAC restrict `get secrets`** — only apps that need them

## Key Takeaways

- Secrets are base64-encoded by default — NOT encrypted without explicit config
- Four types: Opaque, dockerconfigjson, TLS, basic-auth
- Mount as volumes or env vars same as ConfigMaps
- Enable encryption at rest via EncryptionConfiguration
- Use External Secrets Operator or Vault for production secret management
