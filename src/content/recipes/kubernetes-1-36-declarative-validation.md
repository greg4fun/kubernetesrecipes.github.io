---
title: "Kubernetes 1.36 Declarative Type Validation"
description: "Kubernetes 1.36 introduces declarative validation for native API types using validation-gen. Replaces hand-written validation code with struct tag annotations."
tags:
  - "kubernetes-1.36"
  - "api"
  - "validation"
  - "development"
  - "controllers"
category: "configuration"
publishDate: "2026-05-03"
author: "Luca Berton"
difficulty: "advanced"
relatedRecipes:
  - "kubernetes-crd-guide"
  - "kubernetes-1-36-constrained-impersonation"
  - "kubernetes-1-36-mixed-version-proxy"
---

> 💡 **Quick Answer:** Kubernetes 1.36 introduces **Declarative Validation** (KEP-5073) using `validation-gen` for native API types. Validation rules are defined as struct tags instead of hand-written Go code, making the API more consistent and maintainable.

## The Problem

Kubernetes API validation was implemented as hand-written Go functions:

- **Inconsistent**: Different developers wrote validation differently
- **Hard to audit**: Validation logic scattered across thousands of lines of code
- **Error-prone**: Easy to miss edge cases or write conflicting rules
- **Not machine-readable**: Tools can't extract validation rules from imperative code
- **No documentation generation**: Validation rules not visible in API docs

## The Solution

Declarative validation uses struct tags (similar to CRD validation) on native Go types.

### Before: Hand-Written Validation

```go
// Old way — imperative validation function
func ValidateService(service *core.Service) field.ErrorList {
    allErrs := field.ErrorList{}
    if len(service.Name) == 0 {
        allErrs = append(allErrs, field.Required(
            field.NewPath("metadata", "name"), ""))
    }
    if len(service.Name) > 63 {
        allErrs = append(allErrs, field.TooLong(
            field.NewPath("metadata", "name"), service.Name, 63))
    }
    // ... hundreds more lines
    return allErrs
}
```

### After: Declarative Validation Tags

```go
// New way — declarative struct tags
type ServiceSpec struct {
    // +k8s:validation:minLength=1
    // +k8s:validation:maxLength=63
    // +k8s:validation:pattern=`^[a-z]([-a-z0-9]*[a-z0-9])?$`
    ClusterIP string `json:"clusterIP,omitempty"`

    // +k8s:validation:minimum=1
    // +k8s:validation:maximum=65535
    Port int32 `json:"port"`

    // +k8s:validation:enum=ClusterIP;NodePort;LoadBalancer;ExternalName
    Type ServiceType `json:"type,omitempty"`
}
```

### Impact on CRD Authors

```yaml
# CRD validation already uses declarative rules — this aligns native types:
apiVersion: apiextensions.k8s.io/v1
kind: CustomResourceDefinition
spec:
  versions:
    - name: v1
      schema:
        openAPIV3Schema:
          properties:
            spec:
              properties:
                replicas:
                  type: integer
                  minimum: 0
                  maximum: 100
                name:
                  type: string
                  minLength: 1
                  maxLength: 63
                  pattern: '^[a-z]([-a-z0-9]*[a-z0-9])?$'
```

### Check Validation Errors

```bash
# Validation errors now include the declarative rule that failed
kubectl apply -f bad-service.yaml
# Error: spec.port: Invalid value: 99999:
#   must be no greater than 65535
#   (validation rule: maximum=65535)
```

## Common Issues

### New validation rejecting previously accepted manifests
- **Cause**: Declarative validation may be stricter than old hand-written code
- **Fix**: Update manifests to comply; check release notes for validation changes

### Custom admission webhooks conflicting
- **Cause**: Webhook validates same fields with different rules
- **Fix**: Align webhook rules with native validation or remove redundant checks

## Best Practices

1. **Review release notes** — new validation rules may reject old manifests
2. **Test manifests against 1.36** — run `kubectl apply --dry-run=server` before upgrading
3. **Use the same pattern for CRDs** — declarative validation is the future
4. **Check error messages** — they now reference specific validation rules
5. **Report false positives** — if valid manifests are rejected, file an issue

## Key Takeaways

- Declarative validation via `validation-gen` is being adopted in **Kubernetes 1.36** (KEP-5073)
- Native API types use struct tags instead of hand-written Go validation
- More consistent, auditable, and machine-readable validation rules
- Error messages now reference specific validation rules
- Aligns native types with the CRD validation model
