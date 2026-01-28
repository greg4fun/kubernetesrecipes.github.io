---
title: "How to Use Pod Presets and Mutations"
description: "Automatically inject configurations into pods using admission controllers. Configure environment variables, volumes, and annotations at deployment time."
category: "configuration"
difficulty: "advanced"
publishDate: "2026-01-22"
tags: ["admission-controller", "mutation", "injection", "configuration", "automation"]
---

# How to Use Pod Presets and Mutations

Automatically inject configuration into pods using mutating admission webhooks. Add environment variables, volumes, and labels without modifying deployment manifests.

## Mutating Webhook Overview

```yaml
# Mutating webhooks intercept pod creation
# and modify the pod spec before it's persisted

# Common use cases:
# - Inject sidecar containers
# - Add environment variables
# - Mount volumes automatically
# - Add labels and annotations
# - Set resource defaults
```

## Simple Mutation Example

```yaml
# mutating-webhook-config.yaml
apiVersion: admissionregistration.k8s.io/v1
kind: MutatingWebhookConfiguration
metadata:
  name: pod-injector
webhooks:
  - name: inject.pod.example.com
    clientConfig:
      service:
        name: pod-injector
        namespace: kube-system
        path: "/mutate"
      caBundle: ${CA_BUNDLE}
    rules:
      - operations: ["CREATE"]
        apiGroups: [""]
        apiVersions: ["v1"]
        resources: ["pods"]
    namespaceSelector:
      matchLabels:
        inject: enabled
    admissionReviewVersions: ["v1"]
    sideEffects: None
    timeoutSeconds: 10
```

## Webhook Server (Go)

```go
// webhook-server.go
package main

import (
    "encoding/json"
    "net/http"
    
    admissionv1 "k8s.io/api/admission/v1"
    corev1 "k8s.io/api/core/v1"
)

func mutate(w http.ResponseWriter, r *http.Request) {
    var admissionReview admissionv1.AdmissionReview
    json.NewDecoder(r.Body).Decode(&admissionReview)
    
    pod := corev1.Pod{}
    json.Unmarshal(admissionReview.Request.Object.Raw, &pod)
    
    // Create patch to inject environment variable
    patches := []map[string]interface{}{
        {
            "op":    "add",
            "path":  "/spec/containers/0/env/-",
            "value": map[string]string{
                "name":  "INJECTED_VAR",
                "value": "injected-value",
            },
        },
    }
    
    patchBytes, _ := json.Marshal(patches)
    patchType := admissionv1.PatchTypeJSONPatch
    
    response := admissionv1.AdmissionResponse{
        UID:       admissionReview.Request.UID,
        Allowed:   true,
        Patch:     patchBytes,
        PatchType: &patchType,
    }
    
    admissionReview.Response = &response
    json.NewEncoder(w).Encode(admissionReview)
}

func main() {
    http.HandleFunc("/mutate", mutate)
    http.ListenAndServeTLS(":443", "cert.pem", "key.pem", nil)
}
```

## Using Kyverno for Mutations

```bash
# Install Kyverno (easier than custom webhooks)
kubectl create -f https://github.com/kyverno/kyverno/releases/download/v1.11.0/install.yaml
```

```yaml
# Kyverno policy to inject environment variables
apiVersion: kyverno.io/v1
kind: ClusterPolicy
metadata:
  name: inject-env-vars
spec:
  rules:
    - name: inject-cluster-name
      match:
        any:
          - resources:
              kinds:
                - Pod
      mutate:
        patchStrategicMerge:
          spec:
            containers:
              - name: "*"
                env:
                  - name: CLUSTER_NAME
                    value: "production"
                  - name: ENVIRONMENT
                    value: "prod"
```

## Inject Sidecar Container

```yaml
# kyverno-sidecar-injection.yaml
apiVersion: kyverno.io/v1
kind: ClusterPolicy
metadata:
  name: inject-logging-sidecar
spec:
  rules:
    - name: inject-fluentd
      match:
        any:
          - resources:
              kinds:
                - Pod
              namespaceSelector:
                matchLabels:
                  logging: enabled
      mutate:
        patchStrategicMerge:
          spec:
            containers:
              - name: fluentd-sidecar
                image: fluent/fluentd:v1.16
                volumeMounts:
                  - name: logs
                    mountPath: /var/log/app
                resources:
                  limits:
                    memory: "128Mi"
                    cpu: "100m"
            volumes:
              - name: logs
                emptyDir: {}
```

