---
title: "How to Use Kustomize for Configuration Management"
description: "Manage Kubernetes configurations with Kustomize overlays. Customize base manifests for different environments without template duplication."
category: "configuration"
difficulty: "intermediate"
publishDate: "2026-01-22"
tags: ["kustomize", "configuration", "overlays", "environments", "gitops"]
---

# How to Use Kustomize for Configuration Management

Kustomize provides template-free customization of Kubernetes manifests. Create base configurations and use overlays to customize for different environments without duplicating YAML files.

## Directory Structure

```
myapp/
├── base/
│   ├── kustomization.yaml
│   ├── deployment.yaml
│   ├── service.yaml
│   └── configmap.yaml
├── overlays/
│   ├── development/
│   │   ├── kustomization.yaml
│   │   └── replica-count.yaml
│   ├── staging/
│   │   ├── kustomization.yaml
│   │   └── namespace.yaml
│   └── production/
│       ├── kustomization.yaml
│       ├── replica-count.yaml
│       └── resource-limits.yaml
```

## Base Configuration

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

commonAnnotations:
  team: platform
```

```yaml
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
        - name: myapp
          image: myapp:latest
          ports:
            - containerPort: 8080
          resources:
            requests:
              cpu: 100m
              memory: 128Mi
```

```yaml
# base/service.yaml
apiVersion: v1
kind: Service
metadata:
  name: myapp
spec:
  selector:
    app: myapp
  ports:
    - port: 80
      targetPort: 8080
```

## Development Overlay

```yaml
# overlays/development/kustomization.yaml
apiVersion: kustomize.config.k8s.io/v1beta1
kind: Kustomization

namespace: development

resources:
  - ../../base

namePrefix: dev-
nameSuffix: -v1

commonLabels:
  environment: development

# Patch replicas
patches:
  - target:
      kind: Deployment
      name: myapp
    patch: |-
      - op: replace
        path: /spec/replicas
        value: 1

images:
  - name: myapp
    newTag: dev-latest
```

## Production Overlay

```yaml
# overlays/production/kustomization.yaml
apiVersion: kustomize.config.k8s.io/v1beta1
kind: Kustomization

namespace: production

resources:
  - ../../base

commonLabels:
  environment: production

# Strategic merge patches
patches:
  - path: replica-count.yaml
  - path: resource-limits.yaml

images:
  - name: myapp
    newName: registry.example.com/myapp
    newTag: v1.2.3

# Generate ConfigMap from files
configMapGenerator:
  - name: app-config
    files:
      - config.properties
    options:
      disableNameSuffixHash: true
```

```yaml
# overlays/production/replica-count.yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: myapp
spec:
  replicas: 5
```

```yaml
# overlays/production/resource-limits.yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: myapp
spec:
  template:
    spec:
      containers:
        - name: myapp
          resources:
            requests:
              cpu: 500m
              memory: 512Mi
            limits:
              cpu: 1000m
              memory: 1Gi
```

## ConfigMap and Secret Generators

```yaml
# kustomization.yaml
apiVersion: kustomize.config.k8s.io/v1beta1
kind: Kustomization

configMapGenerator:
  # From literal values
  - name: app-settings
    literals:
      - LOG_LEVEL=info
      - MAX_CONNECTIONS=100

  # From files
  - name: app-config
    files:
      - application.yaml
      - logging.conf

  # From env file
  - name: env-config
    envs:
      - .env

secretGenerator:
  - name: db-credentials
    literals:
      - username=admin
      - password=secret123
    type: kubernetes.io/basic-auth

  # From files
  - name: tls-certs
    files:
      - tls.crt
      - tls.key
    type: kubernetes.io/tls

generatorOptions:
  disableNameSuffixHash: false  # Adds hash suffix by default
```

## JSON Patches

```yaml
# kustomization.yaml
patches:
  # JSON 6902 patch
  - target:
      group: apps
      version: v1
      kind: Deployment
      name: myapp
    patch: |-
      - op: add
        path: /spec/template/spec/containers/0/env
        value:
          - name: ENVIRONMENT
            value: production
      - op: replace
        path: /spec/template/spec/containers/0/image
        value: myapp:v2.0.0
```

## Strategic Merge Patches

```yaml
# patch-resources.yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: myapp
spec:
  template:
    spec:
      containers:
        - name: myapp
          resources:
            limits:
              memory: 2Gi
          env:
            - name: NEW_VAR
              value: "new-value"
```

## Components (Reusable Patches)

```yaml
# components/monitoring/kustomization.yaml
apiVersion: kustomize.config.k8s.io/v1alpha1
kind: Component

patches:
  - patch: |-
      - op: add
        path: /spec/template/spec/containers/0/ports/-
        value:
          containerPort: 9090
          name: metrics
    target:
      kind: Deployment

  - patch: |-
      - op: add
        path: /spec/template/metadata/annotations
        value:
          prometheus.io/scrape: "true"
          prometheus.io/port: "9090"
    target:
      kind: Deployment
```

```yaml
# overlays/production/kustomization.yaml
apiVersion: kustomize.config.k8s.io/v1beta1
kind: Kustomization

resources:
  - ../../base

components:
  - ../../components/monitoring
  - ../../components/security
```

## Build and Apply

```bash
# Preview generated manifests
kubectl kustomize overlays/production

# Apply directly
kubectl apply -k overlays/production

# Build to file
kubectl kustomize overlays/production > manifests.yaml

# Diff against cluster
kubectl diff -k overlays/production
```

## Replacements (Variable Substitution)

```yaml
# kustomization.yaml
apiVersion: kustomize.config.k8s.io/v1beta1
kind: Kustomization

resources:
  - deployment.yaml

replacements:
  - source:
      kind: ConfigMap
      name: app-config
      fieldPath: data.database_host
    targets:
      - select:
          kind: Deployment
          name: myapp
        fieldPaths:
          - spec.template.spec.containers.[name=myapp].env.[name=DB_HOST].value
```

## Helm Chart Integration

```yaml
# kustomization.yaml
apiVersion: kustomize.config.k8s.io/v1beta1
kind: Kustomization

helmCharts:
  - name: prometheus
    repo: https://prometheus-community.github.io/helm-charts
    version: 25.8.0
    releaseName: prometheus
    namespace: monitoring
    valuesFile: values.yaml
```

## Remote Resources

```yaml
# kustomization.yaml
apiVersion: kustomize.config.k8s.io/v1beta1
kind: Kustomization

resources:
  # Remote git repository
  - github.com/myorg/k8s-common//base?ref=v1.0.0
  
  # Raw URL
  - https://raw.githubusercontent.com/myorg/repo/main/manifests/crd.yaml
```

## Summary

Kustomize enables configuration management without templates. Define base manifests, create overlays per environment, and use patches for customization. Use ConfigMap/Secret generators for dynamic content, components for reusable modifications, and integrate with GitOps workflows.

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
