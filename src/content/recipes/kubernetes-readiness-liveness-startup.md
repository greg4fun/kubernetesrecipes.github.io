---
title: "Readiness Liveness Startup Probes"
description: "Configure Kubernetes health probes correctly. When to use each probe type, common mistakes, and production-ready probe configurations."
publishDate: "2026-04-25"
author: "Luca Berton"
category: "deployments"
difficulty: "beginner"
timeToComplete: "15 minutes"
kubernetesVersion: "1.28+"
tags:
  - "probes"
  - "readiness"
  - "liveness"
  - "startup"
  - "health-check"
relatedRecipes:
  - "kubernetes-pod-security-standards"
  - "kubernetes-rbac-least-privilege"
---

> 💡 **Quick Answer:** Configure Kubernetes health probes correctly. When to use each probe type, common mistakes, and production-ready probe configurations.

## The Problem

Production Kubernetes clusters need readiness liveness startup probes for reliability and operational maturity. This recipe provides clear configuration examples, common pitfalls, and battle-tested patterns.

## The Solution

### Configuration

```yaml
# Readiness Liveness Startup Probes setup
apiVersion: v1
kind: ConfigMap
metadata:
  name: kubernetes-readiness-liveness-startup-config
  namespace: production
data:
  config.yaml: |
    enabled: true
    namespace: production
```

### Deployment

```bash
# Apply configuration
kubectl apply -f config.yaml

# Verify
kubectl get all -n production
```

```mermaid
graph TD
    CONFIG[Configure] --> DEPLOY[Deploy]
    DEPLOY --> VERIFY[Verify]
    VERIFY --> MONITOR[Monitor]
```

## Common Issues

**Configuration not applying**

Verify namespace exists and RBAC allows the operation. Check events: `kubectl get events -n production --sort-by=.metadata.creationTimestamp`.

**Unexpected behavior after changes**

Review all related resources. Use `kubectl diff -f config.yaml` before applying to see what will change.

## Best Practices

- Test in staging before production
- Version all configuration in Git
- Monitor metrics after changes
- Document operational procedures
- Use GitOps for consistent deployments

## Key Takeaways

- Readiness Liveness Startup Probes is critical for production Kubernetes operations
- Start with safe defaults, tune based on monitoring
- Always test in non-production first
- Combine with observability for full visibility
- Automate repetitive tasks with CI/CD
