---
title: "How to Manage Kubernetes API Versions and Deprecations"
description: "Handle Kubernetes API version changes and deprecations. Migrate resources to stable APIs and ensure cluster upgrade compatibility."
category: "configuration"
difficulty: "intermediate"
publishDate: "2026-01-22"
tags: ["api", "deprecation", "migration", "upgrades", "compatibility"]
---

# How to Manage Kubernetes API Versions and Deprecations

Kubernetes deprecates APIs over time. Learn to identify deprecated resources, migrate to stable APIs, and prepare for cluster upgrades.

## Check API Versions

```bash
# List all API versions
kubectl api-versions

# List resources with their API groups
kubectl api-resources

# Check specific resource API
kubectl api-resources | grep -i ingress

# Get resource with API version
kubectl get ingresses.networking.k8s.io
```

## Detect Deprecated APIs

```bash
# Install kubent (Kube No Trouble)
brew install kubent  # macOS
# Or download from GitHub

# Scan cluster for deprecated APIs
kubent

# Sample output:
# __________________________________________________________________________________________
# | NAME        | NAMESPACE | KIND      | VERSION         | REPLACEMENT              |
# |-------------|-----------|-----------|-----------------|--------------------------|
# | my-ingress  | default   | Ingress   | extensions/v1beta1 | networking.k8s.io/v1  |
# | my-psp      | default   | PodSecurityPolicy | policy/v1beta1 | N/A (removed)     |
```

## Pluto - Another Detection Tool

```bash
# Install pluto
brew install FairwindsOps/tap/pluto

# Scan manifests in directory
pluto detect-files -d ./manifests/

# Scan Helm releases
pluto detect-helm -o wide

# Scan running cluster
pluto detect-api-resources

# Check against specific K8s version
pluto detect-files -d ./manifests/ --target-versions k8s=v1.29.0
```

## Common Deprecations

```yaml
# Ingress (removed in 1.22)
# OLD: extensions/v1beta1, networking.k8s.io/v1beta1
# NEW: networking.k8s.io/v1

# Before (deprecated)
apiVersion: extensions/v1beta1
kind: Ingress
metadata:
  name: my-ingress

# After (current)
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: my-ingress
spec:
  ingressClassName: nginx  # New field
  rules:
    - host: example.com
      http:
        paths:
          - path: /
            pathType: Prefix  # Required in v1
            backend:
              service:
                name: my-service
                port:
                  number: 80  # Changed structure
```

## HorizontalPodAutoscaler Migration

```yaml
# OLD: autoscaling/v1 (limited)
apiVersion: autoscaling/v1
kind: HorizontalPodAutoscaler
spec:
  targetCPUUtilizationPercentage: 80

# NEW: autoscaling/v2 (full features)
apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata:
  name: my-hpa
spec:
  scaleTargetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: my-app
  minReplicas: 2
  maxReplicas: 10
  metrics:
    - type: Resource
      resource:
        name: cpu
        target:
          type: Utilization
          averageUtilization: 80
```

## CronJob Migration

```yaml
# OLD: batch/v1beta1 (removed in 1.25)
# NEW: batch/v1

apiVersion: batch/v1
kind: CronJob
metadata:
  name: my-cronjob
spec:
  schedule: "0 * * * *"
  jobTemplate:
    spec:
      template:
        spec:
          containers:
            - name: job
              image: busybox
              command: ["echo", "hello"]
          restartPolicy: OnFailure
```

## PodSecurityPolicy to Pod Security Standards

```yaml
# PodSecurityPolicy removed in 1.25
# Replace with Pod Security Admission

# Label namespace with security level
apiVersion: v1
kind: Namespace
metadata:
  name: production
  labels:
    pod-security.kubernetes.io/enforce: restricted
    pod-security.kubernetes.io/audit: restricted
    pod-security.kubernetes.io/warn: restricted
```

## Convert Resources with kubectl

