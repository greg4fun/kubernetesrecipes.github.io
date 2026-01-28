---
title: "How to Set Up Linkerd Service Mesh"
description: "Deploy Linkerd service mesh for Kubernetes. Learn to add mTLS encryption, traffic management, and observability with minimal configuration overhead."
category: "networking"
difficulty: "intermediate"
timeToComplete: "35 minutes"
kubernetesVersion: "1.28+"
prerequisites:
  - "A running Kubernetes cluster (1.24+)"
  - "kubectl configured with cluster-admin privileges"
  - "Helm 3 installed"
relatedRecipes:
  - "istio-service-mesh"
  - "network-policies"
  - "distributed-tracing-jaeger"
tags:
  - linkerd
  - service-mesh
  - mtls
  - observability
  - traffic-management
  - networking
publishDate: "2026-01-28"
author: "Luca Berton"
---

## The Problem

You need to secure service-to-service communication, implement traffic management, and gain deep observability into your microservices without modifying application code.

## The Solution

Deploy Linkerd, an ultralight, security-first service mesh that provides automatic mTLS, observability, and reliability features with minimal resource overhead.

## Linkerd Architecture

```
Linkerd Service Mesh Architecture:

┌─────────────────────────────────────────────────────────────────┐
│                     CONTROL PLANE                                │
│                                                                  │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────────┐ │
│  │ destination │  │   identity  │  │    proxy-injector       │ │
│  │  (routing)  │  │  (mTLS CA)  │  │  (sidecar injection)    │ │
│  └─────────────┘  └─────────────┘  └─────────────────────────┘ │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                       DATA PLANE                                 │
│                                                                  │
│  ┌──────────────────────┐    ┌──────────────────────┐          │
│  │     Pod A            │    │     Pod B            │          │
│  │  ┌────────┐ ┌─────┐ │    │  ┌────────┐ ┌─────┐ │          │
│  │  │  App   │ │Proxy│◄├────┼──┤│ Proxy │ │ App │ │          │
│  │  └────────┘ └─────┘ │    │  └────────┘ └─────┘ │          │
│  │         mTLS        │    │        mTLS         │          │
│  └──────────────────────┘    └──────────────────────┘          │
└─────────────────────────────────────────────────────────────────┘
```

## Step 1: Install Linkerd CLI

```bash
# Install CLI
curl --proto '=https' --tlsv1.2 -sSfL https://run.linkerd.io/install | sh

# Add to PATH
export PATH=$HOME/.linkerd2/bin:$PATH

# Verify installation
linkerd version

# Check cluster compatibility
linkerd check --pre
```

## Step 2: Install Linkerd Control Plane

### Option A: Using CLI

```bash
# Generate certificates for identity (required for production)
step certificate create root.linkerd.cluster.local ca.crt ca.key \
  --profile root-ca --no-password --insecure

step certificate create identity.linkerd.cluster.local issuer.crt issuer.key \
  --profile intermediate-ca --not-after 8760h --no-password --insecure \
  --ca ca.crt --ca-key ca.key

# Install CRDs
linkerd install --crds | kubectl apply -f -

# Install control plane
linkerd install \
  --identity-trust-anchors-file ca.crt \
  --identity-issuer-certificate-file issuer.crt \
  --identity-issuer-key-file issuer.key \
  | kubectl apply -f -

# Wait for deployment
linkerd check
```

### Option B: Using Helm

```bash
# Add Helm repo
helm repo add linkerd https://helm.linkerd.io/stable
helm repo update

# Install CRDs
helm install linkerd-crds linkerd/linkerd-crds -n linkerd --create-namespace

# Install control plane
helm install linkerd-control-plane linkerd/linkerd-control-plane \
  -n linkerd \
  --set-file identityTrustAnchorsPEM=ca.crt \
  --set-file identity.issuer.tls.crtPEM=issuer.crt \
  --set-file identity.issuer.tls.keyPEM=issuer.key
```

## Step 3: Install Viz Extension (Observability Dashboard)

```bash
# Install viz extension
linkerd viz install | kubectl apply -f -

# Check viz deployment
linkerd viz check

# Access dashboard
linkerd viz dashboard &
```

## Step 4: Inject Linkerd Proxy into Workloads

### Automatic Injection (Recommended)

Add annotation to namespace:

```yaml
apiVersion: v1
kind: Namespace
metadata:
  name: myapp
  annotations:
    linkerd.io/inject: enabled
```

### Manual Injection

```bash
# Inject into existing deployment
kubectl get deploy myapp -o yaml | linkerd inject - | kubectl apply -f -

# Inject all deployments in namespace
kubectl get deploy -n myapp -o yaml | linkerd inject - | kubectl apply -f -
```

