---
title: "OCI Container Image Internals on Kubernetes"
description: "Understand OCI container image internals: layers as tar archive diffs, image configuration JSON, content-addressable storage with SHA-256, multi-platform image indexes, and how Kubernetes container runtimes pull and unpack images."
tags:
  - "oci"
  - "container-images"
  - "registry"
  - "container-runtime"
  - "containerd"
category: "configuration"
publishDate: "2026-05-22"
author: "Luca Berton"
difficulty: "intermediate"
relatedRecipes:
  - "kubernetes-private-container-registry"
  - "kubernetes-image-pull-secrets"
  - "pod-security-standards-kubernetes"
  - "container-runtime-troubleshooting-kubernetes"
---

> 💡 **Quick Answer:** An OCI container image is a content-addressable bundle: filesystem layers (compressed tar diffs), an image configuration JSON (platform, env, cmd, user), and a manifest tying them together via SHA-256 digests. On Kubernetes, containerd/CRI-O pulls manifests, downloads layers in parallel, unpacks them into an overlay filesystem, and applies the config as container runtime settings.

## The Problem

- Developers treat images as black boxes — can't debug layer bloat or config issues
- Multi-platform images (amd64/arm64) fail on wrong architecture without clear error
- Image pull is slow — don't understand what's being downloaded or why layers cache
- Security scanning reports vulnerabilities "in layer 3" — need to know what that means
- Registry API errors (blob unknown, manifest invalid) are cryptic without understanding internals

## The Solution

### OCI Image Structure

```text
┌──────────────────────────────────────────────────────────────────┐
│ Container Image (content-addressable)                             │
│                                                                   │
│  Image Layers                        Image Configuration          │
│  (tar archives with filesystem diffs)  (JSON document)            │
│                                                                   │
│  ┌──────────┐                        {                            │
│  │ Layer 0  │ ──sha256──────────────►  "architecture": "amd64",  │
│  └──────────┘                          "os": "linux",            │
│       │ Diff                                                      │
│  ┌──────────┐                          "rootfs": {               │
│  │ Layer 1  │ ──sha256──────────────►    "type": "layers",       │
│  └──────────┘                            "diff_ids": [           │
│       │ Diff                               "sha256:c6f988f...",  │
│  ┌──────────┐                              "sha256:5f70bf1..."   │
│  │ Layer 2  │ ──sha256──────────────►    ]                       │
│  └──────────┘                          },                        │
│       │ ...                            "config": {               │
│  ┌──────────┐                            "Cmd": ["/bin/my-app"], │
│  │ Layer N  │                            "Env": ["PATH=..."],    │
│  └──────────┘                            "User": "alice"         │
│                                        }                          │
│                                      }                            │
│                                                                   │
│  rootfs.diff_ids = SHA-256 of        sha256(config JSON)          │
│  UNCOMPRESSED tar archives            == Image ID                 │
└──────────────────────────────────────────────────────────────────┘
```

### Image Layers Deep Dive

```bash
# Inspect image layers
crane manifest nginx:1.27 | jq '.layers[]'
# {
#   "mediaType": "application/vnd.oci.image.layer.v1.tar+gzip",
#   "digest": "sha256:a480a496ba95a...",
#   "size": 29150479
# }

# Each layer is a tar archive containing filesystem diffs:
# Layer 0: base OS (debian-slim) — /usr, /lib, /etc, /bin
# Layer 1: nginx binary + config — /etc/nginx/, /usr/sbin/nginx
# Layer 2: default site — /usr/share/nginx/html/

# Export and inspect a layer
crane blob nginx:1.27@sha256:a480a496ba95a... | tar -tzf - | head -20
# usr/
# usr/sbin/
# usr/sbin/nginx
# etc/nginx/
# etc/nginx/nginx.conf
# ...

# Layers are ADDITIVE — each adds/modifies/deletes files on top of previous
# Deleted files use "whiteout" markers: .wh.<filename>
```

### Image Configuration

