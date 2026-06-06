---
title: "Run Windows Containers on Kubernetes"
description: "Deploy Windows workloads on Kubernetes with mixed Linux and Windows node pools. Covers taints, node selectors, and Windows-specific networking."
category: "deployments"
difficulty: "intermediate"
publishDate: "2026-04-02"
tags: ["windows", "mixed-os", "node-selector", "taints", "kubernetes"]
author: "Luca Berton"
relatedRecipes:
  - "argocd-gitops"
  - "backstage-kubernetes-developer-portal"
  - "cluster-api-infrastructure-as-code"
  - "deployment-vs-statefulset"
---

> 💡 **Quick Answer:** Deploy Windows workloads on Kubernetes with mixed Linux and Windows node pools. Covers taints, node selectors, and Windows-specific networking.

## The Problem

This is a critical skill for managing production Kubernetes clusters at scale. Without it, teams face operational complexity, security risks, and reliability issues.

## The Solution

Windows and Linux nodes coexist in one cluster. Taint Windows nodes so only Windows workloads land there, then schedule with a node selector plus a matching toleration:

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: iis
spec:
  replicas: 2
  selector:
    matchLabels:
      app: iis
  template:
    metadata:
      labels:
        app: iis
    spec:
      nodeSelector:
        kubernetes.io/os: windows
      tolerations:
        - key: "os"
          operator: "Equal"
          value: "windows"
          effect: "NoSchedule"
      containers:
        - name: iis
          image: mcr.microsoft.com/windows/servercore/iis:windowsservercore-ltsc2022
```

Label and taint the Windows nodes so Linux pods never get scheduled onto them:

```bash
kubectl taint nodes <win-node> os=windows:NoSchedule
kubectl label nodes <win-node> kubernetes.io/os=windows
```

Match the container base image to the node's Windows build (e.g. `ltsc2022`), and note that Windows pods support only a subset of SecurityContext and networking features.

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
