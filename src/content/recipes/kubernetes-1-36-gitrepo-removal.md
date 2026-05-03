---
title: "Migrate from gitRepo Volume in Kubernetes 1.36"
description: "The gitRepo volume plugin is permanently removed in Kubernetes 1.36. Migrate to init containers or OCI volumes to avoid broken deployments."
tags:
  - "kubernetes-1.36"
  - "migration"
  - "volumes"
  - "deprecation"
  - "security"
category: "configuration"
publishDate: "2026-05-03"
author: "Luca Berton"
difficulty: "beginner"
relatedRecipes:
  - "kubernetes-1-36-user-namespaces"
  - "kubernetes-1-36-selinux-mount-labeling"
  - "kubernetes-1-36-oci-volume-source"
  - "kubernetes-init-containers-guide"
  - "kubernetes-persistent-volume-guide"
---

> 💡 **Quick Answer:** The `gitRepo` volume plugin is **permanently disabled in Kubernetes 1.36**. Pods using `gitRepo` volumes will fail to start. Migrate to init containers or the new OCI VolumeSource immediately.

## The Problem

The `gitRepo` volume type allowed cloning a Git repository directly into a Pod volume. It was deprecated because:

- **Security vulnerability**: It ran `git clone` as **root on the host node**, allowing malicious repos to execute arbitrary code with root privileges
- **No authentication support**: Couldn't use SSH keys or tokens for private repos
- **Shallow implementation**: No branch selection, sparse checkout, or LFS support
- **No updates**: Volume was cloned once at Pod start and never refreshed

In Kubernetes 1.36, the plugin is **permanently disabled**. This YAML will break:

```yaml
# ❌ THIS NO LONGER WORKS IN 1.36
volumes:
  - name: config
    gitRepo:
      repository: "https://github.com/example/config.git"
      revision: "abc123"
```

## The Solution

### Option 1: Init Container (Drop-in Replacement)

```yaml
apiVersion: v1
kind: Pod
metadata:
  name: app-with-git
spec:
  initContainers:
    - name: git-clone
      image: bitnami/git:2.45
      command:
        - git
        - clone
        - --depth=1
        - --branch=main
        - https://github.com/example/config.git
        - /repo
      volumeMounts:
        - name: git-repo
          mountPath: /repo
      securityContext:
        runAsNonRoot: true
        runAsUser: 1000
  containers:
    - name: app
      image: registry.example.com/app:v2.0
      volumeMounts:
        - name: git-repo
          mountPath: /config
          readOnly: true
  volumes:
    - name: git-repo
      emptyDir: {}
```

### Option 2: Init Container with Private Repo

```yaml
apiVersion: v1
kind: Pod
metadata:
  name: app-private-repo
spec:
  initContainers:
    - name: git-clone
      image: bitnami/git:2.45
      command:
        - /bin/sh
        - -c
        - |
          git clone --depth=1 \
            https://${GIT_TOKEN}@github.com/example/private-config.git \
            /repo
      env:
        - name: GIT_TOKEN
          valueFrom:
            secretKeyRef:
              name: git-credentials
              key: token
      volumeMounts:
        - name: git-repo
          mountPath: /repo
      securityContext:
        runAsNonRoot: true
        runAsUser: 1000
  containers:
    - name: app
      image: registry.example.com/app:v2.0
      volumeMounts:
        - name: git-repo
          mountPath: /config
          readOnly: true
  volumes:
    - name: git-repo
      emptyDir: {}
```

### Option 3: OCI VolumeSource (Kubernetes 1.36+)

Package your config as an OCI artifact and mount it directly:

```bash
# Push config to registry
oras push registry.example.com/configs/app:v1.0 \
  ./config-dir/:application/octet-stream
```

```yaml
apiVersion: v1
kind: Pod
metadata:
  name: app-oci-config
spec:
  containers:
    - name: app
      image: registry.example.com/app:v2.0
      volumeMounts:
        - name: config
          mountPath: /config
          readOnly: true
  volumes:
    - name: config
      image:
        reference: registry.example.com/configs/app:v1.0
        pullPolicy: IfNotPresent
```

### Find Affected Workloads

```bash
# Search for gitRepo usage in your cluster
kubectl get pods -A -o json | jq -r '
  .items[] |
  select(.spec.volumes[]?.gitRepo != null) |
  "\(.metadata.namespace)/\(.metadata.name)"'

# Search in manifests
grep -rn "gitRepo:" manifests/ charts/ k8s/
```

## Common Issues

### Pod fails with "gitRepo volume type is disabled"
- **Cause**: Running Kubernetes 1.36 with gitRepo volumes
- **Fix**: Migrate to init container or OCI volume (see above)

### Init container can't clone (permission denied)
- **Cause**: `runAsNonRoot` with wrong UID for the emptyDir
- **Fix**: Ensure `runAsUser` has write permissions, or use `securityContext.fsGroup`

## Best Practices

1. **Audit all manifests now** — `grep -rn "gitRepo:" .` in your repos
2. **Use OCI volumes** for static config bundles — simpler than init containers
3. **Use init containers** when you need branch selection or authentication
4. **Run git as non-root** — unlike gitRepo, init containers respect security contexts
5. **Pin git image tags** — use specific versions, not `latest`

## Key Takeaways

- `gitRepo` volumes are **permanently disabled in Kubernetes 1.36**
- Pods using gitRepo will **fail to start** — no grace period
- Replace with init containers (flexible) or OCI volumes (simple)
- Init containers are more secure — run as non-root, support private repos
- Search your manifests and Helm charts for `gitRepo:` before upgrading