```bash
# Convert deprecated resource to new API
kubectl convert -f old-ingress.yaml --output-version networking.k8s.io/v1

# Note: kubectl convert was removed in 1.24
# Use kubectl-convert plugin instead:
kubectl krew install convert
kubectl convert -f old-resource.yaml
```

## Helm Chart API Updates

```bash
# Check Helm releases for deprecated APIs
helm mapkubeapis --dry-run my-release

# Update release metadata
helm mapkubeapis my-release

# Or reinstall chart
helm upgrade my-release ./chart --version x.y.z
```

## CI/CD Deprecation Checks

```yaml
# GitHub Actions workflow
name: Check Deprecated APIs
on: [pull_request]

jobs:
  check-deprecations:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      
      - name: Install Pluto
        run: |
          curl -L -o pluto.tar.gz https://github.com/FairwindsOps/pluto/releases/download/v5.18.0/pluto_5.18.0_linux_amd64.tar.gz
          tar -xzf pluto.tar.gz
          
      - name: Check for deprecated APIs
        run: |
          ./pluto detect-files -d ./manifests/ \
            --target-versions k8s=v1.29.0 \
            --output-format=json
```

## Pre-Upgrade Checklist

```bash
# 1. Check deprecated APIs in cluster
kubent

# 2. Scan Helm releases
pluto detect-helm

# 3. Review release notes
# https://kubernetes.io/docs/reference/using-api/deprecation-guide/

# 4. Test in staging
# - Upgrade staging cluster
# - Deploy all applications
# - Run integration tests

# 5. Update manifests
# - Change apiVersion
# - Add required new fields
# - Remove deprecated fields

# 6. Update Helm charts
# - Pin to versions supporting new APIs
# - Update values if needed
```

## Storage Class Migration

```yaml
# v1beta1 removed, use v1
apiVersion: storage.k8s.io/v1
kind: StorageClass
metadata:
  name: fast
provisioner: kubernetes.io/gce-pd
parameters:
  type: pd-ssd
allowVolumeExpansion: true
```

## API Version Discovery

```bash
# Check if API version exists
kubectl get --raw /apis/networking.k8s.io/v1

# List all API groups
kubectl get --raw /apis | jq '.groups[].name'

# Check resource in API group
kubectl get --raw /apis/apps/v1 | jq '.resources[].name'

# Get preferred version
kubectl get --raw /apis/autoscaling | jq '.preferredVersion'
```

## Custom Resource Migrations

```yaml
# When CRD API changes, update CR manifests

# Check CRD served versions
kubectl get crd certificates.cert-manager.io -o jsonpath='{.spec.versions[*].name}'

# Update Custom Resources
apiVersion: cert-manager.io/v1  # Not v1alpha2
kind: Certificate
metadata:
  name: my-cert
```

## Summary

Kubernetes deprecates APIs following a predictable timeline. Use kubent or pluto to detect deprecated resources in your cluster and manifests. Common migrations include Ingress to networking.k8s.io/v1, HPA to autoscaling/v2, and CronJob to batch/v1. PodSecurityPolicy is replaced by Pod Security Admission. Run deprecation checks in CI/CD pipelines before cluster upgrades. Review Kubernetes deprecation guide before upgrading. Test migrations in staging before production. Use `kubectl api-versions` and `kubectl api-resources` to verify available APIs.

---

## 📘 Go Further with Kubernetes Recipes

**Love this recipe? There's so much more!** This is just one of **100+ hands-on recipes** in our comprehensive **[Kubernetes Recipes book](/book)**.

Inside the book, you'll master:
- ✅ Production-ready deployment strategies
- ✅ Advanced networking and security patterns  
- ✅ Observability, monitoring, and troubleshooting
- ✅ Real-world best practices from industry experts

> *"The practical, recipe-based approach made complex Kubernetes concepts finally click for me."*

**👉 [Get Your Copy Now](/book)** — Start building production-grade Kubernetes skills today!
