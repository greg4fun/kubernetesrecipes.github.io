---
title: "How to Debug ImagePullBackOff Errors"
description: "Troubleshoot Kubernetes ImagePullBackOff and ErrImagePull errors. Learn to diagnose registry authentication, image tags, and network connectivity issues."
category: "troubleshooting"
difficulty: "beginner"
publishDate: "2026-01-22"
tags: ["imagepull", "troubleshooting", "registry", "authentication", "debugging"]
---

# How to Debug ImagePullBackOff Errors

ImagePullBackOff occurs when Kubernetes cannot pull a container image. Learn to diagnose authentication issues, missing images, and registry connectivity problems.

## Identify the Problem

```bash
# Check pod status
kubectl get pods

# Output showing ImagePullBackOff:
# NAME        READY   STATUS             RESTARTS   AGE
# myapp-pod   0/1     ImagePullBackOff   0          5m

# Get detailed error
kubectl describe pod myapp-pod
```

Look for events like:
```
Events:
  Type     Reason     Age   Message
  ----     ------     ----  -------
  Normal   Scheduled  1m    Successfully assigned default/myapp-pod to node-1
  Normal   Pulling    1m    Pulling image "registry.example.com/myapp:v1"
  Warning  Failed     1m    Failed to pull image "registry.example.com/myapp:v1": 
                            rpc error: code = Unknown desc = Error response from daemon: 
                            pull access denied for registry.example.com/myapp
  Warning  Failed     1m    Error: ErrImagePull
  Normal   BackOff    30s   Back-off pulling image "registry.example.com/myapp:v1"
  Warning  Failed     30s   Error: ImagePullBackOff
```

## Common Causes and Solutions

### 1. Image Doesn't Exist

```bash
# Verify image exists locally
docker pull myimage:tag

# Check available tags
# For Docker Hub:
curl -s https://hub.docker.com/v2/repositories/library/nginx/tags | jq '.results[].name'

# For private registry:
curl -u user:pass https://registry.example.com/v2/myapp/tags/list
```

Fix: Correct the image name or tag

```yaml
# Wrong
image: myapp:latets  # Typo!

# Correct
image: myapp:latest
```

### 2. Private Registry Authentication

```bash
# Create Docker registry secret
kubectl create secret docker-registry regcred \
  --docker-server=registry.example.com \
  --docker-username=myuser \
  --docker-password=mypassword \
  --docker-email=user@example.com

# Or from existing Docker config
kubectl create secret generic regcred \
  --from-file=.dockerconfigjson=$HOME/.docker/config.json \
  --type=kubernetes.io/dockerconfigjson
```

```yaml
# Use secret in pod
apiVersion: v1
kind: Pod
metadata:
  name: myapp
spec:
  containers:
    - name: myapp
      image: registry.example.com/myapp:v1
  imagePullSecrets:
    - name: regcred
```

### 3. Service Account Image Pull Secret

```yaml
# Attach secret to service account (applies to all pods using it)
apiVersion: v1
kind: ServiceAccount
metadata:
  name: myapp-sa
imagePullSecrets:
  - name: regcred
```

```bash
# Or patch existing service account
kubectl patch serviceaccount default \
  -p '{"imagePullSecrets": [{"name": "regcred"}]}'
```

### 4. Registry Rate Limiting (Docker Hub)

```bash
# Check if rate limited
docker pull nginx 2>&1 | grep -i "rate limit"

# Solution: Authenticate to Docker Hub
kubectl create secret docker-registry dockerhub \
  --docker-server=https://index.docker.io/v1/ \
  --docker-username=myuser \
  --docker-password=mytoken
```

### 5. Network Connectivity Issues

```bash
# Test connectivity from node
kubectl debug node/node-1 -it --image=busybox -- sh

# Inside debug pod
nslookup registry.example.com
wget -O- https://registry.example.com/v2/

# Check if firewall blocking
nc -zv registry.example.com 443
```

### 6. Certificate Issues

```bash
# Check certificate
openssl s_client -connect registry.example.com:443 -showcerts

# For self-signed certs, add CA to nodes or use insecure registry
```

```yaml
# containerd config for insecure registry
# /etc/containerd/config.toml
[plugins."io.containerd.grpc.v1.cri".registry.configs."registry.example.com".tls]
  insecure_skip_verify = true
```

### 7. Image Pull Policy Issues

```yaml
apiVersion: v1
kind: Pod
metadata:
  name: myapp
spec:
  containers:
    - name: myapp
      image: myapp:latest
      # Always pull (good for :latest tag)
      imagePullPolicy: Always
      
      # Use cached if available (good for versioned tags)
      # imagePullPolicy: IfNotPresent
      
      # Never pull (use pre-loaded images)
      # imagePullPolicy: Never
```

## Debug Commands

```bash
# Check events cluster-wide
kubectl get events --field-selector reason=Failed --all-namespaces

# Check specific image pull
kubectl get events --field-selector involvedObject.name=myapp-pod

# Test pull manually on node
crictl pull registry.example.com/myapp:v1

# Check containerd/docker logs
journalctl -u containerd | grep -i "pull\|error"
```

## Verify Secret Configuration

```bash
# Check secret exists
kubectl get secret regcred -o yaml

# Decode and verify credentials
kubectl get secret regcred -o jsonpath='{.data.\.dockerconfigjson}' | base64 -d | jq .

# Expected output:
# {
#   "auths": {
#     "registry.example.com": {
#       "username": "myuser",
#       "password": "mypassword",
#       "auth": "base64encodedcreds"
#     }
#   }
# }
```

## ECR (AWS) Authentication

```bash
# Get ECR login token
aws ecr get-login-password --region us-east-1 | \
  kubectl create secret docker-registry ecr-secret \
    --docker-server=123456789.dkr.ecr.us-east-1.amazonaws.com \
    --docker-username=AWS \
    --docker-password-stdin

# Note: ECR tokens expire after 12 hours
# Use a CronJob or external secrets operator for refresh
```

## GCR (Google) Authentication

```bash
# Using service account key
kubectl create secret docker-registry gcr-secret \
  --docker-server=gcr.io \
  --docker-username=_json_key \
  --docker-password="$(cat key.json)"
```

## ACR (Azure) Authentication

```bash
# Using service principal
kubectl create secret docker-registry acr-secret \
  --docker-server=myregistry.azurecr.io \
  --docker-username=<service-principal-id> \
  --docker-password=<service-principal-password>
```

## Quick Troubleshooting Checklist

```bash
# 1. Get exact error message
kubectl describe pod <pod-name> | grep -A 10 Events

# 2. Verify image name and tag
kubectl get pod <pod-name> -o jsonpath='{.spec.containers[*].image}'

# 3. Check imagePullSecrets configured
kubectl get pod <pod-name> -o jsonpath='{.spec.imagePullSecrets}'

# 4. Verify secret exists and is correct
kubectl get secret <secret-name> -o yaml

# 5. Test registry connectivity
kubectl run test-pull --image=<your-image> --restart=Never
```

## Summary

ImagePullBackOff errors typically stem from authentication issues, missing images, or network problems. Create proper registry secrets, verify image names and tags, and check network connectivity to resolve these issues.

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
