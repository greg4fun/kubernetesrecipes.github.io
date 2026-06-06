---
title: "Kyverno Drift Prevention for GitOps"
description: "Prevent configuration drift in GitOps workflows using Kyverno: block manual kubectl edits, enforce ArgoCD/Flux ownership, and detect out-of-band changes"
tags:
  - "kyverno"
  - "gitops"
  - "argocd"
  - "drift-detection"
  - "policy"
category: "security"
publishDate: "2026-05-06"
author: "Luca Berton"
difficulty: "intermediate"
relatedRecipes:
  - "kyverno-cel-policy-model"
  - "kyverno-rebac-multi-tenant-rbac"
  - "argocd-declarative-application-setup"
  - "flux-gitops-continuous-delivery"
---

> 💡 **Quick Answer:** Use Kyverno to block direct `kubectl edit/apply/patch` on resources managed by ArgoCD or Flux, ensuring all changes flow through Git. Only the GitOps controller's ServiceAccount is allowed to mutate protected resources.

## The Problem

GitOps promises "Git is the single source of truth," but:

- Developers `kubectl edit` deployments directly (bypassing Git)
- Emergency patches done manually are never committed back
- ArgoCD shows "Synced" but actual state differs from desired
- Drift causes outages when ArgoCD re-syncs and reverts changes
- Compliance requires proof that all changes went through approval

## The Solution

### Block Manual Edits on GitOps-Managed Resources

```yaml
apiVersion: kyverno.io/v1
kind: ClusterPolicy
metadata:
  name: prevent-gitops-drift
spec:
  validationFailureAction: Enforce
  background: false
  rules:
    - name: block-manual-updates
      match:
        any:
          - resources:
              kinds:
                - Deployment
                - StatefulSet
                - Service
                - ConfigMap
                - Secret
              namespaceSelector:
                matchLabels:
                  gitops/managed: "true"
              selector:
                matchExpressions:
                  - key: app.kubernetes.io/managed-by
                    operator: In
                    values:
                      - argocd
                      - Helm
      exclude:
        any:
          - subjects:
              - kind: ServiceAccount
                name: argocd-application-controller
                namespace: argocd
              - kind: ServiceAccount
                name: argocd-server
                namespace: argocd
          - clusterRoles:
              - system:kube-controller-manager
              - system:kube-scheduler
      validate:
        message: |
          This resource is managed by GitOps (ArgoCD).
          Direct modifications are not allowed.
          Please commit your change to Git and let ArgoCD sync it.
          
          Resource: {{ request.object.kind }}/{{ request.object.metadata.name }}
          User: {{ request.userInfo.username }}
          
          GitOps repo: Check ArgoCD Application for source URL.
        deny: {}
```

### Allow Emergency Break-Glass

```yaml
apiVersion: kyverno.io/v1
kind: ClusterPolicy
metadata:
  name: gitops-break-glass
spec:
  validationFailureAction: Enforce
  rules:
    - name: allow-emergency-with-annotation
      match:
        any:
          - resources:
              kinds:
                - Deployment
                - StatefulSet
              annotations:
                gitops/emergency-override: "true"
      exclude:
        any:
          - subjects:
              - kind: Group
                name: platform-admins
      validate:
        message: "Only platform-admins can use emergency override"
        deny: {}

    - name: expire-emergency-override
      match:
        any:
          - resources:
              kinds:
                - Deployment
                - StatefulSet
              annotations:
                gitops/emergency-override: "true"
      validate:
        cel:
          expressions:
            - expression: |
                has(object.metadata.annotations['gitops/emergency-expires']) &&
                timestamp(object.metadata.annotations['gitops/emergency-expires']) > now
              message: "Emergency override must have a valid, non-expired timestamp"
```

### Detect Drift via Background Scanning

```yaml
apiVersion: kyverno.io/v1
kind: ClusterPolicy
metadata:
  name: detect-label-drift
spec:
  validationFailureAction: Audit
  background: true
  rules:
    - name: required-labels-present
      match:
        any:
          - resources:
              kinds:
                - Deployment
                - StatefulSet
              namespaceSelector:
                matchLabels:
                  gitops/managed: "true"
      validate:
        cel:
          expressions:
            - expression: |
                has(object.metadata.labels) &&
                'app.kubernetes.io/version' in object.metadata.labels &&
                'app.kubernetes.io/managed-by' in object.metadata.labels
              message: "GitOps-managed resources must retain standard labels"
```

### Protect Specific Fields (Allow Scaling, Block Image Change)

```yaml
apiVersion: kyverno.io/v1
kind: ClusterPolicy
metadata:
  name: protect-critical-fields
spec:
  validationFailureAction: Enforce
  background: false
  rules:
    - name: block-image-change
      match:
        any:
          - resources:
              kinds:
                - Deployment
              operations:
                - UPDATE
              namespaceSelector:
                matchLabels:
                  gitops/managed: "true"
      exclude:
        any:
          - subjects:
              - kind: ServiceAccount
                name: argocd-application-controller
                namespace: argocd
      preconditions:
        any:
          - key: "{{ request.object.spec.template.spec.containers[0].image }}"
            operator: NotEquals
            value: "{{ request.oldObject.spec.template.spec.containers[0].image }}"
      validate:
        message: "Image changes must go through GitOps pipeline"
        deny: {}
```

### Flux-Specific Drift Prevention

```yaml
apiVersion: kyverno.io/v1
kind: ClusterPolicy
metadata:
  name: prevent-flux-drift
spec:
  validationFailureAction: Enforce
  rules:
    - name: block-manual-flux-resources
      match:
        any:
          - resources:
              kinds:
                - Deployment
                - StatefulSet
              annotations:
                kustomize.toolkit.fluxcd.io/name: "?*"
      exclude:
        any:
          - subjects:
              - kind: ServiceAccount
                name: kustomize-controller
                namespace: flux-system
              - kind: ServiceAccount
                name: helm-controller
                namespace: flux-system
      validate:
        message: "This resource is managed by Flux. Commit changes to Git."
        deny: {}
```

## Common Issues

### Kyverno blocks ArgoCD sync
- **Cause**: ArgoCD ServiceAccount not in exclude list
- **Fix**: Add exact ServiceAccount name + namespace to exclude

### HPA can't scale deployments
- **Cause**: Policy blocks all updates including HPA controller
- **Fix**: Exclude `system:kube-controller-manager` or HPA ServiceAccount

### Developers can't debug in staging
- **Cause**: Policy too broad — blocks even read-like operations
- **Fix**: Only match `UPDATE`/`PATCH` operations; allow `GET`/`LIST`

## Best Practices

1. **Label namespaces** `gitops/managed: true` — opt-in, not global
2. **Exclude system controllers** — HPA, VPA, kube-controller-manager
3. **Break-glass with audit trail** — emergency annotation + expiry
4. **Audit mode first** — discover who's making manual changes
5. **Clear error messages** — tell user WHERE to commit instead
6. **Protect images, allow replicas** — not all drift is equal

## Key Takeaways

- Kyverno blocks manual `kubectl` mutations on GitOps-managed resources
- Only GitOps controller ServiceAccounts are excluded from the deny rule
- Break-glass: emergency annotation with expiry timestamp for incidents
- Background scanning detects label/config drift even without admission
- Flux and ArgoCD have different ServiceAccount patterns — configure both
- HPA/VPA scaling must be explicitly allowed (exclude their ServiceAccounts)
- Clear deny messages guide developers to the correct GitOps workflow