## Add Labels and Annotations

```yaml
# add-labels-policy.yaml
apiVersion: kyverno.io/v1
kind: ClusterPolicy
metadata:
  name: add-default-labels
spec:
  rules:
    - name: add-team-label
      match:
        any:
          - resources:
              kinds:
                - Pod
              namespaceSelector:
                matchLabels:
                  team: backend
      mutate:
        patchStrategicMerge:
          metadata:
            labels:
              team: backend
              cost-center: "12345"
            annotations:
              managed-by: platform-team
```

## Mount ConfigMap Automatically

```yaml
# inject-config-volume.yaml
apiVersion: kyverno.io/v1
kind: ClusterPolicy
metadata:
  name: inject-app-config
spec:
  rules:
    - name: mount-common-config
      match:
        any:
          - resources:
              kinds:
                - Pod
              selector:
                matchLabels:
                  inject-config: "true"
      mutate:
        patchStrategicMerge:
          spec:
            containers:
              - name: "*"
                volumeMounts:
                  - name: common-config
                    mountPath: /etc/app-config
                    readOnly: true
            volumes:
              - name: common-config
                configMap:
                  name: common-app-config
```

## Set Resource Defaults

```yaml
# default-resources.yaml
apiVersion: kyverno.io/v1
kind: ClusterPolicy
metadata:
  name: set-default-resources
spec:
  rules:
    - name: set-cpu-memory
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
                    memory: "128Mi"
                    cpu: "100m"
                  limits:
                    memory: "256Mi"
                    cpu: "500m"
```

## Conditional Mutation

```yaml
# conditional-mutation.yaml
apiVersion: kyverno.io/v1
kind: ClusterPolicy
metadata:
  name: inject-based-on-annotation
spec:
  rules:
    - name: inject-if-annotated
      match:
        any:
          - resources:
              kinds:
                - Pod
              annotations:
                inject-proxy: "true"
      mutate:
        patchStrategicMerge:
          spec:
            containers:
              - name: proxy-sidecar
                image: envoyproxy/envoy:v1.28.0
                ports:
                  - containerPort: 9901
```

## Using Gatekeeper Mutations

```yaml
# Gatekeeper mutation (OPA-based)
apiVersion: mutations.gatekeeper.sh/v1
kind: Assign
metadata:
  name: add-pull-secret
spec:
  applyTo:
    - groups: [""]
      kinds: ["Pod"]
      versions: ["v1"]
  match:
    scope: Namespaced
    kinds:
      - apiGroups: [""]
        kinds: ["Pod"]
  location: "spec.imagePullSecrets"
  parameters:
    assign:
      value:
        - name: registry-credentials
```

## Test Mutations

```bash
# Create test pod
kubectl run test-pod --image=nginx --dry-run=server -o yaml

# Check if mutations are applied
kubectl get pod test-pod -o yaml | grep -A5 env

# View Kyverno policy reports
kubectl get policyreport -A

# Check webhook configurations
kubectl get mutatingwebhookconfigurations

# Debug webhook
kubectl logs -n kyverno -l app.kubernetes.io/component=admission-controller
```

## Exclude Namespaces

```yaml
# Exclude system namespaces from mutations
apiVersion: kyverno.io/v1
kind: ClusterPolicy
metadata:
  name: inject-config
spec:
  rules:
    - name: inject
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
      mutate:
        # ... mutation spec
```

## Summary

Mutating admission webhooks automatically modify pods during creation. Use Kyverno or Gatekeeper for policy-based mutations without writing custom webhook servers. Common mutations include injecting environment variables, adding sidecar containers, mounting volumes, and setting resource defaults. Use namespace selectors or labels to target specific workloads. Exclude system namespaces to avoid breaking cluster components. Test mutations with `--dry-run=server` and check policy reports for debugging.

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
