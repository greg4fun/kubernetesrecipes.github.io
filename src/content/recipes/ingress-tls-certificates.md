---
title: "How to Secure Ingress with SSL/TLS Certificates"
description: "Configure TLS termination for Kubernetes Ingress using cert-manager and Let's Encrypt. Automate certificate issuance and renewal."
category: "networking"
difficulty: "intermediate"
publishDate: "2026-01-22"
tags: ["tls", "ssl", "certificates", "ingress", "letsencrypt", "cert-manager"]
---

> 💡 **Quick Answer:** Install **cert-manager**, create a `ClusterIssuer` for Let's Encrypt, then add annotation `cert-manager.io/cluster-issuer: letsencrypt-prod` to your Ingress. Cert-manager auto-provisions TLS certificates and stores them in the Secret referenced by `spec.tls[].secretName`.
>
> **Key command:** `kubectl get certificate` to check cert status; `kubectl describe certificate <name>` for troubleshooting.
>
> **Gotcha:** Use `letsencrypt-staging` issuer first to avoid rate limits during testing; ensure DNS points to your Ingress IP for HTTP-01 validation.

# How to Secure Ingress with SSL/TLS Certificates

Secure your Kubernetes services with TLS certificates. Use cert-manager to automatically issue and renew certificates from Let's Encrypt or other certificate authorities.

## Install cert-manager

```bash
# Install cert-manager
kubectl apply -f https://github.com/cert-manager/cert-manager/releases/download/v1.13.0/cert-manager.yaml

# Wait for pods
kubectl wait --for=condition=Ready pods --all -n cert-manager --timeout=300s

# Verify installation
kubectl get pods -n cert-manager
```

## Let's Encrypt ClusterIssuer (Production)

```yaml
# letsencrypt-prod.yaml
apiVersion: cert-manager.io/v1
kind: ClusterIssuer
metadata:
  name: letsencrypt-prod
spec:
  acme:
    server: https://acme-v02.api.letsencrypt.org/directory
    email: admin@example.com
    privateKeySecretRef:
      name: letsencrypt-prod-account-key
    solvers:
      - http01:
          ingress:
            class: nginx
```

## Let's Encrypt ClusterIssuer (Staging)

```yaml
# letsencrypt-staging.yaml
apiVersion: cert-manager.io/v1
kind: ClusterIssuer
metadata:
  name: letsencrypt-staging
spec:
  acme:
    server: https://acme-staging-v02.api.letsencrypt.org/directory
    email: admin@example.com
    privateKeySecretRef:
      name: letsencrypt-staging-account-key
    solvers:
      - http01:
          ingress:
            class: nginx
```

## Ingress with Automatic TLS

```yaml
# ingress-tls.yaml
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: myapp-ingress
  annotations:
    cert-manager.io/cluster-issuer: letsencrypt-prod
    nginx.ingress.kubernetes.io/ssl-redirect: "true"
spec:
  ingressClassName: nginx
  tls:
    - hosts:
        - myapp.example.com
      secretName: myapp-tls  # cert-manager creates this
  rules:
    - host: myapp.example.com
      http:
        paths:
          - path: /
            pathType: Prefix
            backend:
              service:
                name: myapp
                port:
                  number: 80
```

## DNS-01 Challenge (Wildcard Certificates)

```yaml
# dns01-issuer.yaml
apiVersion: cert-manager.io/v1
kind: ClusterIssuer
metadata:
  name: letsencrypt-dns
spec:
  acme:
    server: https://acme-v02.api.letsencrypt.org/directory
    email: admin@example.com
    privateKeySecretRef:
      name: letsencrypt-dns-account-key
    solvers:
      - dns01:
          cloudflare:
            email: admin@example.com
            apiTokenSecretRef:
              name: cloudflare-api-token
              key: api-token
---
# Cloudflare API token secret
apiVersion: v1
kind: Secret
metadata:
  name: cloudflare-api-token
  namespace: cert-manager
type: Opaque
stringData:
  api-token: your-cloudflare-api-token
```

## Wildcard Certificate

```yaml
# wildcard-cert.yaml
apiVersion: cert-manager.io/v1
kind: Certificate
metadata:
  name: wildcard-example-com
  namespace: default
spec:
  secretName: wildcard-example-com-tls
  issuerRef:
    name: letsencrypt-dns
    kind: ClusterIssuer
  dnsNames:
    - "*.example.com"
    - "example.com"
```

## AWS Route53 DNS Challenge

