---
title: "How to Use Kubernetes Gateway API"
description: "Implement the Gateway API for advanced traffic routing in Kubernetes. Learn HTTPRoute, TLSRoute, and traffic splitting with the next-generation Ingress replacement."
category: "networking"
difficulty: "intermediate"
timeToComplete: "30 minutes"
kubernetesVersion: "1.28+"
prerequisites:
  - "A running Kubernetes cluster (1.26+)"
  - "kubectl configured with appropriate permissions"
  - "A Gateway API implementation (NGINX, Envoy, Istio, etc.)"
relatedRecipes:
  - "ingress-routing"
  - "ingress-tls-certificates"
  - "canary-deployments"
tags:
  - gateway-api
  - networking
  - ingress
  - routing
  - traffic-management
  - httproute
publishDate: "2026-01-28"
author: "Luca Berton"
---

## The Problem

Kubernetes Ingress has limitations: vendor-specific annotations, no support for TCP/UDP routing, and limited traffic splitting capabilities. You need a more expressive, portable, and role-oriented API for traffic management.

## The Solution

Use the Gateway API, the next-generation Kubernetes networking standard that provides expressive, extensible, and role-oriented routing for HTTP, HTTPS, TCP, and gRPC traffic.

## Gateway API vs Ingress

```
Gateway API Architecture:

┌─────────────────────────────────────────────────────────────────┐
│  ROLE-BASED RESOURCE MODEL                                       │
│                                                                  │
│  ┌─────────────────┐                                            │
│  │  GatewayClass   │  ← Infrastructure Provider (cluster-admin) │
│  │  (nginx, envoy) │                                            │
│  └────────┬────────┘                                            │
│           │                                                      │
│  ┌────────▼────────┐                                            │
│  │    Gateway      │  ← Cluster Operator (platform team)        │
│  │  (listeners,    │                                            │
│  │   addresses)    │                                            │
│  └────────┬────────┘                                            │
│           │                                                      │
│  ┌────────▼────────┐                                            │
│  │   HTTPRoute     │  ← Application Developer (dev team)        │
│  │   TCPRoute      │                                            │
│  │   TLSRoute      │                                            │
│  │   GRPCRoute     │                                            │
│  └─────────────────┘                                            │
└─────────────────────────────────────────────────────────────────┘
```

## Step 1: Install Gateway API CRDs

```bash
# Install the standard channel CRDs
kubectl apply -f https://github.com/kubernetes-sigs/gateway-api/releases/download/v1.0.0/standard-install.yaml

# For experimental features (TCPRoute, TLSRoute, etc.)
kubectl apply -f https://github.com/kubernetes-sigs/gateway-api/releases/download/v1.0.0/experimental-install.yaml

# Verify installation
kubectl get crds | grep gateway
```

## Step 2: Install a Gateway Controller

### Option A: NGINX Gateway Fabric

```bash
# Install NGINX Gateway Fabric
kubectl apply -f https://github.com/nginxinc/nginx-gateway-fabric/releases/download/v1.1.0/crds.yaml
kubectl apply -f https://github.com/nginxinc/nginx-gateway-fabric/releases/download/v1.1.0/nginx-gateway.yaml

# Verify deployment
kubectl get pods -n nginx-gateway
```

### Option B: Envoy Gateway

```bash
# Install Envoy Gateway
helm install eg oci://docker.io/envoyproxy/gateway-helm \
  --version v0.6.0 \
  -n envoy-gateway-system --create-namespace

# Verify
kubectl get pods -n envoy-gateway-system
```

### Option C: Istio Gateway

```bash
# If Istio is installed, enable Gateway API support
istioctl install --set values.pilot.env.PILOT_ENABLE_GATEWAY_API=true
```

## Step 3: Create GatewayClass and Gateway

### GatewayClass (Infrastructure Provider)

```yaml
apiVersion: gateway.networking.k8s.io/v1
kind: GatewayClass
metadata:
  name: nginx
spec:
  controllerName: gateway.nginx.org/nginx-gateway-controller
```

### Gateway (Platform Team)

