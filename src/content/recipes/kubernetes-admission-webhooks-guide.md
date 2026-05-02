---
title: "K8s Admission Webhooks: Validate and Mutate"
description: "Build Kubernetes validating and mutating admission webhooks. Webhook configuration, TLS setup, failure policies, and common patterns for policy enforcement."
publishDate: "2026-05-02"
author: "Luca Berton"
category: "security"
difficulty: "advanced"
timeToComplete: "15 minutes"
kubernetesVersion: "1.28+"
tags:
  - "admission-webhooks"
  - "security"
  - "policy"
  - "validation"
  - "cka"
relatedRecipes:
  - "kubernetes-pod-security-admission"
  - "kubernetes-rbac-role-rolebinding"
  - "kubernetes-certificate-management"
---

> 💡 **Quick Answer:** Admission webhooks intercept API requests before persistence. **Validating** webhooks accept/reject requests (enforce policies). **Mutating** webhooks modify requests (inject sidecars, add labels). Configure with `ValidatingWebhookConfiguration` or `MutatingWebhookConfiguration`. The webhook runs as a Service in-cluster, must serve HTTPS, and the CA bundle must be configured in the webhook config.

## The Problem

Built-in admission controllers can't enforce custom policies:

- Require specific labels on all Deployments
- Inject sidecar containers automatically
- Block images from untrusted registries
- Enforce naming conventions
- Add default resource limits

## The Solution

### Validating Webhook Configuration

```yaml
apiVersion: admissionregistration.k8s.io/v1
kind: ValidatingWebhookConfiguration
metadata:
  name: pod-policy
webhooks:
- name: pod-policy.example.com
  admissionReviewVersions: ["v1"]
  sideEffects: None
  failurePolicy: Fail          # Fail or Ignore
  matchPolicy: Equivalent
  
  clientConfig:
    service:
      name: pod-policy-webhook
      namespace: webhook-system
      path: /validate
      port: 443
    caBundle: <base64-encoded-CA>
  
  rules:
  - apiGroups: [""]
    apiVersions: ["v1"]
    operations: ["CREATE", "UPDATE"]
    resources: ["pods"]
    scope: Namespaced
  
  namespaceSelector:
    matchExpressions:
    - key: webhook-policy
      operator: In
      values: ["enabled"]
  
  objectSelector:
    matchLabels:
      validate: "true"
  
  timeoutSeconds: 10
```

### Mutating Webhook Configuration

```yaml
apiVersion: admissionregistration.k8s.io/v1
kind: MutatingWebhookConfiguration
metadata:
  name: sidecar-injector
webhooks:
- name: sidecar.example.com
  admissionReviewVersions: ["v1"]
  sideEffects: None
  failurePolicy: Ignore         # Don't block if webhook is down
  reinvocationPolicy: IfNeeded  # Re-run if other webhooks mutate
  
  clientConfig:
    service:
      name: sidecar-injector
      namespace: webhook-system
      path: /mutate
      port: 443
    caBundle: <base64-encoded-CA>
  
  rules:
  - apiGroups: ["apps"]
    apiVersions: ["v1"]
    operations: ["CREATE"]
    resources: ["deployments"]
    scope: Namespaced
  
  namespaceSelector:
    matchExpressions:
    - key: kubernetes.io/metadata.name
      operator: NotIn
      values: ["kube-system", "webhook-system"]
```

### Webhook Server (Go Example)

```go
// Simplified webhook handler
func handleValidate(w http.ResponseWriter, r *http.Request) {
    var review admissionv1.AdmissionReview
    json.NewDecoder(r.Body).Decode(&review)
    
    pod := corev1.Pod{}
    json.Unmarshal(review.Request.Object.Raw, &pod)
    
    allowed := true
    message := ""
    
    // Policy: require app label
    if _, ok := pod.Labels["app"]; !ok {
        allowed = false
        message = "pods must have an 'app' label"
    }
    
    // Policy: no latest tag
    for _, c := range pod.Spec.Containers {
        if strings.HasSuffix(c.Image, ":latest") || !strings.Contains(c.Image, ":") {
            allowed = false
            message = "container images must use specific tags, not :latest"
        }
    }
    
    response := admissionv1.AdmissionReview{
        TypeMeta: metav1.TypeMeta{APIVersion: "admission.k8s.io/v1", Kind: "AdmissionReview"},
        Response: &admissionv1.AdmissionResponse{
            UID:     review.Request.UID,
            Allowed: allowed,
            Result:  &metav1.Status{Message: message},
        },
    }
    json.NewEncoder(w).Encode(response)
}
```