### Deployment with Linkerd Annotations

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: web-app
  namespace: myapp
spec:
  replicas: 3
  selector:
    matchLabels:
      app: web-app
  template:
    metadata:
      labels:
        app: web-app
      annotations:
        linkerd.io/inject: enabled
        # Optional: Configure proxy resources
        config.linkerd.io/proxy-cpu-request: "100m"
        config.linkerd.io/proxy-memory-request: "64Mi"
        config.linkerd.io/proxy-cpu-limit: "500m"
        config.linkerd.io/proxy-memory-limit: "128Mi"
    spec:
      containers:
        - name: web
          image: nginx:1.25
          ports:
            - containerPort: 80
```

## Step 5: Verify mTLS

```bash
# Check mTLS status for all meshed pods
linkerd viz edges deployment -n myapp

# Check specific connection
linkerd viz tap deployment/web-app -n myapp

# View traffic statistics
linkerd viz stat deployment -n myapp
```

## Traffic Management with Linkerd

### Traffic Split (Canary Deployments)

```yaml
apiVersion: split.smi-spec.io/v1alpha1
kind: TrafficSplit
metadata:
  name: web-app-canary
  namespace: myapp
spec:
  service: web-app
  backends:
    - service: web-app-stable
      weight: 900m  # 90%
    - service: web-app-canary
      weight: 100m  # 10%
```

### Services for Traffic Split

```yaml
apiVersion: v1
kind: Service
metadata:
  name: web-app
  namespace: myapp
spec:
  ports:
    - port: 80
  selector:
    app: web-app
---
apiVersion: v1
kind: Service
metadata:
  name: web-app-stable
  namespace: myapp
spec:
  ports:
    - port: 80
  selector:
    app: web-app
    version: stable
---
apiVersion: v1
kind: Service
metadata:
  name: web-app-canary
  namespace: myapp
spec:
  ports:
    - port: 80
  selector:
    app: web-app
    version: canary
```

## Service Profiles for Advanced Routing

```yaml
apiVersion: linkerd.io/v1alpha2
kind: ServiceProfile
metadata:
  name: web-app.myapp.svc.cluster.local
  namespace: myapp
spec:
  routes:
    - name: GET /api/users
      condition:
        method: GET
        pathRegex: /api/users
      responseClasses:
        - condition:
            status:
              min: 500
              max: 599
          isFailure: true
      # Retry configuration
      isRetryable: true

    - name: POST /api/orders
      condition:
        method: POST
        pathRegex: /api/orders
      # Timeout configuration  
      timeout: 30s
      responseClasses:
        - condition:
            status:
              min: 500
              max: 599
          isFailure: true

    - name: GET /health
      condition:
        method: GET
        pathRegex: /health
```

## Retries and Timeouts

```yaml
apiVersion: linkerd.io/v1alpha2
kind: ServiceProfile
metadata:
  name: backend.myapp.svc.cluster.local
  namespace: myapp
spec:
  # Default retry budget: 20% additional requests
  retryBudget:
    retryRatio: 0.2
    minRetriesPerSecond: 10
    ttl: 10s
  routes:
    - name: GET /api
      condition:
        method: GET
        pathRegex: /api/.*
      timeout: 5s
      isRetryable: true
```

## Circuit Breaking with Failure Accrual

Configure per-route failure handling:

```yaml
apiVersion: policy.linkerd.io/v1beta1
kind: Server
metadata:
  name: web-app-server
  namespace: myapp
spec:
  podSelector:
    matchLabels:
      app: web-app
  port: http
  proxyProtocol: HTTP/1
```

## Authorization Policies

### Allow Traffic from Specific Services

```yaml
apiVersion: policy.linkerd.io/v1beta1
kind: Server
metadata:
  name: backend-server
  namespace: myapp
spec:
  podSelector:
    matchLabels:
      app: backend
  port: 8080
  proxyProtocol: HTTP/1
---
apiVersion: policy.linkerd.io/v1beta1
kind: ServerAuthorization
metadata:
  name: frontend-to-backend
  namespace: myapp
spec:
  server:
    name: backend-server
  client:
    meshTLS:
      serviceAccounts:
        - name: frontend
          namespace: myapp
```

### Deny All by Default

```yaml
apiVersion: policy.linkerd.io/v1beta1
kind: AuthorizationPolicy
metadata:
  name: deny-all
  namespace: myapp
spec:
  targetRef:
    group: policy.linkerd.io
    kind: Server
    name: backend-server
  requiredAuthenticationRefs: []  # Empty means deny all
