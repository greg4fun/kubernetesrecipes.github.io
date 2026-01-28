---
title: "Kubernetes API Aggregation Layer"
description: "Extend the Kubernetes API with custom API servers using the aggregation layer to add new resource types and functionality without modifying core components"
category: "configuration"
difficulty: "advanced"
timeToComplete: "60 minutes"
kubernetesVersion: "1.28+"
prerequisites:
  - "Understanding of Kubernetes API concepts"
  - "Knowledge of Custom Resource Definitions (CRDs)"
  - "Familiarity with Go programming (for custom API servers)"
relatedRecipes:
  - "custom-resource-definitions"
  - "kubernetes-operators"
  - "admission-webhooks"
tags:
  - api-aggregation
  - api-server
  - extension-apiserver
  - custom-api
  - kubernetes-extension
publishDate: 2026-01-28
author: "kubernetes-recipes"
---

## Problem

Custom Resource Definitions (CRDs) have limitations: they don't support subresources like scale or status with custom logic, can't implement custom storage backends, and lack fine-grained control over API behavior. You need more powerful API extension capabilities.

## Solution

Use the Kubernetes API Aggregation Layer to register custom API servers that handle requests for specific API groups. This allows implementing custom storage, validation, admission, and subresources with full control.

### Architecture

```
┌─────────────────────────────────────────────────────┐
│                   kubectl / Client                   │
└─────────────────────┬───────────────────────────────┘
                      │ API Request
                      ▼
┌─────────────────────────────────────────────────────┐
│           Kubernetes API Server                      │
│  ┌────────────────────────────────────────────┐    │
│  │        API Aggregation Layer               │    │
│  │  1. Check if request matches APIService    │    │
│  │  2. Proxy to extension API server          │    │
│  │  3. Return response to client              │    │
│  └─────────────────┬──────────────────────────┘    │
└────────────────────┼────────────────────────────────┘
                     │
        ┌────────────┼────────────┐
        ▼            ▼            ▼
┌─────────────┐ ┌──────────┐ ┌──────────────┐
│   Core API  │ │ Metrics  │ │  Custom API  │
│   Server    │ │  Server  │ │   Server     │
│ (built-in)  │ │ (HPA)    │ │ (your.api)   │
└─────────────┘ └──────────┘ └──────────────┘
     /api           /apis          /apis
    /apis        metrics.k8s.io  custom.io
```

### Step 1: Understand APIService Resource

The APIService resource registers an API group with the aggregation layer:

```yaml
apiVersion: apiregistration.k8s.io/v1
kind: APIService
metadata:
  name: v1.custom.example.com
spec:
  # API version this service handles
  version: v1
  # API group this service handles
  group: custom.example.com
  # Priority for version selection (lower = higher priority)
  versionPriority: 100
  groupPriorityMinimum: 1000
  # Service reference (where to proxy requests)
  service:
    name: custom-api-server
    namespace: custom-system
    port: 443
  # CA bundle to verify the extension API server
  caBundle: <base64-encoded-ca-cert>
  # Set to true if extension server validates its TLS cert
  insecureSkipTLSVerify: false
```

### Step 2: Create Extension API Server

Build a custom API server using the Kubernetes apiserver library:

```go
// main.go
package main

import (
    "os"
    
    "k8s.io/apimachinery/pkg/runtime"
    "k8s.io/apimachinery/pkg/runtime/schema"
    "k8s.io/apiserver/pkg/registry/rest"
    genericapiserver "k8s.io/apiserver/pkg/server"
    
    "github.com/example/custom-api/pkg/apis/custom/v1"
    "github.com/example/custom-api/pkg/registry"
)

func main() {
    // Create server config
    config := genericapiserver.NewRecommendedConfig(Codecs)
    
    // Build API groups
    apiGroupInfo := genericapiserver.NewDefaultAPIGroupInfo(
        "custom.example.com",
        Scheme,
        runtime.NewParameterCodec(Scheme),
        Codecs,
    )
    
    // Register storage for resources
    v1storage := map[string]rest.Storage{
        "widgets":        registry.NewWidgetStorage(),
        "widgets/status": registry.NewWidgetStatusStorage(),
        "widgets/scale":  registry.NewWidgetScaleStorage(),
    }
    apiGroupInfo.VersionedResourcesStorageMap["v1"] = v1storage
    
    // Create and run server
    server, err := config.Complete().New("custom-api-server", genericapiserver.NewEmptyDelegate())
    if err != nil {
        os.Exit(1)
    }
    
    server.InstallAPIGroup(&apiGroupInfo)
    server.PrepareRun().Run(stopCh)
}
```

### Step 3: Define Custom API Types

Define your custom resource types:

