---
title: "Harbor: Private Container Registry on K8s"
description: "Deploy Harbor container registry in Kubernetes for private image hosting. Vulnerability scanning, image replication, RBAC, Helm chart repository, and OCI artifact storage."
publishDate: "2026-05-02"
author: "Luca Berton"
category: "security"
difficulty: "intermediate"
timeToComplete: "12 minutes"
kubernetesVersion: "1.28+"
tags:
  - "harbor"
  - "registry"
  - "security"
  - "container-images"
  - "vulnerability-scanning"
relatedRecipes:
  - "kubernetes-imagepullbackoff-troubleshoot"
  - "kubernetes-secret-types-guide"
---

> 💡 **Quick Answer:** Harbor is the CNCF container registry with vulnerability scanning, RBAC, and replication. Install: `helm install harbor harbor/harbor -n harbor --create-namespace --set expose.type=ingress --set expose.ingress.hosts.core=registry.example.com --set externalURL=https://registry.example.com`. Push images: `docker tag myapp registry.example.com/myproject/myapp:v1 && docker push`. Harbor auto-scans for CVEs on push.

## The Problem

Public registries have limitations:

- Rate limits (Docker Hub: 100 pulls/6h for anonymous)
- No control over vulnerability scanning policies
- Sensitive images shouldn't leave your network
- No fine-grained RBAC for teams
- No replication between regions/clusters

## The Solution

### Install Harbor

```bash
helm repo add harbor https://helm.goharbor.io
helm install harbor harbor/harbor \
  -n harbor --create-namespace \
  --set expose.type=ingress \
  --set expose.ingress.hosts.core=registry.example.com \
  --set expose.ingress.className=nginx \
  --set externalURL=https://registry.example.com \
  --set persistence.persistentVolumeClaim.registry.size=100Gi \
  --set persistence.persistentVolumeClaim.database.size=5Gi \
  --set harborAdminPassword=StrongPassword123

# Access UI: https://registry.example.com
# Login: admin / StrongPassword123

# Verify pods
kubectl get pods -n harbor
# harbor-core-xxx           Running
# harbor-database-xxx       Running
# harbor-jobservice-xxx     Running
# harbor-portal-xxx         Running
# harbor-redis-xxx          Running
# harbor-registry-xxx       Running
# harbor-trivy-xxx          Running  ← vulnerability scanner
```

### Push and Pull Images

```bash
# Login to Harbor
docker login registry.example.com -u admin

# Create a project in Harbor UI first (e.g., "myproject")

# Tag and push
docker tag myapp:latest registry.example.com/myproject/myapp:v1
docker push registry.example.com/myproject/myapp:v1

# Pull
docker pull registry.example.com/myproject/myapp:v1

# Use in Kubernetes
kubectl create secret docker-registry harbor-creds \
  --docker-server=registry.example.com \
  --docker-username=admin \
  --docker-password=StrongPassword123

# Reference in pod
# imagePullSecrets:
# - name: harbor-creds
```

### Vulnerability Scanning

```bash
# Auto-scan on push (enable in project settings)
# Harbor UI → Projects → myproject → Configuration
# ✅ Automatically scan images on push
# ✅ Prevent vulnerable images from running (severity: Critical)

# Manual scan via API
curl -X POST "https://registry.example.com/api/v2.0/projects/myproject/repositories/myapp/artifacts/v1/scan" \
  -H "Authorization: Basic $(echo -n admin:password | base64)"

# View scan results
curl "https://registry.example.com/api/v2.0/projects/myproject/repositories/myapp/artifacts/v1/additions/vulnerabilities" \
  -H "Authorization: Basic $(echo -n admin:password | base64)"
```

### Image Replication

```yaml
# Harbor UI → Registries → New Endpoint
# Name: docker-hub
# Provider: Docker Hub
# Endpoint URL: https://hub.docker.com

# Replication Rule (pull from Docker Hub):
# Name: cache-nginx
# Source: docker-hub / library/nginx
# Destination: myproject
# Trigger: Scheduled (daily)

# Replication Rule (push to DR site):
# Name: replicate-to-dr
# Source: myproject/*
# Destination: dr-harbor
# Trigger: Event-based (on push)
```

### RBAC and Projects

```bash
# Project roles:
# - Project Admin: full control
# - Maintainer: push/pull, scan, manage tags
# - Developer: push/pull
# - Guest: pull only

# Create robot account for CI/CD
# Harbor UI → Projects → myproject → Robot Accounts → New
# Name: ci-pipeline
# Permissions: Push/Pull repository
# Expiration: 365 days
# → Returns token for docker login

docker login registry.example.com \
  -u 'robot$myproject+ci-pipeline' \
  -p '<robot-token>'
```

### Helm Chart Repository

```bash
# Harbor serves as Helm chart repository too

# Push Helm chart
helm package mychart/
helm push mychart-1.0.0.tgz oci://registry.example.com/myproject

# Add as Helm repo
helm repo add myproject https://registry.example.com/chartrepo/myproject \
  --username admin --password StrongPassword123
helm search repo myproject/
helm install myrelease myproject/mychart
```

### Garbage Collection

```bash
# Schedule GC in Harbor UI → Administration → Garbage Collection
# Or trigger via API
curl -X POST "https://registry.example.com/api/v2.0/system/gc/schedule" \
  -H "Content-Type: application/json" \
  -H "Authorization: Basic $(echo -n admin:password | base64)" \
  -d '{"schedule":{"type":"Daily","cron":"0 0 2 * * *"}}'

# Tag retention policy
# Harbor UI → Projects → myproject → Tag Retention
# Keep: most recent 10 tags per repository
# OR: tags pushed within last 30 days
```

## Common Issues

**ImagePullBackOff with Harbor**

Self-signed cert not trusted. Add CA to containerd/docker config, or use `insecure-registries` for testing.

**Scan results empty**

Trivy database not downloaded yet. Check: `kubectl logs harbor-trivy-xxx -n harbor`. First scan takes time.

**Storage full**

Run garbage collection. Old layers from deleted tags aren't removed until GC runs.

## Best Practices

- **Auto-scan on push** with severity gate — block Critical/High CVEs from deploying
- **Robot accounts for CI/CD** — never use admin credentials in pipelines
- **Replication for HA** — replicate to a second Harbor for disaster recovery
- **Tag retention policies** — auto-cleanup old tags to save storage
- **Proxy cache** — cache Docker Hub pulls to avoid rate limits

## Key Takeaways

- Harbor is the CNCF private registry with built-in vulnerability scanning (Trivy)
- RBAC at project level — Admin, Maintainer, Developer, Guest roles
- Image replication for DR and multi-region deployments
- Serves as Helm chart OCI repository too
- Vulnerability gates prevent deploying images with critical CVEs
