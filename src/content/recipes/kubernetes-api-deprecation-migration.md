---
title: "Kubernetes API Deprecation Migration Guide"
description: "Migrate deprecated Kubernetes APIs before cluster upgrades. Detect deprecated resources with pluto, kubent, and kubectl convert."
category: "configuration"
difficulty: "beginner"
publishDate: "2026-04-02"
tags: ["api-deprecation", "migration", "upgrade", "pluto", "kubernetes"]
author: "Luca Berton"
relatedRecipes:
  - "kubernetes-velero-backup-restore"
  - "kubernetes-cluster-upgrade-guide"
  - "api-versions-deprecations"
  - "kubectl-cheat-sheet"
---

> 💡 **Quick Answer:** Migrate deprecated Kubernetes APIs before cluster upgrades. Detect deprecated resources with pluto, kubent, and kubectl convert.

## The Problem

This is a critical skill for managing production Kubernetes clusters at scale. Without it, teams face operational complexity, security risks, and reliability issues.

## The Solution

Before any upgrade, scan both live objects and source manifests for APIs removed in the target version. `pluto` detects deprecated and removed `apiVersions`:

```bash
# Scan live cluster objects against a target Kubernetes version
pluto detect-all-in-cluster --target-versions k8s=v1.33

# Scan Helm releases and raw manifests in your repo
pluto detect-helm --target-versions k8s=v1.33
pluto detect-files -d ./manifests --target-versions k8s=v1.33
```

Convert an out-of-date manifest to a supported `apiVersion` with `kubectl convert`:

```bash
# Example: Ingress networking.k8s.io/v1beta1 -> v1
kubectl convert -f old-ingress.yaml \
  --output-version networking.k8s.io/v1 > new-ingress.yaml
kubectl apply -f new-ingress.yaml
```

Always fix the source of truth (Helm charts, Kustomize bases, GitOps repos) — not just the live object — so the deprecated API does not reappear on the next reconcile.

## Common Issues

### Troubleshooting
Check logs and events first. Most issues have clear error messages pointing to the root cause.

## Best Practices

- **Follow the principle of least privilege** for all configurations
- **Test in staging** before applying to production
- **Monitor and alert** on key metrics
- **Document your runbooks** for the team

## Key Takeaways

- Essential knowledge for Kubernetes operations at scale
- Start simple and evolve your approach as needed
- Automation reduces human error and operational toil
- Share learnings across your team