```go
// pkg/apis/custom/v1/types.go
package v1

import (
    metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
)

// +genclient
// +k8s:deepcopy-gen:interfaces=k8s.io/apimachinery/pkg/runtime.Object

// Widget is a custom resource
type Widget struct {
    metav1.TypeMeta   `json:",inline"`
    metav1.ObjectMeta `json:"metadata,omitempty"`
    
    Spec   WidgetSpec   `json:"spec"`
    Status WidgetStatus `json:"status"`
}

type WidgetSpec struct {
    Replicas int32  `json:"replicas"`
    Image    string `json:"image"`
    Color    string `json:"color"`
}

type WidgetStatus struct {
    AvailableReplicas int32       `json:"availableReplicas"`
    Phase             WidgetPhase `json:"phase"`
    LastUpdated       metav1.Time `json:"lastUpdated"`
}

type WidgetPhase string

const (
    WidgetPending   WidgetPhase = "Pending"
    WidgetRunning   WidgetPhase = "Running"
    WidgetFailed    WidgetPhase = "Failed"
)

// +k8s:deepcopy-gen:interfaces=k8s.io/apimachinery/pkg/runtime.Object

// WidgetList is a list of Widgets
type WidgetList struct {
    metav1.TypeMeta `json:",inline"`
    metav1.ListMeta `json:"metadata"`
    
    Items []Widget `json:"items"`
}
```

### Step 4: Implement Custom Storage

Create storage backend with custom logic:

```go
// pkg/registry/widget_storage.go
package registry

import (
    "context"
    
    "k8s.io/apimachinery/pkg/runtime"
    "k8s.io/apiserver/pkg/registry/generic"
    "k8s.io/apiserver/pkg/registry/rest"
    "k8s.io/apiserver/pkg/storage"
)

type WidgetStorage struct {
    rest.StandardStorage
    store *genericregistry.Store
}

func NewWidgetStorage(scheme *runtime.Scheme, optsGetter generic.RESTOptionsGetter) (*WidgetStorage, error) {
    strategy := NewWidgetStrategy(scheme)
    
    store := &genericregistry.Store{
        NewFunc:                  func() runtime.Object { return &v1.Widget{} },
        NewListFunc:              func() runtime.Object { return &v1.WidgetList{} },
        DefaultQualifiedResource: v1.Resource("widgets"),
        CreateStrategy:           strategy,
        UpdateStrategy:           strategy,
        DeleteStrategy:           strategy,
    }
    
    options := &generic.StoreOptions{
        RESTOptions: optsGetter,
    }
    if err := store.CompleteWithOptions(options); err != nil {
        return nil, err
    }
    
    return &WidgetStorage{store: store}, nil
}

// Custom validation on create
func (s *WidgetStorage) Create(ctx context.Context, obj runtime.Object, createValidation rest.ValidateObjectFunc, options *metav1.CreateOptions) (runtime.Object, error) {
    widget := obj.(*v1.Widget)
    
    // Custom business logic
    if widget.Spec.Color == "" {
        widget.Spec.Color = "blue" // Default color
    }
    
    // Additional validation
    if widget.Spec.Replicas > 100 {
        return nil, errors.NewBadRequest("replicas cannot exceed 100")
    }
    
    return s.store.Create(ctx, obj, createValidation, options)
}
```

### Step 5: Deploy Extension API Server

Create deployment and service:

```yaml
apiVersion: v1
kind: Namespace
metadata:
  name: custom-system
---
apiVersion: v1
kind: ServiceAccount
metadata:
  name: custom-api-server
  namespace: custom-system
---
apiVersion: rbac.authorization.k8s.io/v1
kind: ClusterRoleBinding
metadata:
  name: custom-api-server:system:auth-delegator
roleRef:
  apiGroup: rbac.authorization.k8s.io
  kind: ClusterRole
  name: system:auth-delegator
subjects:
- kind: ServiceAccount
  name: custom-api-server
  namespace: custom-system
---
apiVersion: rbac.authorization.k8s.io/v1
kind: RoleBinding
metadata:
  name: custom-api-server-auth-reader
  namespace: kube-system
roleRef:
  apiGroup: rbac.authorization.k8s.io
  kind: Role
  name: extension-apiserver-authentication-reader
subjects:
- kind: ServiceAccount
  name: custom-api-server
  namespace: custom-system
---
apiVersion: apps/v1
kind: Deployment
metadata:
  name: custom-api-server
  namespace: custom-system
spec:
  replicas: 2
  selector:
    matchLabels:
      app: custom-api-server
  template:
    metadata:
      labels:
        app: custom-api-server
    spec:
      serviceAccountName: custom-api-server
      containers:
      - name: api-server
        image: custom-api-server:v1.0
        args:
        - --secure-port=8443
        - --etcd-servers=https://etcd.custom-system.svc:2379
        - --tls-cert-file=/etc/apiserver/tls/tls.crt
        - --tls-private-key-file=/etc/apiserver/tls/tls.key
        - --client-ca-file=/etc/apiserver/ca/ca.crt
        ports:
        - containerPort: 8443
          name: https
        volumeMounts:
        - name: tls
          mountPath: /etc/apiserver/tls
          readOnly: true
        - name: ca
          mountPath: /etc/apiserver/ca
          readOnly: true
      volumes:
      - name: tls
        secret:
          secretName: custom-api-server-tls
      - name: ca
        secret:
          secretName: custom-api-server-ca
---
apiVersion: v1
kind: Service
metadata:
  name: custom-api-server
  namespace: custom-system
spec:
  selector:
    app: custom-api-server
  ports:
  - port: 443
    targetPort: 8443
```

