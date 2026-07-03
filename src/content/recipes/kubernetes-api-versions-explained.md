---
title: "Kubernetes API Versions Explained"
description: "Understand K8s API versions: alpha, beta, stable. API deprecation policy, migration strategy, and kubectl api-versions usage."
publishDate: "2026-04-25"
author: "Luca Berton"
category: "configuration"
difficulty: "beginner"
timeToComplete: "15 minutes"
kubernetesVersion: "1.28+"
tags:
  - "api-versions"
  - "deprecation"
  - "migration"
  - "alpha-beta"
relatedRecipes:
  - "kubernetes-pod-security-standards"
  - "kubernetes-rbac-least-privilege"
---

> 💡 **Quick Answer:** Understand K8s API versions: alpha, beta, stable. API deprecation policy, migration strategy, and kubectl api-versions usage.

## The Problem

Kubernetes deprecates and eventually removes APIs on a predictable schedule — an `apiVersion` that works today can disappear after a cluster upgrade, breaking `kubectl apply` and Helm installs with no warning until that exact moment.

## The Solution

### Inspecting What's Available

```bash
kubectl api-versions                          # all API versions
kubectl api-resources                         # resources with their API groups
kubectl api-resources | grep -i ingress       # check a specific resource
kubectl get --raw /apis/networking.k8s.io/v1  # confirm a group/version exists
kubectl get --raw /apis/autoscaling | jq '.preferredVersion'
```

### Detecting Deprecated APIs Before You Upgrade

```bash
# kubent (Kube No Trouble) — scans a running cluster
kubent
# | NAME       | NAMESPACE | KIND    | VERSION             | REPLACEMENT           |
# | my-ingress | default   | Ingress | extensions/v1beta1  | networking.k8s.io/v1  |

# pluto — scans manifests, Helm releases, or a live cluster against a target version
pluto detect-files -d ./manifests/ --target-versions k8s=v1.29.0
pluto detect-helm -o wide
pluto detect-api-resources
```

### Common Migrations

```yaml
# Ingress: extensions/v1beta1 (removed 1.22) → networking.k8s.io/v1
apiVersion: networking.k8s.io/v1
kind: Ingress
spec:
  ingressClassName: nginx        # new required field
  rules:
    - http:
        paths:
          - pathType: Prefix     # now required
            backend: {service: {name: my-service, port: {number: 80}}}
```

```yaml
# HPA: autoscaling/v1 (CPU-only) → autoscaling/v2 (full metrics support)
apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
spec:
  metrics: [{type: Resource, resource: {name: cpu, target: {type: Utilization, averageUtilization: 80}}}]
```

```yaml
# CronJob: batch/v1beta1 (removed 1.25) → batch/v1 — same shape, just the group
apiVersion: batch/v1
kind: CronJob
```

```yaml
# PodSecurityPolicy (removed 1.25) → Pod Security Admission namespace labels
metadata:
  labels: {pod-security.kubernetes.io/enforce: restricted}
```

### Converting Manifests

```bash
# kubectl convert was removed from core kubectl in 1.24 — install the plugin
kubectl krew install convert
kubectl convert -f old-resource.yaml --output-version networking.k8s.io/v1
```

```bash
# Helm releases store the API version in their stored manifest — update it directly
helm mapkubeapis --dry-run my-release
helm mapkubeapis my-release
```

### CI/CD Deprecation Gate

```yaml
# GitHub Actions — fail the PR if it introduces a deprecated API
name: Check Deprecated APIs
on: [pull_request]
jobs:
  check-deprecations:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: |
          curl -L -o pluto.tar.gz https://github.com/FairwindsOps/pluto/releases/download/v5.18.0/pluto_5.18.0_linux_amd64.tar.gz
          tar -xzf pluto.tar.gz
          ./pluto detect-files -d ./manifests/ --target-versions k8s=v1.29.0 --output-format=json
```

### Pre-Upgrade Checklist

```text
1. kubent                          — scan the live cluster
2. pluto detect-helm                — scan installed Helm releases
3. Review the K8s deprecation guide for the target version
4. Upgrade staging first, deploy everything, run integration tests
5. Update manifests: apiVersion, new required fields, remove deprecated fields
6. Update/pin Helm charts to versions supporting the new APIs
```

## Common Issues

| Issue | Cause | Fix |
|-------|-------|-----|
| `kubectl apply` fails with "no matches for kind" after upgrade | The API version was removed in this release | Migrate the manifest's `apiVersion` before upgrading, not after |
| Helm release stuck referencing a removed API | Helm's stored release metadata still points at the old API | `helm mapkubeapis <release>` to update the stored metadata |
| `kubectl convert` command not found | Removed from core kubectl in 1.24 | Install via `kubectl krew install convert` |
| CI doesn't catch a deprecated API until deploy | No deprecation scan in the pipeline | Add a `pluto`/`kubent` step gating merges, not just deploys |

## Best Practices

- **Scan before every cluster upgrade**, not after something breaks — `kubent` (live cluster) and `pluto` (manifests/Helm) both take seconds to run
- **Gate CI on deprecated APIs**, don't just catch them at deploy time
- **Migrate one release ahead of removal** — APIs are typically deprecated for ~2-3 releases before removal, giving real lead time
- **Update Helm chart pins**, not just raw manifests — a stale chart version is a common source of deprecated API resurfacing
- **Test the full upgrade in staging** — schema changes (like Ingress's new `pathType` requirement) aren't always caught by a version bump alone

## Key Takeaways

- APIs move through alpha → beta → stable, then get deprecated and eventually removed — always with advance notice in release notes, never silently
- `kubent` scans a live cluster; `pluto` scans manifests, Helm releases, or a live cluster against a specific target version
- Ingress (`extensions/v1beta1`→`networking.k8s.io/v1`), HPA (`v1`→`v2`), CronJob (`batch/v1beta1`→`batch/v1`), and PodSecurityPolicy→PSA are the migrations almost every cluster eventually hits
- `kubectl convert` is a separate `krew` plugin since 1.24, not built into core kubectl anymore
- Run deprecation scans in CI, before the upgrade — not as a post-mortem after `kubectl apply` starts failing
