---
title: "Multi-Architecture Container Images for Kubernetes"
description: "Build and deploy multi-architecture container images for mixed Kubernetes clusters. Docker buildx, manifest lists, image indexes, platform-aware scheduling, and cross-compilation strategies for amd64 and arm64."
tags:
  - "multi-arch"
  - "container-images"
  - "buildx"
  - "arm64"
  - "ci-cd"
category: "deployments"
publishDate: "2026-05-22"
author: "Luca Berton"
difficulty: "intermediate"
relatedRecipes:
  - "oci-container-image-internals-kubernetes"
  - "private-container-registry-kubernetes"
  - "kubernetes-node-affinity-scheduling"
  - "container-image-security-scanning-kubernetes"
---

> 💡 **Quick Answer:** Build multi-architecture images with `docker buildx` using QEMU emulation or native cross-compilation. The resulting OCI Image Index (fat manifest) contains per-platform manifests, and Kubernetes automatically selects the correct architecture based on the node's `kubernetes.io/arch` label. No changes needed in Pod specs — it just works.

## The Problem

- Mixed clusters (amd64 control plane + arm64 worker nodes for cost savings)
- Graviton/Ampere arm64 instances are 20-40% cheaper but need arm64 images
- Edge/IoT nodes run arm64 (Raspberry Pi, NVIDIA Jetson) alongside cloud amd64
- CI builds only amd64 — arm64 nodes get "exec format error"
- Want one image tag that works everywhere without platform-specific tags

## The Solution

### Build Multi-Platform Images

```bash
# Create buildx builder with multi-platform support
docker buildx create --name multiarch \
  --driver docker-container \
  --platform linux/amd64,linux/arm64 \
  --use

# Build and push multi-platform image
docker buildx build \
  --platform linux/amd64,linux/arm64 \
  --tag registry.example.com/myorg/app:v2.1.0 \
  --push .

# Result: One tag → Image Index → 2 platform-specific manifests
```

### Dockerfile for Multi-Platform

```dockerfile
# Multi-stage build with cross-compilation (fast, no QEMU)
FROM --platform=$BUILDPLATFORM golang:1.22-alpine AS builder
ARG TARGETPLATFORM
ARG TARGETOS
ARG TARGETARCH

WORKDIR /app
COPY go.mod go.sum ./
RUN go mod download
COPY . .

# Cross-compile for target platform (no emulation needed)
RUN CGO_ENABLED=0 GOOS=${TARGETOS} GOARCH=${TARGETARCH} \
    go build -ldflags="-s -w" -o /app/server ./cmd/server

# Runtime — automatically selects correct base for platform
FROM gcr.io/distroless/static:nonroot
COPY --from=builder /app/server /server
ENTRYPOINT ["/server"]
```

### Verify Multi-Platform Image

```bash
# Inspect the Image Index (fat manifest)
crane manifest registry.example.com/myorg/app:v2.1.0 | jq .
# {
#   "schemaVersion": 2,
#   "mediaType": "application/vnd.oci.image.index.v1+json",
#   "manifests": [
#     {
#       "digest": "sha256:aaa...",
#       "platform": {"architecture": "amd64", "os": "linux"}
#     },
#     {
#       "digest": "sha256:bbb...",
#       "platform": {"architecture": "arm64", "os": "linux"}
#     }
#   ]
# }

# Check specific platform
crane manifest --platform linux/arm64 registry.example.com/myorg/app:v2.1.0 | jq .

# Verify both platforms have correct binaries
crane config --platform linux/amd64 registry.example.com/myorg/app:v2.1.0 | \
  jq '.architecture'  # "amd64"
crane config --platform linux/arm64 registry.example.com/myorg/app:v2.1.0 | \
  jq '.architecture'  # "arm64"
```

### CI Pipeline (GitHub Actions)

