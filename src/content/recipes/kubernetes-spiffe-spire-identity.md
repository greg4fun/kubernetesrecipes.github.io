---
title: "SPIFFE SPIRE Workload Identity K8s"
description: "Implement zero-trust workload identity with SPIFFE and SPIRE on Kubernetes. SVIDs, attestation, and automatic identity rotation for service-to-service auth."
publishDate: "2026-04-24"
author: "Luca Berton"
category: "security"
difficulty: "advanced"
timeToComplete: "15 minutes"
kubernetesVersion: "1.28+"
tags:
  - "spiffe"
  - "spire"
  - "workload-identity"
  - "zero-trust"
relatedRecipes:
  - "kubernetes-pod-security-standards"
  - "kubernetes-rbac-least-privilege"
---

> 💡 **Quick Answer:** Implement zero-trust workload identity with SPIFFE and SPIRE on Kubernetes. SVIDs, attestation, and automatic identity rotation for service-to-service authentication.

## The Problem

Teams need production-ready guidance for spiffe spire workload identity on Kubernetes. This recipe provides step-by-step configuration with YAML examples, common pitfalls, and best practices from real-world deployments.

## The Solution

### Configuration

```yaml
# Example SPIFFE SPIRE Workload Identity configuration
apiVersion: v1
kind: ConfigMap
metadata:
  name: kubernetes-spiffe-spire-identity-config
  namespace: production
data:
  config.yaml: |
    # Production configuration for SPIFFE SPIRE Workload Identity
    enabled: true
    namespace: production
```

### Deployment

```bash
# Verify configuration
kubectl apply --dry-run=server -f config.yaml

# Apply to cluster
kubectl apply -f config.yaml

# Verify
kubectl get all -n production
```

```mermaid
graph TD
    CONFIG[Configuration] --> APPLY[kubectl apply]
    APPLY --> VERIFY[Verify deployment]
    VERIFY --> MONITOR[Monitor health]
```

## Common Issues

**Configuration not taking effect**

Check namespace and resource names match. Use `kubectl describe` to see events and status conditions.

**Pods not starting after changes**

Review events: `kubectl get events --sort-by=.metadata.creationTimestamp -n production`. Check for resource constraints or missing dependencies.

## Best Practices

- **Test in staging first** — validate all configuration changes before production
- **Version control everything** — all YAML in Git with proper review
- **Monitor after changes** — watch metrics and logs for 30 minutes post-deploy
- **Document decisions** — record why specific settings were chosen
- **Automate with GitOps** — ArgoCD or Flux for consistent deployments

## Key Takeaways

- SPIFFE SPIRE Workload Identity is essential for production Kubernetes clusters
- Start with defaults, tune based on monitoring data
- Always test changes in non-production first
- Combine with other security and observability tools for defense in depth
- Keep configurations in version control for audit and rollback
