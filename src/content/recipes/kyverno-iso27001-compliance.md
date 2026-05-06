---
title: "Kyverno ISO 27001 Compliance Policies"
description: "Implement ISO 27001 and BSI IT-Grundschutz security controls in Kubernetes using Kyverno policies: access control, cryptography, operations security, and audit logging enforcement."
tags:
  - "kyverno"
  - "compliance"
  - "iso27001"
  - "security"
  - "policy"
category: "security"
publishDate: "2026-05-06"
author: "Luca Berton"
difficulty: "advanced"
relatedRecipes:
  - "kyverno-cel-policy-model"
  - "kyverno-ai-software-provenance"
  - "kyverno-rebac-multi-tenant-rbac"
  - "kyverno-drift-prevention-gitops"
---

> 💡 **Quick Answer:** Map ISO 27001 Annex A controls and BSI IT-Grundschutz requirements to Kyverno policies that enforce encryption, access control, network segmentation, logging, and vulnerability management at the Kubernetes admission level.

## The Problem

Organizations need to demonstrate compliance with:

- ISO 27001:2022 Annex A controls (93 controls across 4 themes)
- BSI IT-Grundschutz (German federal security standard)
- Evidence of technical enforcement (not just documentation)
- Continuous compliance (not point-in-time audits)

## The Solution

### ISO 27001 Control Mapping

```text
ISO 27001 Control              Kyverno Policy
──────────────────────────────────────────────────────────────
A.5.15 Access Control          → Restrict ServiceAccount tokens
A.5.23 Cloud Service Security  → Enforce resource limits
A.8.9  Configuration Mgmt      → Require labels/annotations
A.8.10 Information Deletion    → Enforce PV reclaim policies
A.8.20 Network Security        → Require NetworkPolicies
A.8.24 Cryptography            → Enforce TLS on Ingress
A.8.25 Development Security    → Image signing verification
A.8.28 Secure Coding           → Block privileged containers
A.8.31 Separation of Envs      → Namespace isolation
A.8.34 Audit Logging           → Require sidecar logging
```

### A.8.24 — Cryptography (Enforce TLS)

```yaml
apiVersion: kyverno.io/v1
kind: ClusterPolicy
metadata:
  name: iso27001-a824-enforce-tls
  annotations:
    policies.kyverno.io/title: "ISO 27001 A.8.24 - Enforce TLS"
    policies.kyverno.io/description: "All Ingress must use TLS"
spec:
  validationFailureAction: Enforce
  rules:
    - name: ingress-must-have-tls
      match:
        any:
          - resources:
              kinds:
                - Ingress
      validate:
        cel:
          expressions:
            - expression: "has(object.spec.tls) && object.spec.tls.size() > 0"
              message: "[ISO27001-A.8.24] Ingress must configure TLS"
            - expression: |
                object.spec.tls.all(t, has(t.secretName) && t.secretName.size() > 0)
              message: "[ISO27001-A.8.24] TLS must reference a certificate secret"

    - name: service-require-https
      match:
        any:
          - resources:
              kinds:
                - Service
              namespaceSelector:
                matchExpressions:
                  - key: compliance/iso27001
                    operator: Exists
      validate:
        message: "[ISO27001-A.8.24] Services in compliance namespaces must use HTTPS"
        pattern:
          metadata:
            annotations:
              service.beta.kubernetes.io/port_443_no_tls: "!*"
```

### A.8.20 — Network Security (Require NetworkPolicy)

```yaml
apiVersion: kyverno.io/v1
kind: ClusterPolicy
metadata:
  name: iso27001-a820-network-segmentation
spec:
  validationFailureAction: Enforce
  rules:
    - name: require-network-policy
      match:
        any:
          - resources:
              kinds:
                - Pod
              namespaceSelector:
                matchLabels:
                  compliance/iso27001: "true"
      preconditions:
        all:
          - key: "{{ request.object.metadata.labels.app || '' }}"
            operator: NotEquals
            value: ""
      validate:
        message: "[ISO27001-A.8.20] Namespace must have a NetworkPolicy before deploying Pods"
        deny:
          conditions:
            all:
              - key: "{{ request.namespace }}"
                operator: AnyNotIn
                value: "{{ request.object.metadata.namespace | networkpolicies(@) }}"
```

### A.5.15 — Access Control (ServiceAccount Restrictions)

