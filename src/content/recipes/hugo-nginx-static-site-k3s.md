---
title: "Hugo nginx Static Site on k3s"
description: "Deploy a Hugo static site with nginx on k3s. Multi-stage build, Brotli compression, security headers, and automated redeployment on git push via Gitea Actions."
category: "deployments"
publishDate: "2026-04-20"
author: "Luca Berton"
difficulty: "beginner"
timeToComplete: "15 minutes"
kubernetesVersion: "1.31+"
tags: ["hugo", "nginx", "static-site", "k3s", "deployment", "brotli"]
relatedRecipes:
  - "debug-crashloopbackoff"
  - gateway-api-httproutes-tls-k3s
  - gitea-actions-runner-quay-push
  - full-gitops-pipeline-k3s
  - kairos-k3s-hetzner-immutable-bootstrap
---

> 💡 **Quick Answer:** Build Hugo sites in CI, serve with nginx in a minimal container (<15MB). Brotli pre-compression + aggressive caching delivers sub-100ms TTFB for static content.

## The Problem

You need a fast, secure static site serving layer that:
- Serves pre-built Hugo output with optimal compression
- Returns proper security headers (CSP, HSTS, X-Frame-Options)
- Handles SPA-style 404 fallbacks for Hugo's pretty URLs
- Rebuilds and redeploys automatically on git push

## The Solution

Multi-stage Docker build (Hugo → nginx:alpine) deployed as a Kubernetes Deployment with resource limits and liveness probes.

### Architecture

```mermaid
graph LR
    A[Hugo Source] -->|git push| B[Gitea Actions]
    B -->|build| C[Hugo CLI]
    C -->|output| D[public/]
    D -->|COPY| E[nginx:alpine Image]
    E -->|push| F[quay.io]
    F -->|deploy| G[k3s Pod]
    G --> H[HTTPRoute]
    H --> I[Users]
```

### Step 1: Dockerfile (Multi-Stage Build)

```dockerfile
# Dockerfile
FROM hugomods/hugo:exts-0.142.0 AS builder
WORKDIR /src
COPY . .
RUN hugo --minify --gc

FROM nginx:1.27-alpine
# Remove default config
RUN rm /etc/nginx/conf.d/default.conf
COPY --from=builder /src/public /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/site.conf

# Pre-compress static assets
RUN apk add --no-cache brotli && \
    find /usr/share/nginx/html -type f \( -name "*.html" -o -name "*.css" -o -name "*.js" -o -name "*.svg" -o -name "*.xml" -o -name "*.json" \) \
    -exec brotli --best {} \; && \
    apk del brotli

EXPOSE 80
```

### Step 2: nginx Configuration

```nginx
# nginx.conf
server {
    listen 80;
    server_name _;
    root /usr/share/nginx/html;
    
    # Security headers
    add_header X-Frame-Options "SAMEORIGIN" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header Referrer-Policy "strict-origin-when-cross-origin" always;
    add_header Permissions-Policy "camera=(), microphone=(), geolocation=()" always;
    
    # Brotli pre-compressed files
    brotli_static on;
    gzip_static on;
    
    # Aggressive caching for assets
    location ~* \.(css|js|woff2|png|jpg|webp|avif|svg|ico)$ {
        expires 1y;
        add_header Cache-Control "public, immutable";
    }
    
    # HTML pages — short cache for fast updates
    location ~* \.html$ {
        expires 1h;
        add_header Cache-Control "public, must-revalidate";
    }
    
    # Hugo pretty URLs — try file, then directory/index.html, then 404
    location / {
        try_files $uri $uri/index.html =404;
    }
    
    # Custom 404 page
    error_page 404 /404.html;
    
    # Health check endpoint
    location /healthz {
        return 200 "ok";
        add_header Content-Type text/plain;
    }
}
```

### Step 3: Kubernetes Deployment

```yaml
# hugo-deployment.yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: hugo-nginx
  namespace: website
spec:
  replicas: 1
  selector:
    matchLabels:
      app: hugo-nginx
  template:
    metadata:
      labels:
        app: hugo-nginx
    spec:
      containers:
        - name: nginx
          image: quay.io/myorg/website:latest
          ports:
            - containerPort: 80
          livenessProbe:
            httpGet:
              path: /healthz
              port: 80
            initialDelaySeconds: 5
            periodSeconds: 30
          readinessProbe:
            httpGet:
              path: /healthz
              port: 80
            initialDelaySeconds: 2
            periodSeconds: 10
          resources:
            requests:
              memory: 16Mi
              cpu: 10m
            limits:
              memory: 64Mi
              cpu: 100m
          securityContext:
            readOnlyRootFilesystem: true
            runAsNonRoot: true
            runAsUser: 101  # nginx user
            allowPrivilegeEscalation: false
          volumeMounts:
            - name: tmp
              mountPath: /tmp
            - name: cache
              mountPath: /var/cache/nginx
            - name: pid
              mountPath: /var/run
      volumes:
        - name: tmp
          emptyDir: {}
        - name: cache
          emptyDir: {}
        - name: pid
          emptyDir: {}
---
apiVersion: v1
kind: Service
metadata:
  name: hugo-nginx
  namespace: website
spec:
  selector:
    app: hugo-nginx
  ports:
    - port: 80
```

### Step 4: Gitea Actions Workflow

```yaml
# .gitea/workflows/deploy.yaml
name: Build and Deploy Hugo Site
on:
  push:
    branches: [main]

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          submodules: recursive
          fetch-depth: 0

      - name: Build and push
        uses: docker/build-push-action@v6
        with:
          push: true
          tags: quay.io/myorg/website:${{ github.sha }},quay.io/myorg/website:latest

      - name: Restart deployment
        run: |
          kubectl set image deployment/hugo-nginx \
            nginx=quay.io/myorg/website:${{ github.sha }} \
            -n website
```

## Common Issues

| Issue | Cause | Fix |
|-------|-------|-----|
| 403 Forbidden | Root filesystem read-only | Mount tmpdir volumes for nginx |
| Brotli not working | Module not loaded | Use `nginx:alpine` with brotli_static (pre-compressed) |
| Pod OOMKilled | Memory limit too low | 64Mi is enough for static; check for memory leaks |
| Stale content after deploy | Image caching | Use SHA tags, not `latest` |
| Hugo build fails | Missing submodules | `fetch-depth: 0` + `submodules: recursive` |

## Best Practices

1. **Pin Hugo version in Dockerfile** — reproducible builds across environments
2. **Pre-compress with Brotli at build time** — zero CPU overhead at serve time
3. **Read-only root filesystem** — nginx only needs tmp/cache/pid as writable
4. **Use SHA-based image tags** — `latest` causes caching issues
5. **16Mi request is enough** — nginx serving static files is incredibly lightweight

## Key Takeaways

- Hugo + nginx:alpine = ~15MB final image — fast pulls, minimal attack surface
- Brotli pre-compression saves 15-25% over gzip with zero runtime cost
- Read-only root filesystem + non-root user = hardened serving layer
- Automated git push → build → deploy takes <60 seconds end to end
- Single pod handles thousands of req/s for static content — no need for HPA
