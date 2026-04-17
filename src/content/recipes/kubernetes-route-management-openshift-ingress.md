---
title: "Kubernetes Route and Ingress Management Guide"
description: "Manage OpenShift Routes and Kubernetes Ingress resources. TLS termination, path-based routing, weighted traffic splitting, and migration to Gateway API with examples."
publishDate: "2026-04-17"
author: "Luca Berton"
category: "networking"
tags:
  - "route"
  - "ingress"
  - "openshift-route"
  - "gateway-api"
  - "tls"
  - "traffic-management"
difficulty: "advanced"
timeToComplete: "25 minutes"
relatedRecipes:
  - "kubernetes-gateway-api"
  - "kubernetes-ingress-controller"
  - "nginx-ingress-configuration"
  - "kubernetes-service-types"
  - "openshift-4-20-new-features-guide"
---

> 💡 **Quick Answer:** **OpenShift Routes** expose services externally via the built-in HAProxy router. **Kubernetes Ingress** is the cross-platform equivalent (nginx, Traefik, etc.). Both support TLS termination, path-based routing, and host-based routing. **Gateway API** is the modern replacement for both — use it for new deployments on K8s 1.31+/OCP 4.20+.

## The Problem

You have services running in Kubernetes that need to be accessible from outside the cluster. Routes (OpenShift) and Ingress (Kubernetes) are the L7 HTTP/HTTPS entry points. Understanding which to use — and when to migrate to Gateway API — is critical.

```mermaid
flowchart LR
    CLIENT["Client"] --> LB["Load Balancer<br/>:80 / :443"]
    
    subgraph CLUSTER["Kubernetes Cluster"]
        LB --> ROUTER{"Router / Ingress<br/>Controller"}
        ROUTER -->|"host: app.example.com<br/>path: /"| SVC_A["Service A"]
        ROUTER -->|"host: api.example.com<br/>path: /v1"| SVC_B["Service B"]
        ROUTER -->|"host: app.example.com<br/>path: /admin"| SVC_C["Service C"]
    end
```

## OpenShift Routes

### Basic Route

```yaml
apiVersion: route.openshift.io/v1
kind: Route
metadata:
  name: my-app
  namespace: production
spec:
  host: app.example.com
  to:
    kind: Service
    name: my-app-svc
    weight: 100
  port:
    targetPort: http    # Named port on the Service
```

### TLS Termination Types

```yaml
# 1. Edge termination — TLS terminates at the router
apiVersion: route.openshift.io/v1
kind: Route
metadata:
  name: app-edge
spec:
  host: app.example.com
  to:
    kind: Service
    name: my-app-svc
  tls:
    termination: edge
    certificate: |
      -----BEGIN CERTIFICATE-----
      ...
      -----END CERTIFICATE-----
    key: |
      -----BEGIN PRIVATE KEY-----
      ...
      -----END PRIVATE KEY-----
    insecureEdgeTerminationPolicy: Redirect    # HTTP → HTTPS
---
# 2. Passthrough — TLS goes straight to the pod (pod handles TLS)
apiVersion: route.openshift.io/v1
kind: Route
metadata:
  name: app-passthrough
spec:
  host: secure.example.com
  to:
    kind: Service
    name: my-app-svc
  tls:
    termination: passthrough
---
# 3. Re-encrypt — Router terminates client TLS, creates new TLS to pod
apiVersion: route.openshift.io/v1
kind: Route
metadata:
  name: app-reencrypt
spec:
  host: app.example.com
  to:
    kind: Service
    name: my-app-svc
  tls:
    termination: reencrypt
    certificate: |
      -----BEGIN CERTIFICATE-----
      ...client-facing cert...
      -----END CERTIFICATE-----
    key: |
      -----BEGIN PRIVATE KEY-----
      ...
      -----END PRIVATE KEY-----
    destinationCACertificate: |
      -----BEGIN CERTIFICATE-----
      ...pod's CA cert (for router → pod verification)...
      -----END CERTIFICATE-----
```

### Weighted Traffic Splitting (Canary/Blue-Green)

```yaml
apiVersion: route.openshift.io/v1
kind: Route
metadata:
  name: app-canary
  annotations:
    haproxy.router.openshift.io/balance: roundrobin
spec:
  host: app.example.com
  to:
    kind: Service
    name: app-stable
    weight: 90       # 90% to stable
  alternateBackends:
    - kind: Service
      name: app-canary
      weight: 10     # 10% to canary
  tls:
    termination: edge
    insecureEdgeTerminationPolicy: Redirect
```

### Route Annotations

```yaml
metadata:
  annotations:
    # Timeouts
    haproxy.router.openshift.io/timeout: 60s
    
    # Rate limiting
    haproxy.router.openshift.io/rate-limit-connections: "true"
    haproxy.router.openshift.io/rate-limit-connections.concurrent-tcp: "100"
    haproxy.router.openshift.io/rate-limit-connections.rate-http: "50"
    
    # Sticky sessions
    haproxy.router.openshift.io/balance: source
    haproxy.router.openshift.io/disable_cookies: "false"
    
    # Request size
    haproxy.router.openshift.io/proxy-body-size: 10m
    
    # HSTS
    haproxy.router.openshift.io/hsts_header: max-age=31536000;includeSubDomains;preload
    
    # IP allowlist
    haproxy.router.openshift.io/ip_whitelist: "10.0.0.0/8 192.168.1.0/24"
```

## Kubernetes Ingress

### Basic Ingress (nginx)