```bash
# Inspect image config
crane config nginx:1.27 | jq .

# Platform (which arch/OS this image runs on)
# {
#   "architecture": "amd64",
#   "os": "linux"
# }

# Filesystem (references to layers by uncompressed digest)
# {
#   "rootfs": {
#     "type": "layers",
#     "diff_ids": [
#       "sha256:c6f988f4874bb0add23a778f75...",  ← Layer 0 uncompressed
#       "sha256:5f70bf18a086007016e948b04a...",  ← Layer 1 uncompressed
#       "sha256:9a0ef0e3bc21a6b5..."             ← Layer 2 uncompressed
#     ]
#   }
# }

# Execution parameters (become container runtime settings)
# {
#   "config": {
#     "Cmd": ["nginx", "-g", "daemon off;"],
#     "Env": ["PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin"],
#     "ExposedPorts": {"80/tcp": {}},
#     "User": "",
#     "WorkingDir": "",
#     "StopSignal": "SIGQUIT"
#   }
# }

# The SHA-256 of this entire JSON == Image ID
crane digest --full-ref nginx:1.27
# sha256:6db391d1c0cfb...  ← this is sha256(config JSON)
```

### Container Registry Architecture

```text
┌──────────────────────────────────────────────────────────────────┐
│ Container Registry                                                │
│                                                                   │
│  Key API Endpoints              <data-dir>/blobs/sha256/          │
│                                                                   │
│  POST /v2/<repo>/blobs/uploads/ │  Multi-Platform Image           │
│  GET  /v2/<repo>/blobs/<digest> │  ┌─────────────────────────┐   │
│  DELETE /v2/<repo>/blobs/<digest>│  │ aaa... Image Index      │   │
│                                  │  │   ├─► bbb... Manifest   │   │
│  PUT    /v2/<repo>/manifests/   │  │   │     ├─► ccc... Config│   │
│  GET    /v2/<repo>/manifests/   │  │   │     └─► ddd... Layer │   │
│  DELETE /v2/<repo>/manifests/   │  │   └─► eee... Manifest    │   │
│                                  │  │         ├─► fff... Config│   │
│  GET /v2/<repo>/tags/list       │  │         └─► 111... Layer │   │
│                                  │  └─────────────────────────┘   │
│                                  │                                 │
│  Tag-to-Manifest mapping:       │  Single-Platform Image          │
│  :latest → sha256:222...        │  ┌─────────────────────────┐   │
│  :v1.2.3 → sha256:222...        │  │ 222... Manifest         │   │
│  :debug  → sha256:333...        │  │   ├─► 333... Config     │   │
│                                  │  │   └─► 444... Layer      │   │
│  All filenames = SHA-256 hashes │  └─────────────────────────┘   │
└──────────────────────────────────────────────────────────────────┘
```

### How Kubernetes Pulls Images

```yaml
# Pod spec triggers image pull
apiVersion: v1
kind: Pod
metadata:
  name: my-app
spec:
  containers:
    - name: app
      image: registry.example.com/myorg/app:v2.1.0
      # What happens during pull:
      # 1. Resolve tag → manifest digest (GET /v2/myorg/app/manifests/v2.1.0)
      # 2. If multi-platform: select manifest matching node arch
      # 3. Download config blob (GET /v2/myorg/app/blobs/sha256:config...)
      # 4. Download layer blobs in parallel (GET /v2/myorg/app/blobs/sha256:layer...)
      # 5. Verify SHA-256 of each downloaded blob
      # 6. Unpack layers into overlay filesystem (lower dirs)
      # 7. Apply config as container settings (Cmd, Env, User, etc.)
```

```bash
# Watch containerd pulling in real-time
crictl pull registry.example.com/myorg/app:v2.1.0
# Resolving manifest...
# Downloading sha256:a480a496... (29.1 MB)  ← layer blob
# Downloading sha256:7b3a8c01... (1.2 MB)   ← layer blob
# Downloading sha256:config...  (4.2 KB)    ← config blob
# Unpacking...
# Done: sha256:6db391d1c0cfb...             ← image ID

# Verify what's cached (layers are shared across images!)
crictl images -v
# shows layers, size, digest for each cached image

# Check layer sharing
crictl inspecti registry.example.com/myorg/app:v2.1.0 | jq '.info.imageSpec.rootfs'
```

### Multi-Platform Images (Image Index)

```bash
# Image Index (fat manifest) — points to per-platform manifests
crane manifest --platform all nginx:1.27 | jq .
# {
#   "schemaVersion": 2,
#   "mediaType": "application/vnd.oci.image.index.v1+json",
#   "manifests": [
#     {
#       "mediaType": "application/vnd.oci.image.manifest.v1+json",
#       "digest": "sha256:bbb...",
#       "size": 1234,
#       "platform": { "architecture": "amd64", "os": "linux" }
#     },
#     {
#       "mediaType": "application/vnd.oci.image.manifest.v1+json",
#       "digest": "sha256:eee...",
#       "size": 1234,
#       "platform": { "architecture": "arm64", "os": "linux" }
#     }
#   ]
# }

# Kubernetes kubelet selects the manifest matching the node's arch
# Node labels: kubernetes.io/arch=amd64
# → pulls manifest sha256:bbb...
# → downloads layers referenced in that manifest only
```

