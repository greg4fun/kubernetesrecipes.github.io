---
title: "Kubernetes Gateway API Complete Guide"
description: "Deploy Kubernetes Gateway API with HTTPRoute, GRPCRoute, and TLSRoute. Replace Ingress with the next-generation traffic management standard."
publishDate: "2026-05-02"
author: "Luca Berton"
category: "networking"
difficulty: "intermediate"
timeToComplete: "20 minutes"
kubernetesVersion: "1.28+"
tags:
  - "gateway-api"
  - "networking"
  - "ingress"
  - "envoy"
  - "traffic-management"
relatedRecipes:
  - "kubernetes-ingress-guide"
  - "kubernetes-rate-limiting-guide"
  - "nginx-ingress-limit-burst-multiplier"
  - "kubernetes-ingress-fundamentals"
---

> 💡 **Quick Answer:** Gateway API is the successor to Ingress. Install CRDs (`kubectl apply -f https://github.com/kubernetes-sigs/gateway-api/releases/download/v1.2.0/standard-install.yaml`), deploy a Gateway implementation (Envoy Gateway, Cilium, Istio, or NGINX), create a `Gateway` resource for the listener, and `HTTPRoute` for routing rules. Key advantage: role-based resource model (infra team manages Gateway, app teams manage Routes).

## The Problem

Kubernetes Ingress has limitations:

- No standard way to define TCP/UDP/gRPC routing
- Vendor-specific annotations for every feature
- No role separation (infra vs app teams)
- Limited traffic splitting for canary deployments
- No header-based routing without custom annotations

## The Solution

### Install Gateway API CRDs

```bash
# Install standard channel CRDs (stable APIs)
kubectl apply -f https://github.com/kubernetes-sigs/gateway-api/releases/download/v1.2.0/standard-install.yaml

# Or experimental channel (includes TCPRoute, TLSRoute, etc.)
kubectl apply -f https://github.com/kubernetes-sigs/gateway-api/releases/download/v1.2.0/experimental-install.yaml

# Verify
kubectl get crd | grep gateway
# gatewayclasses.gateway.networking.k8s.io
# gateways.gateway.networking.k8s.io
# httproutes.gateway.networking.k8s.io
```

### Install a Gateway Implementation

```bash
# Option 1: Envoy Gateway
helm install eg oci://docker.io/envoyproxy/gateway-helm \
  --version v1.2.0 -n envoy-gateway-system --create-namespace

# Option 2: Cilium (if already using Cilium CNI)
helm upgrade cilium cilium/cilium -n kube-system \
  --set gatewayAPI.enabled=true

# Option 3: NGINX Gateway Fabric
helm install ngf oci://ghcr.io/nginxinc/charts/nginx-gateway-fabric \
  --create-namespace -n nginx-gateway

# Verify GatewayClass is available
kubectl get gatewayclass
# NAME            CONTROLLER                        ACCEPTED
# eg              gateway.envoyproxy.io/controller   True
```

### Create a Gateway

```yaml
# Infrastructure team creates the Gateway (load balancer)
apiVersion: gateway.networking.k8s.io/v1
kind: Gateway
metadata:
  name: api-gateway
  namespace: infra
spec:
  gatewayClassName: eg          # Matches GatewayClass
  listeners:
  - name: http
    protocol: HTTP
    port: 80
    allowedRoutes:
      namespaces:
        from: All               # Routes from any namespace can attach
  - name: https
    protocol: HTTPS
    port: 443
    tls:
      mode: Terminate
      certificateRefs:
      - kind: Secret
        name: wildcard-tls
    allowedRoutes:
      namespaces:
        from: Selector
        selector:
          matchLabels:
            gateway-access: "true"   # Only labeled namespaces
```

### HTTPRoute — Basic Routing

