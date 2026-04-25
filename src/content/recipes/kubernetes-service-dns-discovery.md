---
title: "Service DNS Discovery Kubernetes"
description: "How Kubernetes DNS service discovery works. Service FQDN format, headless services, SRV records, and cross-namespace DNS resolution patterns."
publishDate: "2026-04-25"
author: "Luca Berton"
category: "networking"
difficulty: "beginner"
timeToComplete: "10 minutes"
kubernetesVersion: "1.28+"
tags:
  - "dns"
  - "service-discovery"
  - "fqdn"
  - "headless"
relatedRecipes:
  - "kubernetes-pod-security-standards"
---

> 💡 **Quick Answer:** How Kubernetes DNS service discovery works. Service FQDN format, headless services, SRV records, and cross-namespace DNS resolution patterns.

## The Problem

How Kubernetes DNS service discovery works. Without proper configuration, teams encounter unexpected behavior, errors, or security gaps in production.

## The Solution

### Configuration

```yaml
# Service DNS Discovery Kubernetes example
apiVersion: v1
kind: ConfigMap
metadata:
  name: example
data:
  key: value
```

### Steps

```bash
kubectl apply -f config.yaml
kubectl get all -n production
```

```mermaid
graph TD
    A[Identify need] --> B[Configure]
    B --> C[Deploy]
    C --> D[Verify]
```

## Common Issues

**Configuration not working**: Check YAML syntax and ensure the namespace exists. Use `kubectl apply --dry-run=server` to validate before applying.

## Best Practices

- Test changes in staging first
- Version all configs in Git
- Monitor after deployment
- Document decisions for the team

## Key Takeaways

- Service DNS Discovery Kubernetes is essential for production Kubernetes
- Follow the configuration patterns shown above
- Always validate before applying to production
- Combine with monitoring for full observability