```

## Observability Features

### Golden Metrics via CLI

```bash
# View success rate, requests/sec, latency
linkerd viz stat deployment -n myapp

# Real-time traffic
linkerd viz tap deployment/web-app -n myapp

# Top traffic sources
linkerd viz top deployment/web-app -n myapp

# Route-level metrics
linkerd viz routes deployment/web-app -n myapp
```

### Prometheus Integration

```yaml
# ServiceMonitor for Prometheus Operator
apiVersion: monitoring.coreos.com/v1
kind: ServiceMonitor
metadata:
  name: linkerd-proxies
  namespace: monitoring
spec:
  selector:
    matchLabels:
      linkerd.io/control-plane-component: proxy
  namespaceSelector:
    any: true
  endpoints:
    - port: admin-http
      path: /metrics
      interval: 30s
```

### Grafana Dashboards

Linkerd provides pre-built Grafana dashboards:

```bash
# Install with Grafana
linkerd viz install --set grafana.enabled=true | kubectl apply -f -

# Access Grafana
kubectl port-forward -n linkerd-viz svc/grafana 3000:3000
```

## Multi-Cluster Communication

### Link Clusters

```bash
# On target cluster: Create gateway
linkerd multicluster install | kubectl apply -f -

# On source cluster: Link to target
linkerd multicluster link --cluster-name target | kubectl apply -f -

# Verify link
linkerd multicluster check
linkerd multicluster gateways
```

### Export Service to Other Clusters

```yaml
apiVersion: v1
kind: Service
metadata:
  name: backend
  namespace: myapp
  labels:
    mirror.linkerd.io/exported: "true"
spec:
  ports:
    - port: 8080
  selector:
    app: backend
```

## Debugging with Linkerd

### Debug Container

```bash
# Start debug container in mesh
linkerd viz tap deployment/web-app -n myapp --to deployment/backend

# Check proxy logs
kubectl logs deploy/web-app -n myapp -c linkerd-proxy

# Proxy diagnostics
linkerd diagnostics proxy-metrics -n myapp pod/web-app-xxx
```

### Common Issues

```bash
# Check if injection is working
kubectl get pods -n myapp -o jsonpath='{.items[*].spec.containers[*].name}'
# Should see: app-container, linkerd-proxy

# Verify mTLS
linkerd viz edges deployment -n myapp

# Check for skipped ports
kubectl get deploy web-app -n myapp -o yaml | grep skip-outbound
```

## Production Configuration

### High Availability Control Plane

```bash
linkerd install --ha | kubectl apply -f -
```

Or with Helm:

```bash
helm install linkerd-control-plane linkerd/linkerd-control-plane \
  -n linkerd \
  --set controllerReplicas=3 \
  --set webhookFailurePolicy=Fail \
  --set podDisruptionBudget.enabled=true
```

### Resource Tuning

```yaml
# deployment annotation for proxy resources
metadata:
  annotations:
    config.linkerd.io/proxy-cpu-request: "200m"
    config.linkerd.io/proxy-cpu-limit: "1"
    config.linkerd.io/proxy-memory-request: "128Mi"
    config.linkerd.io/proxy-memory-limit: "256Mi"
    # Skip injection for specific ports
    config.linkerd.io/skip-outbound-ports: "3306,6379"
    config.linkerd.io/skip-inbound-ports: "9090"
```

## Verification Commands

```bash
# Overall health check
linkerd check

# Viz check
linkerd viz check

# View meshed pods
linkerd viz stat -n myapp deploy

# Check edges (connections)
linkerd viz edges deploy -n myapp

# Live traffic tap
linkerd viz tap deploy/web-app -n myapp

# Route statistics
linkerd viz routes deploy/web-app -n myapp --to svc/backend
```

## Cleanup

```bash
# Remove viz extension
linkerd viz uninstall | kubectl delete -f -

# Remove control plane
linkerd uninstall | kubectl delete -f -

# Remove CRDs
helm uninstall linkerd-crds -n linkerd
```

## Linkerd vs Istio Comparison

| Feature | Linkerd | Istio |
|---------|---------|-------|
| Resource usage | Very light (~10MB/proxy) | Heavier (~50MB/proxy) |
| Complexity | Simple | Complex, feature-rich |
| mTLS | Automatic | Configurable |
| Traffic management | Basic (SMI) | Advanced (VirtualService) |
| Learning curve | Low | High |
| Best for | Simplicity, performance | Advanced traffic control |

## Summary

Linkerd provides a lightweight, secure service mesh with automatic mTLS, golden metrics, and traffic management. Its simplicity makes it ideal for teams wanting service mesh benefits without operational complexity.

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
