---
title: "Fix ImagePullBackOff in Kubernetes"
description: "Troubleshoot Kubernetes ImagePullBackOff and ErrImagePull errors. Private registry auth, image pull secrets, tag verification, and network connectivity fixes."
publishDate: "2026-05-02"
author: "Luca Berton"
category: "troubleshooting"
difficulty: "beginner"
timeToComplete: "8 minutes"
kubernetesVersion: "1.28+"
tags:
  - "troubleshooting"
  - "image-pull"
  - "containers"
  - "registry"
  - "cka"
relatedRecipes:
  - "debug-crashloopbackoff"
  - "image-pull-secrets"
  - "kubernetes-serviceaccount-guide"
  - "containerd-certs-d-registry-ca-trust"
  - "kubernetes-createcontainererror-troubleshoot"
---

> 💡 **Quick Answer:** ImagePullBackOff means Kubernetes can't pull your container image. Check: 1) Image name/tag correct? `kubectl describe pod <name>` shows the exact error. 2) Private registry? Create an imagePullSecret: `kubectl create secret docker-registry regcred --docker-server=registry.example.com --docker-username=user --docker-password=pass`. 3) Network issue? Test from node: `crictl pull <image>`.

## The Problem

Pod stuck in ImagePullBackOff or ErrImagePull:

```bash
kubectl get pods
# NAME        READY   STATUS             RESTARTS   AGE
# my-app      0/1     ImagePullBackOff   0          5m
# my-app-2    0/1     ErrImagePull       0          1m
```

## The Solution

### Step 1: Get the Exact Error

```bash
kubectl describe pod my-app | tail -20
# Events:
#   Warning  Failed   pull image "myapp:v2": rpc error: ...
#   Warning  Failed   Error: ImagePullBackOff

# Common errors:
# "manifest unknown"          → Image tag doesn't exist
# "unauthorized"              → Missing or wrong credentials
# "no such host"              → Registry hostname wrong
# "connection refused"        → Registry not reachable
# "x509: certificate signed by unknown authority" → Self-signed CA
```

### Step 2: Verify Image Exists

```bash
# Check if image exists (from your machine)
docker pull myregistry.example.com/myapp:v2
# or
crane manifest myregistry.example.com/myapp:v2

# Common typos:
# myapp:latst  (typo in "latest")
# myapp:v2     (tag is "2.0" not "v2")
# docker.io/myapp:v2 (should be docker.io/library/myapp:v2)
```

### Step 3: Fix Authentication

```bash
# Create image pull secret
kubectl create secret docker-registry regcred \
  --docker-server=registry.example.com \
  --docker-username=myuser \
  --docker-password=mypass \
  --docker-email=user@example.com \
  -n my-namespace

# Use in pod spec
# spec:
#   imagePullSecrets:
#   - name: regcred

# Or attach to ServiceAccount (applies to all pods using it)
kubectl patch serviceaccount default -n my-namespace \
  -p '{"imagePullSecrets": [{"name": "regcred"}]}'
```

```yaml
# Pod with imagePullSecrets
apiVersion: v1
kind: Pod
metadata:
  name: my-app
spec:
  imagePullSecrets:
  - name: regcred
  containers:
  - name: app
    image: registry.example.com/myapp:v2
```

### Step 4: Fix Network/TLS Issues

```bash
# Test from the node (SSH into worker)
crictl pull registry.example.com/myapp:v2

# For self-signed certificates, configure containerd:
# /etc/containerd/certs.d/registry.example.com/hosts.toml
# [host."https://registry.example.com"]
#   ca = "/etc/containerd/certs.d/registry.example.com/ca.crt"

# Or skip TLS verification (dev only!)
# [host."https://registry.example.com"]
#   skip_verify = true
```

### Step 5: Image Pull Policy

```yaml
# Always pull (even if cached)
containers:
- name: app
  image: myapp:v2
  imagePullPolicy: Always

# Never pull (use cached only)
  imagePullPolicy: Never

# Default behavior:
# - :latest tag → Always
# - specific tag (:v2) → IfNotPresent
# - digest (@sha256:...) → IfNotPresent
```

### Quick Diagnostic Checklist

```bash
# 1. What's the exact error?
kubectl describe pod my-app | grep -A5 "Events"

# 2. Is the image name correct?
kubectl get pod my-app -o jsonpath='{.spec.containers[0].image}'

# 3. Are pull secrets configured?
kubectl get pod my-app -o jsonpath='{.spec.imagePullSecrets}'

# 4. Does the secret exist and have correct data?
kubectl get secret regcred -o jsonpath='{.data.\.dockerconfigjson}' | base64 -d

# 5. Can the node reach the registry?
kubectl debug node/worker-1 -it --image=busybox -- wget -qO- https://registry.example.com/v2/

# 6. Node-level pull test
# SSH to node, then:
crictl pull registry.example.com/myapp:v2
```

## Common Issues

**"unauthorized: authentication required"**

Wrong or missing credentials. Verify secret: `kubectl get secret regcred -o yaml`. Recreate if needed.

**"manifest unknown: manifest unknown"**

Image tag doesn't exist. Check available tags in the registry. Common: using `v2` when tag is `2.0`.

**"dial tcp: lookup registry.example.com: no such host"**

DNS can't resolve the registry. Check node DNS configuration and network policies.

**Works locally but not in cluster**

Different network path. Cluster nodes may not have internet access, or may need proxy configuration.

## Best Practices

- **Use specific image tags** — not `:latest` (unpredictable, no rollback)
- **Attach imagePullSecrets to ServiceAccount** — applies to all pods automatically
- **Use image digests for production** — `@sha256:abc123` is immutable
- **Pre-pull images** on nodes for critical workloads — DaemonSet with `initContainers`
- **Monitor image pull failures** — alert on repeated ImagePullBackOff

## Key Takeaways

- ImagePullBackOff = can't download the container image
- `kubectl describe pod` shows the exact error (auth, network, tag not found)
- Create imagePullSecrets for private registries
- Verify image exists and tag is correct before debugging further
- BackOff means Kubernetes is retrying with exponential delay
