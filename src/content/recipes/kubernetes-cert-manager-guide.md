---
title: "cert-manager: Automated TLS Certificates"
description: "Automate TLS certificate management with cert-manager in Kubernetes. Let's Encrypt integration, Issuer configuration, wildcard certificates, and automatic"
publishDate: "2026-05-02"
author: "Luca Berton"
category: "security"
difficulty: "intermediate"
timeToComplete: "12 minutes"
kubernetesVersion: "1.28+"
tags:
  - "tls"
  - "certificates"
  - "cert-manager"
  - "security"
  - "lets-encrypt"
relatedRecipes:
  - "kubernetes-certificate-management"
  - "kubernetes-ingress-nginx-guide"
  - "kubernetes-secret-types-guide"
---

> 💡 **Quick Answer:** cert-manager automates TLS certificates in Kubernetes. Install: `helm install cert-manager jetstack/cert-manager --set installCRDs=true`. Create a `ClusterIssuer` for Let's Encrypt. Add `cert-manager.io/cluster-issuer: letsencrypt-prod` annotation to Ingress — cert-manager auto-creates and renews certificates. Supports Let's Encrypt, Vault, Venafi, self-signed, and custom CAs.

## The Problem

Managing TLS certificates manually:

- Certificates expire → outages
- Manual renewal process is error-prone
- Different apps need different certificates
- Wildcard certificates need DNS validation
- No standard way to distribute certs to pods

## The Solution

### Install cert-manager

```bash
# Helm install (recommended)
helm repo add jetstack https://charts.jetstack.io
helm install cert-manager jetstack/cert-manager \
  -n cert-manager --create-namespace \
  --set installCRDs=true \
  --version v1.14.0

# Verify
kubectl get pods -n cert-manager
# cert-manager-xxx              Running
# cert-manager-cainjector-xxx   Running
# cert-manager-webhook-xxx      Running

# Test
cmctl check api    # If cmctl CLI installed
```

### ClusterIssuer (Let's Encrypt)

```yaml
# Staging (for testing — not trusted by browsers)
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
# Production (trusted certificates)
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
    # HTTP-01 challenge (port 80)
    - http01:
        ingress:
          class: nginx
    # DNS-01 challenge (for wildcards)
    - dns01:
        cloudDNS:
          project: my-gcp-project
      selector:
        dnsZones:
        - "example.com"
```

### Automatic Certificate via Ingress

```yaml
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: my-app
  annotations:
    cert-manager.io/cluster-issuer: letsencrypt-prod   # This triggers cert-manager!
spec:
  tls:
  - hosts:
    - app.example.com
    secretName: app-tls              # cert-manager creates this Secret
  rules:
  - host: app.example.com
    http:
      paths:
      - path: /
        pathType: Prefix
        backend:
          service:
            name: my-app
            port:
              number: 80

# cert-manager will:
# 1. Create a Certificate resource
# 2. Create an ACME challenge (HTTP-01 or DNS-01)
# 3. Get certificate from Let's Encrypt
# 4. Store in Secret "app-tls"
# 5. Auto-renew before expiry (30 days before)
```

### Manual Certificate Resource

```yaml
apiVersion: cert-manager.io/v1
kind: Certificate
metadata:
  name: app-cert
  namespace: production
spec:
  secretName: app-tls
  issuerRef:
    name: letsencrypt-prod
    kind: ClusterIssuer
  commonName: app.example.com
  dnsNames:
  - app.example.com
  - www.app.example.com
  duration: 2160h        # 90 days
  renewBefore: 720h      # Renew 30 days before expiry
```

### Wildcard Certificates (DNS-01)

```yaml
# Requires DNS-01 solver
apiVersion: cert-manager.io/v1
kind: Certificate
metadata:
  name: wildcard-cert
spec:
  secretName: wildcard-tls
  issuerRef:
    name: letsencrypt-prod
    kind: ClusterIssuer
  dnsNames:
  - "*.example.com"
  - "example.com"

# DNS-01 solvers by provider:
# AWS Route53:
#   dns01:
#     route53:
#       region: us-east-1
#       hostedZoneID: Z123456

# Cloudflare:
#   dns01:
#     cloudflare:
#       email: admin@example.com
#       apiTokenSecretRef:
#         name: cloudflare-token
#         key: api-token

# Google Cloud DNS:
#   dns01:
#     cloudDNS:
#       project: my-project
```

### Self-Signed and Internal CA

```yaml
# Self-signed issuer
apiVersion: cert-manager.io/v1
kind: ClusterIssuer
metadata:
  name: selfsigned
spec:
  selfSigned: {}

---
# Create CA certificate
apiVersion: cert-manager.io/v1
kind: Certificate
metadata:
  name: internal-ca
  namespace: cert-manager
spec:
  isCA: true
  commonName: Internal CA
  secretName: internal-ca-key
  issuerRef:
    name: selfsigned
    kind: ClusterIssuer
  duration: 87600h        # 10 years

---
# CA issuer (signs certs with internal CA)
apiVersion: cert-manager.io/v1
kind: ClusterIssuer
metadata:
  name: internal-ca-issuer
spec:
  ca:
    secretName: internal-ca-key
```

### Debug Certificates

```bash
# Check certificate status
kubectl get certificate -A
# NAME       READY   SECRET     AGE
# app-cert   True    app-tls    5d
# web-cert   False   web-tls    10m   ← problem!

# Describe for details
kubectl describe certificate web-cert

# Check certificate request
kubectl get certificaterequest -A
kubectl describe certificaterequest web-cert-xxxxx

# Check ACME challenges
kubectl get challenges -A
kubectl describe challenge web-cert-xxxxx

# Check orders
kubectl get orders -A

# View actual certificate
kubectl get secret app-tls -o jsonpath='{.data.tls\.crt}' | base64 -d | openssl x509 -text -noout

# cert-manager logs
kubectl logs -n cert-manager deployment/cert-manager --tail=50
```

## Common Issues

**Certificate stuck at "Issuing"**

HTTP-01 challenge failing. Check: Ingress controller reachable on port 80, DNS points to cluster, no firewall blocking.

**"acme: error 403" from Let's Encrypt**

Rate limited. Use staging issuer for testing. Production limit: 50 certs per domain per week.

**Secret not created**

Certificate not Ready. Check events: `kubectl describe certificate <name>`. Usually DNS or challenge solver issue.

## Best Practices

- **Test with staging first** — Let's Encrypt has strict rate limits
- **Use ClusterIssuer** for cluster-wide, **Issuer** for namespace-scoped
- **DNS-01 for wildcards** — HTTP-01 can't do wildcard certificates
- **Monitor certificate expiry** — Prometheus + cert-manager metrics
- **Internal CA for service mesh** — mTLS between services

## Key Takeaways

- cert-manager automates certificate lifecycle (issue, renew, revoke)
- Annotate Ingress with `cert-manager.io/cluster-issuer` for auto-TLS
- HTTP-01 for standard certs, DNS-01 for wildcards
- Auto-renewal 30 days before expiry (configurable)
- Supports Let's Encrypt, Vault, internal CA, self-signed
