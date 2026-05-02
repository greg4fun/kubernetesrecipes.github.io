---
title: "kubectl Cheat Sheet: Essential Commands"
description: "Complete kubectl cheat sheet with essential commands for pods, deployments, services, debugging, and cluster management. Copy-paste ready examples."
publishDate: "2026-05-02"
author: "Luca Berton"
category: "configuration"
difficulty: "beginner"
timeToComplete: "15 minutes"
kubernetesVersion: "1.28+"
tags:
  - "kubectl"
  - "cheat-sheet"
  - "cka"
  - "reference"
  - "commands"
relatedRecipes:
  - "kubectl-run-pod-command"
  - "kubectl-get-pods-examples"
  - "kubectl-apply-vs-create"
  - "kubectl-exec-into-pod"
  - "kubectl-describe-pod-events"
---

> 💡 **Quick Answer:** Essential kubectl commands: `kubectl get pods -A` (all pods), `kubectl describe pod <name>` (details), `kubectl logs <pod>` (logs), `kubectl exec -it <pod> -- sh` (shell), `kubectl apply -f file.yaml` (deploy), `kubectl delete pod <name>` (remove). Set namespace: `kubectl config set-context --current --namespace=prod`.

## The Problem

kubectl has hundreds of commands. This cheat sheet covers the ones you'll use daily, organized by task.

## The Solution

### Context and Configuration

```bash
# View current context
kubectl config current-context

# List all contexts
kubectl config get-contexts

# Switch context
kubectl config use-context my-cluster

# Set default namespace
kubectl config set-context --current --namespace=production

# View kubeconfig
kubectl config view

# Merge kubeconfigs
KUBECONFIG=~/.kube/config:~/new-cluster.yaml kubectl config view --merge --flatten > merged.yaml
```

### Get Resources

```bash
# Pods
kubectl get pods                          # Current namespace
kubectl get pods -A                       # All namespaces
kubectl get pods -o wide                  # Extra info (node, IP)
kubectl get pods -l app=nginx             # By label
kubectl get pods --field-selector status.phase=Running
kubectl get pods --sort-by='.status.containerStatuses[0].restartCount'

# All resource types
kubectl get all                           # Common resources
kubectl get deploy,svc,ingress            # Specific types
kubectl api-resources                     # List all resource types

# Output formats
kubectl get pods -o yaml                  # Full YAML
kubectl get pods -o json                  # Full JSON
kubectl get pods -o name                  # Just names
kubectl get pods -o jsonpath='{.items[*].metadata.name}'
kubectl get pods -o custom-columns=NAME:.metadata.name,NODE:.spec.nodeName
```

### Create Resources

```bash
# From file
kubectl apply -f deployment.yaml
kubectl apply -f manifests/              # Entire directory
kubectl apply -f https://example.com/manifest.yaml

# Imperative
kubectl create deployment nginx --image=nginx:1.27 --replicas=3
kubectl create service clusterip nginx --tcp=80:80
kubectl create configmap myconfig --from-literal=key=value
kubectl create secret generic mysecret --from-literal=pass=secret
kubectl create namespace production
kubectl create job myjob --image=busybox -- echo hello

# Generate YAML
kubectl create deployment nginx --image=nginx:1.27 --dry-run=client -o yaml
kubectl run nginx --image=nginx:1.27 --dry-run=client -o yaml
```

### Modify Resources

```bash
# Update
kubectl apply -f updated.yaml
kubectl set image deployment/nginx nginx=nginx:1.28
kubectl scale deployment nginx --replicas=5
kubectl autoscale deployment nginx --min=2 --max=10 --cpu-percent=70

# Edit live
kubectl edit deployment nginx
kubectl patch deployment nginx -p '{"spec":{"replicas":3}}'
kubectl label pod nginx env=prod
kubectl annotate pod nginx description="web server"

# Rollout
kubectl rollout status deployment/nginx
kubectl rollout history deployment/nginx
kubectl rollout undo deployment/nginx
kubectl rollout restart deployment/nginx
```

### Delete Resources

```bash
# By name
kubectl delete pod nginx
kubectl delete deployment nginx

# By file
kubectl delete -f deployment.yaml

# By label
kubectl delete pods -l app=nginx

# Force delete (stuck pods)
kubectl delete pod nginx --grace-period=0 --force

# Delete namespace (ALL resources in it!)
kubectl delete namespace staging
```

### Debugging

```bash
# Logs
kubectl logs my-pod
kubectl logs my-pod -c sidecar           # Specific container
kubectl logs my-pod --previous            # Previous crash
kubectl logs my-pod -f                    # Follow/stream
kubectl logs my-pod --since=1h            # Last hour
kubectl logs -l app=nginx --all-containers

# Exec
kubectl exec -it my-pod -- sh
kubectl exec my-pod -- cat /etc/resolv.conf
kubectl exec my-pod -c sidecar -- env

# Describe
kubectl describe pod my-pod
kubectl describe node worker-1
kubectl describe svc my-service

# Debug
kubectl debug -it my-pod --image=busybox --target=my-container
kubectl debug node/worker-1 -it --image=ubuntu

# Port forward
kubectl port-forward pod/my-pod 8080:80
kubectl port-forward svc/my-service 8080:80

# Copy files
kubectl cp my-pod:/app/log.txt ./log.txt
kubectl cp ./config.yaml my-pod:/etc/config/
```

### Cluster Info

```bash
# Cluster state
kubectl cluster-info
kubectl get nodes
kubectl describe node worker-1
kubectl top nodes                         # CPU/memory usage
kubectl top pods -A                       # Pod resource usage

# Events
kubectl get events --sort-by='.lastTimestamp'
kubectl get events -A --field-selector reason=FailedScheduling

# API resources
kubectl api-resources
kubectl api-versions
kubectl explain pod.spec.containers       # Built-in docs
kubectl explain deployment.spec --recursive
```

### RBAC

```bash
# Check permissions
kubectl auth can-i create pods
kubectl auth can-i delete pods --as=jane@example.com
kubectl auth can-i '*' '*'                # Am I admin?
kubectl auth can-i --list                 # All my permissions
```

### Useful Aliases

```bash
# Add to ~/.bashrc or ~/.zshrc
alias k=kubectl
alias kgp='kubectl get pods'
alias kga='kubectl get all'
alias kgn='kubectl get nodes'
alias kd='kubectl describe'
alias kl='kubectl logs'
alias kaf='kubectl apply -f'
alias kdel='kubectl delete'
alias kex='kubectl exec -it'

# Enable autocomplete
source <(kubectl completion bash)
complete -F __start_kubectl k
```

## Key Takeaways

- `get`, `describe`, `logs`, `exec` — the four debugging pillars
- `apply -f` for declarative, `create` for imperative + YAML generation
- `-o wide`, `-o yaml`, `-o jsonpath` for different output needs
- `--dry-run=client -o yaml` generates templates without creating resources
- Set up aliases and bash completion for productivity
