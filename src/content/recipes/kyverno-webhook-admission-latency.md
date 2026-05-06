---
title: "Kyverno Webhook Topology and Admission Latency"
description: "Optimize Kyverno webhook topology for minimal admission latency: webhook configuration tuning, failure policies, timeout settings, and lessons from migrating to Kyverno at scale."
tags:
  - "kyverno"
  - "webhook"
  - "admission-control"
  - "performance"
  - "latency"
category: "security"
publishDate: "2026-05-06"
author: "Luca Berton"
difficulty: "advanced"
relatedRecipes:
  - "kyverno-cel-policy-model"
  - "kyverno-drift-prevention-gitops"
  - "kyverno-iso27001-compliance"
  - "kubernetes-admission-webhooks-guide"
---

> 💡 **Quick Answer:** Minimize Kyverno admission latency by consolidating webhook configurations, setting appropriate timeouts (5-10s), using `failurePolicy: Ignore` for non-critical policies, placing Kyverno Pods close to the API server, and migrating complex policies to CEL for compiled evaluation.

## The Problem

Admission webhooks add latency to every API request:

- Each webhook call adds 5-50ms network round-trip
- Multiple webhooks chain sequentially (not parallel)
- Slow webhooks delay Pod creation, scaling, deployments
- Webhook failures can block entire cluster operations
- Migration from OPA/Gatekeeper to Kyverno needs careful planning

## The Solution

### Webhook Architecture

```text
kubectl apply → API Server → Authentication → Authorization
  → Mutating Admission Webhooks (sequential):
    ├── Kyverno mutate (1st call)       ~5-15ms
    ├── Istio sidecar injection         ~10-20ms
    └── Other mutating webhooks
  → Object Schema Validation
  → Validating Admission Webhooks (sequential):
    ├── Kyverno validate (2nd call)     ~5-15ms
    ├── OPA/Gatekeeper (if present)     ~10-30ms
    └── Other validating webhooks
  → etcd Write
  
Total admission latency: sum of all webhook calls
Target: < 100ms total for simple resources
```

### Kyverno Webhook Configuration

```yaml
apiVersion: admissionregistration.k8s.io/v1
kind: ValidatingWebhookConfiguration
metadata:
  name: kyverno-resource-validating-webhook-cfg
webhooks:
  - name: validate.kyverno.svc
    clientConfig:
      service:
        name: kyverno-svc
        namespace: kyverno
        path: /validate
    rules:
      - apiGroups: ["", "apps", "batch"]
        apiVersions: ["v1", "v1beta1"]
        operations: ["CREATE", "UPDATE"]
        resources: ["pods", "deployments", "statefulsets", "jobs"]
        scope: "Namespaced"
    failurePolicy: Fail        # Critical policies: block on webhook failure
    timeoutSeconds: 10         # Max wait before timeout
    sideEffects: None
    admissionReviewVersions: ["v1"]
    matchPolicy: Equivalent
    namespaceSelector:
      matchExpressions:
        - key: kyverno.io/exclude
          operator: DoesNotExist
```

### Optimize Timeout Settings

```yaml
# For critical security policies (must not be bypassed)
failurePolicy: Fail
timeoutSeconds: 10

# For non-critical policies (best-effort, don't block cluster)
failurePolicy: Ignore
timeoutSeconds: 5

# For background-only policies (no admission call)
background: true
# → No webhook call at all; evaluated asynchronously
```

### Reduce Webhook Calls with Scope Filtering

```yaml
# BAD: Matches everything (unnecessary calls for non-relevant resources)
rules:
  - apiGroups: ["*"]
    resources: ["*"]
    operations: ["*"]

# GOOD: Only match what your policies actually validate
rules:
  - apiGroups: ["", "apps"]
    resources: ["pods", "deployments", "statefulsets"]
    operations: ["CREATE", "UPDATE"]
    scope: "Namespaced"
```

### Kyverno Scaling for Low Latency

```yaml
# Kyverno Helm values for production
apiVersion: helm.cattle.io/v1
kind: HelmChart
metadata:
  name: kyverno
spec:
  valuesContent: |
    replicaCount: 3

    resources:
      limits:
        cpu: 1000m
        memory: 1Gi
      requests:
        cpu: 500m
        memory: 512Mi

    # Spread across nodes for HA
    topologySpreadConstraints:
      - maxSkew: 1
        topologyKey: kubernetes.io/hostname
        whenUnsatisfiable: DoNotSchedule
        labelSelector:
          matchLabels:
            app: kyverno

    # Co-locate with API server for lowest latency
    affinity:
      nodeAffinity:
        preferredDuringSchedulingIgnoredDuringExecution:
          - weight: 100
            preference:
              matchExpressions:
                - key: node-role.kubernetes.io/control-plane
                  operator: Exists

    # Webhook configuration
    config:
      webhooks:
        - namespaceSelector:
            matchExpressions:
              - key: kubernetes.io/metadata.name
                operator: NotIn
                values:
                  - kube-system
                  - kyverno
```

