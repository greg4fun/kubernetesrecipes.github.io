---
title: "How to Implement Request Routing with Ingress"
description: "Configure advanced routing rules with Kubernetes Ingress. Implement path-based routing, host-based routing, and traffic management."
category: "networking"
difficulty: "intermediate"
publishDate: "2026-01-22"
tags: ["ingress", "routing", "traffic", "nginx", "load-balancing"]
---

# How to Implement Request Routing with Ingress

Kubernetes Ingress provides HTTP/HTTPS routing to services. Configure path-based and host-based routing, TLS termination, and advanced traffic management.

## Basic Ingress

```yaml
# basic-ingress.yaml
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: simple-ingress
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
                name: web-service
                port:
                  number: 80
```

## Path-Based Routing

```yaml
# path-routing.yaml
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: path-based-routing
spec:
  ingressClassName: nginx
  rules:
    - host: api.example.com
      http:
        paths:
          - path: /users
            pathType: Prefix
            backend:
              service:
                name: users-service
                port:
                  number: 80
          - path: /orders
            pathType: Prefix
            backend:
              service:
                name: orders-service
                port:
                  number: 80
          - path: /products
            pathType: Prefix
            backend:
              service:
                name: products-service
                port:
                  number: 80
          - path: /
            pathType: Prefix
            backend:
              service:
                name: default-service
                port:
                  number: 80
```

## Host-Based Routing

```yaml
# host-routing.yaml
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: multi-host-ingress
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
                name: app-service
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
                  number: 80
    - host: admin.example.com
      http:
        paths:
          - path: /
            pathType: Prefix
            backend:
              service:
                name: admin-service
                port:
                  number: 80
```

## Path Types

```yaml
# Path type options:
# - Prefix: Matches URL path prefix (most common)
# - Exact: Matches exact path only
# - ImplementationSpecific: Depends on ingress controller

# Exact matching
- path: /api/v1/users
  pathType: Exact
  backend:
    service:
      name: users-v1
      port:
        number: 80

# Prefix matching
- path: /api/v1
  pathType: Prefix
  backend:
    service:
      name: api-v1
      port:
        number: 80
```

## TLS Termination

```yaml
# tls-ingress.yaml
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: tls-ingress
spec:
  ingressClassName: nginx
  tls:
    - hosts:
        - app.example.com
        - api.example.com
      secretName: example-tls-secret
  rules:
    - host: app.example.com
      http:
        paths:
          - path: /
            pathType: Prefix
            backend:
              service:
                name: app-service
                port:
                  number: 80
```

```bash
# Create TLS secret
kubectl create secret tls example-tls-secret \
  --cert=tls.crt \
  --key=tls.key
```

## NGINX Ingress Annotations

```yaml
# nginx-annotations.yaml
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: annotated-ingress
  annotations:
    # SSL redirect
    nginx.ingress.kubernetes.io/ssl-redirect: "true"
    
    # Rewrite target
    nginx.ingress.kubernetes.io/rewrite-target: /$2
    
    # Proxy settings
    nginx.ingress.kubernetes.io/proxy-body-size: "100m"
    nginx.ingress.kubernetes.io/proxy-connect-timeout: "30"
    nginx.ingress.kubernetes.io/proxy-read-timeout: "60"
    nginx.ingress.kubernetes.io/proxy-send-timeout: "60"
    
    # Rate limiting
    nginx.ingress.kubernetes.io/limit-rps: "100"
    nginx.ingress.kubernetes.io/limit-connections: "50"
    
    # CORS
    nginx.ingress.kubernetes.io/enable-cors: "true"
    nginx.ingress.kubernetes.io/cors-allow-origin: "https://example.com"
spec:
  ingressClassName: nginx
  rules:
    - host: api.example.com
      http:
        paths:
          - path: /api(/|$)(.*)
            pathType: ImplementationSpecific
            backend:
              service:
                name: api-service
                port:
                  number: 80
```

## URL Rewriting

```yaml
# rewrite-ingress.yaml
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: rewrite-ingress
  annotations:
    nginx.ingress.kubernetes.io/rewrite-target: /$2
spec:
  ingressClassName: nginx
  rules:
    - host: app.example.com
      http:
        paths:
          # /api/users -> /users
          - path: /api(/|$)(.*)
            pathType: ImplementationSpecific
            backend:
              service:
                name: api-service
                port:
                  number: 80
```

## Canary Deployments

```yaml
# canary-ingress.yaml
# Main ingress
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: main-ingress
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
                name: main-service
                port:
                  number: 80
---
# Canary ingress (10% traffic)
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: canary-ingress
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
                name: canary-service
                port:
                  number: 80
```

## Header-Based Routing

```yaml
# header-routing.yaml
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: header-canary
  annotations:
    nginx.ingress.kubernetes.io/canary: "true"
    nginx.ingress.kubernetes.io/canary-by-header: "X-Canary"
    nginx.ingress.kubernetes.io/canary-by-header-value: "true"
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
                name: canary-service
                port:
                  number: 80
```

## Session Affinity

```yaml
# sticky-sessions.yaml
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: sticky-ingress
  annotations:
    nginx.ingress.kubernetes.io/affinity: "cookie"
    nginx.ingress.kubernetes.io/affinity-mode: "persistent"
    nginx.ingress.kubernetes.io/session-cookie-name: "SERVERID"
    nginx.ingress.kubernetes.io/session-cookie-max-age: "3600"
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
                name: stateful-service
                port:
                  number: 80
```

## Basic Authentication

```yaml
# auth-ingress.yaml
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: auth-ingress
  annotations:
    nginx.ingress.kubernetes.io/auth-type: basic
    nginx.ingress.kubernetes.io/auth-secret: basic-auth
    nginx.ingress.kubernetes.io/auth-realm: "Authentication Required"
spec:
  ingressClassName: nginx
  rules:
    - host: admin.example.com
      http:
        paths:
          - path: /
            pathType: Prefix
            backend:
              service:
                name: admin-service
                port:
                  number: 80
```

```bash
# Create auth secret
htpasswd -c auth admin
kubectl create secret generic basic-auth --from-file=auth
```

## Default Backend

```yaml
# default-backend.yaml
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: ingress-with-default
spec:
  ingressClassName: nginx
  defaultBackend:
    service:
      name: default-service
      port:
        number: 80
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
                  number: 80
```

## Debug Ingress

```bash
# Check ingress status
kubectl get ingress
kubectl describe ingress my-ingress

# Check ingress controller logs
kubectl logs -n ingress-nginx -l app.kubernetes.io/name=ingress-nginx

# Test routing
curl -H "Host: app.example.com" http://<ingress-ip>/

# Check generated nginx config
kubectl exec -n ingress-nginx <nginx-pod> -- cat /etc/nginx/nginx.conf
```

## Summary

Kubernetes Ingress provides HTTP routing through path-based and host-based rules. Use pathType Prefix for most routing needs and Exact for specific endpoints. Enable TLS termination with secrets containing certificates. NGINX ingress annotations configure rewrites, timeouts, rate limiting, and CORS. Implement canary deployments with weight-based or header-based routing. Add session affinity for stateful applications. Debug with `kubectl describe ingress` and ingress controller logs.
