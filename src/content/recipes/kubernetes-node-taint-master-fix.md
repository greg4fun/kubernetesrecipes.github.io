---
title: "Fix node-role.kubernetes.io/master"
description: "Remove the node-role.kubernetes.io/master taint to schedule pods on control plane nodes. Single-node clusters, tolerations, and untolerated taint fix."
publishDate: "2026-04-25"
author: "Luca Berton"
category: "troubleshooting"
difficulty: "beginner"
timeToComplete: "10 minutes"
kubernetesVersion: "1.28+"
tags:
  - "taint"
  - "master"
  - "control-plane"
  - "scheduling"
relatedRecipes:
  - "kubernetes-pending-pod-troubleshooting"
  - "kubernetes-pod-security-standards"
  - "fix-kubernetes-dns-resolution"
---

> 💡 **Quick Answer:** Remove or tolerate the node-role.kubernetes.io/master taint on Kubernetes control plane nodes. Schedule workloads on master nodes for single-node clusters.

## The Problem

Remove or tolerate the node-role. Without proper configuration, teams encounter unexpected behavior, errors, or security gaps in production.

## The Solution

### Configuration

```yaml
# Fix Master Node Taint Kubernetes example
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

- Fix Master Node Taint Kubernetes is essential for production Kubernetes
- Follow the configuration patterns shown above
- Always validate before applying to production
- Combine with monitoring for full observability
