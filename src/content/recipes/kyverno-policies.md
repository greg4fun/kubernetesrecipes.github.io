---
title: "How to Create Custom Admission Controllers with Kyverno"
description: "Implement policy-as-code with Kyverno. Validate, mutate, and generate Kubernetes resources without writing webhook code."
category: "security"
difficulty: "intermediate"
publishDate: "2026-01-22"
tags: ["kyverno", "policy", "admission", "validation", "mutation"]
---

# How to Create Custom Admission Controllers with Kyverno

Kyverno is a policy engine designed for Kubernetes. It validates, mutates, and generates resources using declarative policies without requiring custom webhook code.

## Install Kyverno

```bash
# Install with Helm
helm repo add kyverno https://kyverno.github.io/kyverno/
helm repo update

helm install kyverno kyverno/kyverno \
  --namespace kyverno \
  --create-namespace \
  --set replicaCount=3

# Verify installation
kubectl get pods -n kyverno
kubectl get crd | grep kyverno
```

## Policy Types

```yaml
# Kyverno supports:
# - validate: Accept or reject resources
# - mutate: Modify resources
# - generate: Create additional resources
# - verifyImages: Verify container image signatures

# Policy scopes:
# - ClusterPolicy: Applies cluster-wide
# - Policy: Applies to specific namespace
```

## Validation Policy

```yaml
# require-labels.yaml
apiVersion: kyverno.io/v1
kind: ClusterPolicy
metadata:
  name: require-labels
spec:
  validationFailureAction: Enforce  # Or Audit
  background: true
  rules:
    - name: require-team-label
      match:
        any:
          - resources:
              kinds:
                - Pod
      validate:
        message: "All pods must have a 'team' label"
        pattern:
          metadata:
            labels:
              team: "?*"  # Wildcard: any non-empty value
```

## Require Resource Limits

```yaml
# require-limits.yaml
apiVersion: kyverno.io/v1
kind: ClusterPolicy
metadata:
  name: require-resource-limits
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

## Deny Privileged Containers

```yaml
# deny-privileged.yaml
apiVersion: kyverno.io/v1
kind: ClusterPolicy
metadata:
  name: deny-privileged-containers
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
            initContainers:
              - securityContext:
                  privileged: "!true"
```

## Mutation Policy

```yaml
# add-default-labels.yaml
apiVersion: kyverno.io/v1
kind: ClusterPolicy
metadata:
  name: add-default-labels
spec:
  rules:
    - name: add-managed-by
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
              environment: "{{ request.namespace }}"
```

## Set Default Resources

```yaml
# default-resources.yaml
apiVersion: kyverno.io/v1
kind: ClusterPolicy
metadata:
  name: set-default-resources
spec:
  rules:
    - name: set-default-requests
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
                  requests:
                    +(memory): "128Mi"  # + means add if not exists
                    +(cpu): "100m"
                  limits:
                    +(memory): "256Mi"
                    +(cpu): "200m"
```

## Generate NetworkPolicy

```yaml
# generate-netpol.yaml
apiVersion: kyverno.io/v1
kind: ClusterPolicy
metadata:
  name: generate-network-policy
spec:
  rules:
    - name: default-deny-ingress
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
        apiVersion: networking.k8s.io/v1
        kind: NetworkPolicy
        name: default-deny-ingress
        namespace: "{{ request.object.metadata.name }}"
        data:
          spec:
            podSelector: {}
            policyTypes:
              - Ingress
```

## Image Verification

```yaml
# verify-images.yaml
apiVersion: kyverno.io/v1
kind: ClusterPolicy
metadata:
  name: verify-image-signatures
spec:
  validationFailureAction: Enforce
  webhookTimeoutSeconds: 30
  rules:
    - name: verify-signature
      match:
        any:
          - resources:
              kinds:
                - Pod
      verifyImages:
        - imageReferences:
            - "myregistry.io/*"
          attestors:
            - entries:
                - keys:
                    publicKeys: |-
                      -----BEGIN PUBLIC KEY-----
                      ...
                      -----END PUBLIC KEY-----
