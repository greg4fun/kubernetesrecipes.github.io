---
title: "K8s Projected Volumes: Combine Sources"
description: "Configure Kubernetes projected volumes to combine secrets, configmaps, downward API, and service account tokens into a single mount."
publishDate: "2026-05-02"
author: "Luca Berton"
category: "configuration"
difficulty: "intermediate"
timeToComplete: "8 minutes"
kubernetesVersion: "1.28+"
tags:
  - "volumes"
  - "projected"
  - "configuration"
  - "service-accounts"
  - "cka"
relatedRecipes:
  - "kubernetes-configmap-guide"
  - "kubernetes-secret-types-guide"
  - "kubernetes-serviceaccount-guide"
  - "kubernetes-emptydir-hostpath-volumes"
  - "kubernetes-kubelet-configuration"
  - "kubernetes-kustomize-guide"
  - "kubernetes-kubeadm-init-guide"
  - "kubernetes-cluster-api-guide"
  - "kubernetes-container-runtime-guide"
---

> 💡 **Quick Answer:** Projected volumes combine multiple sources into one mount: `projected: {sources: [{secret: {name: creds}}, {configMap: {name: config}}, {downwardAPI: {items: [{path: "labels", fieldRef: {fieldPath: metadata.labels}}]}}]}`. All sources appear as files in the same directory. Most useful for combining secrets + configmaps + token into `/etc/app/`.

## The Problem

Applications need configuration from multiple sources:

- Secrets for credentials
- ConfigMaps for settings
- Downward API for pod metadata
- ServiceAccount token for API access

Without projected volumes, each requires a separate volume mount at a different path.

## The Solution

### Combine Multiple Sources

```yaml
apiVersion: v1
kind: Pod
metadata:
  name: app
  labels:
    app: web
    version: v2
spec:
  containers:
  - name: app
    image: myapp:v2
    volumeMounts:
    - name: all-config
      mountPath: /etc/app
      readOnly: true
  
  volumes:
  - name: all-config
    projected:
      sources:
      # Secret files
      - secret:
          name: db-credentials
          items:
          - key: username
            path: db/username
          - key: password
            path: db/password
      
      # ConfigMap files
      - configMap:
          name: app-config
          items:
          - key: settings.yaml
            path: settings.yaml
          - key: features.json
            path: features.json
      
      # Downward API
      - downwardAPI:
          items:
          - path: labels
            fieldRef:
              fieldPath: metadata.labels
          - path: annotations
            fieldRef:
              fieldPath: metadata.annotations
          - path: cpu-request
            resourceFieldRef:
              containerName: app
              resource: requests.cpu
      
      # ServiceAccount token
      - serviceAccountToken:
          path: token
          expirationSeconds: 3600
          audience: api.example.com

# Resulting filesystem:
# /etc/app/
# ├── db/
# │   ├── username
# │   └── password
# ├── settings.yaml
# ├── features.json
# ├── labels
# ├── annotations
# ├── cpu-request
# └── token
```

### Bound ServiceAccount Token

```yaml
# Projected token with custom audience and expiration
volumes:
- name: vault-token
  projected:
    sources:
    - serviceAccountToken:
        path: token
        expirationSeconds: 600      # 10 minutes
        audience: vault              # Token audience claim

# Use case: HashiCorp Vault Kubernetes auth
# The token is:
# - Short-lived (10 min, auto-rotated by kubelet)
# - Scoped to a specific audience ("vault")
# - Projected by kubelet (not stored as Secret)
```

### Downward API Fields

```yaml
# Available fields via fieldRef
- fieldRef:
    fieldPath: metadata.name           # Pod name
- fieldRef:
    fieldPath: metadata.namespace      # Namespace
- fieldRef:
    fieldPath: metadata.uid            # Pod UID
- fieldRef:
    fieldPath: metadata.labels         # All labels
- fieldRef:
    fieldPath: metadata.annotations    # All annotations
- fieldRef:
    fieldPath: spec.nodeName           # Node name
- fieldRef:
    fieldPath: spec.serviceAccountName # SA name
- fieldRef:
    fieldPath: status.podIP            # Pod IP
- fieldRef:
    fieldPath: status.hostIP           # Node IP

# Resource fields via resourceFieldRef
- resourceFieldRef:
    containerName: app
    resource: requests.cpu
- resourceFieldRef:
    containerName: app
    resource: limits.memory
```

### File Permissions

```yaml
volumes:
- name: secure-config
  projected:
    defaultMode: 0400              # Read-only for owner
    sources:
    - secret:
        name: tls-cert
        items:
        - key: tls.key
          path: tls.key
          mode: 0400               # Per-file override
        - key: tls.crt
          path: tls.crt
          mode: 0444               # Readable by all
```

### Practical Example: TLS + Config + Metadata

```yaml
apiVersion: v1
kind: Pod
metadata:
  name: nginx
  labels:
    app: nginx
spec:
  containers:
  - name: nginx
    image: nginx:1.27
    volumeMounts:
    - name: nginx-config
      mountPath: /etc/nginx/conf
      readOnly: true
    - name: tls
      mountPath: /etc/nginx/ssl
      readOnly: true
  
  volumes:
  - name: nginx-config
    projected:
      sources:
      - configMap:
          name: nginx-conf
      - downwardAPI:
          items:
          - path: pod-name
            fieldRef:
              fieldPath: metadata.name
  
  - name: tls
    projected:
      defaultMode: 0400
      sources:
      - secret:
          name: nginx-tls
          items:
          - key: tls.crt
            path: server.crt
          - key: tls.key
            path: server.key
```

## Common Issues

**"projected volume sources overlap"**

Two sources write to the same path. Ensure all `path` values are unique across sources.

**Token file empty or missing**

ServiceAccount token projection requires kubelet support (standard in K8s 1.21+). Check kubelet flags.

**ConfigMap updates not reflected**

Projected volumes from ConfigMaps update automatically (kubelet sync period ~1 min). Secrets with `immutable: true` never update.

## Best Practices

- **Combine related config into one mount** — simpler than multiple volumes
- **Use projected tokens over Secret-based tokens** — short-lived, auto-rotated
- **Set `expirationSeconds`** on tokens — shorter = more secure
- **Set `audience`** on tokens — limits where the token is accepted
- **Use `defaultMode: 0400`** for sensitive files — principle of least privilege

## Key Takeaways

- Projected volumes combine secrets, configmaps, downward API, and tokens into one mount
- ServiceAccount token projection provides short-lived, scoped tokens
- Downward API exposes pod metadata (name, namespace, labels, resources) as files
- File permissions configurable per-source and per-file
- Reduces volume mount complexity — one mount point for all config sources
