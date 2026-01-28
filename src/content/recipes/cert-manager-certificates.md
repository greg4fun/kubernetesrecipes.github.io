---
title: "How to Manage Kubernetes Certificates with cert-manager"
description: "Automate TLS certificate management with cert-manager. Configure issuers, request certificates from Let's Encrypt, and enable automatic renewal."
category: "security"
difficulty: "intermediate"
publishDate: "2026-01-22"
tags: ["cert-manager", "tls", "certificates", "lets-encrypt", "security"]
---

# How to Manage Kubernetes Certificates with cert-manager

cert-manager automates the management and issuance of TLS certificates in Kubernetes. It supports multiple certificate authorities including Let's Encrypt, HashiCorp Vault, and private CAs.

## Install cert-manager

```bash
# Install with kubectl
kubectl apply -f https://github.com/cert-manager/cert-manager/releases/download/v1.14.0/cert-manager.yaml

# Or with Helm
helm repo add jetstack https://charts.jetstack.io
helm repo update
helm install cert-manager jetstack/cert-manager \
  --namespace cert-manager \
  --create-namespace \
  --set installCRDs=true

# Verify installation
kubectl get pods -n cert-manager
kubectl get crds | grep cert-manager
```

## Certificate Resources

```yaml
# cert-manager introduces these CRDs:
# - Issuer: Namespace-scoped certificate authority
# - ClusterIssuer: Cluster-wide certificate authority
# - Certificate: Request for a signed certificate
# - CertificateRequest: Internal resource for CSR
```

## Let's Encrypt Staging Issuer

```yaml
# letsencrypt-staging-issuer.yaml
apiVersion: cert-manager.io/v1
kind: ClusterIssuer
metadata:
  name: letsencrypt-staging
spec:
  acme:
    # Staging URL for testing
    server: https://acme-staging-v02.api.letsencrypt.org/directory
    email: admin@example.com
    privateKeySecretRef:
      name: letsencrypt-staging-account
    solvers:
      - http01:
          ingress:
            class: nginx
```

## Let's Encrypt Production Issuer

```yaml
# letsencrypt-prod-issuer.yaml
apiVersion: cert-manager.io/v1
kind: ClusterIssuer
metadata:
  name: letsencrypt-prod
spec:
  acme:
    # Production URL
    server: https://acme-v02.api.letsencrypt.org/directory
    email: admin@example.com
    privateKeySecretRef:
      name: letsencrypt-prod-account
    solvers:
      - http01:
          ingress:
            class: nginx
```

## DNS01 Challenge (Wildcard Certificates)

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
      name: letsencrypt-dns-account
    solvers:
      # AWS Route53
      - dns01:
          route53:
            region: us-east-1
            hostedZoneID: Z1234567890
            accessKeyID: AKIAIOSFODNN7EXAMPLE
            secretAccessKeySecretRef:
              name: route53-credentials
              key: secret-access-key
      # Or CloudFlare
      - dns01:
          cloudflare:
            email: admin@example.com
            apiTokenSecretRef:
              name: cloudflare-api-token
              key: api-token
```

## Request Certificate

```yaml
# certificate.yaml
apiVersion: cert-manager.io/v1
kind: Certificate
metadata:
  name: myapp-tls
  namespace: default
spec:
  secretName: myapp-tls-secret
  duration: 2160h    # 90 days
  renewBefore: 360h  # 15 days before expiry
  subject:
    organizations:
      - My Company
  commonName: myapp.example.com
  dnsNames:
    - myapp.example.com
    - www.myapp.example.com
  issuerRef:
    name: letsencrypt-prod
    kind: ClusterIssuer
```

## Wildcard Certificate

```yaml
# wildcard-certificate.yaml
apiVersion: cert-manager.io/v1
kind: Certificate
metadata:
  name: wildcard-example-com
  namespace: default
spec:
  secretName: wildcard-example-com-tls
  dnsNames:
    - "*.example.com"
    - "example.com"
  issuerRef:
    name: letsencrypt-dns  # Must use DNS01 for wildcards
    kind: ClusterIssuer
```

## Ingress with Automatic Certificate

```yaml
# ingress-with-tls.yaml
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: myapp-ingress
  annotations:
    # This annotation triggers cert-manager
    cert-manager.io/cluster-issuer: letsencrypt-prod
spec:
  ingressClassName: nginx
  tls:
    - hosts:
        - myapp.example.com
      secretName: myapp-tls-secret  # cert-manager creates this
  rules:
    - host: myapp.example.com
      http:
        paths:
          - path: /
            pathType: Prefix
            backend:
              service:
                name: myapp-service
                port:
                  number: 80
```

## Self-Signed Issuer

```yaml
# self-signed-issuer.yaml
apiVersion: cert-manager.io/v1
kind: ClusterIssuer
metadata:
  name: selfsigned-issuer
spec:
  selfSigned: {}

---
# Create a CA certificate
apiVersion: cert-manager.io/v1
kind: Certificate
metadata:
  name: my-ca
  namespace: cert-manager
