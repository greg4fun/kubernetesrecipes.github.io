---
title: "How to Implement Kyverno Policies"
description: "Enforce Kubernetes policies with Kyverno. Validate, mutate, and generate resources using declarative YAML policies without code."
category: "security"
difficulty: "intermediate"
publishDate: "2026-01-22"
tags: ["kyverno", "policy", "security", "admission-control", "governance"]
author: "Luca Berton"
---

> 💡 **Quick Answer:** Install Kyverno (`helm install kyverno kyverno/kyverno`), create `ClusterPolicy` or `Policy` CRDs with rules. Rules can **validate** (block non-compliant), **mutate** (auto-fix), or **generate** (create related resources). No coding—policies are YAML.
>
> **Key pattern:** `match` selects resources, `validate`/`mutate`/`generate` defines the action.
>
> **Gotcha:** Set `validationFailureAction: Audit` first to test without blocking. Switch to `Enforce` in production. Background scans catch existing violations.

# How to Implement Kyverno Policies

Kyverno is a Kubernetes-native policy engine. Write policies in YAML to validate, mutate, and generate resources without writing code.

## Install Kyverno

```bash
# Add Helm repo
helm repo add kyverno https://kyverno.github.io/kyverno/
helm repo update

# Install Kyverno
helm install kyverno kyverno/kyverno -n kyverno --create-namespace

# Verify installation
kubectl get pods -n kyverno
```

## Validate Policy: Require Labels

```yaml
# require-labels.yaml
apiVersion: kyverno.io/v1
kind: ClusterPolicy
metadata:
  name: require-labels
spec:
  validationFailureAction: Enforce
  background: true
  rules:
    - name: require-app-label
      match:
        any:
          - resources:
              kinds:
                - Pod
      validate:
        message: "Label 'app' is required"
        pattern:
          metadata:
            labels:
              app: "?*"
```

## Validate Policy: Disallow Privileged

```yaml
# disallow-privileged.yaml
apiVersion: kyverno.io/v1
kind: ClusterPolicy
metadata:
  name: disallow-privileged
spec:
  validationFailureAction: Enforce
  rules:
    - name: deny-privileged
      match:
        any:
          - resources:
              kinds:
                - Pod
      validate:
        message: "Privileged containers are not allowed"
        pattern:
          spec:
            containers:
              - securityContext:
                  privileged: "!true"
```

## Validate Policy: Require Resource Limits

```yaml
# require-limits.yaml
apiVersion: kyverno.io/v1
kind: ClusterPolicy
metadata:
  name: require-limits
spec:
  validationFailureAction: Enforce
  rules:
    - name: require-cpu-memory-limits
      match:
        any:
          - resources:
              kinds:
                - Pod
      validate:
        message: "CPU and memory limits are required"
        pattern:
          spec:
            containers:
              - resources:
                  limits:
                    memory: "?*"
                    cpu: "?*"
```

## Mutate Policy: Add Default Labels

```yaml
# add-default-labels.yaml
apiVersion: kyverno.io/v1
kind: ClusterPolicy
metadata:
  name: add-labels
spec:
  rules:
    - name: add-managed-by-label
      match:
        any:
          - resources:
              kinds:
                - Pod
                - Deployment
      mutate:
        patchStrategicMerge:
          metadata:
            labels:
              managed-by: kyverno
```

## Mutate Policy: Add Resource Defaults

```yaml
# add-default-resources.yaml
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
                    +(memory): "256Mi"
                    +(cpu): "200m"
                  requests:
                    +(memory): "128Mi"
                    +(cpu): "100m"
```

## Generate Policy: Create NetworkPolicy

```yaml
# generate-network-policy.yaml
apiVersion: kyverno.io/v1
kind: ClusterPolicy
metadata:
  name: add-network-policy
spec:
  rules:
    - name: default-deny
      match:
        any:
          - resources:
              kinds:
                - Namespace
      generate:
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
```

## Generate Policy: Copy Secrets

```yaml
# copy-secrets.yaml
apiVersion: kyverno.io/v1
kind: ClusterPolicy
metadata:
  name: copy-registry-secret
spec:
  rules:
    - name: copy-secret
      match:
        any:
          - resources:
              kinds:
                - Namespace
      generate:
        apiVersion: v1
        kind: Secret
        name: registry-credentials
        namespace: "{{request.object.metadata.name}}"
        clone:
          namespace: default
          name: registry-credentials
```

## Exclude Namespaces

```yaml
# policy-with-exclusions.yaml
apiVersion: kyverno.io/v1
kind: ClusterPolicy
metadata:
  name: require-labels
spec:
  validationFailureAction: Enforce
  rules:
    - name: require-labels
      match:
        any:
          - resources:
              kinds:
                - Pod
      exclude:
        any:
          - resources:
              namespaces:
                - kube-system
                - kube-public
                - kyverno
```

## Policy Exceptions

```yaml
# exception.yaml
apiVersion: kyverno.io/v2alpha1
kind: PolicyException
metadata:
  name: allow-privileged-csi
  namespace: kube-system
spec:
  exceptions:
    - policyName: disallow-privileged
      ruleNames:
        - deny-privileged
  match:
    any:
      - resources:
          kinds:
            - Pod
          namespaces:
            - kube-system
          names:
            - csi-*
```

## Test Policies

```bash
# Test policy in audit mode first
kubectl apply -f policy.yaml

# Check policy status
kubectl get clusterpolicy

# View policy reports
kubectl get policyreport -A
kubectl get clusterpolicyreport

# Describe for details
kubectl describe clusterpolicy require-labels

# Test with dry-run
kubectl run test --image=nginx --dry-run=server -o yaml
```

## Policy Report

```bash
# List violations
kubectl get policyreport -A -o wide

# Detailed report
kubectl describe policyreport -n default

# Check specific namespace
kubectl get policyreport -n production -o yaml
```

## Best Practices

1. **Start with Audit** mode before Enforce
2. **Use background scans** to find existing violations
3. **Exclude system namespaces** (kube-system, kyverno)
4. **Use PolicyExceptions** for legitimate bypasses
5. **Combine validate + mutate** for best UX
6. **Version control policies** like any other K8s resource
