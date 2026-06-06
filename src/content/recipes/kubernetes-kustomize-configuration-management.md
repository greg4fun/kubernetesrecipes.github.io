---
title: "Kubernetes Kustomize Configuration Management"
description: "Manage Kubernetes configurations with Kustomize. Build overlays for multiple environments, patch resources, generate ConfigMaps and Secrets, and integrate"
tags:
  - "kustomize"
  - "configuration"
  - "overlays"
  - "gitops"
  - "patches"
category: "configuration"
publishDate: "2026-06-01"
author: "Luca Berton"
difficulty: "intermediate"
relatedRecipes:
  - "kustomize-vs-helm-comparison"
  - "argocd-gitops-deployment"
  - "kubernetes-configmap-secrets-management"
---

> 💡 **Quick Answer:** Kustomize customizes Kubernetes YAML without templates. Define a base configuration, then create overlays (dev/staging/prod) that patch specific fields. Built into `kubectl`: use `kubectl apply -k ./overlays/production/`. Key features: strategic merge patches, JSON patches, ConfigMap/Secret generators, name prefixes/suffixes, and common labels.

## The Problem

- Copying YAML files per environment leads to drift and duplication
- Helm templates add complexity for simple configuration differences
- Need to change just image tag or replica count per environment
- ConfigMaps and Secrets need to trigger rollouts when changed
- Want to use plain YAML without learning a templating language

## The Solution

### Directory Structure

```text
my-app/
├── base/
│   ├── kustomization.yaml
│   ├── deployment.yaml
│   ├── service.yaml
│   └── configmap.yaml
└── overlays/
    ├── dev/
    │   ├── kustomization.yaml
    │   └── replica-patch.yaml
    ├── staging/
    │   ├── kustomization.yaml
    │   └── resource-patch.yaml
    └── production/
        ├── kustomization.yaml
        ├── replica-patch.yaml
        └── hpa.yaml
```

### Base Configuration

```yaml
# base/kustomization.yaml
apiVersion: kustomize.config.k8s.io/v1beta1
kind: Kustomization

resources:
  - deployment.yaml
  - service.yaml

commonLabels:
  app.kubernetes.io/name: my-app
  app.kubernetes.io/managed-by: kustomize

configMapGenerator:
  - name: app-config
    literals:
      - LOG_LEVEL=info
      - CACHE_TTL=300
```

```yaml
# base/deployment.yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: my-app
spec:
  replicas: 1
  selector:
    matchLabels:
      app.kubernetes.io/name: my-app
  template:
    metadata:
      labels:
        app.kubernetes.io/name: my-app
    spec:
      containers:
        - name: app
          image: registry.example.com/my-app:latest
          ports:
            - containerPort: 8080
          envFrom:
            - configMapRef:
                name: app-config
          resources:
            requests:
              cpu: "100m"
              memory: "128Mi"
            limits:
              cpu: "500m"
              memory: "256Mi"
```

### Production Overlay

```yaml
# overlays/production/kustomization.yaml
apiVersion: kustomize.config.k8s.io/v1beta1
kind: Kustomization

resources:
  - ../../base
  - hpa.yaml         # Additional resources for prod

namespace: production

namePrefix: prod-

images:
  - name: registry.example.com/my-app
    newTag: "v2.1.0"    # Pin specific version

replicas:
  - name: my-app
    count: 5

configMapGenerator:
  - name: app-config
    behavior: merge    # Merge with base ConfigMap
    literals:
      - LOG_LEVEL=warn
      - CACHE_TTL=3600

patches:
  - path: replica-patch.yaml
```

```yaml
# overlays/production/replica-patch.yaml (strategic merge patch)
apiVersion: apps/v1
kind: Deployment
metadata:
  name: my-app
spec:
  template:
    spec:
      containers:
        - name: app
          resources:
            requests:
              cpu: "500m"
              memory: "512Mi"
            limits:
              cpu: "2"
              memory: "1Gi"
```

### Build and Apply

```bash
# Preview rendered output
kubectl kustomize overlays/production/
# or
kustomize build overlays/production/

# Apply directly
kubectl apply -k overlays/production/

# Diff against cluster
kubectl diff -k overlays/production/
```

### Common Kustomize Features

```yaml
# kustomization.yaml features:

# Change image tags without patching
images:
  - name: nginx
    newName: registry.example.com/nginx
    newTag: "1.25"

# Add labels/annotations to all resources
commonLabels:
  environment: production
  team: platform

commonAnnotations:
  owner: platform-team@example.com

# Generate ConfigMap from file
configMapGenerator:
  - name: nginx-config
    files:
      - nginx.conf
      - configs/app.properties

# Generate Secret
secretGenerator:
  - name: db-credentials
    literals:
      - username=admin
      - password=secret123
    type: Opaque

# JSON patch (more precise than strategic merge)
patches:
  - target:
      kind: Deployment
      name: my-app
    patch: |-
      - op: replace
        path: /spec/replicas
        value: 10
      - op: add
        path: /spec/template/spec/containers/0/env/-
        value:
          name: NEW_VAR
          value: "added-by-patch"
```

### ConfigMap Hash Suffix (Auto-Rollout)

```bash
# Kustomize adds hash suffix to ConfigMap names:
# app-config-abc123
# When content changes → new hash → Deployment references new name → triggers rollout

# This ensures pods restart when config changes (unlike plain ConfigMaps)
```

## Common Issues

### "no matches for OriginalId" when patching
- **Cause**: Patch target name/kind doesn't match any resource in base
- **Fix**: Verify resource name in base matches patch metadata.name exactly

### ConfigMap hash suffix breaking external references
- **Cause**: Other resources reference ConfigMap by fixed name
- **Fix**: Use `generatorOptions: { disableNameSuffixHash: true }` (loses auto-rollout)

### Kustomize version differences (kubectl vs standalone)
- **Cause**: `kubectl kustomize` may be older than standalone `kustomize` binary
- **Fix**: Use standalone: `kustomize build | kubectl apply -f -`

## Best Practices

1. **Base + overlays pattern** — base is the default; overlays are environment-specific
2. **Use `images` field for tags** — don't patch just to change image version
3. **ConfigMap generators with hash** — automatic rollout on config changes
4. **Keep patches minimal** — only override what differs from base
5. **Use `replicas` field** — cleaner than patching replica count
6. **Commit kustomize output to Git** — `kustomize build > rendered.yaml` for audit trail
7. **Pair with ArgoCD** — native kustomize support for GitOps

## Key Takeaways

- Kustomize = plain YAML customization without templates (built into `kubectl -k`)
- Base + overlays pattern: one base configuration, environment-specific overrides
- `images` field changes tags without patches; `replicas` field sets replica count
- ConfigMap/Secret generators add hash suffix → automatic rollout on changes
- Strategic merge patches override specific fields; JSON patches for precise operations
- `kubectl apply -k ./overlays/prod/` — one command to deploy environment
- No templating language to learn — just YAML patches and generators
