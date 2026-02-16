---
draft: false
title: "Push a Podman-Saved Image to Local Quay"
description: "Load a Podman image tar archive, tag it correctly, authenticate to Local Quay, and push it safely."
category: "deployments"
difficulty: "beginner"
timeToComplete: "15 minutes"
kubernetesVersion: "Any"
prerequisites:
  - "Podman installed"
  - "Access to a Local Quay registry"
  - "Target repository created in Quay"
relatedRecipes:
  - "local-quay-retag-and-push"
  - "image-pull-secrets"
tags: ["quay", "podman", "container-registry", "images", "devops"]
publishDate: "2026-02-16"
updatedDate: "2026-02-16"
author: "Luca Berton"
---

> **💡 Quick Answer:** Run `podman load -i image.tar`, tag the loaded image to your Quay path (`quay.internal.example.com/org/project/image:tag`), authenticate with `podman login`, then push with `podman push`.

# Push a Podman-Saved Image to Local Quay

This guide shows how to take an image archive created with `podman save` and publish it to a Local Quay registry.

## 1) Load the Saved Image Archive

```bash
podman load -i image.tar
```

Typical output:

```text
Loaded image(s): localhost/myimage:tag
```

Keep this source image name for the next step.

## 2) Tag the Image for Local Quay

Use the full registry + repository path exactly as it exists in Quay.

```bash
podman tag localhost/myimage:tag \
  quay.internal.example.com/org/project/myimage:latest
```

## 3) Authenticate to Local Quay

```bash
podman login quay.internal.example.com
```

For internal/self-signed environments (temporary troubleshooting only):

```bash
podman login --tls-verify=false quay.internal.example.com
```

## 4) Push the Image

```bash
podman push quay.internal.example.com/org/project/myimage:latest
```

If TLS trust is not configured yet:

```bash
podman push --tls-verify=false quay.internal.example.com/org/project/myimage:latest
```

## Optional: Insecure Registry Configuration

If your internal registry is HTTP-only (not recommended for production), configure Podman registries first:

```toml
[[registry]]
location = "quay.internal.example.com"
insecure = true
```

Then push again with normal `podman push`.

## Full Command Sequence

```bash
podman load -i image.tar
podman tag localhost/myimage:tag quay.internal.example.com/org/project/myimage:latest
podman login quay.internal.example.com
podman push quay.internal.example.com/org/project/myimage:latest
```

## Common Errors

- `requested access to the resource is denied`: verify repository permissions in Quay.
- `x509: certificate signed by unknown authority`: add CA trust or use temporary `--tls-verify=false`.
- `manifest unknown`: check image/tag spelling.

## Related Recipes

- [Retag and Push an Image in Local Quay](./local-quay-retag-and-push)
