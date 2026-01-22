---
title: "How to Manage Kubernetes Contexts and Clusters"
description: "Switch between multiple clusters efficiently. Configure kubeconfig, manage contexts, and set up secure multi-cluster access."
category: "configuration"
difficulty: "beginner"
publishDate: "2026-01-22"
tags: ["kubeconfig", "contexts", "clusters", "kubectl", "multi-cluster"]
---

# How to Manage Kubernetes Contexts and Clusters

Kubeconfig files define clusters, users, and contexts for kubectl. Learn to manage multiple clusters efficiently and switch between them safely.

## Kubeconfig Structure

```yaml
# ~/.kube/config structure
apiVersion: v1
kind: Config
current-context: production-cluster

clusters:
  - name: production-cluster
    cluster:
      server: https://prod.k8s.example.com:6443
      certificate-authority-data: <base64-ca-cert>
  
  - name: staging-cluster
    cluster:
      server: https://staging.k8s.example.com:6443
      certificate-authority-data: <base64-ca-cert>

users:
  - name: admin-user
    user:
      client-certificate-data: <base64-cert>
      client-key-data: <base64-key>
  
  - name: developer-user
    user:
      token: <bearer-token>

contexts:
  - name: prod-admin
    context:
      cluster: production-cluster
      user: admin-user
      namespace: default
  
  - name: staging-dev
    context:
      cluster: staging-cluster
      user: developer-user
      namespace: development
```

## View Current Context

```bash
# Current context
kubectl config current-context

# View config
kubectl config view

# View config (hide secrets)
kubectl config view --minify

# Show all contexts
kubectl config get-contexts

# Show clusters
kubectl config get-clusters

# Show users
kubectl config get-users
```

## Switch Contexts

```bash
# Switch to different context
kubectl config use-context staging-dev

# Run command in different context
kubectl --context=prod-admin get pods

# Set default namespace for context
kubectl config set-context --current --namespace=production
```

## Create Context

```bash
# Add new cluster
kubectl config set-cluster my-cluster \
  --server=https://my-cluster.example.com:6443 \
  --certificate-authority=/path/to/ca.crt

# Add user credentials
kubectl config set-credentials my-user \
  --client-certificate=/path/to/client.crt \
  --client-key=/path/to/client.key

# Or with token
kubectl config set-credentials my-user \
  --token=<bearer-token>

# Create context
kubectl config set-context my-context \
  --cluster=my-cluster \
  --user=my-user \
  --namespace=default
```

## Multiple Kubeconfig Files

```bash
# Use specific kubeconfig file
kubectl --kubeconfig=/path/to/config get pods

# Merge multiple kubeconfig files
export KUBECONFIG=~/.kube/config:~/.kube/config-staging:~/.kube/config-prod

# View merged config
kubectl config view --flatten

# Save merged config
kubectl config view --flatten > ~/.kube/config-merged
```

## Use kubectx and kubens

```bash
# Install kubectx and kubens (popular tools)
# macOS
brew install kubectx

# Linux
sudo apt install kubectx

# Switch context interactively
kubectx
kubectx production-cluster

# Switch namespace
kubens
kubens kube-system

# Previous context
kubectx -

# Previous namespace
kubens -
```

## Context Aliases

```bash
# Create alias for quick switching
alias kprod='kubectl --context=production-cluster'
alias kstaging='kubectl --context=staging-cluster'
alias kdev='kubectl --context=development-cluster'

# Use aliases
kprod get pods
kstaging get deployments
```

## Shell Prompt Integration

```bash
# Show current context in prompt
# Add to ~/.bashrc or ~/.zshrc

# Bash
PS1='$(kubectl config current-context 2>/dev/null) \$ '

# Or use kube-ps1
source /usr/local/opt/kube-ps1/share/kube-ps1.sh
PS1='$(kube_ps1) \$ '

# Zsh with Oh My Zsh
plugins=(... kubectl kube-ps1)
PROMPT='$(kube_ps1) '$PROMPT
```

## Secure Context Management

```bash
# Don't store production credentials locally
# Use short-lived tokens

# AWS EKS - update kubeconfig with IAM
aws eks update-kubeconfig --name my-cluster --region us-east-1

# GKE - get credentials
gcloud container clusters get-credentials my-cluster --zone us-central1-a

# AKS - get credentials
az aks get-credentials --resource-group myRG --name my-cluster

# These use cloud CLI for authentication
```

## Context with OIDC

```yaml
# kubeconfig with OIDC authentication
users:
  - name: oidc-user
    user:
      exec:
        apiVersion: client.authentication.k8s.io/v1beta1
        command: kubectl
        args:
          - oidc-login
          - get-token
          - --oidc-issuer-url=https://issuer.example.com
          - --oidc-client-id=kubernetes
          - --oidc-client-secret=<secret>
```

## Delete Context

```bash
# Delete context
kubectl config delete-context staging-dev

# Delete cluster
kubectl config delete-cluster staging-cluster

# Delete user
kubectl config delete-user developer-user

# Unset current context
kubectl config unset current-context
```

## Validate Context

```bash
# Test connection to cluster
kubectl cluster-info

# Check API server health
kubectl get --raw /healthz

# Verify credentials
kubectl auth whoami  # Kubernetes 1.27+

# Or check with can-i
kubectl auth can-i get pods
```

## Context Per Terminal

```bash
# Set context for current terminal only
export KUBECONFIG=~/.kube/config-staging

# Or use different config file
kubectl --kubeconfig=~/.kube/config-prod get pods

# Script to set context per directory
# Add to ~/.bashrc
function cd() {
  builtin cd "$@"
  if [[ -f .kubeconfig ]]; then
    export KUBECONFIG=$(cat .kubeconfig)
  fi
}
```

## Backup Kubeconfig

```bash
# Backup before modifications
cp ~/.kube/config ~/.kube/config.backup

# Restore if needed
cp ~/.kube/config.backup ~/.kube/config

# Version control (careful with secrets!)
# Better: use external secret management
```

## Namespace Context Helper

```bash
# Quick namespace switch function
kns() {
  kubectl config set-context --current --namespace=$1
}

# Usage
kns production
kns kube-system
```

## Safety Tips

```bash
# 1. Always check current context before dangerous operations
kubectl config current-context && kubectl delete ...

# 2. Use --dry-run for verification
kubectl delete pods --all --dry-run=client

# 3. Color-code terminal by environment
# Production: Red background
# Staging: Yellow background

# 4. Require confirmation for production
alias kubectl-prod='echo "PRODUCTION CLUSTER!" && read -p "Continue? " && kubectl --context=production'
```

## Summary

Kubeconfig manages cluster access through clusters, users, and contexts. Use `kubectl config` commands to view and modify configuration. Install kubectx/kubens for quick switching between contexts and namespaces. Merge multiple kubeconfig files with KUBECONFIG environment variable. Use cloud CLI tools (aws, gcloud, az) for secure authentication to managed clusters. Add context to shell prompt to always know your current cluster. Practice safe switching by verifying context before destructive operations.
