---
draft: false
title: "Retag and Push an Image in Local Quay"
description: "Pull an existing image from Local Quay, retag it for a new repository path, and push the new tag."
category: "deployments"
difficulty: "beginner"
timeToComplete: "10 minutes"
kubernetesVersion: "Any"
prerequisites:
  - "Podman installed"
  - "Read/write access to source and target repositories in Quay"
relatedRecipes:
  - "local-quay-push-podman-image"
  - "image-pull-secrets"
tags: ["quay", "podman", "retag", "container-image", "registry"]
publishDate: "2026-02-16"
updatedDate: "2026-02-16"
author: "Luca Berton"
---

> **💡 Quick Answer:** Pull the source image from Local Quay, retag to the new repository path, then push the new tag. Use `--tls-verify=false` only when your internal cert trust is not configured yet.

# Retag and Push an Image in Local Quay

Use this workflow to duplicate or promote images between repositories in the same Local Quay instance.

## 1) Pull the Source Image

```bash
podman pull quay.internal.example.com/org-a/source-image:latest
```

For internal/self-signed cert environments:

```bash
podman pull --tls-verify=false quay.internal.example.com/org-a/source-image:latest
```

## 2) Retag to the Target Repository

```bash
podman tag \
  quay.internal.example.com/org-a/source-image:latest \
  quay.internal.example.com/org-b/target-image:2.26.6-rhel9.6
```

## 3) Push the New Tag

```bash
podman push quay.internal.example.com/org-b/target-image:2.26.6-rhel9.6
```

If trust is not configured yet:

```bash
podman push --tls-verify=false \
  quay.internal.example.com/org-b/target-image:2.26.6-rhel9.6
```

## One-Shot Sequence

```bash
podman pull quay.internal.example.com/org-a/source-image:latest
podman tag quay.internal.example.com/org-a/source-image:latest quay.internal.example.com/org-b/target-image:2.26.6-rhel9.6
podman push quay.internal.example.com/org-b/target-image:2.26.6-rhel9.6
```

## Operational Tips

- Keep immutable version tags (for example, `2.26.6-rhel9.6`) for traceability.
- Avoid overwriting `latest` in production promotion flows.
- Validate repository retention and access policies before publishing.

## Related Recipes

- [Push a Podman-Saved Image to Local Quay](/recipes/deployments/local-quay-push-podman-image/)