### Build Multi-Platform for Kubernetes

```bash
# Build for multiple architectures
docker buildx create --name multiarch --use
docker buildx build \
  --platform linux/amd64,linux/arm64 \
  --tag registry.example.com/myorg/app:v2.1.0 \
  --push .

# Result: Image Index with 2 manifests, each with own layers + config
# Kubernetes nodes pull only their architecture's layers
```

### Debugging Image Issues on Kubernetes

```bash
# Image pull fails — check manifest exists
crane manifest registry.example.com/myorg/app:v2.1.0

# Wrong architecture — check what platforms are available
crane manifest --platform all registry.example.com/myorg/app:v2.1.0 | \
  jq '.manifests[].platform'

# Layer size analysis (find bloat)
crane manifest registry.example.com/myorg/app:v2.1.0 | \
  jq '.layers[] | {digest: .digest[:20], size: (.size/1048576 | round | tostring + " MB")}'

# Compare two tags (what changed?)
diff <(crane config registry.example.com/myorg/app:v2.0.0 | jq .) \
     <(crane config registry.example.com/myorg/app:v2.1.0 | jq .)

# Find which layer added a file
for layer in $(crane manifest registry.example.com/myorg/app:v2.1.0 | jq -r '.layers[].digest'); do
  echo "=== $layer ==="
  crane blob registry.example.com/myorg/app@$layer | tar -tzf - | grep "vulnerable-lib"
done
```

### Content-Addressable Storage

```bash
# Everything in a registry is stored by SHA-256 digest
# <data-dir>/blobs/sha256/
#   aaa...  → Image Index JSON
#   bbb...  → Manifest JSON (linux/amd64)
#   ccc...  → Config JSON
#   ddd...  → Layer tar.gz
#   eee...  → Manifest JSON (linux/arm64)
#   ...

# Tags are just pointers (mutable!)
# :latest → sha256:aaa...
# :v1.2.3 → sha256:aaa...
# Tags can be moved; digests are immutable

# Best practice for Kubernetes: pin by digest
containers:
  - name: app
    image: registry.example.com/myorg/app@sha256:6db391d1c0cfb...
    # Immutable — always gets exactly this image
    # Tags like :latest can change under you
```

## Common Issues

### ImagePullBackOff — manifest unknown
- **Cause**: Tag doesn't exist or was deleted; registry returns 404
- **Fix**: Verify with `crane manifest <image>:<tag>`; check tag spelling and registry URL

### exec format error (wrong architecture)
- **Cause**: Image built for amd64, running on arm64 node (or vice versa)
- **Fix**: Build multi-platform image; or use nodeSelector to match image arch

### Image pull slow (large layers)
- **Cause**: Base image too large; or layers not shared with other images on node
- **Fix**: Use smaller base (distroless, alpine); reorder Dockerfile for better layer caching

### Layer cache not working (rebuilds everything)
- **Cause**: Dockerfile COPY before dependencies — invalidates all subsequent layers
- **Fix**: Copy dependency files first (package.json, go.mod), install deps, then copy source

## Best Practices

1. **Pin by digest in production** — tags are mutable; digests guarantee exact content
2. **Small base images** — distroless/alpine reduce pull time and attack surface
3. **Order Dockerfile for cache** — dependencies before source code
4. **Multi-platform builds** — support amd64 + arm64 for mixed clusters
5. **Non-root USER** — set in config; enforced by Pod Security Standards
6. **Scan per-layer** — identify which layer introduced a vulnerability
7. **Use crane/skopeo** — inspect images without pulling entire content

## Key Takeaways

- OCI image = layers (tar diffs) + config (JSON) + manifest (ties them together)
- Everything is content-addressable: filename = SHA-256 of content
- `rootfs.diff_ids` in config = SHA-256 of **uncompressed** layer tars
- Image ID = SHA-256 of the config JSON
- Tags are mutable pointers; digests are immutable references
- Multi-platform: Image Index → per-arch Manifests → per-arch Layers
- Kubernetes selects correct platform manifest based on node's `kubernetes.io/arch` label
- Registry API: blobs (content), manifests (metadata), tags (human-readable pointers)
- Layer sharing across images reduces disk and network usage on nodes
