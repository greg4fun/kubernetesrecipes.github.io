---
title: "How to Configure NGINX Ingress with TLS using cert-manager"
description: "Learn how to set up NGINX Ingress Controller with automatic TLS certificates from Let's Encrypt using cert-manager. Complete YAML examples and troubleshooting tips included."
category: "networking"
difficulty: "intermediate"
timeToComplete: "20 minutes"
kubernetesVersion: "1.28+"
prerequisites:
  - "A running Kubernetes cluster (1.28+)"
  - "kubectl configured to access your cluster"
  - "Helm 3 installed"
  - "A domain name pointing to your cluster's external IP"
relatedRecipes:
  - "networkpolicy-deny-all"
  - "ingress-annotations-cheatsheet"
tags:
  - ingress
  - nginx
  - tls
  - cert-manager
  - lets-encrypt
  - https
publishDate: "2026-01-20"
author: "Luca Berton"
---

> 💡 **Quick Answer:** Install NGINX Ingress (`helm install ingress-nginx ingress-nginx/ingress-nginx`) and cert-manager (`helm install cert-manager jetstack/cert-manager --set installCRDs=true`). Create a `ClusterIssuer` for Let's Encrypt, then add annotation `cert-manager.io/cluster-issuer: letsencrypt-prod` to your Ingress. TLS certs auto-provision and renew.
>
> **Key Ingress config:** `tls: [{hosts: [example.com], secretName: example-tls}]` + annotation triggers cert-manager.
>
> **Gotcha:** Ensure DNS points to Ingress external IP before requesting certs; use `letsencrypt-staging` first to avoid rate limits.

## The Problem

You want to expose your Kubernetes services over HTTPS with valid TLS certificates, but managing certificates manually is error-prone and doesn't scale.

## The Solution

Use NGINX Ingress Controller combined with cert-manager to automatically provision and renew TLS certificates from Let's Encrypt.

## Step 1: Install NGINX Ingress Controller

First, add the ingress-nginx Helm repository and install the controller:

```bash
# Add the ingress-nginx repository
helm repo add ingress-nginx https://kubernetes.github.io/ingress-nginx
helm repo update

# Install NGINX Ingress Controller
helm install ingress-nginx ingress-nginx/ingress-nginx \
  --namespace ingress-nginx \
  --create-namespace \
  --set controller.publishService.enabled=true
```

Verify the installation:

```bash
kubectl get pods -n ingress-nginx
kubectl get svc -n ingress-nginx
```

## Step 2: Install cert-manager

Install cert-manager to handle automatic certificate management:

```bash
# Add the Jetstack Helm repository
helm repo add jetstack https://charts.jetstack.io
helm repo update

# Install cert-manager with CRDs
helm install cert-manager jetstack/cert-manager \
  --namespace cert-manager \
  --create-namespace \
  --set installCRDs=true
```

Wait for cert-manager pods to be ready:

```bash
kubectl get pods -n cert-manager
```

## Step 3: Create a ClusterIssuer

Create a ClusterIssuer for Let's Encrypt. Save this as `cluster-issuer.yaml`:

```yaml
apiVersion: cert-manager.io/v1
kind: ClusterIssuer
metadata:
  name: letsencrypt-prod
spec:
  acme:
    # The ACME server URL
    server: https://acme-v02.api.letsencrypt.org/directory
    # Email address used for ACME registration
    email: your-email@example.com
    # Name of secret to store the ACME account private key
    privateKeySecretRef:
      name: letsencrypt-prod
    # Enable the HTTP-01 challenge provider
    solvers:
      - http01:
          ingress:
            class: nginx
```

Apply it:

```bash
kubectl apply -f cluster-issuer.yaml
```

> **Tip:** For testing, use `https://acme-staging-v02.api.letsencrypt.org/directory` to avoid rate limits.

## Step 4: Create an Ingress with TLS

Now create an Ingress resource that uses the ClusterIssuer. Save as `my-app-ingress.yaml`:

```yaml
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: my-app-ingress
  annotations:
    # Use the letsencrypt-prod ClusterIssuer
    cert-manager.io/cluster-issuer: "letsencrypt-prod"
    # Force HTTPS redirect
    nginx.ingress.kubernetes.io/ssl-redirect: "true"
spec:
  ingressClassName: nginx
  tls:
    - hosts:
        - myapp.example.com
      secretName: myapp-tls  # cert-manager will create this
  rules:
    - host: myapp.example.com
      http:
        paths:
          - path: /
            pathType: Prefix
            backend:
              service:
                name: my-app-service
                port:
                  number: 80
```

Apply the Ingress:

```bash
kubectl apply -f my-app-ingress.yaml
```

## Step 5: Verify Certificate Issuance

Check the certificate status:

```bash
# Check Certificate resource
kubectl get certificate

# Check certificate details
kubectl describe certificate myapp-tls

# Check the secret was created
kubectl get secret myapp-tls
```

The certificate should transition from `False` to `True` within 1-2 minutes.

## Common Issues

### Certificate stuck in "False" state

Check the Certificate and CertificateRequest status:

```bash
kubectl describe certificate myapp-tls
kubectl get certificaterequest
kubectl describe certificaterequest <name>
```

### HTTP-01 challenge failing

Ensure your domain resolves to the Ingress controller's external IP:

```bash
# Get the external IP
kubectl get svc -n ingress-nginx

# Test DNS resolution
nslookup myapp.example.com
```

### Rate limiting

Let's Encrypt has rate limits. Use the staging server for testing:

```yaml
server: https://acme-staging-v02.api.letsencrypt.org/directory
```

## Complete Example

Here's a complete example with a sample deployment:

```yaml
---
apiVersion: apps/v1
kind: Deployment
metadata:
  name: my-app
spec:
  replicas: 2
  selector:
    matchLabels:
      app: my-app
  template:
    metadata:
      labels:
        app: my-app
    spec:
      containers:
        - name: my-app
          image: nginx:alpine
          ports:
            - containerPort: 80
---
apiVersion: v1
kind: Service
metadata:
  name: my-app-service
spec:
  selector:
    app: my-app
  ports:
    - port: 80
      targetPort: 80
---
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: my-app-ingress
  annotations:
    cert-manager.io/cluster-issuer: "letsencrypt-prod"
    nginx.ingress.kubernetes.io/ssl-redirect: "true"
spec:
  ingressClassName: nginx
  tls:
    - hosts:
        - myapp.example.com
      secretName: myapp-tls
  rules:
    - host: myapp.example.com
      http:
        paths:
          - path: /
            pathType: Prefix
            backend:
              service:
                name: my-app-service
                port:
                  number: 80
```

## Summary

You've learned how to:

1. Install NGINX Ingress Controller using Helm
2. Install cert-manager for automatic certificate management
3. Create a ClusterIssuer for Let's Encrypt
4. Configure an Ingress with automatic TLS

Certificates will be automatically renewed by cert-manager before they expire.

## References

- [cert-manager Documentation](https://cert-manager.io/docs/)
- [NGINX Ingress Controller](https://kubernetes.github.io/ingress-nginx/)
- [Let's Encrypt Rate Limits](https://letsencrypt.org/docs/rate-limits/)

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