```yaml
apiVersion: gateway.networking.k8s.io/v1
kind: Gateway
metadata:
  name: main-gateway
  namespace: default
spec:
  gatewayClassName: nginx
  listeners:
    # HTTP listener
    - name: http
      protocol: HTTP
      port: 80
      allowedRoutes:
        namespaces:
          from: All

    # HTTPS listener
    - name: https
      protocol: HTTPS
      port: 443
      tls:
        mode: Terminate
        certificateRefs:
          - name: wildcard-tls
            kind: Secret
      allowedRoutes:
        namespaces:
          from: Selector
          selector:
            matchLabels:
              gateway-access: "true"

    # Specific hostname listener
    - name: api
      protocol: HTTPS
      port: 443
      hostname: "api.example.com"
      tls:
        mode: Terminate
        certificateRefs:
          - name: api-tls
      allowedRoutes:
        namespaces:
          from: Same
```

## Step 4: Configure HTTPRoute

### Basic HTTPRoute

```yaml
apiVersion: gateway.networking.k8s.io/v1
kind: HTTPRoute
metadata:
  name: web-app-route
  namespace: production
spec:
  parentRefs:
    - name: main-gateway
      namespace: default
  hostnames:
    - "app.example.com"
  rules:
    - matches:
        - path:
            type: PathPrefix
            value: /
      backendRefs:
        - name: web-app
          port: 80
```

### Path-Based Routing

```yaml
apiVersion: gateway.networking.k8s.io/v1
kind: HTTPRoute
metadata:
  name: microservices-route
  namespace: production
spec:
  parentRefs:
    - name: main-gateway
  hostnames:
    - "api.example.com"
  rules:
    # Route /users to users service
    - matches:
        - path:
            type: PathPrefix
            value: /users
      backendRefs:
        - name: users-service
          port: 8080

    # Route /orders to orders service
    - matches:
        - path:
            type: PathPrefix
            value: /orders
      backendRefs:
        - name: orders-service
          port: 8080

    # Route /products to products service
    - matches:
        - path:
            type: PathPrefix
            value: /products
      backendRefs:
        - name: products-service
          port: 8080

    # Default backend
    - matches:
        - path:
            type: PathPrefix
            value: /
      backendRefs:
        - name: frontend
          port: 80
```

### Header-Based Routing

```yaml
apiVersion: gateway.networking.k8s.io/v1
kind: HTTPRoute
metadata:
  name: header-routing
  namespace: production
spec:
  parentRefs:
    - name: main-gateway
  hostnames:
    - "api.example.com"
  rules:
    # Route mobile traffic to mobile backend
    - matches:
        - headers:
            - name: X-Client-Type
              value: mobile
      backendRefs:
        - name: mobile-backend
          port: 8080

    # Route based on API version header
    - matches:
        - headers:
            - name: X-API-Version
              value: v2
      backendRefs:
        - name: api-v2
          port: 8080

    # Default to v1
    - backendRefs:
        - name: api-v1
          port: 8080
```

### Query Parameter Routing

```yaml
apiVersion: gateway.networking.k8s.io/v1
kind: HTTPRoute
metadata:
  name: query-routing
spec:
  parentRefs:
    - name: main-gateway
  hostnames:
    - "api.example.com"
  rules:
    # Route debug requests
    - matches:
        - queryParams:
            - name: debug
              value: "true"
      backendRefs:
        - name: debug-service
          port: 8080

    # Default route
    - backendRefs:
        - name: production-service
          port: 8080
```

## Traffic Splitting (Canary/Blue-Green)

### Weighted Traffic Split

```yaml
apiVersion: gateway.networking.k8s.io/v1
kind: HTTPRoute
metadata:
  name: canary-deployment
  namespace: production
spec:
  parentRefs:
    - name: main-gateway
  hostnames:
    - "app.example.com"
  rules:
    - backendRefs:
        # 90% to stable
        - name: app-stable
          port: 8080
          weight: 90
        # 10% to canary
        - name: app-canary
          port: 8080
          weight: 10
```

### Header-Based Canary

