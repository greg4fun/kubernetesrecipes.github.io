---
title: "Kubernetes 1.36 Pod Certificates (mTLS)"
description: "Use Pod Certificates in Kubernetes 1.36 to authenticate Pods to the API server via mTLS. Built-in X.509 certificate provisioning without external tools."
tags:
  - "kubernetes-1.36"
  - "security"
  - "mtls"
  - "certificates"
  - "authentication"
category: "security"
publishDate: "2026-05-03"
author: "Luca Berton"
difficulty: "advanced"
relatedRecipes:
  - "kubernetes-1-36-external-sa-token-signing"
  - "kubernetes-cert-manager-guide"
  - "kubernetes-spiffe-spire-identity"
  - "kubernetes-serviceaccount-guide"
---

> 💡 **Quick Answer:** Pod Certificates reach **Beta in Kubernetes 1.36**. Pods can authenticate to the API server using mTLS with auto-provisioned X.509 certificates — no external cert-manager or SPIFFE required for basic workload identity.

## The Problem

ServiceAccount tokens (JWTs) are the default Pod authentication method, but they have limitations:

- **Bearer tokens can be stolen** — if leaked, anyone can use them until expiry
- **No mutual authentication** — server verifies the token, but client can't verify the server
- **Token projection delays** — bound tokens need refresh, creating brief auth gaps
- **No certificate-based identity** — many enterprise systems require X.509 client certs
- **External tools needed** — cert-manager or SPIFFE/SPIRE for workload certificates

## The Solution

Pod Certificates provide built-in X.509 certificate provisioning as projected volumes. The kubelet requests certificates from the API server and mounts them in the Pod.

### Enable Pod Certificates (Beta — Enabled by Default in 1.36)

```yaml
apiVersion: v1
kind: Pod
metadata:
  name: secure-app
spec:
  serviceAccountName: app-identity
  containers:
    - name: app
      image: registry.example.com/app:v3.0
      volumeMounts:
        - name: pod-cert
          mountPath: /var/run/secrets/kubernetes.io/pod-certificates
          readOnly: true
      env:
        - name: TLS_CERT_PATH
          value: /var/run/secrets/kubernetes.io/pod-certificates/tls.crt
        - name: TLS_KEY_PATH
          value: /var/run/secrets/kubernetes.io/pod-certificates/tls.key
        - name: CA_CERT_PATH
          value: /var/run/secrets/kubernetes.io/pod-certificates/ca.crt
  volumes:
    - name: pod-cert
      projected:
        sources:
          - podCertificate:
              expirationSeconds: 3600
              signerName: kubernetes.io/kube-apiserver-client
```

### PodCertificateRequest with PKCS#10 CSR (New in 1.36)

```yaml
apiVersion: v1
kind: Pod
metadata:
  name: app-with-csr
spec:
  containers:
    - name: app
      image: registry.example.com/app:v3.0
      volumeMounts:
        - name: pod-cert
          mountPath: /certs
          readOnly: true
  volumes:
    - name: pod-cert
      projected:
        sources:
          - podCertificate:
              expirationSeconds: 7200
              signerName: kubernetes.io/kube-apiserver-client
              stubPKCS10Request:
                subject:
                  commonName: "app.production.svc"
                  organization:
                    - "production"
                dnsNames:
                  - "app.production.svc.cluster.local"
                  - "app.production.svc"
```

### mTLS Between Pods

```yaml
# Server Pod
apiVersion: v1
kind: Pod
metadata:
  name: api-server
spec:
  containers:
    - name: server
      image: registry.example.com/api:v2.0
      ports:
        - containerPort: 8443
      volumeMounts:
        - name: server-cert
          mountPath: /certs
          readOnly: true
      command:
        - /api-server
        - --tls-cert=/certs/tls.crt
        - --tls-key=/certs/tls.key
        - --client-ca=/certs/ca.crt
        - --require-client-cert
  volumes:
    - name: server-cert
      projected:
        sources:
          - podCertificate:
              expirationSeconds: 3600
              signerName: kubernetes.io/kube-apiserver-client
---
# Client Pod
apiVersion: v1
kind: Pod
metadata:
  name: api-client
spec:
  containers:
    - name: client
      image: registry.example.com/client:v2.0
      volumeMounts:
        - name: client-cert
          mountPath: /certs
          readOnly: true
      command:
        - /client
        - --tls-cert=/certs/tls.crt
        - --tls-key=/certs/tls.key
        - --server-ca=/certs/ca.crt
        - --server=https://api-server:8443
  volumes:
    - name: client-cert
      projected:
        sources:
          - podCertificate:
              expirationSeconds: 3600
              signerName: kubernetes.io/kube-apiserver-client
```

### Verify Pod Certificates

```bash
# Check certificate contents
kubectl exec secure-app -- openssl x509 \
  -in /var/run/secrets/kubernetes.io/pod-certificates/tls.crt \
  -noout -subject -issuer -dates

# Verify the certificate chain
kubectl exec secure-app -- openssl verify \
  -CAfile /var/run/secrets/kubernetes.io/pod-certificates/ca.crt \
  /var/run/secrets/kubernetes.io/pod-certificates/tls.crt

# Check certificate expiration
kubectl exec secure-app -- openssl x509 \
  -in /var/run/secrets/kubernetes.io/pod-certificates/tls.crt \
  -noout -enddate
```

## Common Issues

### Certificate not mounted
- **Cause**: Feature gate not enabled (pre-1.36) or invalid `signerName`
- **Fix**: Verify `PodCertificates` feature gate is enabled; use valid signer name

### Certificate expired and not renewed
- **Cause**: Kubelet certificate rotation not working
- **Fix**: Check kubelet logs; certificates auto-rotate at ~80% of expiration

### Application can't parse certificate format
- **Cause**: App expects PKCS#12 but receives PEM
- **Fix**: Convert with `openssl pkcs12 -export` in an init container

## Best Practices

1. **Set short expiration** — 1-4 hours; certificates auto-rotate
2. **Use specific signer names** — match your security policy requirements
3. **Enable mTLS for service-to-service** — both client and server certificates
4. **Monitor certificate events** — watch for rotation failures
5. **Combine with NetworkPolicy** — certificate auth + network isolation = defense in depth

## Key Takeaways

- Pod Certificates are **Beta in Kubernetes 1.36** (enabled by default)
- Built-in X.509 certificate provisioning via projected volumes
- Enables mTLS without external tools (cert-manager, SPIFFE/SPIRE)
- PKCS#10 CSR support added in 1.36 for custom certificate subjects
- Auto-rotation handled by kubelet — no manual renewal needed
