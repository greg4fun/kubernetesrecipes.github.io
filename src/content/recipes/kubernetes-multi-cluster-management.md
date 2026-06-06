---
title: "Multi-Cluster Mgmt Strategies K8s"
description: "Manage multiple Kubernetes clusters with federation, service mesh, and GitOps. Covers Admiralty, Liqo, Skupper, and ArgoCD ApplicationSets."
category: "deployments"
difficulty: "advanced"
publishDate: "2026-04-02"
tags: ["multi-cluster", "federation", "gitops", "argocd", "kubernetes"]
author: "Luca Berton"
relatedRecipes:
  - "argocd-gitops"
  - "argocd-multi-cluster-app-of-apps"
  - "argocd-app-of-apps-pattern"
  - "argocd-app-of-apps-sync-waves"
---

> 💡 **Quick Answer:** Manage multiple Kubernetes clusters with federation, service mesh, and GitOps. Covers Admiralty, Liqo, Skupper, and ArgoCD ApplicationSets.

## The Problem

This is a critical skill for managing production Kubernetes clusters at scale. Without it, teams face operational complexity, security risks, and reliability issues.

## The Solution

Manage fleets declaratively: register clusters once, then let an ArgoCD ApplicationSet fan a single app out to every cluster. The cluster generator targets all registered clusters automatically:

```yaml
apiVersion: argoproj.io/v1alpha1
kind: ApplicationSet
metadata:
  name: guestbook
  namespace: argocd
spec:
  generators:
    - clusters: {}          # every cluster registered in Argo CD
  template:
    metadata:
      name: 'guestbook-{{name}}'
    spec:
      project: default
      source:
        repoURL: https://github.com/org/fleet.git
        targetRevision: main
        path: apps/guestbook
      destination:
        server: '{{server}}'
        namespace: guestbook
```

Register a cluster with the Argo CD CLI:

```bash
argocd cluster add prod-eu --name prod-eu
argocd cluster list
```

For cross-cluster service connectivity, layer a mesh (Istio multi-primary, Cilium Cluster Mesh, or Skupper) on top of this GitOps foundation.

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