### Mutating Webhook (JSON Patch)

```go
// Inject sidecar container
func handleMutate(w http.ResponseWriter, r *http.Request) {
    var review admissionv1.AdmissionReview
    json.NewDecoder(r.Body).Decode(&review)
    
    // JSON Patch to add sidecar
    patch := []map[string]interface{}{
        {
            "op":   "add",
            "path": "/spec/template/spec/containers/-",
            "value": map[string]interface{}{
                "name":  "log-collector",
                "image": "fluent-bit:3.0",
                "resources": map[string]interface{}{
                    "requests": map[string]string{"cpu": "50m", "memory": "64Mi"},
                },
            },
        },
        {
            "op":    "add",
            "path":  "/metadata/labels/sidecar-injected",
            "value": "true",
        },
    }
    
    patchBytes, _ := json.Marshal(patch)
    patchType := admissionv1.PatchTypeJSONPatch
    
    response := admissionv1.AdmissionReview{
        Response: &admissionv1.AdmissionResponse{
            UID:       review.Request.UID,
            Allowed:   true,
            Patch:     patchBytes,
            PatchType: &patchType,
        },
    }
    json.NewEncoder(w).Encode(response)
}
```

### TLS Certificate Setup

```bash
# Generate self-signed cert for webhook
openssl req -x509 -newkey rsa:2048 -keyout tls.key -out tls.crt \
  -days 365 -nodes \
  -subj "/CN=pod-policy-webhook.webhook-system.svc" \
  -addext "subjectAltName=DNS:pod-policy-webhook.webhook-system.svc,DNS:pod-policy-webhook.webhook-system.svc.cluster.local"

# Create TLS secret
kubectl create secret tls webhook-tls \
  --cert=tls.crt --key=tls.key \
  -n webhook-system

# Get CA bundle for webhook config
cat tls.crt | base64 | tr -d '\n'
# Paste into caBundle field

# Or use cert-manager for automatic rotation
```

### Webhook Execution Order

```
API Request → Authentication → Authorization
  → Mutating Webhooks (in order, can modify)
    → Object Schema Validation
      → Validating Webhooks (in parallel, accept/reject)
        → Persist to etcd
```

### Common Policy Patterns

```yaml
# Validating: require resource limits
# Reject pods without CPU/memory limits

# Validating: block privileged containers
# Reject pods with securityContext.privileged: true

# Mutating: inject labels
# Add team, environment, cost-center labels

# Mutating: set default tolerations
# Add standard tolerations for all pods

# Mutating: inject environment variables
# Add CLUSTER_NAME, REGION from webhook config
```

## Common Issues

**"connection refused" from webhook**

Webhook Service not running or wrong port. Check: `kubectl get pods -n webhook-system`. Verify Service port matches webhook server port.

**"x509: certificate signed by unknown authority"**

`caBundle` doesn't match the webhook server's TLS certificate. Regenerate or use cert-manager.

**Webhook blocks kube-system pods**

Missing `namespaceSelector` exclusion. Always exclude `kube-system` to prevent breaking cluster components.

**Cluster locked out after webhook failure**

`failurePolicy: Fail` + webhook down = nothing can be created. Use `Ignore` for non-critical webhooks. Delete the webhook config to recover: `kubectl delete validatingwebhookconfiguration <name>`.

## Best Practices

- **`failurePolicy: Ignore`** for non-critical webhooks — don't break the cluster
- **Exclude system namespaces** — `kube-system`, `kube-public`, webhook's own namespace
- **Set `timeoutSeconds: 5-10`** — don't slow down all API requests
- **Use cert-manager** for TLS — automatic certificate rotation
- **Monitor webhook latency** — adds to every API request matching rules
- **Consider Kyverno or OPA/Gatekeeper** — policy engines built on webhooks

## Key Takeaways

- Validating webhooks accept/reject; mutating webhooks modify requests
- Must serve HTTPS with a CA bundle configured in the webhook config
- Mutating runs before validating; both run after authentication/authorization
- Always exclude system namespaces and set appropriate failure policies
- For policy enforcement, consider Kyverno or Gatekeeper over custom webhooks
