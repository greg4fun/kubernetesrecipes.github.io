---
title: "How to Create Admission Webhooks"
description: "Build validating and mutating admission webhooks to enforce policies and modify resources. Implement custom admission controllers for Kubernetes."
category: "security"
difficulty: "advanced"
publishDate: "2026-01-22"
tags: ["admission-webhooks", "security", "validation", "mutation", "policy"]
---

# How to Create Admission Webhooks

Admission webhooks intercept requests to the Kubernetes API before persistence, allowing you to validate or mutate resources. Validating webhooks reject non-compliant resources, while mutating webhooks modify resources automatically.

## Webhook Types

- **Validating Admission Webhook**: Accepts or rejects requests
- **Mutating Admission Webhook**: Modifies requests before validation

## Create Webhook Server (Go)

```go
// main.go
package main

import (
    "encoding/json"
    "fmt"
    "io"
    "net/http"

    admissionv1 "k8s.io/api/admission/v1"
    corev1 "k8s.io/api/core/v1"
    metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
)

func main() {
    http.HandleFunc("/validate", validateHandler)
    http.HandleFunc("/mutate", mutateHandler)
    http.HandleFunc("/health", healthHandler)

    fmt.Println("Starting webhook server on :8443")
    err := http.ListenAndServeTLS(":8443", "/certs/tls.crt", "/certs/tls.key", nil)
    if err != nil {
        panic(err)
    }
}

func validateHandler(w http.ResponseWriter, r *http.Request) {
    body, _ := io.ReadAll(r.Body)
    
    var admissionReview admissionv1.AdmissionReview
    json.Unmarshal(body, &admissionReview)
    
    var pod corev1.Pod
    json.Unmarshal(admissionReview.Request.Object.Raw, &pod)
    
    allowed := true
    message := "Pod validation passed"
    
    // Validate: Require resource limits
    for _, container := range pod.Spec.Containers {
        if container.Resources.Limits == nil {
            allowed = false
            message = fmt.Sprintf("Container %s must have resource limits", container.Name)
            break
        }
    }
    
    response := admissionv1.AdmissionReview{
        TypeMeta: metav1.TypeMeta{
            APIVersion: "admission.k8s.io/v1",
            Kind:       "AdmissionReview",
        },
        Response: &admissionv1.AdmissionResponse{
            UID:     admissionReview.Request.UID,
            Allowed: allowed,
            Result: &metav1.Status{
                Message: message,
            },
        },
    }
    
    respBytes, _ := json.Marshal(response)
    w.Header().Set("Content-Type", "application/json")
    w.Write(respBytes)
}

func mutateHandler(w http.ResponseWriter, r *http.Request) {
    body, _ := io.ReadAll(r.Body)
    
    var admissionReview admissionv1.AdmissionReview
    json.Unmarshal(body, &admissionReview)
    
    var pod corev1.Pod
    json.Unmarshal(admissionReview.Request.Object.Raw, &pod)
    
    // Mutation: Add default labels
    patches := []map[string]interface{}{}
    
    if pod.Labels == nil {
        patches = append(patches, map[string]interface{}{
            "op":    "add",
            "path":  "/metadata/labels",
            "value": map[string]string{},
        })
    }
    
    if _, exists := pod.Labels["managed-by"]; !exists {
        patches = append(patches, map[string]interface{}{
            "op":    "add",
            "path":  "/metadata/labels/managed-by",
            "value": "admission-webhook",
        })
    }
    
    patchBytes, _ := json.Marshal(patches)
    patchType := admissionv1.PatchTypeJSONPatch
    
    response := admissionv1.AdmissionReview{
        TypeMeta: metav1.TypeMeta{
            APIVersion: "admission.k8s.io/v1",
            Kind:       "AdmissionReview",
        },
        Response: &admissionv1.AdmissionResponse{
            UID:       admissionReview.Request.UID,
            Allowed:   true,
            PatchType: &patchType,
            Patch:     patchBytes,
        },
    }
    
    respBytes, _ := json.Marshal(response)
    w.Header().Set("Content-Type", "application/json")
    w.Write(respBytes)
}

func healthHandler(w http.ResponseWriter, r *http.Request) {
    w.WriteHeader(http.StatusOK)
    w.Write([]byte("OK"))
}
```

## Create Webhook Server (Python)

