---
title: "ValidatingAdmissionPolicy with CEL"
description: "Replace admission webhooks with ValidatingAdmissionPolicy and CEL expressions for in-process, low-latency Kubernetes policy enforcement."
publishDate: "2026-04-21"
author: "Luca Berton"
category: "security"
difficulty: "advanced"
timeToComplete: "15 minutes"
kubernetesVersion: "1.30+"
tags:
  - admission-policy
  - cel
  - policy
  - validation
relatedRecipes:
  - "kyverno-policy-management"
  - "kubernetes-pod-security-admission"
---

> 💡 **Quick Answer:** ValidatingAdmissionPolicy uses CEL (Common Expression Language) to enforce policies directly in the API server — no webhooks, no external dependencies, sub-millisecond evaluation.

## The Problem

Admission webhooks (OPA/Gatekeeper, Kyverno) add latency, create availability dependencies, and require separate infrastructure. If the webhook is down, cluster operations can stall or all requests get allowed.

## The Solution

### Basic Policy: Require Labels

```yaml
apiVersion: admissionregistration.k8s.io/v1
kind: ValidatingAdmissionPolicy
metadata:
  name: require-team-label
spec:
  failurePolicy: Fail
  matchConstraints:
    resourceRules:
      - apiGroups: ["apps"]
        apiVersions: ["v1"]
        operations: ["CREATE", "UPDATE"]
        resources: ["deployments"]
  validations:
    - expression: "has(object.metadata.labels) && 'team' in object.metadata.labels"
      message: "All deployments must have a 'team' label"
---
apiVersion: admissionregistration.k8s.io/v1
kind: ValidatingAdmissionPolicyBinding
metadata:
  name: require-team-label-binding
spec:
  policyName: require-team-label
  validationActions:
    - Deny
  matchResources:
    namespaceSelector:
      matchExpressions:
        - key: environment
          operator: In
          values: ["production"]
```

### Block Privileged Containers

```yaml
apiVersion: admissionregistration.k8s.io/v1
kind: ValidatingAdmissionPolicy
metadata:
  name: deny-privileged
spec:
  failurePolicy: Fail
  matchConstraints:
    resourceRules:
      - apiGroups: [""]
        apiVersions: ["v1"]
        operations: ["CREATE"]
        resources: ["pods"]
  validations:
    - expression: |
        object.spec.containers.all(c,
          !has(c.securityContext) ||
          !has(c.securityContext.privileged) ||
          c.securityContext.privileged == false
        )
      message: "Privileged containers are not allowed"
```

### Resource Limits Required

```yaml
apiVersion: admissionregistration.k8s.io/v1
kind: ValidatingAdmissionPolicy
metadata:
  name: require-resource-limits
spec:
  failurePolicy: Fail
  matchConstraints:
    resourceRules:
      - apiGroups: [""]
        apiVersions: ["v1"]
        operations: ["CREATE", "UPDATE"]
        resources: ["pods"]
  validations:
    - expression: |
        object.spec.containers.all(c,
          has(c.resources) &&
          has(c.resources.limits) &&
          has(c.resources.limits.memory)
        )
      message: "All containers must have memory limits set"
```

### Parameterized Policy

```yaml
apiVersion: admissionregistration.k8s.io/v1
kind: ValidatingAdmissionPolicy
metadata:
  name: max-replicas
spec:
  failurePolicy: Fail
  paramKind:
    apiVersion: v1
    kind: ConfigMap
  matchConstraints:
    resourceRules:
      - apiGroups: ["apps"]
        apiVersions: ["v1"]
        operations: ["CREATE", "UPDATE"]
        resources: ["deployments"]
  validations:
    - expression: "object.spec.replicas <= int(params.data.maxReplicas)"
      messageExpression: "'Replicas ' + string(object.spec.replicas) + ' exceeds max ' + params.data.maxReplicas"
---
apiVersion: v1
kind: ConfigMap
metadata:
  name: max-replicas-params
  namespace: default
data:
  maxReplicas: "50"
```

```mermaid
graph LR
    A[API Request] --> B[API Server]
    B --> C{ValidatingAdmissionPolicy}
    C -->|CEL evaluates| D{Pass?}
    D -->|Yes| E[Request Admitted]
    D -->|No| F[Request Denied]
    Note over C: In-process evaluation<br/>No network call
```

## Common Issues

**CEL expression syntax errors**
Test expressions with `kubectl apply --dry-run=server`:
```bash
kubectl create deployment test --image=nginx --dry-run=server
```

**Policy not enforcing**
Check that the PolicyBinding exists and `validationActions` includes `Deny`:
```bash
kubectl get validatingadmissionpolicybindings
```

**Feature gate not enabled (pre-1.30)**
Requires `ValidatingAdmissionPolicy` feature gate on api-server in 1.28-1.29.

## Best Practices

- Start with `validationActions: [Warn]` before switching to `[Deny]`
- Use `Audit` action to log violations without blocking
- Prefer CEL over webhooks for stateless validation rules
- Use parameterized policies for tenant-specific thresholds
- Keep CEL expressions simple — complex logic should stay in webhooks
- Test policies in a staging namespace with dry-run

## Key Takeaways

- ValidatingAdmissionPolicy is GA in 1.30 — no feature gates needed
- CEL expressions evaluate in-process (microseconds, not milliseconds)
- No external dependencies — policies work even if network is partitioned
- PolicyBindings control where policies apply (namespace selectors, etc.)
- `Warn` and `Audit` actions enable gradual rollout
- Parameterized policies reuse logic with different thresholds per namespace
