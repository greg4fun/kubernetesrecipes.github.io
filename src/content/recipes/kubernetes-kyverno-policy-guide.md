---
title: "Kyverno: K8s Policy Engine Without Code"
description: "Enforce Kubernetes policies with Kyverno. Validate, mutate, and generate resources using YAML policies. Image verification, label enforcement."
publishDate: "2026-05-02"
author: "Luca Berton"
category: "security"
difficulty: "intermediate"
timeToComplete: "12 minutes"
kubernetesVersion: "1.28+"
tags:
  - "kyverno"
  - "policy"
  - "security"
  - "governance"
  - "admission-webhooks"
relatedRecipes:
  - "kubernetes-admission-webhooks-guide"
  - "kubernetes-pod-security-admission"
  - "kubernetes-security-context-guide"
  - "kubernetes-rbac-role-rolebinding"
  - "kubernetes-falco-runtime-security"
  - "kubernetes-trivy-security-scanning"
---

> 💡 **Quick Answer:** Kyverno enforces policies as Kubernetes resources — no new language to learn. Validate: block pods without labels. Mutate: auto-add resource limits. Generate: create NetworkPolicy for every new namespace. Install: `helm install kyverno kyverno/kyverno -n kyverno --create-namespace`. Policies are YAML `ClusterPolicy` or `Policy` resources — apply with `kubectl apply`.

## The Problem

Kubernetes lacks built-in policy enforcement:

- How to require specific labels on all resources?
- How to block images from untrusted registries?
- How to auto-inject defaults (resource limits, tolerations)?
- How to ensure every namespace gets a NetworkPolicy?
- OPA/Gatekeeper requires learning Rego — too complex for many teams

## The Solution

### Install Kyverno

```bash
# Helm install
helm repo add kyverno https://kyverno.github.io/kyverno/
helm install kyverno kyverno/kyverno -n kyverno --create-namespace

# Verify
kubectl get pods -n kyverno
# kyverno-admission-controller-xxx    Running
# kyverno-background-controller-xxx   Running
# kyverno-cleanup-controller-xxx      Running
# kyverno-reports-controller-xxx      Running
```

### Validate Policies

```yaml
# Require app label on all Deployments
apiVersion: kyverno.io/v1
kind: ClusterPolicy
metadata:
  name: require-app-label
spec:
  validationFailureAction: Enforce    # Enforce or Audit
  background: true
  rules:
  - name: check-app-label
    match:
      any:
      - resources:
          kinds:
          - Deployment
    validate:
      message: "Deployments must have an 'app' label."
      pattern:
        metadata:
          labels:
            app: "?*"                  # Must exist and be non-empty

---
# Block latest tag
apiVersion: kyverno.io/v1
kind: ClusterPolicy
metadata:
  name: disallow-latest-tag
spec:
  validationFailureAction: Enforce
  rules:
  - name: check-image-tag
    match:
      any:
      - resources:
          kinds:
          - Pod
    validate:
      message: "Images must use a specific tag, not ':latest'."
      pattern:
        spec:
          containers:
          - image: "!*:latest"

---
# Require resource limits
apiVersion: kyverno.io/v1
kind: ClusterPolicy
metadata:
  name: require-resource-limits
spec:
  validationFailureAction: Enforce
  rules:
  - name: check-limits
    match:
      any:
      - resources:
          kinds:
          - Pod
    validate:
      message: "All containers must have CPU and memory limits."
      pattern:
        spec:
          containers:
          - resources:
              limits:
                memory: "?*"
                cpu: "?*"

---
# Restrict image registries
apiVersion: kyverno.io/v1
kind: ClusterPolicy
metadata:
  name: allowed-registries
spec:
  validationFailureAction: Enforce
  rules:
  - name: validate-registry
    match:
      any:
      - resources:
          kinds:
          - Pod
    validate:
      message: "Images must come from allowed registries."
      pattern:
        spec:
          containers:
          - image: "ghcr.io/* | registry.k8s.io/* | docker.io/library/*"
```

### Mutate Policies

