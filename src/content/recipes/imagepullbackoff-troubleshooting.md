---
title: "How to Troubleshoot ImagePullBackOff Errors"
description: "Debug and fix container image pull failures. Resolve authentication issues, registry connectivity, and image availability problems."
category: "troubleshooting"
difficulty: "beginner"
publishDate: "2026-01-22"
tags: ["imagepull", "troubleshooting", "registry", "authentication", "containers"]
---

> 💡 **Quick Answer:** Run `kubectl describe pod <name>` to see the exact error. Common causes: **wrong image name/tag** (check spelling, tag exists), **missing imagePullSecret** (add secret reference), **private registry auth** (verify credentials), or **rate limiting** (Docker Hub limits). Test with `docker pull <image>` locally.
>
> **Key command:** `kubectl describe pod <name> | grep -A5 Events` shows the pull failure reason.
>
> **Gotcha:** "manifest unknown" means tag doesn't exist; "unauthorized" means auth failed—check secret with `kubectl get secret <name> -o yaml`.

# How to Troubleshoot ImagePullBackOff Errors

ImagePullBackOff means Kubernetes can't pull your container image. Learn to diagnose authentication failures, network issues, and image availability problems.

## Identify the Problem

```bash
# Check pod status
kubectl get pods
# NAME         READY   STATUS             RESTARTS   AGE
# my-pod       0/1     ImagePullBackOff   0          5m

# Get detailed error message
kubectl describe pod my-pod | grep -A 10 Events

# Common messages:
# "Failed to pull image": Can't download image
# "unauthorized": Authentication failed
# "not found": Image doesn't exist
# "manifest unknown": Tag doesn't exist
```

## Common Causes and Fixes

### 1. Image Not Found

```bash
# Error: "rpc error: pull access denied" or "not found"

# Verify image exists
docker pull myregistry.io/myapp:v1

# Check image name and tag
# Wrong: myapp:latest (if latest doesn't exist)
# Right: myapp:v1.2.3

# Common mistakes:
# - Typo in image name
# - Wrong registry URL
# - Tag doesn't exist
# - Using 'latest' when not published
```

### 2. Authentication Required

```bash
# Error: "unauthorized: authentication required"

# Create registry secret
kubectl create secret docker-registry regcred \
  --docker-server=myregistry.io \
  --docker-username=myuser \
  --docker-password=mypass \
  --docker-email=user@example.com

# Use in pod
```

```yaml
# pod-with-secret.yaml
apiVersion: v1
kind: Pod
metadata:
  name: my-pod
spec:
  containers:
    - name: app
      image: myregistry.io/myapp:v1
  imagePullSecrets:
    - name: regcred
```

### 3. Add Secret to ServiceAccount

```bash
# Add to default service account for all pods
kubectl patch serviceaccount default \
  -p '{"imagePullSecrets": [{"name": "regcred"}]}'

# Verify
kubectl get serviceaccount default -o yaml
```

### 4. Network/Firewall Issues

```bash
# Error: "i/o timeout" or "connection refused"

# Test connectivity from node
kubectl run test --rm -it --image=busybox -- \
  wget -qO- https://myregistry.io/v2/

# Check if registry is accessible
kubectl run test --rm -it --image=curlimages/curl -- \
  curl -v https://myregistry.io/v2/

# DNS issues
kubectl run test --rm -it --image=busybox -- \
  nslookup myregistry.io
```

### 5. Private Registry with Self-Signed Cert

```bash
# Error: "x509: certificate signed by unknown authority"

# Option 1: Add CA to nodes
# Copy CA cert to /etc/docker/certs.d/myregistry.io/ca.crt

# Option 2: Configure containerd
# /etc/containerd/config.toml
[plugins."io.containerd.grpc.v1.cri".registry.configs."myregistry.io".tls]
  ca_file = "/etc/containerd/certs.d/myregistry.io/ca.crt"

# Option 3: Skip TLS verification (not recommended for production)
[plugins."io.containerd.grpc.v1.cri".registry.configs."myregistry.io".tls]
  insecure_skip_verify = true
```

