---
title: "How to Encrypt Secrets at Rest with KMS"
description: "Configure Kubernetes secrets encryption at rest using external KMS providers. Learn to set up AWS KMS, GCP KMS, and Azure Key Vault encryption."
category: "security"
difficulty: "advanced"
publishDate: "2026-01-22"
tags: ["encryption", "kms", "secrets", "security", "etcd"]
---

> 💡 **Quick Answer:** Configure API server with `--encryption-provider-config` pointing to an `EncryptionConfiguration` that specifies KMS provider (AWS KMS, GCP KMS, Azure Key Vault, HashiCorp Vault). Secrets are encrypted before being written to etcd. Re-encrypt existing secrets after enabling.
>
> **Key command:** After enabling, re-encrypt: `kubectl get secrets -A -o json | kubectl replace -f -`
>
> **Gotcha:** KMS key rotation requires re-encrypting all secrets; test encryption/decryption in staging first—misconfiguration can lock you out.

# How to Encrypt Secrets at Rest with KMS

By default, Kubernetes stores secrets in etcd base64-encoded but not encrypted. Configure encryption at rest using external KMS providers for production security.

## Understanding Encryption at Rest

```
┌──────────────────────────────────────────────────────────┐
│                    Secret Flow                            │
│                                                          │
│  kubectl create secret → API Server → Encrypt → etcd    │
│                              ↓                           │
│                          KMS Provider                    │
│                    (AWS/GCP/Azure/Vault)                 │
└──────────────────────────────────────────────────────────┘
```

## Basic Encryption Configuration

```yaml
# /etc/kubernetes/encryption-config.yaml
apiVersion: apiserver.config.k8s.io/v1
kind: EncryptionConfiguration
resources:
  - resources:
      - secrets
      - configmaps
    providers:
      # Primary: AES-CBC encryption
      - aescbc:
          keys:
            - name: key1
              secret: <base64-encoded-32-byte-key>
      # Fallback: identity for reading unencrypted data
      - identity: {}
```

Generate encryption key:

```bash
# Generate 32-byte random key
head -c 32 /dev/urandom | base64
```

## AWS KMS Provider

```yaml
# encryption-config-aws.yaml
apiVersion: apiserver.config.k8s.io/v1
kind: EncryptionConfiguration
resources:
  - resources:
      - secrets
    providers:
      - kms:
          apiVersion: v2
          name: aws-kms
          endpoint: unix:///var/run/kmsplugin/socket.sock
          cachesize: 1000
          timeout: 3s
      - identity: {}
```

Deploy AWS KMS plugin:

```yaml
# aws-kms-plugin.yaml
apiVersion: apps/v1
kind: DaemonSet
metadata:
  name: aws-encryption-provider
  namespace: kube-system
spec:
  selector:
    matchLabels:
      app: aws-encryption-provider
  template:
    metadata:
      labels:
        app: aws-encryption-provider
    spec:
      hostNetwork: true
      containers:
        - name: aws-encryption-provider
          image: amazon/aws-encryption-provider:latest
          args:
            - --key=arn:aws:kms:us-east-1:123456789:key/abc-123-def
            - --region=us-east-1
            - --listen=/var/run/kmsplugin/socket.sock
          volumeMounts:
            - name: socket
              mountPath: /var/run/kmsplugin
      volumes:
        - name: socket
          hostPath:
            path: /var/run/kmsplugin
            type: DirectoryOrCreate
      nodeSelector:
        node-role.kubernetes.io/control-plane: ""
      tolerations:
        - key: node-role.kubernetes.io/control-plane
          effect: NoSchedule
```

## GCP KMS Provider

```yaml
# encryption-config-gcp.yaml
apiVersion: apiserver.config.k8s.io/v1
kind: EncryptionConfiguration
resources:
  - resources:
      - secrets
    providers:
      - kms:
          apiVersion: v2
          name: gcp-kms
          endpoint: unix:///var/run/kmsplugin/socket.sock
          cachesize: 1000
          timeout: 3s
      - identity: {}
```

```yaml
# gcp-kms-plugin.yaml
apiVersion: apps/v1
kind: DaemonSet
metadata:
  name: gcp-kms-plugin
  namespace: kube-system
spec:
  selector:
    matchLabels:
      app: gcp-kms-plugin
  template:
    metadata:
      labels:
        app: gcp-kms-plugin
    spec:
      containers:
        - name: kms-plugin
          image: gcr.io/cloud-provider-gcp/kms-plugin:latest
          args:
            - --project-id=my-project
            - --location=global
            - --key-ring=k8s-secrets
            - --key=secrets-key
            - --path-to-unix-socket=/var/run/kmsplugin/socket.sock
          volumeMounts:
            - name: socket
              mountPath: /var/run/kmsplugin
      volumes:
        - name: socket
          hostPath:
            path: /var/run/kmsplugin
```

