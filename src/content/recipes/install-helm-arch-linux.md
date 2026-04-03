---
title: "Install Helm on Arch Linux"
description: "Install Helm 3 on Arch Linux and configure chart repositories. Covers package manager install, script install, and shell completion for Arch Linux rolling."
category: "helm"
difficulty: "beginner"
publishDate: "2026-04-02"
tags: ["helm", "installation", "arch-linux", "package-manager", "charts"]
author: "Luca Berton"
relatedRecipes:
  - "install-kubernetes-arch-linux"
  - "install-argocd-arch-linux"
  - "helm-chart-development-guide"
---

> 💡 **Quick Answer:** Install Helm 3 on Arch Linux and configure chart repositories. Covers package manager install, script install, and shell completion for Arch Linux rolling.

## The Problem

You need Helm installed on Arch Linux (Arch Linux rolling) to manage Kubernetes application deployments with charts.

## The Solution

### Install Helm on Arch Linux

```bash
# Method 1: Official script
curl https://raw.githubusercontent.com/helm/helm/main/scripts/get-helm-3 | bash

# Method 2: pacman
sudo pacman -S helm

# Method 3: AUR
yay -S helm-bin

# Verify
helm version

# Add popular chart repos
helm repo add bitnami https://charts.bitnami.com/bitnami
helm repo add ingress-nginx https://kubernetes.github.io/ingress-nginx
helm repo add jetstack https://charts.jetstack.io
helm repo update

# Shell completion
echo 'source <(helm completion bash)' >> ~/.bashrc
```

### Verify Installation

```bash
helm version
# version.BuildInfo{Version:"v3.16.x", ...}

# List installed releases
helm list -A

# Search for charts
helm search repo nginx
helm search hub prometheus
```

```mermaid
graph TD
    A[Install Helm] --> B[Add chart repos]
    B --> C[helm repo update]
    C --> D[helm search for charts]
    D --> E[helm install release]
    E --> F[helm upgrade/rollback]
```

## Common Issues

- **kubectl not configured** — Helm uses your kubeconfig; ensure `kubectl get nodes` works first
- **Helm 2 vs 3** — Helm 3 has no Tiller; if you see Tiller errors, you have Helm 2
- **Repository not found** — run `helm repo update` after adding repos

## Best Practices

- **Always use `--namespace` and `--create-namespace`** for clean isolation
- **Use `values.yaml` files** instead of `--set` flags for reproducibility
- **Pin chart versions** in production: `helm install --version 1.2.3`

## Key Takeaways

- Helm is the standard package manager for Kubernetes
- The official install script works on every Linux distro
- Always add and update repos before searching for charts
- Use shell completion for productivity
