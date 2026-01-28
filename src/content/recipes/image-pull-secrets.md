---
title: "How to Configure Image Pull Secrets"
description: "Pull container images from private registries using image pull secrets. Configure authentication for Docker Hub, GCR, ECR, ACR, and private registries."
category: "configuration"
difficulty: "beginner"
publishDate: "2026-01-22"
tags: ["image-pull-secrets", "registries", "docker", "authentication", "containers"]
---

# How to Configure Image Pull Secrets

Image pull secrets authenticate Kubernetes with private container registries. They're required to pull images from Docker Hub private repos, cloud provider registries, or self-hosted registries.

## Create Docker Registry Secret

```bash
# Generic method for any registry
kubectl create secret docker-registry my-registry-secret \
  --docker-server=registry.example.com \
  --docker-username=myuser \
  --docker-password=mypassword \
  --docker-email=user@example.com

# For Docker Hub
kubectl create secret docker-registry dockerhub-secret \
  --docker-server=https://index.docker.io/v1/ \
  --docker-username=dockerhub-user \
  --docker-password=dockerhub-token \
  --docker-email=user@example.com
```

## Use Secret in Pod

```yaml
# pod-with-secret.yaml
apiVersion: v1
kind: Pod
metadata:
  name: private-app
spec:
  containers:
    - name: app
      image: registry.example.com/myapp:v1
  imagePullSecrets:
    - name: my-registry-secret
```

## Create Secret from Docker Config

```bash
# If you have existing docker credentials
kubectl create secret generic my-registry-secret \
  --from-file=.dockerconfigjson=$HOME/.docker/config.json \
  --type=kubernetes.io/dockerconfigjson
```

## Secret YAML Format

```yaml
# registry-secret.yaml
apiVersion: v1
kind: Secret
metadata:
  name: my-registry-secret
type: kubernetes.io/dockerconfigjson
data:
  .dockerconfigjson: eyJhdXRocyI6eyJyZWdpc3RyeS5leGFtcGxlLmNvbSI6eyJ1c2VybmFtZSI6Im15dXNlciIsInBhc3N3b3JkIjoibXlwYXNzd29yZCIsImVtYWlsIjoidXNlckBleGFtcGxlLmNvbSIsImF1dGgiOiJiWGwxYzJWeU9tMTVjR0Z6YzNkdmNtUT0ifX19
```

```bash
# Generate the base64 encoded value
echo -n '{"auths":{"registry.example.com":{"username":"myuser","password":"mypassword","email":"user@example.com","auth":"bXl1c2VyOm15cGFzc3dvcmQ="}}}' | base64
```

## AWS ECR (Elastic Container Registry)

```bash
# Get ECR password (valid for 12 hours)
AWS_ACCOUNT=123456789012
AWS_REGION=us-east-1

aws ecr get-login-password --region $AWS_REGION | \
kubectl create secret docker-registry ecr-secret \
  --docker-server=$AWS_ACCOUNT.dkr.ecr.$AWS_REGION.amazonaws.com \
  --docker-username=AWS \
  --docker-password-stdin

# Use in pod
# image: 123456789012.dkr.ecr.us-east-1.amazonaws.com/myapp:v1
```

### ECR Credential Refresher

```yaml
# ecr-cred-refresher.yaml
apiVersion: batch/v1
kind: CronJob
metadata:
  name: ecr-cred-refresher
spec:
  schedule: "0 */6 * * *"  # Every 6 hours
  jobTemplate:
    spec:
      template:
        spec:
          serviceAccountName: ecr-refresher
          containers:
            - name: refresher
              image: amazon/aws-cli:latest
              command:
                - /bin/sh
                - -c
                - |
                  aws ecr get-login-password --region $AWS_REGION | \
                  kubectl create secret docker-registry ecr-secret \
                    --docker-server=$AWS_ACCOUNT.dkr.ecr.$AWS_REGION.amazonaws.com \
                    --docker-username=AWS \
                    --docker-password-stdin \
                    --dry-run=client -o yaml | kubectl apply -f -
              env:
                - name: AWS_REGION
                  value: "us-east-1"
                - name: AWS_ACCOUNT
                  value: "123456789012"
          restartPolicy: OnFailure
```

## Google Container Registry (GCR) / Artifact Registry

```bash
# Using service account key
kubectl create secret docker-registry gcr-secret \
  --docker-server=gcr.io \
  --docker-username=_json_key \
  --docker-password="$(cat service-account-key.json)" \
  --docker-email=sa@project.iam.gserviceaccount.com

# For Artifact Registry
kubectl create secret docker-registry artifact-secret \
  --docker-server=us-docker.pkg.dev \
  --docker-username=_json_key \
  --docker-password="$(cat service-account-key.json)"
```

## Azure Container Registry (ACR)