### Migration from OPA/Gatekeeper

```text
Migration strategy (zero-downtime):

Phase 1: Deploy Kyverno alongside Gatekeeper (Audit mode)
├── Install Kyverno with all policies in Audit mode
├── Compare PolicyReports with Gatekeeper violations
├── Fix any differences in policy logic
└── Duration: 2 weeks

Phase 2: Parallel enforcement
├── Enable Enforce on Kyverno for validated policies
├── Keep Gatekeeper running (redundant validation)
├── Monitor for false positives
└── Duration: 1 week

Phase 3: Disable Gatekeeper
├── Remove Gatekeeper constraints (one by one)
├── Verify no regressions
├── Remove Gatekeeper operator
└── Duration: 1 week

Phase 4: Optimize
├── Consolidate webhook configurations
├── Tune timeouts based on observed latency
├── Convert complex Rego policies to CEL
└── Measure improvement
```

### Measure Admission Latency

```bash
# API server metrics for webhook duration
kubectl get --raw /metrics | grep apiserver_admission_webhook_admission_duration_seconds

# Kyverno-specific metrics
kubectl port-forward -n kyverno svc/kyverno-svc 8000:443 &
curl -sk https://localhost:8000/metrics | grep kyverno_admission_review_duration

# Trace a specific request
kubectl apply -f test-pod.yaml -v=8 2>&1 | grep -i "admission\|webhook\|duration"

# Aggregated latency percentiles
kubectl get --raw /metrics | grep 'apiserver_admission_webhook_admission_duration_seconds_bucket{name="validate.kyverno.svc"'
```

### Common Latency Patterns

```text
Scenario                          Expected Latency    Notes
────────────────────────────────────────────────────────────────
Simple label check (YAML)         2-5ms              Fast pattern match
CEL expression (compiled)         1-3ms              Faster than YAML
Image verification (cosign)       50-200ms           Network call to registry
API call (context lookup)         20-100ms           Cross-namespace lookups
Complex Rego (if migrated)        10-50ms            Depends on complexity
Background policy                 0ms                No admission webhook call
```

## Common Issues

### Webhook timeout causes Pod creation failure
- **Cause**: Kyverno overloaded or network partition
- **Fix**: Use `failurePolicy: Ignore` for non-security policies; scale Kyverno

### All cluster operations blocked after Kyverno crash
- **Cause**: `failurePolicy: Fail` + all Kyverno replicas down
- **Fix**: Emergency: delete ValidatingWebhookConfiguration; fix: ensure 3+ replicas with PDB

### Latency spike during policy update
- **Cause**: Policy compilation/caching after CRD update
- **Fix**: Expected behavior; resolves within 5-10s after policy change

### Namespace exclusion not working
- **Cause**: `namespaceSelector` not applied to webhook config
- **Fix**: Check `kyverno.io/exclude` label on namespace; restart Kyverno to refresh webhook

## Best Practices

1. **3+ replicas with PDB** — webhook availability = cluster availability
2. **Scope webhook rules narrowly** — don't match resources you don't policy
3. **CEL over YAML** — compiled expressions are 2-5x faster
4. **Background for non-blocking** — move audit-only policies off critical path
5. **`failurePolicy: Ignore`** for nice-to-have policies
6. **`failurePolicy: Fail`** only for security-critical policies
7. **Measure before and after** — use API server admission metrics
8. **Exclude system namespaces** — kube-system, kyverno, cert-manager

## Key Takeaways

- Each webhook adds 2-200ms depending on policy complexity
- CEL policies: 1-3ms; image verification: 50-200ms; API lookups: 20-100ms
- Scope rules narrowly to minimize unnecessary webhook invocations
- `failurePolicy: Ignore` prevents Kyverno outage from blocking the cluster
- 3+ replicas with anti-affinity for HA; prefer control-plane nodes
- Migration from Gatekeeper: 4-phase zero-downtime approach
- Monitor `apiserver_admission_webhook_admission_duration_seconds` histogram
- Background scanning moves non-critical checks off the admission hot path
