---
title: "Build a Custom OpenClaw Docker Image for K8s"
description: "Create an optimized Docker image for OpenClaw with pre-installed dependencies, custom skills, and workspace files for faster Kubernetes deployments."
category: "deployments"
difficulty: "beginner"
timeToComplete: "15 minutes"
kubernetesVersion: "1.28+"
prerequisites:
  - "Docker or Podman installed"
  - "A container registry (Docker Hub, GHCR, ECR)"
relatedRecipes:
  - "openclaw-kubernetes-deployment"
  - "openclaw-ha-kubernetes"
  - "container-image-best-practices"
  - "openclaw-signal-kubernetes"
  - "rolling-update-deployment"
tags:
  - openclaw
  - docker
  - container-image
  - optimization
  - ci-cd
  - deployment
publishDate: "2026-02-26"
author: "Luca Berton"
---

> 💡 **Quick Answer:** Build a custom image with OpenClaw pre-installed to eliminate the `npm install` step on every pod start. This reduces cold start from ~60s to ~5s.
>
> ```dockerfile
> FROM node:22-slim
> RUN npm install -g openclaw@latest
> ENTRYPOINT ["openclaw", "gateway"]
> ```
>
> **Key concept:** The base deployment uses `node:22-slim` with `npm install` in the command. A pre-built image skips this entirely.
>
> **Gotcha:** Pin the OpenClaw version in your Dockerfile (`openclaw@1.2.3`) to avoid unexpected upgrades.

## The Problem

- Default deployment runs `npm install -g openclaw@latest` on every pod start
- Cold starts take 30-60 seconds for npm install
- Unpinned versions can introduce breaking changes on restart
- Skills and workspace templates must be manually configured after deployment

## The Solution

Build a custom Docker image with OpenClaw pre-installed, pinned versions, and baked-in workspace templates.

## Dockerfile

```dockerfile
# Dockerfile
FROM node:22-slim

# Install OpenClaw (pin version for reproducibility)
RUN npm install -g openclaw@latest && \
    npm cache clean --force

# Create workspace directory
RUN mkdir -p /home/node/.openclaw/workspace/skills /home/node/.openclaw/workspace/memory

# Copy workspace templates
COPY workspace/SOUL.md /home/node/.openclaw/workspace/SOUL.md
COPY workspace/AGENTS.md /home/node/.openclaw/workspace/AGENTS.md
COPY workspace/USER.md /home/node/.openclaw/workspace/USER.md
COPY workspace/TOOLS.md /home/node/.openclaw/workspace/TOOLS.md

# Copy custom skills (optional)
COPY skills/ /home/node/.openclaw/workspace/skills/

# Set ownership
RUN chown -R node:node /home/node/.openclaw

USER node
WORKDIR /home/node

EXPOSE 18789

ENTRYPOINT ["openclaw"]
CMD ["gateway", "--port", "18789"]
```

## Build and Push

```bash
# Build
docker build -t registry.example.com/openclaw:v1.0.0 .

# Test locally
docker run --rm -p 18789:18789 \
  -e ANTHROPIC_API_KEY=sk-ant-test \
  registry.example.com/openclaw:v1.0.0

# Push
docker push registry.example.com/openclaw:v1.0.0
```

## CI/CD with GitHub Actions

```yaml
# .github/workflows/build-openclaw.yaml
name: Build OpenClaw Image
on:
  push:
    branches: [main]
    paths: ['workspace/**', 'skills/**', 'Dockerfile']
  schedule:
    - cron: '0 6 * * 1'    # Weekly rebuild for updates

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: docker/login-action@v3
        with:
          registry: ghcr.io
          username: ${{ github.actor }}
          password: ${{ secrets.GITHUB_TOKEN }}
      - uses: docker/build-push-action@v5
        with:
          push: true
          tags: |
            ghcr.io/${{ github.repository }}/openclaw:latest
            ghcr.io/${{ github.repository }}/openclaw:${{ github.sha }}
```

## Updated Kubernetes Deployment

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: openclaw-gateway
  namespace: openclaw
spec:
  replicas: 1
  strategy:
    type: Recreate
  selector:
    matchLabels:
      app: openclaw
  template:
    spec:
      containers:
        - name: openclaw
          image: registry.example.com/openclaw:v1.0.0    # Custom image!
          # No more: command: ["sh", "-c", "npm i -g openclaw@latest && ..."]
          ports: [{containerPort: 18789}]
          envFrom:
            - secretRef:
                name: openclaw-secrets
          volumeMounts:
            - name: state
              mountPath: /home/node/.openclaw
          resources:
            requests:
              cpu: 100m
              memory: 256Mi
```

## Common Issues

### Issue 1: Workspace files overwritten by PVC mount

```bash
# PVC mount at /home/node/.openclaw replaces baked-in files
# Solution: use an initContainer to copy defaults if missing
initContainers:
  - name: init-workspace
    image: registry.example.com/openclaw:v1.0.0
    command: ["sh", "-c"]
    args:
      - |
        for f in SOUL.md AGENTS.md USER.md TOOLS.md; do
          [ -f "/state/workspace/$f" ] || cp "/home/node/.openclaw/workspace/$f" "/state/workspace/$f"
        done
    volumeMounts:
      - name: state
        mountPath: /state
```

## Best Practices

1. **Pin OpenClaw version** — `openclaw@1.2.3` not `openclaw@latest`
2. **Use multi-stage builds** — If adding build tools for skills
3. **Weekly rebuilds** — Catch security patches in base image
4. **Init containers** — Copy defaults without overwriting user changes
5. **Image scanning** — Scan with Trivy before deploying

## Key Takeaways

- **Custom images reduce cold start** from 60s to 5s
- **Pin versions** for reproducible deployments
- **Bake workspace templates** into the image for consistent defaults
- **Use init containers** to merge defaults with PVC-persisted state
- **CI/CD pipeline** automates builds on workspace/skill changes