```yaml
# Auto-add resource defaults
apiVersion: kyverno.io/v1
kind: ClusterPolicy
metadata:
  name: add-default-resources
spec:
  rules:
  - name: add-default-limits
    match:
      any:
      - resources:
          kinds:
          - Pod
    mutate:
      patchStrategicMerge:
        spec:
          containers:
          - (name): "*"
            resources:
              limits:
                memory: "256Mi"
                cpu: "500m"
              requests:
                memory: "128Mi"
                cpu: "100m"

---
# Auto-add labels
apiVersion: kyverno.io/v1
kind: ClusterPolicy
metadata:
  name: add-team-label
spec:
  rules:
  - name: add-labels
    match:
      any:
      - resources:
          kinds:
          - Deployment
          - StatefulSet
    mutate:
      patchStrategicMerge:
        metadata:
          labels:
            managed-by: "kyverno"
            environment: "{{request.namespace}}"

---
# Inject sidecar
apiVersion: kyverno.io/v1
kind: ClusterPolicy
metadata:
  name: inject-logging-sidecar
spec:
  rules:
  - name: inject-sidecar
    match:
      any:
      - resources:
          kinds:
          - Deployment
          namespaceSelector:
            matchLabels:
              logging: "enabled"
    mutate:
      patchStrategicMerge:
        spec:
          template:
            spec:
              containers:
              - name: log-collector
                image: fluent-bit:3.0
                resources:
                  limits:
                    cpu: 100m
                    memory: 128Mi
```

### Generate Policies

```yaml
# Auto-create NetworkPolicy for new namespaces
apiVersion: kyverno.io/v1
kind: ClusterPolicy
metadata:
  name: generate-default-networkpolicy
spec:
  rules:
  - name: default-deny
    match:
      any:
      - resources:
          kinds:
          - Namespace
    exclude:
      any:
      - resources:
          namespaces:
          - kube-system
          - kyverno
    generate:
      synchronize: true          # Keep in sync if policy changes
      apiVersion: networking.k8s.io/v1
      kind: NetworkPolicy
      name: default-deny
      namespace: "{{request.object.metadata.name}}"
      data:
        spec:
          podSelector: {}
          policyTypes:
          - Ingress
          - Egress

---
# Auto-create ResourceQuota for new namespaces
apiVersion: kyverno.io/v1
kind: ClusterPolicy
metadata:
  name: generate-quota
spec:
  rules:
  - name: default-quota
    match:
      any:
      - resources:
          kinds:
          - Namespace
    generate:
      synchronize: true
      apiVersion: v1
      kind: ResourceQuota
      name: default-quota
      namespace: "{{request.object.metadata.name}}"
      data:
        spec:
          hard:
            requests.cpu: "4"
            requests.memory: 8Gi
            limits.cpu: "8"
            limits.memory: 16Gi
            pods: "50"
```

### Policy Reports

```bash
# View policy violations
kubectl get policyreport -A
kubectl get clusterpolicyreport

# Detailed report
kubectl describe policyreport -n production

# Audit mode — log violations without blocking
# Set: validationFailureAction: Audit
# Then check reports for violations before switching to Enforce
```

### Kyverno CLI (Test Policies)

```bash
# Install CLI
# brew install kyverno (macOS)
# or download from releases

# Test policy against resource
kyverno apply policy.yaml --resource pod.yaml

# Test all policies in directory
kyverno apply policies/ --resource resources/

# Validate policy syntax
kyverno validate policy.yaml
```

## Common Issues

**Policy not enforcing**

Check `validationFailureAction: Enforce` (not `Audit`). Verify match rules target the right resource kind.

**Mutating policy not applied**

Resource was created before policy. Kyverno only mutates at admission time. Delete and recreate resources.

**Generated resources deleted manually keep coming back**

`synchronize: true` regenerates them. Set to `false` if you want one-time generation.

## Best Practices

- **Start with Audit mode** — find violations before enforcing
- **Use ClusterPolicy** for cluster-wide, **Policy** for namespace-scoped
- **Combine validate + mutate** — enforce standards and auto-fix
- **Generate for namespace defaults** — NetworkPolicy, ResourceQuota, LimitRange
- **Test with Kyverno CLI** before deploying policies

## Key Takeaways

- Kyverno uses Kubernetes-native YAML policies — no new language needed
- Validate (accept/reject), Mutate (modify), Generate (create resources)
- `validationFailureAction: Audit` logs violations; `Enforce` blocks them
- Generate policies auto-create resources (NetworkPolicy, Quota) for new namespaces
- Simpler than OPA/Gatekeeper for most policy use cases