```python
# webhook.py
from flask import Flask, request, jsonify
import json
import base64

app = Flask(__name__)

@app.route('/validate', methods=['POST'])
def validate():
    admission_review = request.get_json()
    pod = json.loads(
        admission_review['request']['object']
    ) if isinstance(admission_review['request']['object'], str) else admission_review['request']['object']
    
    allowed = True
    message = "Validation passed"
    
    # Validate: Check for required labels
    required_labels = ['app', 'team']
    labels = pod.get('metadata', {}).get('labels', {})
    
    for label in required_labels:
        if label not in labels:
            allowed = False
            message = f"Missing required label: {label}"
            break
    
    # Validate: No privileged containers
    containers = pod.get('spec', {}).get('containers', [])
    for container in containers:
        security_context = container.get('securityContext', {})
        if security_context.get('privileged', False):
            allowed = False
            message = f"Privileged containers not allowed: {container['name']}"
            break
    
    return jsonify({
        "apiVersion": "admission.k8s.io/v1",
        "kind": "AdmissionReview",
        "response": {
            "uid": admission_review['request']['uid'],
            "allowed": allowed,
            "status": {"message": message}
        }
    })

@app.route('/mutate', methods=['POST'])
def mutate():
    admission_review = request.get_json()
    pod = admission_review['request']['object']
    
    patches = []
    
    # Add default annotations
    if 'annotations' not in pod.get('metadata', {}):
        patches.append({
            "op": "add",
            "path": "/metadata/annotations",
            "value": {}
        })
    
    patches.append({
        "op": "add",
        "path": "/metadata/annotations/webhook.kubernetes.io~1mutated",
        "value": "true"
    })
    
    # Add resource requests if missing
    containers = pod.get('spec', {}).get('containers', [])
    for i, container in enumerate(containers):
        if 'resources' not in container:
            patches.append({
                "op": "add",
                "path": f"/spec/containers/{i}/resources",
                "value": {
                    "requests": {"memory": "64Mi", "cpu": "50m"},
                    "limits": {"memory": "128Mi", "cpu": "100m"}
                }
            })
    
    patch_base64 = base64.b64encode(json.dumps(patches).encode()).decode()
    
    return jsonify({
        "apiVersion": "admission.k8s.io/v1",
        "kind": "AdmissionReview",
        "response": {
            "uid": admission_review['request']['uid'],
            "allowed": True,
            "patchType": "JSONPatch",
            "patch": patch_base64
        }
    })

@app.route('/health', methods=['GET'])
def health():
    return "OK", 200

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=8443, ssl_context=('/certs/tls.crt', '/certs/tls.key'))
```

## Generate TLS Certificates

```bash
#!/bin/bash
# generate-certs.sh

SERVICE_NAME=webhook-service
NAMESPACE=webhook-system
SECRET_NAME=webhook-tls

# Generate CA
openssl genrsa -out ca.key 2048
openssl req -x509 -new -nodes -key ca.key -days 365 -out ca.crt -subj "/CN=Admission Webhook CA"

# Generate server certificate
cat > server.conf << EOF
[req]
req_extensions = v3_req
distinguished_name = req_distinguished_name
[req_distinguished_name]
[v3_req]
basicConstraints = CA:FALSE
keyUsage = nonRepudiation, digitalSignature, keyEncipherment
extendedKeyUsage = serverAuth
subjectAltName = @alt_names
[alt_names]
DNS.1 = ${SERVICE_NAME}
DNS.2 = ${SERVICE_NAME}.${NAMESPACE}
DNS.3 = ${SERVICE_NAME}.${NAMESPACE}.svc
DNS.4 = ${SERVICE_NAME}.${NAMESPACE}.svc.cluster.local
EOF

openssl genrsa -out server.key 2048
openssl req -new -key server.key -out server.csr -subj "/CN=${SERVICE_NAME}.${NAMESPACE}.svc" -config server.conf
openssl x509 -req -in server.csr -CA ca.crt -CAkey ca.key -CAcreateserial -out server.crt -days 365 -extensions v3_req -extfile server.conf

# Create Kubernetes secret
kubectl create namespace ${NAMESPACE} --dry-run=client -o yaml | kubectl apply -f -
kubectl create secret tls ${SECRET_NAME} \
  --cert=server.crt \
  --key=server.key \
  -n ${NAMESPACE} \
  --dry-run=client -o yaml | kubectl apply -f -

# Get CA bundle for webhook config
CA_BUNDLE=$(cat ca.crt | base64 | tr -d '\n')
echo "CA_BUNDLE: ${CA_BUNDLE}"
```

## Deploy Webhook Server

