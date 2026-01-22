---
title: "How to Extend kubectl with Plugins"
description: "Enhance kubectl with custom plugins using Krew. Discover, install, and create plugins to boost Kubernetes productivity."
category: "troubleshooting"
difficulty: "beginner"
publishDate: "2026-01-22"
tags: ["kubectl", "krew", "plugins", "cli", "productivity"]
---

# How to Extend kubectl with Plugins

kubectl plugins extend the CLI with custom commands. Use Krew package manager to discover and install plugins that boost productivity.

## Install Krew

```bash
# macOS / Linux
(
  set -x; cd "$(mktemp -d)" &&
  OS="$(uname | tr '[:upper:]' '[:lower:]')" &&
  ARCH="$(uname -m | sed -e 's/x86_64/amd64/' -e 's/aarch64/arm64/')" &&
  KREW="krew-${OS}_${ARCH}" &&
  curl -fsSLO "https://github.com/kubernetes-sigs/krew/releases/latest/download/${KREW}.tar.gz" &&
  tar zxvf "${KREW}.tar.gz" &&
  ./"${KREW}" install krew
)

# Add to PATH
export PATH="${KREW_ROOT:-$HOME/.krew}/bin:$PATH"

# Add to shell profile
echo 'export PATH="${KREW_ROOT:-$HOME/.krew}/bin:$PATH"' >> ~/.bashrc
```

## Krew Basic Usage

```bash
# Update plugin index
kubectl krew update

# Search for plugins
kubectl krew search
kubectl krew search pod

# Install plugin
kubectl krew install ctx
kubectl krew install ns

# List installed plugins
kubectl krew list

# Upgrade plugins
kubectl krew upgrade

# Uninstall plugin
kubectl krew uninstall ctx

# Plugin info
kubectl krew info ctx
```

## Essential Plugins

```bash
# Context and namespace switching
kubectl krew install ctx    # kubectl ctx
kubectl krew install ns     # kubectl ns

# Usage
kubectl ctx                 # List contexts
kubectl ctx production      # Switch context
kubectl ns                  # List namespaces
kubectl ns kube-system      # Switch namespace
```

```bash
# Resource tree visualization
kubectl krew install tree

# Show owner hierarchy
kubectl tree deployment nginx
# NAMESPACE  NAME                           READY  REASON  AGE
# default    Deployment/nginx               -              5d
# default    └─ReplicaSet/nginx-6799fc88d8  -              5d
# default      └─Pod/nginx-6799fc88d8-xyz   True           5d
```

```bash
# View resource utilization
kubectl krew install resource-capacity

# Node capacity
kubectl resource-capacity
# NODE          CPU REQUESTS  CPU LIMITS  MEMORY REQUESTS  MEMORY LIMITS
# node-1        1200m (60%)   2000m       2Gi (50%)        4Gi
# node-2        800m (40%)    1500m       1.5Gi (37%)      3Gi
```

```bash
# Access pod logs easily
kubectl krew install stern

# Tail logs from multiple pods
stern "web-.*" -n production
stern -l app=nginx --tail 50
```

```bash
# Get all images in cluster
kubectl krew install images

kubectl images
# Shows all container images used in the cluster
```

```bash
# View pod networking
kubectl krew install pod-inspect

kubectl pod-inspect my-pod
```

```bash
# Score resources against best practices
kubectl krew install score

kubectl score deployment.yaml
# Shows security and reliability recommendations
```

## Debugging Plugins

```bash
# Debug running containers
kubectl krew install debug

# Start debug container
kubectl debug my-pod -it --image=busybox
```

```bash
# View pod resource usage
kubectl krew install top-pod

kubectl top-pod
# Enhanced top with more details
```

```bash
# Check deprecated APIs
kubectl krew install deprecations

kubectl deprecations
# Lists deprecated APIs in use
```

```bash
# Node shell access
kubectl krew install node-shell

kubectl node-shell my-node
# Opens shell on node
```

## Security Plugins

```bash
# Scan for vulnerabilities
kubectl krew install kubesec-scan

kubectl kubesec-scan pod my-pod
```

```bash
# View RBAC permissions
kubectl krew install access-matrix

kubectl access-matrix --for user:jane
kubectl access-matrix --for sa:default:myapp
```

