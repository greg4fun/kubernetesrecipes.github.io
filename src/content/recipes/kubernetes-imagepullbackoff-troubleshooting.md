---
title: "Kubernetes ImagePullBackOff Troubleshooting Guide"
description: "Debug and fix ImagePullBackOff and ErrImagePull errors in Kubernetes. Resolve authentication failures, registry connectivity, image not found, TLS certificate errors, and rate limiting issues."
tags:
  - "imagepullbackoff"
  - "troubleshooting"
  - "container-registry"
  - "authentication"
  - "errimagepull"
category: "troubleshooting"
publishDate: "2026-06-01"
author: "Luca Berton"
difficulty: "beginner"
relatedRecipes:
  - "kubernetes-private-container-registry"
  - "kubernetes-image-pull-secrets"
  - "container-image-security-scanning-kubernetes"
---

> 💡 **Quick Answer:** `ImagePullBackOff` means Kubernetes tried and failed to pull a container image. Check: 1) Image name/tag exists, 2) `imagePullSecrets` configured for private registries, 3) Registry is reachable from nodes, 4) No TLS certificate errors, 5) Not rate-limited (Docker Hub: 100 pulls/6h anonymous). Use `kubectl describe pod` to see the exact pull error message.

## The Problem

- Pod stuck in `ImagePullBackOff` or `ErrImagePull` status
- Error messages are cryptic and buried in pod events
- Multiple possible causes: auth, network, DNS, TLS, rate limits, wrong tag
- Exponential backoff means long waits between retry attempts
- Different nodes may have different pull capabilities

## The Solution

### Diagnose the Error

```bash
# Get the exact error message
kubectl describe pod <pod-name> -n <namespace>
# Look in Events section:
# Warning  Failed   pull image "registry.example.com/app:v1"
#   Error: ...specific error here...

# Quick check pod status
kubectl get pod <pod-name> -n <namespace> -o jsonpath='{.status.containerStatuses[0].state.waiting}'
```

### Common Error Messages and Fixes

#### "unauthorized: authentication required"

```bash
# Cause: Missing or invalid imagePullSecrets
# Fix: Create and attach pull secret

kubectl create secret docker-registry regcred \
  --docker-server=registry.example.com \
  --docker-username=myuser \
  --docker-password=mypassword \
  --docker-email=user@example.com \
  -n <namespace>
```

```yaml
# Attach to pod spec
spec:
  imagePullSecrets:
    - name: regcred
  containers:
    - name: app
      image: registry.example.com/app:v1
```

```yaml
# Or attach to ServiceAccount (applies to all pods)
apiVersion: v1
kind: ServiceAccount
metadata:
  name: default
  namespace: my-namespace
imagePullSecrets:
  - name: regcred
```

#### "manifest unknown" / "not found"

```bash
# Cause: Image or tag doesn't exist
# Fix: Verify image exists

# Check if image exists
docker manifest inspect registry.example.com/app:v1
# or
crane manifest registry.example.com/app:v1

# Common mistakes:
# - Typo in image name
# - Tag deleted or never pushed
# - Wrong registry URL
# - Using :latest but no latest tag exists
```

#### "x509: certificate signed by unknown authority"

```bash
# Cause: Private registry uses self-signed or internal CA certificate
# Fix: Add CA cert to containerd/CRI-O trusted certs

# For containerd (most common):
# Create /etc/containerd/certs.d/<registry>/hosts.toml on each node
mkdir -p /etc/containerd/certs.d/registry.example.com

cat > /etc/containerd/certs.d/registry.example.com/hosts.toml << 'EOF'
server = "https://registry.example.com"

[host."https://registry.example.com"]
  ca = "/etc/containerd/certs.d/registry.example.com/ca.crt"
EOF

# Copy CA certificate to node
cp ca.crt /etc/containerd/certs.d/registry.example.com/ca.crt

# Restart containerd
systemctl restart containerd
```

#### "toomanyrequests: You have reached your pull rate limit"

```bash
# Cause: Docker Hub rate limiting
# Anonymous: 100 pulls/6 hours per IP
# Authenticated: 200 pulls/6 hours
# Pro/Team: unlimited

# Fix: Add Docker Hub credentials
kubectl create secret docker-registry dockerhub-cred \
  --docker-server=https://index.docker.io/v1/ \
  --docker-username=myuser \
  --docker-password=mytoken \
  -n <namespace>

# Or use a registry mirror/proxy cache
```

#### "dial tcp: lookup registry.example.com: no such host"

```bash
# Cause: DNS resolution failure
# Fix: Check CoreDNS, check node DNS config

# Test from node:
nslookup registry.example.com
# Test from pod:
kubectl run dns-test --rm -it --image=busybox -- nslookup registry.example.com
```

#### "dial tcp <ip>:443: connect: connection refused/timeout"

```bash
# Cause: Network connectivity — firewall, proxy, or registry down
# Fix: Check network path from node to registry

# Test from node:
curl -v https://registry.example.com/v2/
# Check if proxy is needed:
# Set HTTP_PROXY/HTTPS_PROXY in containerd config
```

### Verify Pull Secret Works

```bash
# Test pull manually on a node
crictl pull --creds "user:pass" registry.example.com/app:v1

# Decode and verify secret contents
kubectl get secret regcred -n <namespace> -o jsonpath='{.data.\.dockerconfigjson}' | base64 -d | jq .

# Expected format:
# {
#   "auths": {
#     "registry.example.com": {
#       "username": "...",
#       "password": "...",
#       "auth": "base64(user:pass)"
#     }
#   }
# }
```

### Force Re-Pull

```bash
# Delete pod to reset backoff timer
kubectl delete pod <pod-name> -n <namespace>

# Or set imagePullPolicy to Always
spec:
  containers:
    - name: app
      image: registry.example.com/app:v1
      imagePullPolicy: Always    # Always pull, never use cached
```

## Common Issues

### ImagePullBackOff only on some nodes
- **Cause**: Pull secret cached on some nodes; or node-level credentials differ
- **Fix**: Ensure all nodes have registry access; check node-level `/etc/containerd/certs.d/`

### Works with `docker pull` but not in Kubernetes
- **Cause**: Docker daemon has credentials; containerd/CRI-O doesn't
- **Fix**: CRI doesn't use `~/.docker/config.json`; must use `imagePullSecrets`

### Secret exists but still "unauthorized"
- **Cause**: Secret in wrong namespace; or secret data incorrect
- **Fix**: Secrets are namespaced — create in same namespace as pod; verify with base64 decode

## Best Practices

1. **Always use imagePullSecrets for private registries** — attach to ServiceAccount for convenience
2. **Use specific tags, not `:latest`** — avoids "not found" when latest is untagged
3. **Set `imagePullPolicy: IfNotPresent`** — reduces registry load and speeds up restarts
4. **Deploy registry mirrors** — cache images closer to nodes; avoid rate limits
5. **Monitor pull errors** — alert on ImagePullBackOff events cluster-wide
6. **Pre-pull large images** — DaemonSet with initContainer pulls images to all nodes

## Key Takeaways

- `ImagePullBackOff` = Kubernetes failed to pull the image and is backing off retries
- `kubectl describe pod` shows the exact error in the Events section
- Most common causes: wrong image name, missing auth, TLS errors, rate limits
- `imagePullSecrets` must be in the same namespace as the pod
- Docker Hub rate limits: 100 anonymous / 200 authenticated pulls per 6 hours per IP
- Self-signed registries need CA certs configured at the CRI level (containerd/CRI-O)
- `imagePullPolicy: Always` forces fresh pulls but increases registry load