```

## Restrict Image Registries

```yaml
# allowed-registries.yaml
apiVersion: kyverno.io/v1
kind: ClusterPolicy
metadata:
  name: restrict-image-registries
spec:
  validationFailureAction: Enforce
  rules:
    - name: allowed-registries
      match:
        any:
          - resources:
              kinds:
                - Pod
      validate:
        message: "Images must be from allowed registries"
        pattern:
          spec:
            containers:
              - image: "gcr.io/* | docker.io/library/* | myregistry.io/*"
            initContainers:
              - image: "gcr.io/* | docker.io/library/* | myregistry.io/*"
```

## Context Variables

```yaml
# context-variables.yaml
apiVersion: kyverno.io/v1
kind: ClusterPolicy
metadata:
  name: add-pod-annotations
spec:
  rules:
    - name: add-user-info
      match:
        any:
          - resources:
              kinds:
                - Pod
      mutate:
        patchStrategicMerge:
          metadata:
            annotations:
              created-by: "{{ request.userInfo.username }}"
              created-at: "{{ time_now_utc() }}"
              namespace: "{{ request.namespace }}"
```

## Conditional Policies

```yaml
# conditional-policy.yaml
apiVersion: kyverno.io/v1
kind: ClusterPolicy
metadata:
  name: production-restrictions
spec:
  validationFailureAction: Enforce
  rules:
    - name: require-probes-in-production
      match:
        any:
          - resources:
              kinds:
                - Pod
              namespaces:
                - production
      preconditions:
        all:
          - key: "{{ request.operation }}"
            operator: In
            value: ["CREATE", "UPDATE"]
      validate:
        message: "Production pods must have liveness and readiness probes"
        pattern:
          spec:
            containers:
              - livenessProbe:
                  httpGet:
                    path: "?*"
                readinessProbe:
                  httpGet:
                    path: "?*"
```

## Exclude Resources

```yaml
# exclude-resources.yaml
apiVersion: kyverno.io/v1
kind: ClusterPolicy
metadata:
  name: policy-with-exclusions
spec:
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
                - kyverno
          - resources:
              selector:
                matchLabels:
                  skip-validation: "true"
      validate:
        message: "Labels required"
        pattern:
          metadata:
            labels:
              app: "?*"
```

## Check Policy Status

```bash
# List policies
kubectl get clusterpolicies
kubectl get policies -A

# Describe policy
kubectl describe clusterpolicy require-labels

# View policy reports
kubectl get policyreport -A
kubectl get clusterpolicyreport

# Check policy violations
kubectl get policyreport -A -o jsonpath='{range .items[*]}{.metadata.namespace}{"\t"}{.summary}{"\n"}{end}'
```

## Audit Mode

```yaml
# Start with audit to see what would be blocked
apiVersion: kyverno.io/v1
kind: ClusterPolicy
metadata:
  name: audit-policy
spec:
  validationFailureAction: Audit  # Log violations, don't block
  rules:
    - name: check-labels
      # ...
```

```bash
# View audit results
kubectl get policyreport -A
kubectl describe policyreport -n <namespace>
```

## Summary

Kyverno provides policy-as-code for Kubernetes without custom webhook development. Use validation policies to enforce requirements like labels, resource limits, and security settings. Mutation policies automatically add defaults like labels and resource requests. Generate policies create resources like NetworkPolicies when namespaces are created. Start with `validationFailureAction: Audit` to test policies before enforcement. View policy reports to track compliance across the cluster.

---

## 📘 Go Further with Kubernetes Recipes

**Love this recipe? There's so much more!** This is just one of **100+ hands-on recipes** in our comprehensive **[Kubernetes Recipes book](/book)**.

Inside the book, you'll master:
- ✅ Production-ready deployment strategies
- ✅ Advanced networking and security patterns  
- ✅ Observability, monitoring, and troubleshooting
- ✅ Real-world best practices from industry experts

> *"The practical, recipe-based approach made complex Kubernetes concepts finally click for me."*

**👉 [Get Your Copy Now](/book)** — Start building production-grade Kubernetes skills today!