```yaml
apiVersion: gateway.networking.k8s.io/v1
kind: HTTPRoute
metadata:
  name: header-canary
spec:
  parentRefs:
    - name: main-gateway
  hostnames:
    - "app.example.com"
  rules:
    # Canary for specific users
    - matches:
        - headers:
            - name: X-Canary
              value: "true"
      backendRefs:
        - name: app-canary
          port: 8080

    # Production for everyone else
    - backendRefs:
        - name: app-stable
          port: 8080
```

## Request/Response Modification

### URL Rewriting

```yaml
apiVersion: gateway.networking.k8s.io/v1
kind: HTTPRoute
metadata:
  name: url-rewrite
spec:
  parentRefs:
    - name: main-gateway
  hostnames:
    - "api.example.com"
  rules:
    - matches:
        - path:
            type: PathPrefix
            value: /api/v1
      filters:
        - type: URLRewrite
          urlRewrite:
            path:
              type: ReplacePrefixMatch
              replacePrefixMatch: /v1
      backendRefs:
        - name: backend
          port: 8080
```

### Header Modification

```yaml
apiVersion: gateway.networking.k8s.io/v1
kind: HTTPRoute
metadata:
  name: header-modification
spec:
  parentRefs:
    - name: main-gateway
  rules:
    - matches:
        - path:
            type: PathPrefix
            value: /
      filters:
        # Add request headers
        - type: RequestHeaderModifier
          requestHeaderModifier:
            add:
              - name: X-Request-ID
                value: "generated-id"
              - name: X-Forwarded-Proto
                value: https
            set:
              - name: Host
                value: backend.internal
            remove:
              - X-Debug-Header

        # Add response headers
        - type: ResponseHeaderModifier
          responseHeaderModifier:
            add:
              - name: X-Response-Time
                value: "100ms"
            set:
              - name: Cache-Control
                value: "max-age=3600"
      backendRefs:
        - name: backend
          port: 8080
```

### Redirects

```yaml
apiVersion: gateway.networking.k8s.io/v1
kind: HTTPRoute
metadata:
  name: redirects
spec:
  parentRefs:
    - name: main-gateway
  hostnames:
    - "old.example.com"
  rules:
    # Redirect to new domain
    - filters:
        - type: RequestRedirect
          requestRedirect:
            hostname: new.example.com
            statusCode: 301

---
apiVersion: gateway.networking.k8s.io/v1
kind: HTTPRoute
metadata:
  name: https-redirect
spec:
  parentRefs:
    - name: main-gateway
      sectionName: http  # Reference HTTP listener
  rules:
    # Redirect HTTP to HTTPS
    - filters:
        - type: RequestRedirect
          requestRedirect:
            scheme: https
            statusCode: 301
```

## TLS Configuration

### TLS Termination

```yaml
apiVersion: gateway.networking.k8s.io/v1
kind: Gateway
metadata:
  name: tls-gateway
spec:
  gatewayClassName: nginx
  listeners:
    - name: https
      protocol: HTTPS
      port: 443
      hostname: "secure.example.com"
      tls:
        mode: Terminate
        certificateRefs:
          - name: secure-tls-cert
            kind: Secret
      allowedRoutes:
        namespaces:
          from: Same
```

### TLS Passthrough

```yaml
apiVersion: gateway.networking.k8s.io/v1
kind: Gateway
metadata:
  name: passthrough-gateway
spec:
  gatewayClassName: nginx
  listeners:
    - name: tls-passthrough
      protocol: TLS
      port: 443
      hostname: "backend.example.com"
      tls:
        mode: Passthrough
      allowedRoutes:
        kinds:
          - kind: TLSRoute
---
apiVersion: gateway.networking.k8s.io/v1alpha2
kind: TLSRoute
metadata:
  name: backend-tls-route
spec:
  parentRefs:
    - name: passthrough-gateway
  hostnames:
    - "backend.example.com"
  rules:
    - backendRefs:
        - name: backend-service
          port: 443
```

## GRPCRoute

