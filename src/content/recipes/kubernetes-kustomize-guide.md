---
title: "Kustomize: Customize K8s Manifests"
description: "Use Kustomize to customize Kubernetes manifests without templates. Overlays, patches, configMapGenerator, secretGenerator, and environment-specific configurations."
publishDate: "2026-05-02"
author: "Luca Berton"
category: "configuration"
difficulty: "intermediate"
timeToComplete: "12 minutes"
kubernetesVersion: "1.28+"
tags:
  - "kustomize"
  - "configuration"
  - "gitops"
  - "overlays"
  - "cka"
relatedRecipes:
  - "kustomize-vs-helm-comparison"
  - "kubectl-apply-vs-create"
  - "kubernetes-configmap-guide"
  - "kubernetes-api-resources-explain"
  - "kubernetes-kubectl-wait-scripting"
---

> 💡 **Quick Answer:** Kustomize customizes YAML without templates. Create a `kustomization.yaml` listing resources, then `kubectl apply -k .` to deploy. Use overlays for environment-specific changes: `base/` has common manifests, `overlays/production/` patches replicas, images, and config. Built into kubectl since v1.14 — no extra tools needed.

## The Problem

Managing Kubernetes manifests across environments:

- Copy-paste YAML between dev/staging/prod (drift)
- Template engines add complexity (Helm)
- Environment differences: replicas, images, resources, config
- Need to patch third-party manifests without forking

## The Solution

### Directory Structure

```
app/
├── base/
│   ├── kustomization.yaml
│   ├── deployment.yaml
│   ├── service.yaml
│   └── configmap.yaml
├── overlays/
│   ├── development/
│   │   ├── kustomization.yaml
│   │   └── replica-patch.yaml
│   ├── staging/
│   │   ├── kustomization.yaml
│   │   └── resource-patch.yaml
│   └── production/
│       ├── kustomization.yaml
│       ├── replica-patch.yaml
│       └── resource-patch.yaml
```

### Base

```yaml
# base/kustomization.yaml
apiVersion: kustomize.config.k8s.io/v1beta1
kind: Kustomization

resources:
- deployment.yaml
- service.yaml
- configmap.yaml

commonLabels:
  app: myapp

# base/deployment.yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: myapp
spec:
  replicas: 1
  selector:
    matchLabels:
      app: myapp
  template:
    metadata:
      labels:
        app: myapp
    spec:
      containers:
      - name: app
        image: myapp:latest
        ports:
        - containerPort: 8080
        resources:
          requests:
            cpu: 100m
            memory: 128Mi
```

### Production Overlay

```yaml
# overlays/production/kustomization.yaml
apiVersion: kustomize.config.k8s.io/v1beta1
kind: Kustomization

resources:
- ../../base

namespace: production

namePrefix: prod-

commonLabels:
  environment: production

# Override image
images:
- name: myapp
  newName: registry.example.com/myapp
  newTag: v2.1.0

# Patch replicas and resources
patches:
- path: replica-patch.yaml
- target:
    kind: Deployment
    name: myapp
  patch: |
    - op: replace
      path: /spec/template/spec/containers/0/resources/requests/cpu
      value: "1"
    - op: replace
      path: /spec/template/spec/containers/0/resources/requests/memory
      value: 1Gi

# overlays/production/replica-patch.yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: myapp
spec:
  replicas: 5
```

### ConfigMap and Secret Generators

```yaml
# kustomization.yaml
configMapGenerator:
- name: app-config
  literals:
  - DATABASE_HOST=db.production.svc
  - LOG_LEVEL=info
  files:
  - configs/settings.yaml

- name: nginx-conf
  files:
  - nginx.conf=configs/nginx-production.conf

secretGenerator:
- name: db-credentials
  literals:
  - username=admin
  - password=secret123
  type: Opaque

- name: tls-cert
  files:
  - tls.crt=certs/server.crt
  - tls.key=certs/server.key
  type: kubernetes.io/tls

# Generated names include content hash: app-config-abc123
# Triggers rolling update when config changes!
```

### Patch Types

```yaml
# Strategic Merge Patch (default) — merge YAML
patches:
- path: increase-replicas.yaml
# increase-replicas.yaml:
# apiVersion: apps/v1
# kind: Deployment
# metadata:
#   name: myapp
# spec:
#   replicas: 10

# JSON Patch — precise operations
patches:
- target:
    kind: Deployment
    name: myapp
  patch: |
    - op: replace
      path: /spec/replicas
      value: 10
    - op: add
      path: /spec/template/spec/containers/0/env/-
      value:
        name: NEW_VAR
        value: "hello"
    - op: remove
      path: /spec/template/spec/containers/0/resources/limits

# Inline patch
patches:
- target:
    kind: Service
    name: myapp
  patch: |
    apiVersion: v1
    kind: Service
    metadata:
      name: myapp
      annotations:
        service.beta.kubernetes.io/aws-load-balancer-type: nlb
```

### Build and Apply

```bash
# Preview rendered YAML
kubectl kustomize overlays/production/

# Apply directly
kubectl apply -k overlays/production/

# Diff before apply
kubectl diff -k overlays/production/

# Build with standalone kustomize (more features)
kustomize build overlays/production/ | kubectl apply -f -

# Delete
kubectl delete -k overlays/production/
```

### Advanced Features

```yaml
# Cross-cutting fields
commonLabels:
  team: platform
commonAnnotations:
  managed-by: kustomize

# Name transformations
namePrefix: prod-
nameSuffix: -v2

# Replace all namespaces
namespace: production

# Add component (reusable kustomization)
components:
- ../../components/monitoring
- ../../components/logging

# Variable substitution (replacements)
replacements:
- source:
    kind: ConfigMap
    name: app-config
    fieldPath: data.DATABASE_HOST
  targets:
  - select:
      kind: Deployment
    fieldPaths:
    - spec.template.spec.containers.[name=app].env.[name=DB_HOST].value
```

## Common Issues

**"resource not found" in overlay**

Resource name in patch doesn't match base. Names must match exactly (including namespace if set).

**ConfigMap hash suffix breaks references**

Use `generatorOptions: {disableNameSuffixHash: true}` if you don't want hash suffixes. But you lose automatic rollout on config change.

**Overlay doesn't override base**

Strategic merge patches merge arrays by key. For containers, the `name` field is the key. Ensure container names match.

## Best Practices

- **Base + overlays pattern** — base for common, overlays for environment-specific
- **Use `images` transformer** — don't hardcode tags in overlays
- **ConfigMapGenerator with hash** — automatic rollout on config change
- **Keep patches small** — one concern per patch file
- **Use `kubectl diff -k`** — always preview before applying
- **Combine with GitOps** — ArgoCD/Flux natively support Kustomize

## Key Takeaways

- Kustomize customizes YAML without templates — built into kubectl
- Base/overlay pattern for environment-specific config (dev/staging/prod)
- ConfigMapGenerator adds content hash — auto-triggers rolling updates
- Patches: strategic merge (YAML) or JSON patch (precise operations)
- `kubectl apply -k .` deploys, `kubectl kustomize .` previews