```yaml
apiVersion: kyverno.io/v1
kind: ClusterPolicy
metadata:
  name: iso27001-a515-access-control
spec:
  validationFailureAction: Enforce
  rules:
    - name: restrict-automount-token
      match:
        any:
          - resources:
              kinds:
                - Pod
      validate:
        cel:
          expressions:
            - expression: |
                has(object.spec.automountServiceAccountToken) &&
                object.spec.automountServiceAccountToken == false
              message: "[ISO27001-A.5.15] automountServiceAccountToken must be false"

    - name: no-default-service-account
      match:
        any:
          - resources:
              kinds:
                - Pod
      validate:
        cel:
          expressions:
            - expression: |
                !has(object.spec.serviceAccountName) ||
                object.spec.serviceAccountName != 'default'
              message: "[ISO27001-A.5.15] Must use a dedicated ServiceAccount, not 'default'"
```

### A.8.28 — Secure Coding (Pod Security)

```yaml
apiVersion: kyverno.io/v1
kind: ClusterPolicy
metadata:
  name: iso27001-a828-pod-security
spec:
  validationFailureAction: Enforce
  rules:
    - name: restrict-containers
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
                  has(c.securityContext) &&
                  has(c.securityContext.runAsNonRoot) &&
                  c.securityContext.runAsNonRoot == true
                )
              message: "[ISO27001-A.8.28] Containers must run as non-root"

            - expression: |
                object.spec.containers.all(c,
                  has(c.securityContext) &&
                  has(c.securityContext.readOnlyRootFilesystem) &&
                  c.securityContext.readOnlyRootFilesystem == true
                )
              message: "[ISO27001-A.8.28] Root filesystem must be read-only"

            - expression: |
                !has(object.spec.hostPID) || object.spec.hostPID == false
              message: "[ISO27001-A.8.28] hostPID is not allowed"
```

### BSI IT-Grundschutz Module: Container (SYS.1.6)

```yaml
apiVersion: kyverno.io/v1
kind: ClusterPolicy
metadata:
  name: bsi-sys16-container-hardening
  annotations:
    policies.kyverno.io/title: "BSI SYS.1.6 Container Hardening"
spec:
  validationFailureAction: Enforce
  rules:
    - name: require-resource-limits
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
                  has(c.resources) &&
                  has(c.resources.limits) &&
                  has(c.resources.limits.memory) &&
                  has(c.resources.limits.cpu)
                )
              message: "[BSI-SYS.1.6] All containers must have CPU and memory limits"

    - name: require-liveness-probe
      match:
        any:
          - resources:
              kinds:
                - Pod
      exclude:
        any:
          - resources:
              selector:
                matchLabels:
                  batch.kubernetes.io/job-name: "?*"
      validate:
        cel:
          expressions:
            - expression: |
                object.spec.containers.all(c,
                  has(c.livenessProbe)
                )
              message: "[BSI-SYS.1.6] Long-running containers must have liveness probes"
```

### Compliance Reporting

```bash
# View policy violations
kubectl get policyreport -A -o wide

# Export compliance report
kubectl get policyreport -A -o json | jq '
  .items[] |
  {
    namespace: .metadata.namespace,
    pass: .summary.pass,
    fail: .summary.fail,
    warn: .summary.warn
  }
'

# Generate ISO 27001 evidence report
kubectl get cpol -o json | jq '.items[] |
  select(.metadata.annotations["policies.kyverno.io/title"] | startswith("ISO")) |
  {
    control: .metadata.annotations["policies.kyverno.io/title"],
    action: .spec.validationFailureAction,
    rules: [.spec.rules[].name]
  }
'
```

## Common Issues

### Policies block system workloads
- **Cause**: Kyverno enforces on all Pods including kube-system
- **Fix**: Add `exclude` for system namespaces or use namespaceSelector

### Compliance drift after policy update
- **Cause**: Existing non-compliant resources not re-evaluated
- **Fix**: Enable background scanning; use `kubectl get policyreport` to find violations

### Too many policy violations overwhelm team
- **Cause**: Enforcing everything at once
- **Fix**: Start with Audit; fix violations namespace by namespace; then Enforce

## Best Practices

1. **Map controls to policies** — document which ISO control each policy implements
2. **Use annotations** for audit trail (`policies.kyverno.io/title`)
3. **Namespace-scoped rollout** — label namespaces `compliance/iso27001: true`
4. **Background scanning** — catch pre-existing violations
5. **Policy Reports as evidence** — export for auditors
6. **Exception process** — PolicyException CRD for approved deviations

## Key Takeaways

- Kyverno can enforce 20+ ISO 27001 Annex A controls at admission time
- CEL expressions provide type-safe compliance validation
- BSI IT-Grundschutz SYS.1.6 maps directly to Pod security policies
- PolicyReports provide continuous compliance evidence for auditors
- Namespace labels (`compliance/iso27001: true`) enable gradual rollout
- Exception CRD allows documented, approved deviations
- Audit → Fix → Enforce pattern prevents production disruption
