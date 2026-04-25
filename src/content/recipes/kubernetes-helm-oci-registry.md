---
title: "Helm OCI Registry Push Pull Guide"
description: "Push and pull Helm charts from OCI registries. Harbor, ECR, ACR, and GCR integration for Helm chart distribution and versioning."
publishDate: "2026-04-24"
author: "Luca Berton"
category: "helm"
difficulty: "intermediate"
timeToComplete: "15 minutes"
kubernetesVersion: "1.28+"
tags:
  - "helm"
  - "oci"
  - "registry"
  - "harbor"
relatedRecipes:
  - "kubernetes-pod-security-standards"
---

> 💡 **Quick Answer:** Push and pull Helm charts from OCI registries. Harbor, ECR, ACR, and GCR integration for Helm chart distribution and versioning.

## The Problem

Production Kubernetes environments need helm oci registry integration for reliability, security, and operational efficiency. Without proper configuration, teams face downtime, security gaps, or operational overhead.

## The Solution

### Configuration

```yaml
# Helm OCI Registry Integration configuration
apiVersion: v1
kind: ConfigMap
metadata:
  name: kubernetes-helm-oci-registry-config
data:
  config.yaml: |
    enabled: true
```

### Deployment Steps

```bash
# Apply configuration
kubectl apply -f kubernetes-helm-oci-registry.yaml

# Verify
kubectl get all -l app=helm-oci-registry
```

```mermaid
graph TD
    PLAN[Plan configuration] --> APPLY[Deploy to cluster]
    APPLY --> VERIFY[Verify health]
    VERIFY --> MONITOR[Ongoing monitoring]
```

## Common Issues

**Resources not created**

Check RBAC permissions and namespace exists. Use `kubectl auth can-i create <resource>` to verify.

**Configuration drift**

Use GitOps (ArgoCD/Flux) to prevent manual changes from diverging from desired state.

## Best Practices

- Test in staging before production
- Version all configuration in Git
- Monitor metrics after deployment
- Document operational procedures
- Automate with CI/CD pipelines

## Key Takeaways

- Helm OCI Registry Integration improves Kubernetes operational maturity
- Start simple, iterate based on real-world experience
- Combine with observability for full visibility
- Automate repetitive operations
- Keep security as a first-class concern