```yaml
# webhook-deployment.yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: admission-webhook
  namespace: webhook-system
spec:
  replicas: 2
  selector:
    matchLabels:
      app: admission-webhook
  template:
    metadata:
      labels:
        app: admission-webhook
    spec:
      containers:
        - name: webhook
          image: myregistry/admission-webhook:v1
          ports:
            - containerPort: 8443
          volumeMounts:
            - name: tls-certs
              mountPath: /certs
              readOnly: true
          readinessProbe:
            httpGet:
              path: /health
              port: 8443
              scheme: HTTPS
          resources:
            requests:
              memory: "64Mi"
              cpu: "50m"
            limits:
              memory: "128Mi"
              cpu: "100m"
      volumes:
        - name: tls-certs
          secret:
            secretName: webhook-tls
---
apiVersion: v1
kind: Service
metadata:
  name: webhook-service
  namespace: webhook-system
spec:
  selector:
    app: admission-webhook
  ports:
    - port: 443
      targetPort: 8443
```

## Register Validating Webhook

```yaml
# validating-webhook-config.yaml
apiVersion: admissionregistration.k8s.io/v1
kind: ValidatingWebhookConfiguration
metadata:
  name: pod-validation-webhook
webhooks:
  - name: pod-validator.example.com
    clientConfig:
      service:
        name: webhook-service
        namespace: webhook-system
        path: /validate
      caBundle: <BASE64_ENCODED_CA_CERT>
    rules:
      - operations: ["CREATE", "UPDATE"]
        apiGroups: [""]
        apiVersions: ["v1"]
        resources: ["pods"]
    admissionReviewVersions: ["v1"]
    sideEffects: None
    failurePolicy: Fail  # or Ignore
    namespaceSelector:
      matchExpressions:
        - key: webhook-enabled
          operator: In
          values: ["true"]
```

## Register Mutating Webhook

```yaml
# mutating-webhook-config.yaml
apiVersion: admissionregistration.k8s.io/v1
kind: MutatingWebhookConfiguration
metadata:
  name: pod-mutation-webhook
webhooks:
  - name: pod-mutator.example.com
    clientConfig:
      service:
        name: webhook-service
        namespace: webhook-system
        path: /mutate
      caBundle: <BASE64_ENCODED_CA_CERT>
    rules:
      - operations: ["CREATE"]
        apiGroups: [""]
        apiVersions: ["v1"]
        resources: ["pods"]
    admissionReviewVersions: ["v1"]
    sideEffects: None
    failurePolicy: Ignore
    reinvocationPolicy: Never
    namespaceSelector:
      matchExpressions:
        - key: kubernetes.io/metadata.name
          operator: NotIn
          values: ["kube-system", "webhook-system"]
```

## Using cert-manager for Certificates

```yaml
# cert-manager-certificate.yaml
apiVersion: cert-manager.io/v1
kind: Certificate
metadata:
  name: webhook-cert
  namespace: webhook-system
spec:
  secretName: webhook-tls
  dnsNames:
    - webhook-service
    - webhook-service.webhook-system
    - webhook-service.webhook-system.svc
    - webhook-service.webhook-system.svc.cluster.local
  issuerRef:
    name: selfsigned-issuer
    kind: ClusterIssuer
---
apiVersion: cert-manager.io/v1
kind: ClusterIssuer
metadata:
  name: selfsigned-issuer
spec:
  selfSigned: {}
```

## Test Webhooks

```bash
# Test validating webhook - should fail without labels
kubectl run test-pod --image=nginx

# Test with required labels - should succeed
kubectl run test-pod --image=nginx --labels="app=test,team=platform"

# Check mutation
kubectl get pod test-pod -o jsonpath='{.metadata.annotations}'

# Debug webhook
kubectl logs -n webhook-system -l app=admission-webhook
kubectl get events --field-selector reason=FailedCreate
```

## Summary

Admission webhooks provide powerful customization for the Kubernetes API. Mutating webhooks run first to modify resources, then validating webhooks check compliance. Always use TLS, implement health checks, set appropriate `failurePolicy`, and exclude system namespaces to prevent cluster lockout. Use cert-manager to automate certificate management.

---

## 📘 Go Further with Kubernetes Recipes

**Love this recipe? There's so much more!** This is just one of **100+ hands-on recipes** in our comprehensive **[Kubernetes Recipes book](https://amzn.to/3DzC8QA)**.

Inside the book, you'll master:
- ✅ Production-ready deployment strategies
- ✅ Advanced networking and security patterns  
- ✅ Observability, monitoring, and troubleshooting
- ✅ Real-world best practices from industry experts

> *"The practical, recipe-based approach made complex Kubernetes concepts finally click for me."*

**👉 [Get Your Copy Now](https://amzn.to/3DzC8QA)** — Start building production-grade Kubernetes skills today!
