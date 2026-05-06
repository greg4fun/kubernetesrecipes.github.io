---
title: "Kyverno CEL Policy Model Migration"
description: "Migrate Kyverno policies from YAML-based rules to CEL expressions for type-safe, performant validation. Covers CEL syntax, migration patterns, and comparison with traditional Kyverno rules."
tags:
  - "kyverno"
  - "cel"
  - "policy"
  - "admission-control"
  - "security"
category: "security"
publishDate: "2026-05-06"
author: "Luca Berton"
difficulty: "advanced"
relatedRecipes:
  - "kubernetes-kyverno-policy-guide"
  - "kyverno-rebac-multi-tenant-rbac"
  - "kyverno-drift-prevention-gitops"
  - "kyverno-llm-inference-guardrails"
---

> 💡 **Quick Answer:** Kyverno now supports CEL (Common Expression Language) as a policy expression engine alongside traditional YAML overlays, enabling type-safe, compile-time validated policies with better performance and alignment with Kubernetes ValidatingAdmissionPolicy.

## The Problem

Traditional Kyverno YAML-based policies:

- Lack type safety (errors found at runtime, not authoring time)
- Limited expressiveness for complex conditions
- No compile-time validation of policy logic
- Difficult to express mathematical/string operations
- Separate syntax from Kubernetes-native ValidatingAdmissionPolicy

## The Solution

### Traditional YAML vs CEL Comparison

```yaml
# Traditional Kyverno YAML pattern match
apiVersion: kyverno.io/v1
kind: ClusterPolicy
metadata:
  name: require-labels
spec:
  validationFailureAction: Enforce
  rules:
    - name: check-team-label
      match:
        any:
          - resources:
              kinds:
                - Pod
      validate:
        message: "Label 'team' is required"
        pattern:
          metadata:
            labels:
              team: "?*"
```

```yaml
# New CEL-based Kyverno policy
apiVersion: kyverno.io/v1
kind: ClusterPolicy
metadata:
  name: require-labels-cel
spec:
  validationFailureAction: Enforce
  rules:
    - name: check-team-label
      match:
        any:
          - resources:
              kinds:
                - Pod
      validate:
        cel:
          expressions:
            - expression: "has(object.metadata.labels) && 'team' in object.metadata.labels"
              message: "Label 'team' is required on all Pods"
            - expression: "object.metadata.labels['team'].size() > 0"
              message: "Label 'team' must not be empty"
```

### CEL Expression Patterns

```yaml
# Resource limit validation with math
validate:
  cel:
    expressions:
      - expression: |
          object.spec.containers.all(c,
            has(c.resources.limits) &&
            has(c.resources.limits.memory) &&
            quantity(c.resources.limits.memory).compareTo(quantity('4Gi')) <= 0
          )
        message: "Container memory limit must not exceed 4Gi"

      - expression: |
          object.spec.containers.all(c,
            has(c.resources.requests) &&
            has(c.resources.limits) &&
            quantity(c.resources.requests.cpu).compareTo(
              quantity(c.resources.limits.cpu)) <= 0
          )
        message: "CPU request must not exceed limit"
```

### CEL Variables and Bindings

```yaml
apiVersion: kyverno.io/v1
kind: ClusterPolicy
metadata:
  name: image-policy-cel
spec:
  rules:
    - name: restrict-registries
      match:
        any:
          - resources:
              kinds:
                - Pod
      validate:
        cel:
          variables:
            - name: allowedRegistries
              expression: "['registry.example.com', 'gcr.io/my-project', 'nvcr.io']"
            - name: containers
              expression: "object.spec.containers + object.spec.?initContainers.orValue([])"
          expressions:
            - expression: |
                variables.containers.all(c,
                  variables.allowedRegistries.exists(r, c.image.startsWith(r))
                )
              message: "Images must come from approved registries"
```

### Complex CEL Policies

```yaml
# Enforce pod security standards via CEL
apiVersion: kyverno.io/v1
kind: ClusterPolicy
metadata:
  name: pod-security-cel
spec:
  validationFailureAction: Enforce
  rules:
    - name: restrict-privilege-escalation
      match:
        any:
          - resources:
              kinds:
                - Pod
      validate:
        cel:
          expressions:
            - expression: |
                object.spec.containers.all(c,
                  !has(c.securityContext) ||
                  !has(c.securityContext.privileged) ||
                  c.securityContext.privileged == false
                )
              message: "Privileged containers are not allowed"

            - expression: |
                object.spec.containers.all(c,
                  has(c.securityContext) &&
                  has(c.securityContext.allowPrivilegeEscalation) &&
                  c.securityContext.allowPrivilegeEscalation == false
                )
              message: "Privilege escalation must be explicitly disabled"

            - expression: |
                !has(object.spec.hostNetwork) || object.spec.hostNetwork == false
              message: "Host networking is not allowed"
```

### Migration Path from YAML to CEL

```bash
# Step 1: Identify policies to migrate
kubectl get cpol -o json | jq '.items[] | .metadata.name'

# Step 2: Test CEL expressions interactively
# Use cel-playground or kyverno CLI
kyverno test --policy cel-policy.yaml --resource test-pod.yaml

# Step 3: Run in Audit mode first
# validationFailureAction: Audit

# Step 4: Monitor policy reports
kubectl get policyreport -A --sort-by='.summary.fail'

# Step 5: Switch to Enforce after validation
```

### CEL vs YAML Decision Matrix

```text
Feature                    YAML Overlay    CEL Expression
──────────────────────────────────────────────────────────
Type safety                ❌ runtime       ✅ compile-time
Math operations            ❌ limited       ✅ full arithmetic
String manipulation        ❌ basic regex   ✅ full string ops
List comprehensions        ❌ no            ✅ all/exists/map/filter
Cross-field validation     ⚠️ awkward       ✅ natural
Performance                ⚠️ slower        ✅ compiled
K8s VAP compatibility      ❌ no            ✅ same syntax
Mutation support           ✅ yes           ❌ validate only
Generation support         ✅ yes           ❌ validate only
Learning curve             ✅ familiar      ⚠️ new syntax
```

## Common Issues

### CEL expression type error
- **Cause**: Accessing field that may not exist without `has()` check
- **Fix**: Always guard with `has(object.spec.field)` before accessing

### Policy not matching resources
- **Cause**: CEL expression returns wrong type (must be bool)
- **Fix**: Ensure all expressions evaluate to true/false

### Performance regression with complex CEL
- **Cause**: Nested loops over large container lists
- **Fix**: Use variables to pre-compute; limit list operations

## Best Practices

1. **Use `has()` guards** — fields may not exist in all resources
2. **Define variables** for reusable sub-expressions
3. **Test with `kyverno test`** before deploying
4. **Start with Audit** mode — never deploy Enforce untested
5. **Keep CEL expressions readable** — use variables for complex logic
6. **Use CEL for validation, YAML for mutation** — CEL doesn't support mutate yet

## Key Takeaways

- CEL provides type-safe, compile-time validated policy expressions
- Same syntax as Kubernetes ValidatingAdmissionPolicy (future-proof)
- Better performance than YAML overlay matching for complex conditions
- Use `has()` + `?` optional chaining to handle missing fields
- Variables enable readable, DRY policy expressions
- Migration: YAML for mutation/generation, CEL for complex validation
- Audit mode → Policy Reports → Enforce (safe rollout pattern)
