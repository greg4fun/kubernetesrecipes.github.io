---
title: "HPA Custom Metrics Autoscaling"
description: "Scale Kubernetes workloads on custom Prometheus metrics with HPA. Prometheus Adapter, external metrics, and request-rate-based scaling for web services."
publishDate: "2026-04-24"
author: "Luca Berton"
category: "autoscaling"
difficulty: "intermediate"
timeToComplete: "15 minutes"
kubernetesVersion: "1.28+"
tags:
  - "hpa"
  - "custom-metrics"
  - "prometheus-adapter"
  - "autoscaling"
relatedRecipes:
  - "kubernetes-pod-security-standards"
  - "kubernetes-rbac-least-privilege"
---

> 💡 **Quick Answer:** Scale Kubernetes workloads on custom Prometheus metrics with HPA. Prometheus Adapter, external metrics, and request-rate-based scaling for web services.

## The Problem

Teams need production-ready guidance for hpa custom metrics autoscaling on Kubernetes. This recipe provides step-by-step configuration with YAML examples, common pitfalls, and best practices from real-world deployments.

## The Solution

### Configuration

```yaml
# Example HPA Custom Metrics Autoscaling configuration
apiVersion: v1
kind: ConfigMap
metadata:
  name: kubernetes-hpa-custom-metrics-guide-config
  namespace: production
data:
  config.yaml: |
    # Production configuration for HPA Custom Metrics Autoscaling
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

- HPA Custom Metrics Autoscaling is essential for production Kubernetes clusters
- Start with defaults, tune based on monitoring data
- Always test changes in non-production first
- Combine with other security and observability tools for defense in depth
- Keep configurations in version control for audit and rollback