## AWS ECR Authentication

```bash
# ECR tokens expire every 12 hours

# Get token and create secret
aws ecr get-login-password --region us-east-1 | \
  kubectl create secret docker-registry ecr-secret \
    --docker-server=123456789.dkr.ecr.us-east-1.amazonaws.com \
    --docker-username=AWS \
    --docker-password-stdin

# Better: Use IAM roles for service accounts (IRSA)
# No secret management needed
```

## GCR/Artifact Registry Authentication

```bash
# Create secret from service account key
kubectl create secret docker-registry gcr-secret \
  --docker-server=gcr.io \
  --docker-username=_json_key \
  --docker-password="$(cat service-account.json)"

# Better: Use Workload Identity
# Automatic authentication with GKE
```

## Azure ACR Authentication

```bash
# Option 1: Service principal
kubectl create secret docker-registry acr-secret \
  --docker-server=myregistry.azurecr.io \
  --docker-username=<client-id> \
  --docker-password=<client-secret>

# Option 2: Attach ACR to AKS (recommended)
az aks update -n myAKS -g myResourceGroup --attach-acr myregistry
```

## Debug Image Pull

```bash
# Manually try to pull on node
# SSH to node, then:
crictl pull myregistry.io/myapp:v1

# Check pull progress
crictl images | grep myapp

# View detailed error
journalctl -u containerd | tail -50

# Test with docker (if available)
docker login myregistry.io
docker pull myregistry.io/myapp:v1
```

## Verify Secret Configuration

```bash
# Check secret exists
kubectl get secrets | grep regcred

# Decode and verify credentials
kubectl get secret regcred -o jsonpath='{.data.\.dockerconfigjson}' | base64 -d | jq .

# Output should show:
# {
#   "auths": {
#     "myregistry.io": {
#       "username": "user",
#       "password": "pass",
#       "auth": "base64-encoded"
#     }
#   }
# }
```

## Image Pull Policy

```yaml
# Control when images are pulled
apiVersion: v1
kind: Pod
metadata:
  name: my-pod
spec:
  containers:
    - name: app
      image: myapp:v1
      imagePullPolicy: Always  # Always pull (for :latest)
      # imagePullPolicy: IfNotPresent  # Only if not cached
      # imagePullPolicy: Never  # Use local image only
```

## Pre-Pull Images

```yaml
# DaemonSet to pre-pull images on all nodes
apiVersion: apps/v1
kind: DaemonSet
metadata:
  name: image-prepuller
spec:
  selector:
    matchLabels:
      app: prepuller
  template:
    metadata:
      labels:
        app: prepuller
    spec:
      initContainers:
        - name: prepull
          image: myregistry.io/myapp:v1
          command: ["sh", "-c", "echo Image pulled"]
      containers:
        - name: pause
          image: registry.k8s.io/pause:3.9
      imagePullSecrets:
        - name: regcred
```

## Rate Limiting (Docker Hub)

```bash
# Error: "toomanyrequests: Rate limit exceeded"

# Docker Hub limits:
# Anonymous: 100 pulls/6 hours
# Authenticated: 200 pulls/6 hours
# Paid: Higher limits

# Solution 1: Authenticate
kubectl create secret docker-registry dockerhub \
  --docker-server=docker.io \
  --docker-username=myuser \
  --docker-password=mytoken

# Solution 2: Use image mirror/proxy
# Configure containerd to use mirror

# Solution 3: Use different registry
# gcr.io, quay.io, GitHub Container Registry
```

## Summary

ImagePullBackOff usually means authentication failure, network issues, or image not found. Check `kubectl describe pod` for the specific error message. Create docker-registry secrets for private registries and reference them in imagePullSecrets. For cloud registries (ECR, GCR, ACR), use IAM integration when possible. Verify network connectivity and DNS resolution from nodes. Handle Docker Hub rate limits by authenticating or using alternative registries. Test image pulls manually with crictl on nodes for detailed errors.

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