```yaml
name: Multi-Arch Build
on:
  push:
    tags: ["v*"]
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Set up QEMU (for arm64 emulation)
        uses: docker/setup-qemu-action@v3

      - name: Set up Docker Buildx
        uses: docker/setup-buildx-action@v3

      - name: Login to registry
        uses: docker/login-action@v3
        with:
          registry: registry.example.com
          username: ${{ secrets.REGISTRY_USER }}
          password: ${{ secrets.REGISTRY_PASS }}

      - name: Build and push multi-platform
        uses: docker/build-push-action@v5
        with:
          context: .
          platforms: linux/amd64,linux/arm64
          push: true
          tags: |
            registry.example.com/myorg/app:${{ github.ref_name }}
            registry.example.com/myorg/app:latest
          cache-from: type=gha
          cache-to: type=gha,mode=max
```

### How Kubernetes Selects the Right Platform

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: my-app
spec:
  replicas: 6
  selector:
    matchLabels:
      app: my-app
  template:
    spec:
      containers:
        - name: app
          image: registry.example.com/myorg/app:v2.1.0
          # Kubernetes does this automatically:
          # 1. kubelet reads node label: kubernetes.io/arch=amd64 (or arm64)
          # 2. Asks registry for Image Index
          # 3. Selects manifest matching node architecture
          # 4. Downloads only that platform's layers
          # No nodeSelector needed — multi-arch images just work!
```

```bash
# Verify node architectures in cluster
kubectl get nodes -o custom-columns=\
  NAME:.metadata.name,\
  ARCH:.status.nodeInfo.architecture,\
  OS:.status.nodeInfo.operatingSystem

# NAME          ARCH    OS
# control-1     amd64   linux
# worker-amd-1  amd64   linux
# worker-arm-1  arm64   linux
# worker-arm-2  arm64   linux
```

### Performance: Cross-Compile vs QEMU

```text
Strategy          Build Time    Complexity    Language Support
─────────────────────────────────────────────────────────────
QEMU emulation    10-50x slower Any language  All (transparent)
Cross-compile     1x (native)   Needs support Go, Rust, C (with toolchain)
Native runners    1x (native)   CI infra cost All (real arm64 hardware)
─────────────────────────────────────────────────────────────

Recommendation:
- Go/Rust: Always cross-compile (GOARCH=arm64, --target)
- Python/Node: QEMU is fine (no compilation step)
- Large C/C++ projects: Use native arm64 runners
```

## Common Issues

### "exec format error" at container start
- **Cause**: Single-arch image (amd64) scheduled on arm64 node
- **Fix**: Build multi-platform image; or add nodeSelector for architecture

### QEMU build hangs or is extremely slow
- **Cause**: Complex compilation under emulation (especially C/C++)
- **Fix**: Use cross-compilation in Dockerfile; or native arm64 CI runners

### Cache not shared between platforms
- **Cause**: BuildKit caches are per-platform by default
- **Fix**: Use `--cache-from type=gha` in CI; or registry-based cache

### arm64 image has different behavior than amd64
- **Cause**: Architecture-specific bugs (endianness, SIMD, memory alignment)
- **Fix**: Run tests on both platforms in CI; use QEMU for test execution

## Best Practices

1. **Cross-compile when possible** — 10-50x faster than QEMU for compiled languages
2. **Use `--platform=$BUILDPLATFORM` for builder stage** — runs natively
3. **Test on both architectures** — functional differences can be subtle
4. **Cache aggressively** — multi-platform builds are expensive; use GHA or registry cache
5. **Distroless for runtime** — already multi-platform, minimal attack surface
6. **Pin base images by digest** — ensure consistent layers across platforms
7. **Label nodes clearly** — `kubernetes.io/arch` is automatic; add custom labels for GPU etc.

## Key Takeaways

- OCI Image Index = one tag pointing to multiple per-platform manifests
- Kubernetes automatically selects correct platform based on node's `kubernetes.io/arch`
- `docker buildx` with `--platform` builds for multiple architectures in one command
- Cross-compilation (Go/Rust) is 10-50x faster than QEMU emulation
- Mixed clusters (amd64 + arm64) work transparently with multi-arch images
- No Pod spec changes needed — multi-platform images are automatic
- arm64 instances are 20-40% cheaper; multi-arch support unlocks cost savings
