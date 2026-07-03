---
title: "Kubernetes Ingress TLS Certificate with cert-manager"
description: "Automate TLS certificate management on Kubernetes with cert-manager. Let's Encrypt integration, ClusterIssuer configuration, automatic renewal, wildcard"
tags:
  - "cert-manager"
  - "tls"
  - "certificates"
  - "letsencrypt"
  - "ingress"
category: "networking"
publishDate: "2026-06-01"
author: "Luca Berton"
difficulty: "intermediate"
relatedRecipes:
  - "kubernetes-ingress-nginx-guide"
  - "kubernetes-gateway-api-httproute"
  - "kubernetes-secrets-management-best-practices"
---

> 💡 **Quick Answer:** cert-manager automates TLS certificate lifecycle on Kubernetes. Install with Helm, create a `ClusterIssuer` pointing to Let's Encrypt, then annotate your Ingress with `cert-manager.io/cluster-issuer: letsencrypt-prod`. cert-manager automatically issues, stores (as Secret), and renews certificates before expiry.

## The Problem

- Manual certificate management is error-prone and certificates expire unexpectedly
- Let's Encrypt requires ACME challenge automation
- Each Ingress needs its own TLS certificate Secret
- Certificate renewal must happen before expiry (90-day Let's Encrypt certs)
- Need wildcard certificates for dynamic subdomains

## The Solution

### Install NGINX Ingress Controller

cert-manager needs an Ingress controller to serve the HTTP-01 challenge, so install NGINX Ingress first if it isn't already running:

```bash
helm repo add ingress-nginx https://kubernetes.github.io/ingress-nginx
helm repo update

helm install ingress-nginx ingress-nginx/ingress-nginx \
  --namespace ingress-nginx \
  --create-namespace \
  --set controller.publishService.enabled=true

kubectl get pods -n ingress-nginx
kubectl get svc -n ingress-nginx    # note the external IP — point DNS at it
```

### Install cert-manager

```bash
helm repo add jetstack https://charts.jetstack.io
helm repo update

helm install cert-manager jetstack/cert-manager \
  --namespace cert-manager \
  --create-namespace \
  --version v1.16.0 \
  --set crds.enabled=true

# Verify
kubectl get pods -n cert-manager
```

### ClusterIssuer (Let's Encrypt)

```yaml
# Staging (for testing — no rate limits)
apiVersion: cert-manager.io/v1
kind: ClusterIssuer
metadata:
  name: letsencrypt-staging
spec:
  acme:
    server: https://acme-staging-v02.api.letsencrypt.org/directory
    email: admin@example.com
    privateKeySecretRef:
      name: letsencrypt-staging-key
    solvers:
      - http01:
          ingress:
            class: nginx
---
# Production
apiVersion: cert-manager.io/v1
kind: ClusterIssuer
metadata:
  name: letsencrypt-prod
spec:
  acme:
    server: https://acme-v02.api.letsencrypt.org/directory
    email: admin@example.com
    privateKeySecretRef:
      name: letsencrypt-prod-key
    solvers:
      - http01:
          ingress:
            class: nginx
```

### Ingress with Automatic TLS

```yaml
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: my-app
  namespace: production
  annotations:
    cert-manager.io/cluster-issuer: "letsencrypt-prod"
spec:
  ingressClassName: nginx
  tls:
    - hosts:
        - app.example.com
        - api.example.com
      secretName: app-tls-cert    # cert-manager creates this Secret
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
    - host: api.example.com
      http:
        paths:
          - path: /
            pathType: Prefix
            backend:
              service:
                name: api-server
                port:
                  number: 80
```

### DNS-01 Challenge (Wildcard Certs)

```yaml
# ClusterIssuer with DNS-01 (required for wildcards)
apiVersion: cert-manager.io/v1
kind: ClusterIssuer
metadata:
  name: letsencrypt-dns
spec:
  acme:
    server: https://acme-v02.api.letsencrypt.org/directory
    email: admin@example.com
    privateKeySecretRef:
      name: letsencrypt-dns-key
    solvers:
      - dns01:
          cloudflare:
            email: admin@example.com
            apiTokenSecretRef:
              name: cloudflare-api-token
              key: api-token
---
# Wildcard Certificate
apiVersion: cert-manager.io/v1
kind: Certificate
metadata:
  name: wildcard-cert
  namespace: production
spec:
  secretName: wildcard-tls
  issuerRef:
    name: letsencrypt-dns
    kind: ClusterIssuer
  dnsNames:
    - "example.com"
    - "*.example.com"
```

### Check Certificate Status

```bash
# List certificates
kubectl get certificates -A
# NAME            READY   SECRET          AGE
# app-tls-cert    True    app-tls-cert    5d

# Detailed status
kubectl describe certificate app-tls-cert -n production

# Check certificate request
kubectl get certificaterequest -n production

# Check ACME challenges
kubectl get challenges -A

# View actual certificate
kubectl get secret app-tls-cert -n production -o jsonpath='{.data.tls\.crt}' | \
  base64 -d | openssl x509 -text -noout | head -20
```

### Gateway API Integration

```yaml
apiVersion: gateway.networking.k8s.io/v1
kind: Gateway
metadata:
  name: main-gateway
  annotations:
    cert-manager.io/cluster-issuer: "letsencrypt-prod"
spec:
  gatewayClassName: nginx
  listeners:
    - name: https
      protocol: HTTPS
      port: 443
      hostname: "app.example.com"
      tls:
        mode: Terminate
        certificateRefs:
          - name: app-tls-cert    # cert-manager auto-creates
```

## Common Issues

### Certificate stuck in "Not Ready" — challenge failing
- **Cause**: HTTP-01 challenge can't reach `/.well-known/acme-challenge/` on port 80
- **Fix**: Ensure Ingress is accessible externally on port 80; DNS resolves to ingress IP; no firewall blocking

### "rate limited" error from Let's Encrypt
- **Cause**: Too many certificate requests for same domain (5/week for prod)
- **Fix**: Use staging issuer for testing; wait for rate limit reset; use longer-lived certs

### "acme: authorization for domain not found"
- **Cause**: DNS-01 TXT record not propagated; or API token lacks permissions
- **Fix**: Verify DNS provider credentials; check cert-manager pod logs; add propagation wait

### Certificate renewed but pods still use old cert
- **Cause**: Ingress controller caches TLS; or pods mount Secret that hasn't refreshed
- **Fix**: NGINX ingress auto-detects Secret changes. For pod mounts, restart pods or wait kubelet sync

## Best Practices

1. **Start with staging issuer** — avoid rate limits while testing
2. **Use ClusterIssuer over Issuer** — works across all namespaces
3. **HTTP-01 for standard certs** — simplest, no DNS provider integration needed
4. **DNS-01 for wildcards** — only solver type that supports `*.example.com`
5. **Set `secretName` in Ingress TLS** — cert-manager stores cert there
6. **Monitor certificate expiry** — cert-manager Prometheus metrics or alerts
7. **Renewal happens at 2/3 lifetime** — 60 days for 90-day Let's Encrypt certs

## Key Takeaways

- cert-manager automates certificate issuance, storage, and renewal on Kubernetes
- `ClusterIssuer` + Ingress annotation = fully automatic TLS with Let's Encrypt
- HTTP-01: validates domain via HTTP request (port 80 must be reachable)
- DNS-01: validates via DNS TXT record (required for wildcards)
- Certificates stored as Kubernetes Secrets (type `kubernetes.io/tls`)
- Auto-renewal at 2/3 certificate lifetime (day 60 of 90-day cert)
- `kubectl describe certificate` and `kubectl get challenges` — primary debugging tools
