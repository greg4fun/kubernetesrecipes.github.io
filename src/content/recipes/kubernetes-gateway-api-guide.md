---
title: "Gateway API: Next-Gen K8s Ingress"
description: "Replace Kubernetes Ingress with Gateway API. HTTPRoute, GRPCRoute, TLSRoute configuration. Multi-tenant gateways, traffic splitting, and header-based routing."
publishDate: "2026-05-02"
author: "Luca Berton"
category: "networking"
difficulty: "intermediate"
timeToComplete: "12 minutes"
kubernetesVersion: "1.28+"
tags:
  - "gateway-api"
  - "networking"
  - "ingress"
  - "routing"
  - "traffic-management"
relatedRecipes:
  - "kubernetes-ingress-nginx-guide"
  - "kubernetes-service-mesh-istio-guide"
  - "kubernetes-cert-manager-guide"
---

> 💡 **Quick Answer:** Gateway API is the official successor to Ingress. Install CRDs: `kubectl apply -f https://github.com/kubernetes-sigs/gateway-api/releases/download/v1.1.0/standard-install.yaml`. Create a `Gateway` (infra team), then `HTTPRoute` (app teams). Supports traffic splitting, header matching, URL rewriting, and cross-namespace routing. Works with Envoy Gateway, Istio, Cilium, NGINX, Traefik.

## The Problem

Kubernetes Ingress has limitations:

- No standard traffic splitting (canary/blue-green)
- No header-based routing without annotations
- Single resource type for different roles (infra vs app team)
- Implementation-specific features via annotations
- No support for gRPC, TCP, UDP routing

## The Solution

### Install Gateway API CRDs

```bash
# Standard channel (stable features)
kubectl apply -f https://github.com/kubernetes-sigs/gateway-api/releases/download/v1.1.0/standard-install.yaml

# Experimental channel (includes TCPRoute, UDPRoute, GRPCRoute)
kubectl apply -f https://github.com/kubernetes-sigs/gateway-api/releases/download/v1.1.0/experimental-install.yaml

# Install a Gateway controller (pick one):
# Envoy Gateway
helm install eg oci://docker.io/envoyproxy/gateway-helm -n envoy-gateway-system --create-namespace

# Or Istio
istioctl install --set profile=minimal

# Or Cilium
cilium install --set gatewayAPI.enabled=true
```

### GatewayClass + Gateway

```yaml
# GatewayClass (cluster-scoped, like StorageClass)
apiVersion: gateway.networking.k8s.io/v1
kind: GatewayClass
metadata:
  name: envoy
spec:
  controllerName: gateway.envoyproxy.io/gatewayclass-controller

---
# Gateway (infra team creates this)
apiVersion: gateway.networking.k8s.io/v1
kind: Gateway
metadata:
  name: production
  namespace: gateway-system
spec:
  gatewayClassName: envoy
  listeners:
  - name: http
    protocol: HTTP
    port: 80
    allowedRoutes:
      namespaces:
        from: All              # Any namespace can attach routes
  
  - name: https
    protocol: HTTPS
    port: 443
    tls:
      mode: Terminate
      certificateRefs:
      - name: wildcard-tls
        namespace: gateway-system
    allowedRoutes:
      namespaces:
        from: Selector
        selector:
          matchLabels:
            gateway-access: "true"
```

### HTTPRoute

```yaml
# Simple routing (app team creates this)
apiVersion: gateway.networking.k8s.io/v1
kind: HTTPRoute
metadata:
  name: my-app
  namespace: production
spec:
  parentRefs:
  - name: production
    namespace: gateway-system
  hostnames:
  - app.example.com
  rules:
  - matches:
    - path:
        type: PathPrefix
        value: /api
    backendRefs:
    - name: api-service
      port: 8080
  - matches:
    - path:
        type: PathPrefix
        value: /
    backendRefs:
    - name: frontend
      port: 80

---
# Traffic splitting (canary)
apiVersion: gateway.networking.k8s.io/v1
kind: HTTPRoute
metadata:
  name: canary-route
spec:
  parentRefs:
  - name: production
    namespace: gateway-system
  hostnames:
  - app.example.com
  rules:
  - backendRefs:
    - name: app-v1
      port: 80
      weight: 90
    - name: app-v2
      port: 80
      weight: 10

---
# Header-based routing
apiVersion: gateway.networking.k8s.io/v1
kind: HTTPRoute
metadata:
  name: header-route
spec:
  parentRefs:
  - name: production
    namespace: gateway-system
  hostnames:
  - app.example.com
  rules:
  - matches:
    - headers:
      - name: x-version
        value: beta
    backendRefs:
    - name: app-beta
      port: 80
  - backendRefs:
    - name: app-stable
      port: 80
```