```yaml
# App team creates routes (no infra access needed)
apiVersion: gateway.networking.k8s.io/v1
kind: HTTPRoute
metadata:
  name: api-routes
  namespace: production
spec:
  parentRefs:
  - name: api-gateway
    namespace: infra
  hostnames:
  - api.example.com
  rules:
  # Path-based routing
  - matches:
    - path:
        type: PathPrefix
        value: /v1/users
    backendRefs:
    - name: users-service
      port: 8080
  
  # Header-based routing
  - matches:
    - headers:
      - name: x-api-version
        value: "2"
    backendRefs:
    - name: users-v2-service
      port: 8080
  
  # Method-based routing
  - matches:
    - method: POST
      path:
        type: PathPrefix
        value: /v1/orders
    backendRefs:
    - name: orders-write-service
      port: 8080
```

### Traffic Splitting (Canary Deployments)

```yaml
apiVersion: gateway.networking.k8s.io/v1
kind: HTTPRoute
metadata:
  name: canary-route
spec:
  parentRefs:
  - name: api-gateway
    namespace: infra
  hostnames:
  - app.example.com
  rules:
  - backendRefs:
    - name: app-stable
      port: 8080
      weight: 90          # 90% to stable
    - name: app-canary
      port: 8080
      weight: 10          # 10% to canary
```

### Request/Response Manipulation

```yaml
apiVersion: gateway.networking.k8s.io/v1
kind: HTTPRoute
metadata:
  name: header-route
spec:
  parentRefs:
  - name: api-gateway
    namespace: infra
  rules:
  - matches:
    - path:
        type: PathPrefix
        value: /api
    filters:
    # Add request header
    - type: RequestHeaderModifier
      requestHeaderModifier:
        add:
        - name: X-Forwarded-Proto
          value: https
    # Redirect
    - type: RequestRedirect
      requestRedirect:
        scheme: https
        statusCode: 301
    # URL rewrite
    - type: URLRewrite
      urlRewrite:
        hostname: backend.internal
        path:
          type: ReplacePrefixMatch
          replacePrefixMatch: /v2/api
    backendRefs:
    - name: api-service
      port: 8080
```

### Gateway API vs Ingress

| Feature | Ingress | Gateway API |
|---------|---------|-------------|
| HTTP routing | ✅ Basic | ✅ Advanced (header, method, query) |
| TLS termination | ✅ | ✅ + passthrough |
| TCP/UDP routing | ❌ | ✅ (TCPRoute, UDPRoute) |
| gRPC routing | ❌ (annotations) | ✅ (GRPCRoute) |
| Traffic splitting | ❌ (annotations) | ✅ Native (weight) |
| Role separation | ❌ | ✅ (Gateway vs Route) |
| Cross-namespace | ❌ | ✅ (ReferenceGrant) |
| Header manipulation | ❌ (annotations) | ✅ Native (filters) |

## Common Issues

**"no matching parent gateway" on HTTPRoute**

Route references a Gateway in another namespace. Check `parentRefs.namespace` and ensure the Gateway's `allowedRoutes.namespaces` includes your namespace.

**Gateway stuck in "Programmed: False"**

Implementation controller not running or misconfigured. Check: `kubectl get gatewayclass` and the controller pod logs.

**TLS certificate not working**

Secret must be in the same namespace as the Gateway (or use ReferenceGrant for cross-namespace).

## Best Practices

- **Use Gateway API for new clusters** — Ingress is in maintenance mode
- **Infra team manages Gateway, app teams manage Routes** — role separation
- **One Gateway per domain/environment** — keep listener config centralized
- **Use ReferenceGrant** for cross-namespace Secret/Service references
- **Traffic splitting for canary** — native, no annotations needed

## Key Takeaways

- Gateway API is the official successor to Ingress (GA since K8s 1.29)
- Role model: infra team → GatewayClass + Gateway, app teams → HTTPRoute
- Native traffic splitting, header routing, and request manipulation
- Implementations: Envoy Gateway, Cilium, Istio, NGINX Gateway Fabric
- Install CRDs first, then a controller — Gateway API is just an API spec