```yaml
# route53-issuer.yaml
apiVersion: cert-manager.io/v1
kind: ClusterIssuer
metadata:
  name: letsencrypt-route53
spec:
  acme:
    server: https://acme-v02.api.letsencrypt.org/directory
    email: admin@example.com
    privateKeySecretRef:
      name: letsencrypt-route53-key
    solvers:
      - dns01:
          route53:
            region: us-east-1
            hostedZoneID: Z1234567890ABC
            # Use IAM role for EKS
            # Or provide credentials:
            # accessKeyIDSecretRef:
            #   name: route53-credentials
            #   key: access-key-id
            # secretAccessKeySecretRef:
            #   name: route53-credentials
            #   key: secret-access-key
```

## Manual Certificate

```yaml
# manual-cert.yaml
apiVersion: cert-manager.io/v1
kind: Certificate
metadata:
  name: myapp-cert
  namespace: default
spec:
  secretName: myapp-tls
  duration: 2160h    # 90 days
  renewBefore: 360h  # 15 days before expiry
  issuerRef:
    name: letsencrypt-prod
    kind: ClusterIssuer
  dnsNames:
    - myapp.example.com
    - api.example.com
```

## Self-Signed Certificates (Development)

```yaml
# self-signed-issuer.yaml
apiVersion: cert-manager.io/v1
kind: ClusterIssuer
metadata:
  name: selfsigned-issuer
spec:
  selfSigned: {}
---
# CA Certificate
apiVersion: cert-manager.io/v1
kind: Certificate
metadata:
  name: my-ca
  namespace: cert-manager
spec:
  isCA: true
  commonName: my-ca
  secretName: my-ca-secret
  privateKey:
    algorithm: ECDSA
    size: 256
  issuerRef:
    name: selfsigned-issuer
    kind: ClusterIssuer
---
# CA Issuer
apiVersion: cert-manager.io/v1
kind: ClusterIssuer
metadata:
  name: my-ca-issuer
spec:
  ca:
    secretName: my-ca-secret
```

## Multiple TLS Hosts

```yaml
# multi-host-ingress.yaml
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: multi-app-ingress
  annotations:
    cert-manager.io/cluster-issuer: letsencrypt-prod
spec:
  ingressClassName: nginx
  tls:
    - hosts:
        - app1.example.com
      secretName: app1-tls
    - hosts:
        - app2.example.com
      secretName: app2-tls
  rules:
    - host: app1.example.com
      http:
        paths:
          - path: /
            pathType: Prefix
            backend:
              service:
                name: app1
                port:
                  number: 80
    - host: app2.example.com
      http:
        paths:
          - path: /
            pathType: Prefix
            backend:
              service:
                name: app2
                port:
                  number: 80
```

## Check Certificate Status

```bash
# List certificates
kubectl get certificates -A

# Check certificate details
kubectl describe certificate myapp-cert

# View certificate secret
kubectl get secret myapp-tls -o yaml

# Check certificate requests
kubectl get certificaterequests -A

# Debug certificate issues
kubectl describe certificaterequest myapp-cert-xxxxx
```

## Certificate Expiry Alert

```yaml
# prometheus-rule.yaml
apiVersion: monitoring.coreos.com/v1
kind: PrometheusRule
metadata:
  name: cert-expiry-alerts
spec:
  groups:
    - name: certificates
      rules:
        - alert: CertificateExpiringSoon
          expr: |
            certmanager_certificate_expiration_timestamp_seconds - time() < 7 * 24 * 3600
          for: 1h
          labels:
            severity: warning
          annotations:
            summary: "Certificate {{ $labels.name }} expires in less than 7 days"
        - alert: CertificateExpired
          expr: |
            certmanager_certificate_expiration_timestamp_seconds - time() < 0
          labels:
            severity: critical
          annotations:
            summary: "Certificate {{ $labels.name }} has expired"
```

## Force Certificate Renewal

```bash
# Delete the secret to trigger renewal
kubectl delete secret myapp-tls

# Or delete and recreate certificate
kubectl delete certificate myapp-cert
kubectl apply -f certificate.yaml

# Check renewal status
kubectl describe certificate myapp-cert
```

## Summary

cert-manager automates TLS certificate management in Kubernetes. Configure ClusterIssuers for Let's Encrypt, annotate Ingress resources for automatic certificate provisioning, and use DNS-01 challenges for wildcard certificates. Monitor certificate expiry with Prometheus alerts.

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