### Advanced Features

```yaml
# URL rewriting
apiVersion: gateway.networking.k8s.io/v1
kind: HTTPRoute
metadata:
  name: rewrite-route
spec:
  parentRefs:
  - name: production
    namespace: gateway-system
  rules:
  - matches:
    - path:
        type: PathPrefix
        value: /old-api
    filters:
    - type: URLRewrite
      urlRewrite:
        path:
          type: ReplacePrefixMatch
          replacePrefixMatch: /v2/api
    backendRefs:
    - name: api-service
      port: 8080

---
# Request header modification
  rules:
  - filters:
    - type: RequestHeaderModifier
      requestHeaderModifier:
        add:
        - name: X-Gateway
          value: production
        remove:
        - X-Internal-Debug
    backendRefs:
    - name: backend
      port: 80

---
# Redirect
  rules:
  - matches:
    - path:
        type: Exact
        value: /old-page
    filters:
    - type: RequestRedirect
      requestRedirect:
        hostname: new.example.com
        statusCode: 301
```

### Role Separation

```
Ingress (old):
  One resource, one role → all config in one place
  
Gateway API (new):
  GatewayClass  → Platform team (cluster-wide, which controller)
  Gateway       → Infra team (listeners, TLS, namespaces)
  HTTPRoute     → App team (routing rules for their service)
  
  Clear separation of concerns!
```

### Comparison: Ingress vs Gateway API

```
Feature              | Ingress           | Gateway API
---------------------|-------------------|-------------------
Traffic splitting    | ❌ (annotations)  | ✅ weight-based
Header matching      | ❌ (annotations)  | ✅ native
URL rewriting        | ❌ (annotations)  | ✅ native
gRPC routing         | ❌                | ✅ GRPCRoute
TCP/UDP routing      | ❌                | ✅ TCPRoute/UDPRoute
Multi-tenant         | ❌                | ✅ cross-namespace
Role separation      | ❌                | ✅ Gateway/Route split
Portable config      | ⚠️ annotations    | ✅ standard API
```

### Check Status

```bash
# Gateway status
kubectl get gateway -A
kubectl describe gateway production -n gateway-system

# HTTPRoute status
kubectl get httproute -A
kubectl describe httproute my-app

# Check if route is attached to gateway
kubectl get httproute my-app -o jsonpath='{.status.parents[0].conditions}'
```

## Common Issues

**HTTPRoute not working — no traffic**

Route not attached to Gateway. Check: `kubectl describe httproute` → parentRef conditions. Ensure namespace is allowed by Gateway's `allowedRoutes`.

**Gateway stuck in "Not Accepted"**

GatewayClass controller not installed or not matching. Verify: `kubectl get gatewayclass`.

**Cross-namespace route rejected**

Gateway `allowedRoutes.namespaces.from` must be `All` or `Selector` matching the route's namespace.

## Best Practices

- **Use Gateway API over Ingress** for new clusters — it's the future
- **Separate Gateway from Routes** — infra team manages Gateway, app teams manage Routes
- **Traffic splitting for canary** — native weight-based routing
- **Cross-namespace references** — enable controlled multi-tenant routing
- **Check controller compatibility** — not all controllers support all features yet

## Key Takeaways

- Gateway API is the official Ingress successor (GA since K8s 1.28)
- Separates concerns: GatewayClass (platform) → Gateway (infra) → Route (app)
- Native traffic splitting, header routing, URL rewriting — no annotations
- Supports HTTP, gRPC, TCP, UDP routing
- Works with Envoy Gateway, Istio, Cilium, NGINX, Traefik