```yaml
apiVersion: gateway.networking.k8s.io/v1alpha2
kind: GRPCRoute
metadata:
  name: grpc-route
spec:
  parentRefs:
    - name: main-gateway
  hostnames:
    - "grpc.example.com"
  rules:
    # Route by service name
    - matches:
        - method:
            service: myapp.UserService
      backendRefs:
        - name: user-grpc-service
          port: 50051

    # Route by method
    - matches:
        - method:
            service: myapp.OrderService
            method: CreateOrder
      backendRefs:
        - name: order-grpc-service
          port: 50051
```

## TCPRoute

```yaml
apiVersion: gateway.networking.k8s.io/v1alpha2
kind: TCPRoute
metadata:
  name: database-route
spec:
  parentRefs:
    - name: tcp-gateway
      sectionName: postgres
  rules:
    - backendRefs:
        - name: postgres-service
          port: 5432
---
apiVersion: gateway.networking.k8s.io/v1
kind: Gateway
metadata:
  name: tcp-gateway
spec:
  gatewayClassName: nginx
  listeners:
    - name: postgres
      protocol: TCP
      port: 5432
      allowedRoutes:
        kinds:
          - kind: TCPRoute
```

## Cross-Namespace Routing

### Allow Routes from Specific Namespaces

```yaml
apiVersion: gateway.networking.k8s.io/v1
kind: Gateway
metadata:
  name: shared-gateway
  namespace: gateway-system
spec:
  gatewayClassName: nginx
  listeners:
    - name: http
      protocol: HTTP
      port: 80
      allowedRoutes:
        namespaces:
          from: Selector
          selector:
            matchLabels:
              shared-gateway-access: "true"
```

### Reference Gateway from Another Namespace

```yaml
apiVersion: gateway.networking.k8s.io/v1
kind: HTTPRoute
metadata:
  name: app-route
  namespace: team-a  # Must have label: shared-gateway-access: "true"
spec:
  parentRefs:
    - name: shared-gateway
      namespace: gateway-system
  hostnames:
    - "team-a.example.com"
  rules:
    - backendRefs:
        - name: team-a-app
          port: 8080
```

## ReferenceGrant (Cross-Namespace Backend)

```yaml
# Allow HTTPRoute in 'frontend' namespace to reference
# Service in 'backend' namespace
apiVersion: gateway.networking.k8s.io/v1beta1
kind: ReferenceGrant
metadata:
  name: allow-frontend-to-backend
  namespace: backend
spec:
  from:
    - group: gateway.networking.k8s.io
      kind: HTTPRoute
      namespace: frontend
  to:
    - group: ""
      kind: Service
```

## Verification Commands

```bash
# Check Gateway status
kubectl get gateway main-gateway -o yaml

# Check HTTPRoute status
kubectl get httproute web-app-route -o yaml

# View attached routes
kubectl describe gateway main-gateway

# Check GatewayClass
kubectl get gatewayclass

# Debug routing
kubectl get httproutes -A -o wide

# Test routing
curl -H "Host: app.example.com" http://<gateway-ip>/
```

## Migration from Ingress

### Before (Ingress)

```yaml
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: web-ingress
  annotations:
    nginx.ingress.kubernetes.io/rewrite-target: /
spec:
  rules:
    - host: app.example.com
      http:
        paths:
          - path: /api
            pathType: Prefix
            backend:
              service:
                name: api-service
                port:
                  number: 8080
```

### After (Gateway API)

```yaml
apiVersion: gateway.networking.k8s.io/v1
kind: HTTPRoute
metadata:
  name: web-route
spec:
  parentRefs:
    - name: main-gateway
  hostnames:
    - "app.example.com"
  rules:
    - matches:
        - path:
            type: PathPrefix
            value: /api
      filters:
        - type: URLRewrite
          urlRewrite:
            path:
              type: ReplacePrefixMatch
              replacePrefixMatch: /
      backendRefs:
        - name: api-service
          port: 8080
```

## Summary

The Gateway API provides a more expressive, role-oriented approach to Kubernetes traffic management. It separates concerns between infrastructure providers, platform teams, and developers while offering powerful routing capabilities beyond traditional Ingress.

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