```bash
# Using service principal
kubectl create secret docker-registry acr-secret \
  --docker-server=myregistry.azurecr.io \
  --docker-username=<service-principal-id> \
  --docker-password=<service-principal-password>

# Using admin credentials (not recommended for production)
kubectl create secret docker-registry acr-secret \
  --docker-server=myregistry.azurecr.io \
  --docker-username=myregistry \
  --docker-password=$(az acr credential show -n myregistry --query "passwords[0].value" -o tsv)
```

## GitHub Container Registry (GHCR)

```bash
# Using Personal Access Token
kubectl create secret docker-registry ghcr-secret \
  --docker-server=ghcr.io \
  --docker-username=github-username \
  --docker-password=ghp_xxxxxxxxxxxx
```

## Multiple Registries

```yaml
# multi-registry-secret.yaml
apiVersion: v1
kind: Secret
metadata:
  name: multi-registry-secret
type: kubernetes.io/dockerconfigjson
stringData:
  .dockerconfigjson: |
    {
      "auths": {
        "https://index.docker.io/v1/": {
          "username": "dockerhub-user",
          "password": "dockerhub-token",
          "auth": "ZG9ja2VyaHViLXVzZXI6ZG9ja2VyaHViLXRva2Vu"
        },
        "ghcr.io": {
          "username": "github-user",
          "password": "ghp_token",
          "auth": "Z2l0aHViLXVzZXI6Z2hwX3Rva2Vu"
        },
        "registry.example.com": {
          "username": "myuser",
          "password": "mypassword",
          "auth": "bXl1c2VyOm15cGFzc3dvcmQ="
        }
      }
    }
```

## Attach Secret to Service Account

```yaml
# service-account-with-secret.yaml
apiVersion: v1
kind: ServiceAccount
metadata:
  name: my-app-sa
imagePullSecrets:
  - name: my-registry-secret
```

```bash
# Patch existing service account
kubectl patch serviceaccount default -p '{"imagePullSecrets": [{"name": "my-registry-secret"}]}'

# All pods using this service account automatically use the secret
```

## Default for All Pods in Namespace

```bash
# Add to default service account (applies to all pods without explicit SA)
kubectl patch serviceaccount default -n production \
  -p '{"imagePullSecrets": [{"name": "my-registry-secret"}]}'
```

## Multiple Image Pull Secrets

```yaml
# pod-multiple-secrets.yaml
apiVersion: v1
kind: Pod
metadata:
  name: multi-registry-app
spec:
  containers:
    - name: app
      image: ghcr.io/myorg/myapp:v1
    - name: sidecar
      image: myregistry.azurecr.io/sidecar:v1
  imagePullSecrets:
    - name: ghcr-secret
    - name: acr-secret
```

## Deployment with Image Pull Secret

```yaml
# deployment-with-secret.yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: my-app
spec:
  replicas: 3
  selector:
    matchLabels:
      app: my-app
  template:
    metadata:
      labels:
        app: my-app
    spec:
      imagePullSecrets:
        - name: my-registry-secret
      containers:
        - name: app
          image: registry.example.com/myapp:v1.2.3
          ports:
            - containerPort: 8080
```

## Verify Secret

```bash
# Check secret exists
kubectl get secret my-registry-secret

# View secret (encoded)
kubectl get secret my-registry-secret -o yaml

# Decode and view credentials
kubectl get secret my-registry-secret -o jsonpath='{.data.\.dockerconfigjson}' | base64 -d | jq

# Test authentication
kubectl run test --image=registry.example.com/myapp:v1 --dry-run=client
```

## Troubleshooting

```bash
# Check pod events for image pull errors
kubectl describe pod my-pod

# Common errors:
# - ErrImagePull: Can't pull image
# - ImagePullBackOff: Pull failed, backing off
# - unauthorized: authentication required

# Verify secret is correct
kubectl get secret my-registry-secret -o jsonpath='{.data.\.dockerconfigjson}' | base64 -d

# Test from inside cluster
kubectl run tmp --image=busybox --rm -it -- sh
# Inside pod: wget or curl to registry

# Check service account
kubectl get sa default -o yaml | grep imagePullSecrets
```

## Copy Secret to Another Namespace

```bash
# Export and import
kubectl get secret my-registry-secret -o yaml | \
  sed 's/namespace: default/namespace: production/' | \
  kubectl apply -f -

# Or use kubectl copy
kubectl get secret my-registry-secret -n default -o yaml | \
  kubectl apply -n production -f -
```

## Sealed Secrets for GitOps

```yaml
# sealed-secret.yaml (encrypted, safe for Git)
apiVersion: bitnami.com/v1alpha1
kind: SealedSecret
metadata:
  name: my-registry-secret
  namespace: default
spec:
  encryptedData:
    .dockerconfigjson: AgBY7...encrypted...data
  template:
    type: kubernetes.io/dockerconfigjson
```

## Summary

Image pull secrets authenticate with private container registries. Create them using `kubectl create secret docker-registry` or from existing Docker configs. Attach secrets to pods directly or to service accounts for automatic use. For cloud registries like ECR, implement credential refresh mechanisms since tokens expire. Always verify authentication works before deploying applications.

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