```bash
# Who can perform actions
kubectl krew install who-can

kubectl who-can create pods -n production
kubectl who-can delete secrets --all-namespaces
```

## Network Plugins

```bash
# Capture network traffic
kubectl krew install sniff

kubectl sniff my-pod -n production
```

```bash
# Test network policies
kubectl krew install np-viewer

kubectl np-viewer
# Visualizes network policies
```

## Create Custom Plugin

```bash
# Plugins are executables named kubectl-<name>
# Create kubectl-hello

cat > kubectl-hello << 'EOF'
#!/bin/bash
echo "Hello from kubectl plugin!"
echo "Current context: $(kubectl config current-context)"
echo "Arguments: $@"
EOF

chmod +x kubectl-hello
mv kubectl-hello /usr/local/bin/

# Use plugin
kubectl hello
kubectl hello world
```

## Advanced Custom Plugin

```bash
# kubectl-pod-status - Show pod status summary
cat > kubectl-pod-status << 'EOF'
#!/bin/bash

NAMESPACE="${1:---all-namespaces}"

if [[ "$NAMESPACE" != "--all-namespaces" ]]; then
  NS_FLAG="-n $NAMESPACE"
else
  NS_FLAG="--all-namespaces"
fi

echo "Pod Status Summary"
echo "=================="

kubectl get pods $NS_FLAG -o json | jq -r '
  .items | group_by(.status.phase) | 
  map({phase: .[0].status.phase, count: length}) |
  .[] | "\(.phase): \(.count)"
'

echo ""
echo "Problematic Pods:"
kubectl get pods $NS_FLAG --field-selector=status.phase!=Running,status.phase!=Succeeded
EOF

chmod +x kubectl-pod-status
sudo mv kubectl-pod-status /usr/local/bin/

# Usage
kubectl pod-status
kubectl pod-status production
```

## Plugin with Go

```go
// kubectl-goinfo/main.go
package main

import (
    "fmt"
    "os"
    "path/filepath"

    "k8s.io/client-go/kubernetes"
    "k8s.io/client-go/tools/clientcmd"
)

func main() {
    kubeconfig := filepath.Join(os.Getenv("HOME"), ".kube", "config")
    config, _ := clientcmd.BuildConfigFromFlags("", kubeconfig)
    clientset, _ := kubernetes.NewForConfig(config)
    
    version, _ := clientset.Discovery().ServerVersion()
    fmt.Printf("Server Version: %s\n", version.GitVersion)
    
    nodes, _ := clientset.CoreV1().Nodes().List(context.TODO(), metav1.ListOptions{})
    fmt.Printf("Nodes: %d\n", len(nodes.Items))
}
```

## Plugin Discovery

```bash
# List all available plugins
kubectl plugin list

# Check if command is a plugin
type kubectl-ctx
# kubectl-ctx is /Users/user/.krew/bin/kubectl-ctx

# Plugin locations (searched in order):
# 1. Current directory
# 2. Directories in PATH
# 3. ~/.krew/bin/
```

## Popular Plugin Collection

```bash
# Install commonly used plugins
kubectl krew install \
  ctx \
  ns \
  tree \
  stern \
  images \
  resource-capacity \
  who-can \
  deprecations \
  neat \
  view-secret

# kubectl neat - Clean YAML output
kubectl get pod my-pod -o yaml | kubectl neat

# kubectl view-secret - Decode secrets
kubectl view-secret my-secret
```

## Alias with Plugins

```bash
# Add to ~/.bashrc or ~/.zshrc
alias kctx='kubectl ctx'
alias kns='kubectl ns'
alias klog='kubectl stern'
alias ktree='kubectl tree'

# Combined workflows
alias kpods='kubectl get pods -o wide'
alias kdebug='kubectl debug -it --image=nicolaka/netshoot'
```

## Summary

Krew is the package manager for kubectl plugins. Install with the official script and add to PATH. Use `kubectl krew search` to discover plugins and `kubectl krew install` to add them. Essential plugins include ctx/ns (context switching), stern (log tailing), tree (resource hierarchy), and resource-capacity (utilization). Create custom plugins as executables named `kubectl-<name>`. Security plugins like who-can and access-matrix help audit RBAC. Combine plugins with shell aliases for maximum productivity.