```yaml
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: my-app
  namespace: production
  annotations:
    nginx.ingress.kubernetes.io/ssl-redirect: "true"
spec:
  ingressClassName: nginx
  tls:
    - hosts:
        - app.example.com
      secretName: app-tls-secret    # cert-manager can auto-provision this
  rules:
    - host: app.example.com
      http:
        paths:
          - path: /
            pathType: Prefix
            backend:
              service:
                name: app-frontend
                port:
                  number: 80
          - path: /api
            pathType: Prefix
            backend:
              service:
                name: app-api
                port:
                  number: 8080
          - path: /admin
            pathType: Exact
            backend:
              service:
                name: app-admin
                port:
                  number: 80
```

### Canary with nginx Ingress

```yaml
# Stable Ingress
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: app-stable
spec:
  ingressClassName: nginx
  rules:
    - host: app.example.com
      http:
        paths:
          - path: /
            pathType: Prefix
            backend:
              service:
                name: app-stable
                port:
                  number: 80
---
# Canary Ingress (10% traffic)
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: app-canary
  annotations:
    nginx.ingress.kubernetes.io/canary: "true"
    nginx.ingress.kubernetes.io/canary-weight: "10"
spec:
  ingressClassName: nginx
  rules:
    - host: app.example.com
      http:
        paths:
          - path: /
            pathType: Prefix
            backend:
              service:
                name: app-canary
                port:
                  number: 80
```

## Gateway API (Modern Replacement)

```yaml
# Gateway — managed by platform team
apiVersion: gateway.networking.k8s.io/v1
kind: Gateway
metadata:
  name: main-gateway
  namespace: gateway-system
spec:
  gatewayClassName: istio    # or: nginx, envoy, cilium
  listeners:
    - name: https
      protocol: HTTPS
      port: 443
      tls:
        mode: Terminate
        certificateRefs:
          - name: wildcard-tls
      allowedRoutes:
        namespaces:
          from: All
    - name: http
      protocol: HTTP
      port: 80
      allowedRoutes:
        namespaces:
          from: All
---
# HTTPRoute — managed by app team
apiVersion: gateway.networking.k8s.io/v1
kind: HTTPRoute
metadata:
  name: my-app
  namespace: production
spec:
  parentRefs:
    - name: main-gateway
      namespace: gateway-system
  hostnames:
    - app.example.com
  rules:
    - matches:
        - path:
            type: PathPrefix
            value: /
      backendRefs:
        - name: app-stable
          port: 80
          weight: 90
        - name: app-canary
          port: 80
          weight: 10
    - matches:
        - path:
            type: PathPrefix
            value: /api
        - headers:
            - name: X-API-Version
              value: v2
      backendRefs:
        - name: api-v2
          port: 8080
```

## Comparison: Route vs Ingress vs Gateway API

| Feature | OpenShift Route | Kubernetes Ingress | Gateway API |
|---------|----------------|-------------------|-------------|
| **Platform** | OpenShift only | All K8s | All K8s + OCP 4.20+ |
| **TLS termination** | edge/passthrough/reencrypt | Depends on controller | All modes |
| **Traffic splitting** | ✅ Native weights | ❌ Annotations (non-standard) | ✅ Native weights |
| **Header-based routing** | ❌ Limited | ❌ Controller-specific | ✅ Native |
| **Role separation** | No | No | ✅ Gateway (infra) vs Route (app) |
| **TCP/UDP** | ❌ HTTP(S) only | ❌ HTTP(S) only | ✅ TCPRoute, UDPRoute |
| **gRPC** | Passthrough only | Controller-specific | ✅ GRPCRoute |
| **Cross-namespace** | No | No | ✅ Native |
| **Future** | Maintained | Maintained | **Active development** |

## Common Issues

| Issue | Cause | Fix |
|-------|-------|-----|
| Route returns 503 | Service has no ready endpoints | Check pod readiness, `oc get endpoints` |
| TLS certificate mismatch | Wrong cert for hostname | Verify cert SAN matches route host |
| Passthrough route not working | Pod not listening on TLS | Ensure pod handles TLS on target port |
| Ingress 404 | Wrong pathType (Prefix vs Exact) | Use `Prefix` for catch-all, `Exact` for specific |
| Canary not splitting correctly | Weight percentages wrong | Weights are relative: 90+10 = 90%/10% |
| Route admitted but not accessible | DNS not pointing to router | Verify DNS A/CNAME record |

## Best Practices

- **Use Gateway API for new projects** — it's the future of K8s ingress
- **Edge TLS termination for most apps** — simplest, router handles TLS
- **Re-encrypt for compliance** — when traffic must be encrypted end-to-end
- **Passthrough for gRPC/WebSocket** — when app needs direct TLS control
- **cert-manager for auto TLS** — never manage certificates manually
- **Always redirect HTTP → HTTPS** — `insecureEdgeTerminationPolicy: Redirect`
- **Set timeouts explicitly** — don't rely on defaults for long-running requests
- **Use canary routing for safe deployments** — start at 5%, increase gradually

## Key Takeaways

- OpenShift Routes: built-in, simple, HAProxy-backed — use on OCP clusters
- Kubernetes Ingress: cross-platform, controller-dependent annotations
- Gateway API: modern replacement with native traffic splitting, header routing, role separation
- TLS: edge (router terminates), passthrough (pod terminates), re-encrypt (both)
- Weighted backends enable canary deployments without service mesh
- Migrate to Gateway API on OCP 4.20+ / K8s 1.31+ for new workloads