### Step 6: Generate TLS Certificates

Create certificates for the extension API server:

```bash
# Generate CA
openssl genrsa -out ca.key 2048
openssl req -x509 -new -nodes -key ca.key -subj "/CN=custom-api-server-ca" \
  -days 3650 -out ca.crt

# Generate server certificate
openssl genrsa -out server.key 2048
cat > server.conf <<EOF
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
DNS.1 = custom-api-server
DNS.2 = custom-api-server.custom-system
DNS.3 = custom-api-server.custom-system.svc
DNS.4 = custom-api-server.custom-system.svc.cluster.local
EOF

openssl req -new -key server.key -subj "/CN=custom-api-server" \
  -out server.csr -config server.conf

openssl x509 -req -in server.csr -CA ca.crt -CAkey ca.key \
  -CAcreateserial -out server.crt -days 365 \
  -extensions v3_req -extfile server.conf

# Create secrets
kubectl create secret tls custom-api-server-tls \
  --cert=server.crt --key=server.key -n custom-system

kubectl create secret generic custom-api-server-ca \
  --from-file=ca.crt=ca.crt -n custom-system
```

### Step 7: Register APIService

Register the extension API server:

```yaml
apiVersion: apiregistration.k8s.io/v1
kind: APIService
metadata:
  name: v1.custom.example.com
spec:
  version: v1
  group: custom.example.com
  groupPriorityMinimum: 1000
  versionPriority: 100
  service:
    name: custom-api-server
    namespace: custom-system
    port: 443
  caBundle: <base64-encoded-ca.crt>
```

Apply with CA bundle:

```bash
# Get base64 CA bundle
CA_BUNDLE=$(cat ca.crt | base64 | tr -d '\n')

# Apply APIService
cat <<EOF | kubectl apply -f -
apiVersion: apiregistration.k8s.io/v1
kind: APIService
metadata:
  name: v1.custom.example.com
spec:
  version: v1
  group: custom.example.com
  groupPriorityMinimum: 1000
  versionPriority: 100
  service:
    name: custom-api-server
    namespace: custom-system
    port: 443
  caBundle: ${CA_BUNDLE}
EOF
```

### Step 8: Use the Custom API

Create and manage custom resources:

```yaml
apiVersion: custom.example.com/v1
kind: Widget
metadata:
  name: my-widget
  namespace: default
spec:
  replicas: 3
  image: widget-processor:v1.0
  color: red
```

```bash
# Create widget
kubectl apply -f widget.yaml

# List widgets
kubectl get widgets

# Get widget details
kubectl get widget my-widget -o yaml

# Scale widget (if scale subresource implemented)
kubectl scale widget my-widget --replicas=5

# Get widget status
kubectl get widget my-widget -o jsonpath='{.status}'
```

## Verification

Check APIService status:

```bash
# List all APIServices
kubectl get apiservices

# Check specific APIService
kubectl get apiservice v1.custom.example.com -o yaml

# Verify APIService is available
kubectl get apiservice v1.custom.example.com -o jsonpath='{.status.conditions}'
```

Test API endpoint:

```bash
# Direct API call
kubectl get --raw /apis/custom.example.com/v1/widgets

# With namespace
kubectl get --raw /apis/custom.example.com/v1/namespaces/default/widgets

# API discovery
kubectl api-resources | grep custom.example.com
kubectl api-versions | grep custom.example.com
```

Debug issues:

```bash
# Check extension API server logs
kubectl logs -n custom-system -l app=custom-api-server

# Check kube-apiserver aggregation logs
kubectl logs -n kube-system kube-apiserver-<node> | grep -i aggregat

# Verify network connectivity
kubectl run -it --rm debug --image=curlimages/curl -- \
  curl -k https://custom-api-server.custom-system.svc:443/apis/custom.example.com/v1
```

## Best Practices

1. **Use CRDs when possible** - simpler and sufficient for most cases
2. **Implement proper authentication** delegation from main API server
3. **Use TLS** for all extension API server communications
4. **Handle admission webhooks** for validation
5. **Implement proper RBAC** for your custom resources
6. **Monitor APIService availability** status
7. **Version your APIs** properly (v1alpha1, v1beta1, v1)
8. **Document your custom API** thoroughly
9. **Test failover** when extension server is unavailable
10. **Use etcd or proper storage** for persistence

## Common Issues

**APIService unavailable:**
- Check extension API server pods are running
- Verify TLS certificates are valid
- Check network policy allows traffic

**Authentication failures:**
- Ensure auth-delegator binding exists
- Verify extension server reads auth config
- Check CA bundle is correct

**Storage errors:**
- Verify etcd connectivity
- Check storage RBAC permissions
- Ensure proper storage backend configuration

## Related Resources

- [API Aggregation](https://kubernetes.io/docs/concepts/extend-kubernetes/api-extension/apiserver-aggregation/)
- [Building Extension API Servers](https://kubernetes.io/docs/tasks/extend-kubernetes/setup-extension-api-server/)
- [Sample API Server](https://github.com/kubernetes/sample-apiserver)

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
