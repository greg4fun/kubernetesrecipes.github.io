---
title: "kubectl Plugins: Extend with Krew"
description: "Install kubectl plugins with Krew package manager. Essential plugins for debugging, resource management, and cluster operations. Build custom kubectl plugins."
publishDate: "2026-05-02"
author: "Luca Berton"
category: "configuration"
difficulty: "beginner"
timeToComplete: "8 minutes"
kubernetesVersion: "1.28+"
tags:
  - "kubectl"
  - "plugins"
  - "krew"
  - "tooling"
  - "productivity"
relatedRecipes:
  - "kubectl-cheat-sheet"
  - "kubernetes-api-resources-explain"
  - "kubernetes-kubectl-debug-guide"
---

> 💡 **Quick Answer:** Install Krew (kubectl plugin manager): `kubectl krew install krew`. Then install plugins: `kubectl krew install ctx` (switch contexts), `kubectl krew install ns` (switch namespaces), `kubectl krew install neat` (clean YAML output). Run as: `kubectl ctx`, `kubectl ns`, `kubectl neat`. Essential plugins: ctx, ns, neat, tree, images, resource-capacity, stern, access-matrix.

## The Problem

kubectl lacks some common operations:

- Switching contexts/namespaces requires long commands
- YAML output includes managed fields and status noise
- No tree view of resource ownership
- No multi-pod log streaming
- No resource utilization overview

## The Solution

### Install Krew

```bash
# Install Krew
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
# Add to ~/.bashrc or ~/.zshrc

# Verify
kubectl krew version
kubectl krew update
```

### Essential Plugins

```bash
# Context switching (replaces: kubectl config use-context)
kubectl krew install ctx
kubectl ctx                      # List contexts
kubectl ctx my-cluster           # Switch context

# Namespace switching (replaces: kubectl config set-context --namespace)
kubectl krew install ns
kubectl ns                       # List namespaces
kubectl ns production            # Switch namespace

# Clean YAML output (removes managed fields, status)
kubectl krew install neat
kubectl get pod my-pod -o yaml | kubectl neat
# Clean, readable YAML — perfect for saving as manifests

# Resource tree (show ownership hierarchy)
kubectl krew install tree
kubectl tree deployment my-app
# NAMESPACE  NAME                            READY
# default    Deployment/my-app               3/3
# default    ├─ReplicaSet/my-app-5d5dd5db49  3/3
# default    │ ├─Pod/my-app-5d5dd5db49-abc   1/1
# default    │ ├─Pod/my-app-5d5dd5db49-def   1/1
# default    │ └─Pod/my-app-5d5dd5db49-ghi   1/1

# List all container images in cluster
kubectl krew install images
kubectl images -A
# Shows all images across all pods

# Resource capacity overview
kubectl krew install resource-capacity
kubectl resource-capacity
# NODE        CPU REQ   CPU LIM   MEM REQ   MEM LIM
# worker-1    3200m     8000m     6Gi       16Gi
# worker-2    2800m     7000m     5Gi       14Gi

# Multi-pod log streaming
kubectl krew install stern
kubectl stern my-app              # Stream logs from all pods matching "my-app"
kubectl stern -n production .     # ALL pods in namespace
kubectl stern my-app -s 5m        # Last 5 minutes

# RBAC lookup
kubectl krew install access-matrix
kubectl access-matrix             # Who can do what

# Who can access a resource
kubectl krew install who-can
kubectl who-can create pods -n production
```

### More Useful Plugins

```bash
# Diff before apply
kubectl krew install diff
kubectl diff -f manifests/

# View all events sorted
kubectl krew install evict-pod    # Safely evict pods

# Sniff network traffic
kubectl krew install sniff
kubectl sniff my-pod -n production

# Node shell (quick SSH alternative)
kubectl krew install node-shell
kubectl node-shell worker-1

# Deprecation warnings
kubectl krew install deprecations
kubectl deprecations

# Unused resources
kubectl krew install unused-volumes
kubectl unused-volumes

# Manage Krew
kubectl krew list                 # Installed plugins
kubectl krew search               # All available plugins
kubectl krew upgrade              # Update all plugins
kubectl krew uninstall <plugin>   # Remove
```

### Build a Custom Plugin

```bash
# kubectl plugins are any executable named kubectl-<name>
# in your PATH

# Create kubectl-whoami
cat > /usr/local/bin/kubectl-whoami << 'EOF'
#!/bin/bash
# Show current user, context, and namespace
echo "User:      $(kubectl config view --minify -o jsonpath='{.users[0].name}')"
echo "Context:   $(kubectl config current-context)"
echo "Namespace: $(kubectl config view --minify -o jsonpath='{.contexts[0].context.namespace:-default}')"
echo "Cluster:   $(kubectl config view --minify -o jsonpath='{.clusters[0].cluster.server}')"
EOF

chmod +x /usr/local/bin/kubectl-whoami

# Use it
kubectl whoami
# User:      admin@my-cluster
# Context:   my-cluster
# Namespace: production
# Cluster:   https://10.0.0.1:6443

# kubectl discovers plugins automatically
kubectl plugin list
```

### Plugin as Shell Function

```bash
# Add to ~/.bashrc for frequently needed operations
# Not a "plugin" but equivalent functionality

# Quick pod restart
krestart() {
  kubectl rollout restart deployment "$1" -n "${2:-default}"
}

# Quick logs
klogs() {
  kubectl logs -f "deployment/$1" --all-containers -n "${2:-default}"
}

# Quick exec
kexec() {
  kubectl exec -it "$1" -n "${2:-default}" -- "${3:-sh}"
}
```

## Common Issues

**"kubectl: command not found: krew"**

PATH not set. Add to shell profile: `export PATH="${KREW_ROOT:-$HOME/.krew}/bin:$PATH"`. Restart shell.

**Plugin conflicts with built-in command**

Plugins can't override built-in kubectl commands. Rename your plugin.

**Plugin not working after kubectl upgrade**

Plugins may need updates. Run: `kubectl krew upgrade`.

## Best Practices

- **Install ctx + ns first** — biggest productivity boost
- **Use neat for saving manifests** — removes noise from `kubectl get -o yaml`
- **stern over kubectl logs** — multi-pod streaming with color coding
- **tree for debugging** — instantly see Deployment→ReplicaSet→Pod chain
- **Keep plugins updated** — `kubectl krew upgrade` regularly

## Key Takeaways

- Krew is the package manager for kubectl plugins (200+ plugins)
- Essential plugins: ctx, ns, neat, tree, stern, resource-capacity
- Custom plugins are just executables named `kubectl-<name>` in PATH
- Plugins extend kubectl without modifying it
- `kubectl krew search` to discover plugins for your needs