spec:
  isCA: true
  commonName: My Internal CA
  secretName: my-ca-secret
  duration: 87600h  # 10 years
  privateKey:
    algorithm: ECDSA
    size: 256
  issuerRef:
    name: selfsigned-issuer
    kind: ClusterIssuer

---
# CA Issuer using the self-signed CA
apiVersion: cert-manager.io/v1
kind: ClusterIssuer
metadata:
  name: my-ca-issuer
spec:
  ca:
    secretName: my-ca-secret
```

## Vault Issuer

```yaml
# vault-issuer.yaml
apiVersion: cert-manager.io/v1
kind: ClusterIssuer
metadata:
  name: vault-issuer
spec:
  vault:
    server: https://vault.example.com
    path: pki/sign/my-role
    auth:
      kubernetes:
        role: cert-manager
        mountPath: /v1/auth/kubernetes
        secretRef:
          name: vault-token
          key: token
```

## Check Certificate Status

```bash
# View certificates
kubectl get certificates -A
kubectl describe certificate myapp-tls

# View certificate requests
kubectl get certificaterequests -A

# View certificate secret
kubectl get secret myapp-tls-secret -o yaml
kubectl describe secret myapp-tls-secret

# Decode and view certificate
kubectl get secret myapp-tls-secret -o jsonpath='{.data.tls\.crt}' | base64 -d | openssl x509 -text -noout

# Check expiration
kubectl get secret myapp-tls-secret -o jsonpath='{.data.tls\.crt}' | base64 -d | openssl x509 -noout -dates
```

## Troubleshoot Certificate Issues

```bash
# Check cert-manager logs
kubectl logs -n cert-manager -l app=cert-manager

# Check certificate events
kubectl describe certificate myapp-tls

# Check certificate request
kubectl get certificaterequest -l cert-manager.io/certificate-name=myapp-tls

# Check ACME orders and challenges
kubectl get orders -A
kubectl get challenges -A
kubectl describe challenge <challenge-name>

# Debug HTTP01 challenge
kubectl get pods -l acme.cert-manager.io/http01-solver=true
```

## Certificate for mTLS

```yaml
# mtls-certificates.yaml
# Server certificate
apiVersion: cert-manager.io/v1
kind: Certificate
metadata:
  name: server-cert
spec:
  secretName: server-tls
  duration: 2160h
  renewBefore: 360h
  subject:
    organizations:
      - My Company
  commonName: server.internal
  dnsNames:
    - server.internal
    - server.default.svc.cluster.local
  usages:
    - server auth
  issuerRef:
    name: my-ca-issuer
    kind: ClusterIssuer

---
# Client certificate
apiVersion: cert-manager.io/v1
kind: Certificate
metadata:
  name: client-cert
spec:
  secretName: client-tls
  duration: 2160h
  renewBefore: 360h
  subject:
    organizations:
      - My Company
  commonName: client-app
  usages:
    - client auth
  issuerRef:
    name: my-ca-issuer
    kind: ClusterIssuer
```

## Certificate with Private Key Settings

```yaml
# certificate-with-key.yaml
apiVersion: cert-manager.io/v1
kind: Certificate
metadata:
  name: secure-cert
spec:
  secretName: secure-tls
  duration: 8760h
  renewBefore: 720h
  commonName: secure.example.com
  dnsNames:
    - secure.example.com
  privateKey:
    algorithm: ECDSA
    size: 384
    # Or RSA
    # algorithm: RSA
    # size: 4096
    rotationPolicy: Always
  issuerRef:
    name: letsencrypt-prod
    kind: ClusterIssuer
```

## Copy Certificate to Multiple Namespaces

```yaml
# Use kubernetes-replicator or similar
# Or create multiple certificates

# Create in each namespace
apiVersion: cert-manager.io/v1
kind: Certificate
metadata:
  name: shared-cert
  namespace: app-namespace
spec:
  secretName: shared-tls
  dnsNames:
    - api.example.com
  secretTemplate:
    annotations:
      replicator.v1.mittwald.de/replicate-to: "namespace-a,namespace-b"
  issuerRef:
    name: letsencrypt-prod
    kind: ClusterIssuer
```

## Monitoring Certificates

```yaml
# cert-manager exposes Prometheus metrics
# Check certificate expiry
kubectl get certificates -A -o custom-columns=\
'NAMESPACE:.metadata.namespace,NAME:.metadata.name,READY:.status.conditions[0].status,EXPIRY:.status.notAfter'
```

```bash
# Alert on expiring certificates
# Prometheus query:
# certmanager_certificate_expiration_timestamp_seconds - time() < 86400 * 7
```

## Summary

cert-manager automates TLS certificate lifecycle in Kubernetes. Use ClusterIssuers for cluster-wide certificate authorities, Certificates to request certificates, and annotations on Ingress for automatic certificate provisioning. Start with Let's Encrypt staging for testing, use DNS01 challenges for wildcard certificates, and set appropriate renewBefore values for automatic renewal.

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