## Azure Key Vault Provider

```yaml
# encryption-config-azure.yaml
apiVersion: apiserver.config.k8s.io/v1
kind: EncryptionConfiguration
resources:
  - resources:
      - secrets
    providers:
      - kms:
          apiVersion: v2
          name: azure-kms
          endpoint: unix:///opt/azurekms/socket.sock
          cachesize: 1000
          timeout: 3s
      - identity: {}
```

## Configure API Server

```yaml
# kube-apiserver.yaml (static pod manifest)
apiVersion: v1
kind: Pod
metadata:
  name: kube-apiserver
  namespace: kube-system
spec:
  containers:
    - name: kube-apiserver
      command:
        - kube-apiserver
        - --encryption-provider-config=/etc/kubernetes/encryption-config.yaml
        # ... other flags
      volumeMounts:
        - name: encryption-config
          mountPath: /etc/kubernetes/encryption-config.yaml
          readOnly: true
        - name: kms-socket
          mountPath: /var/run/kmsplugin
  volumes:
    - name: encryption-config
      hostPath:
        path: /etc/kubernetes/encryption-config.yaml
        type: File
    - name: kms-socket
      hostPath:
        path: /var/run/kmsplugin
        type: DirectoryOrCreate
```

## Encrypt Existing Secrets

```bash
# Re-encrypt all secrets after enabling encryption
kubectl get secrets --all-namespaces -o json | \
  kubectl replace -f -

# Verify encryption is working
ETCDCTL_API=3 etcdctl \
  --endpoints=https://127.0.0.1:2379 \
  --cacert=/etc/kubernetes/pki/etcd/ca.crt \
  --cert=/etc/kubernetes/pki/etcd/server.crt \
  --key=/etc/kubernetes/pki/etcd/server.key \
  get /registry/secrets/default/my-secret | hexdump -C

# Encrypted data starts with "k8s:enc:kms:" or "k8s:enc:aescbc:"
```

## Key Rotation

```yaml
# Step 1: Add new key as primary
apiVersion: apiserver.config.k8s.io/v1
kind: EncryptionConfiguration
resources:
  - resources:
      - secrets
    providers:
      - aescbc:
          keys:
            - name: key2  # New key first
              secret: <new-base64-key>
            - name: key1  # Old key for decryption
              secret: <old-base64-key>
      - identity: {}
```

```bash
# Step 2: Restart API server

# Step 3: Re-encrypt all secrets with new key
kubectl get secrets --all-namespaces -o json | kubectl replace -f -

# Step 4: Remove old key (after confirming all re-encrypted)
```

## HashiCorp Vault Provider

```yaml
# vault-kms-provider.yaml
apiVersion: apps/v1
kind: DaemonSet
metadata:
  name: vault-kms-provider
  namespace: kube-system
spec:
  template:
    spec:
      containers:
        - name: vault-kms
          image: vault-kms-provider:latest
          args:
            - --vault-addr=https://vault.example.com:8200
            - --transit-path=transit
            - --key-name=k8s-secrets
            - --listen=/var/run/kmsplugin/socket.sock
          env:
            - name: VAULT_TOKEN
              valueFrom:
                secretKeyRef:
                  name: vault-token
                  key: token
          volumeMounts:
            - name: socket
              mountPath: /var/run/kmsplugin
```

## Verify Encryption Status

```bash
# Check if encryption is enabled
kubectl get apiservices | grep encryption

# Test by creating a secret
kubectl create secret generic test-secret --from-literal=key=value

# Check etcd directly (requires etcd access)
ETCDCTL_API=3 etcdctl get /registry/secrets/default/test-secret --print-value-only

# Should NOT see plaintext "value"
```

## Audit Encryption

```yaml
# Create audit policy for secrets
apiVersion: audit.k8s.io/v1
kind: Policy
rules:
  - level: Metadata
    resources:
      - group: ""
        resources: ["secrets"]
    verbs: ["create", "update", "patch", "delete"]
```

## Summary

Encrypting secrets at rest protects sensitive data stored in etcd. Use external KMS providers (AWS, GCP, Azure, Vault) for key management. Regularly rotate encryption keys and verify encryption is active by inspecting etcd data.

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
