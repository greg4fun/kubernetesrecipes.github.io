---
title: "K8s Ingress NGINX: Routing and TLS"
description: "Configure Kubernetes Ingress with NGINX controller. Path-based routing, TLS termination, annotations, rate limiting, and multiple hosts with examples."
publishDate: "2026-05-02"
author: "Luca Berton"
category: "networking"
difficulty: "intermediate"
timeToComplete: "12 minutes"
kubernetesVersion: "1.28+"
tags:
  - "ingress"
  - "nginx"
  - "tls"
  - "routing"
  - "cka"
relatedRecipes:
  - "kubernetes-gateway-api-guide"
  - "kubernetes-service-types-explained"
  - "nginx-ingress-limit-burst-multiplier"
  - "kubernetes-rate-limiting-gateway-api"
---

> 💡 **Quick Answer:** Install NGINX Ingress Controller, then create an Ingress resource with `ingressClassName: nginx`. Route by path: `path: /api` → backend service, or by host: `host: api.example.com`. Add TLS with a Secret containing cert+key and `tls: [{hosts: [api.example.com], secretName: tls-secret}]`. Use annotations for rate limiting, redirects, CORS, and custom NGINX config.

## The Problem

Exposing multiple services externally without Ingress means:

- One LoadBalancer per service ($$$)
- No host-based or path-based routing
- No centralized TLS termination
- No shared rate limiting, auth, or CORS

## The Solution

### Install NGINX Ingress Controller

```bash
# Helm (recommended)
helm repo add ingress-nginx https://kubernetes.github.io/ingress-nginx
helm install ingress-nginx ingress-nginx/ingress-nginx \
  -n ingress-nginx --create-namespace

# Or kubectl
kubectl apply -f https://raw.githubusercontent.com/kubernetes/ingress-nginx/controller-v1.10.0/deploy/static/provider/cloud/deploy.yaml

# Verify
kubectl get pods -n ingress-nginx
kubectl get svc -n ingress-nginx
# NAME                       TYPE           EXTERNAL-IP
# ingress-nginx-controller   LoadBalancer   34.123.45.67
```

### Basic Ingress

```yaml
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: app-ingress
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
            name: frontend
            port:
              number: 80
      - path: /api
        pathType: Prefix
        backend:
          service:
            name: backend-api
            port:
              number: 8080
      - path: /api/v2
        pathType: Exact
        backend:
          service:
            name: backend-api-v2
            port:
              number: 8080
```

### Multiple Hosts

```yaml
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: multi-host
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
            name: app-frontend
            port:
              number: 80
  - host: api.example.com
    http:
      paths:
      - path: /
        pathType: Prefix
        backend:
          service:
            name: api-service
            port:
              number: 8080
  - host: admin.example.com
    http:
      paths:
      - path: /
        pathType: Prefix
        backend:
          service:
            name: admin-panel
            port:
              number: 3000
```

### TLS Termination

```yaml
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: tls-ingress
  annotations:
    nginx.ingress.kubernetes.io/ssl-redirect: "true"
spec:
  ingressClassName: nginx
  tls:
  - hosts:
    - app.example.com
    - api.example.com
    secretName: example-tls    # Secret with tls.crt + tls.key
  rules:
  - host: app.example.com
    http:
      paths:
      - path: /
        pathType: Prefix
        backend:
          service:
            name: frontend
            port:
              number: 80
```

```bash
# Create TLS secret
kubectl create secret tls example-tls \
  --cert=tls.crt --key=tls.key

# Or use cert-manager for automatic certificates
# See: cert-manager-kubernetes-tls recipe
```

### Useful Annotations

```yaml
metadata:
  annotations:
    # SSL redirect
    nginx.ingress.kubernetes.io/ssl-redirect: "true"
    
    # Rate limiting
    nginx.ingress.kubernetes.io/limit-rps: "10"
    nginx.ingress.kubernetes.io/limit-burst-multiplier: "5"
    
    # CORS
    nginx.ingress.kubernetes.io/enable-cors: "true"
    nginx.ingress.kubernetes.io/cors-allow-origin: "https://app.example.com"
    
    # URL rewrite
    nginx.ingress.kubernetes.io/rewrite-target: /$2
    # path: /api(/|$)(.*) → backend receives /<captured>
    
    # Timeouts
    nginx.ingress.kubernetes.io/proxy-read-timeout: "300"
    nginx.ingress.kubernetes.io/proxy-send-timeout: "300"
    
    # Body size
    nginx.ingress.kubernetes.io/proxy-body-size: "50m"
    
    # Basic auth
    nginx.ingress.kubernetes.io/auth-type: basic
    nginx.ingress.kubernetes.io/auth-secret: basic-auth
    
    # Custom headers
    nginx.ingress.kubernetes.io/configuration-snippet: |
      add_header X-Frame-Options "SAMEORIGIN";
      add_header X-Content-Type-Options "nosniff";
```

### Path Types

| pathType | Behavior | Example |
|----------|----------|---------|
| `Exact` | Exact match only | `/api` matches `/api`, not `/api/users` |
| `Prefix` | Prefix match | `/api` matches `/api`, `/api/users`, `/api/v2` |
| `ImplementationSpecific` | Controller decides | Depends on ingress controller |

### Default Backend

```yaml
spec:
  defaultBackend:
    service:
      name: default-404-page
      port:
        number: 80
  rules:
  # ... specific rules
```

## Common Issues

**Ingress created but no EXTERNAL-IP**

LoadBalancer pending. On bare-metal, install MetalLB. On cloud, check security groups allow port 80/443.

**404 for all paths**

Service selector doesn't match pods, or service port doesn't match container port. Check: `kubectl get endpoints <service-name>`.

**TLS not working — connection refused on 443**

TLS secret must be in the same namespace as the Ingress. Check: `kubectl describe ingress <name>` for TLS errors.

**"413 Request Entity Too Large"**

Default body size is 1MB. Set: `nginx.ingress.kubernetes.io/proxy-body-size: "50m"`.

## Best Practices

- **One Ingress Controller, many Ingress resources** — share the load balancer
- **Always enable SSL redirect** — force HTTPS
- **Use cert-manager** for automatic TLS certificate management
- **Set rate limits** on public endpoints
- **Consider Gateway API** for new deployments — Ingress successor

## Key Takeaways

- Ingress provides HTTP/HTTPS routing via a single load balancer
- Path-based and host-based routing with TLS termination
- Annotations customize NGINX behavior (rate limits, CORS, rewrites)
- `pathType: Prefix` for most routes, `Exact` for specific endpoints
- Gateway API is the modern successor — consider for new clusters
