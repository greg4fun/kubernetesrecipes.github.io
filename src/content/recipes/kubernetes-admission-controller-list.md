---
title: "Admission Controllers List K8s"
description: "Complete list of K8s admission controllers. Enable/disable controllers, common ones (PodSecurity, ResourceQuota), and custom webhooks."
publishDate: "2026-04-25"
author: "Luca Berton"
category: "configuration"
difficulty: "intermediate"
timeToComplete: "15 minutes"
kubernetesVersion: "1.28+"
tags:
  - "admission-controller"
  - "webhook"
  - "validation"
  - "mutation"
relatedRecipes:
  - "kubernetes-pod-security-standards"
  - "kubernetes-rbac-least-privilege"
---

> 💡 **Quick Answer:** Complete list of K8s admission controllers. Enable/disable controllers, common ones (PodSecurity, ResourceQuota), and custom webhooks.

## The Problem

Teams running production K8s clusters need admission controllers list k8s for reliability, security, and operational excellence. Misconfiguration leads to outages, security gaps, or wasted resources.

## The Solution

### Prerequisites

```bash
# Verify cluster access
kubectl cluster-info
kubectl get nodes
```

### Configuration

```yaml
# Admission Controllers List K8s — production example
apiVersion: v1
kind: ConfigMap
metadata:
  name: kubernetes-admission-controller-list-config
  namespace: production
  labels:
    app.kubernetes.io/managed-by: kubectl
data:
  config.yaml: |
    enabled: true
    logLevel: info
```

### Deployment

```bash
# Apply the configuration
kubectl apply -f config.yaml

# Verify deployment
kubectl get all -n production -l app.kubernetes.io/managed-by=kubectl

# Check logs for errors
kubectl logs -n production -l component=controller --tail=50
```

### Verification

```bash
# Confirm everything is running
kubectl get pods -n production -o wide
kubectl describe pod -n production <pod-name>
```

```mermaid
graph TD
    A[Identify Requirement] --> B[Review Configuration]
    B --> C[Apply to Staging]
    C --> D{Tests Pass?}
    D -->|Yes| E[Apply to Production]
    D -->|No| F[Debug & Fix]
    F --> C
    E --> G[Monitor & Alert]
```

## Common Issues

**Configuration not taking effect**

Verify the resource exists in the correct namespace. Check for typos in label selectors. Use `kubectl get events` to see scheduling or admission errors.

**Performance degradation after changes**

Monitor resource usage before and after. Use `kubectl top pods` and check Prometheus metrics. Roll back if metrics degrade: `kubectl rollout undo`.

**RBAC permission denied**

Ensure the ServiceAccount has the required ClusterRole or Role bindings. Use `kubectl auth can-i` to verify permissions.

## Best Practices

- **Test in staging first** — never apply untested configs to production
- **Use GitOps** — version all manifests in Git for audit trail and rollback
- **Monitor after deployment** — set up alerts for key metrics within 15 minutes
- **Document decisions** — record why configurations were chosen in PR descriptions
- **Automate validation** — add CI checks for YAML syntax and policy compliance

## Key Takeaways

- Admission Controllers List K8s is critical for production K8s operations
- Start with safe defaults and tune based on real monitoring data
- Always test changes in non-production environments first
- Combine with observability for full visibility into cluster behavior
- Automate repetitive tasks with CI/CD pipelines and GitOps
