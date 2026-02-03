---
title: "Essential kubectl Commands for Debugging"
description: "Master kubectl debugging commands to troubleshoot Kubernetes issues. Learn to inspect pods, view logs, debug networking, and diagnose cluster problems."
category: "troubleshooting"
difficulty: "beginner"
publishDate: "2026-01-22"
tags: ["kubectl", "debugging", "troubleshooting", "cli", "diagnostics"]
---

> 💡 **Quick Answer:** Debug workflow: `kubectl get pods` (status), `kubectl describe pod <name>` (events/errors), `kubectl logs <pod> [-c container] [--previous]` (logs), `kubectl exec -it <pod> -- sh` (shell access). For crashed pods, use `kubectl logs --previous` to see pre-crash logs.
>
> **Key commands:** `kubectl get events --sort-by=.metadata.creationTimestamp` for cluster-wide issues; `kubectl top pods` for resource usage.
>
> **Gotcha:** Add `-o wide` for node/IP info, `-A` for all namespaces, `--watch` for live updates.

# Essential kubectl Commands for Debugging

Effective kubectl usage is crucial for debugging Kubernetes issues. This guide covers essential commands for diagnosing problems with pods, services, networking, and cluster resources.

## Pod Debugging

### Get Pod Information

```bash
# List pods with status
kubectl get pods
kubectl get pods -o wide  # Include node and IP

# List pods in all namespaces
kubectl get pods -A

# Filter by label
kubectl get pods -l app=nginx

# Get pod with specific output
kubectl get pod my-pod -o yaml
kubectl get pod my-pod -o json

# Watch pods in real-time
kubectl get pods -w
```

### Describe Pod Details

```bash
# Full pod description including events
kubectl describe pod my-pod

# Common issues visible in describe:
# - ImagePullBackOff (wrong image name/tag)
# - CrashLoopBackOff (app keeps crashing)
# - Pending (no nodes available)
# - ContainerCreating (pulling image or mounting volumes)
```

### View Pod Logs

```bash
# Current logs
kubectl logs my-pod

# Previous container logs (after restart)
kubectl logs my-pod --previous

# Follow logs in real-time
kubectl logs my-pod -f

# Last N lines
kubectl logs my-pod --tail=100

# Logs since time
kubectl logs my-pod --since=1h
kubectl logs my-pod --since=30m

# Logs from specific container
kubectl logs my-pod -c container-name

# Logs from all containers
kubectl logs my-pod --all-containers

# Logs from multiple pods
kubectl logs -l app=nginx --all-containers
```

### Execute Commands in Pod

```bash
# Run command in pod
kubectl exec my-pod -- ls /app

# Interactive shell
kubectl exec -it my-pod -- /bin/bash
kubectl exec -it my-pod -- /bin/sh  # For minimal images

# Specific container
kubectl exec -it my-pod -c container-name -- /bin/bash

# Run as different user
kubectl exec -it my-pod -- su - appuser
```

### Debug with Ephemeral Containers

```bash
# Add debug container to running pod
kubectl debug -it my-pod --image=busybox --target=my-container

# Debug with networking tools
kubectl debug -it my-pod --image=nicolaka/netshoot

# Debug node issues
kubectl debug node/my-node -it --image=busybox
```

## Service and Networking

### Verify Service

```bash
# List services
kubectl get svc
kubectl get svc -o wide

# Describe service
kubectl describe svc my-service

# Check endpoints
kubectl get endpoints my-service

# Test service DNS
kubectl run tmp --image=busybox --rm -it -- nslookup my-service
kubectl run tmp --image=busybox --rm -it -- nslookup my-service.namespace.svc.cluster.local
```

### Test Connectivity

```bash
# Test from within cluster
kubectl run tmp --image=nicolaka/netshoot --rm -it -- bash

# Inside the pod:
curl http://my-service:8080
wget -qO- http://my-service:8080
nc -zv my-service 8080

# Test external connectivity
kubectl run tmp --image=busybox --rm -it -- wget -qO- http://example.com

# Port forward for local testing
kubectl port-forward pod/my-pod 8080:80
kubectl port-forward svc/my-service 8080:80
kubectl port-forward deployment/my-deployment 8080:80
```

### Check Ingress

```bash
# List ingresses
kubectl get ingress -A

# Describe ingress
kubectl describe ingress my-ingress

# Check ingress controller logs
kubectl logs -n ingress-nginx -l app.kubernetes.io/component=controller
```

## Resource Status

### Get Resource Events

```bash
# All events
kubectl get events

# Events sorted by time
kubectl get events --sort-by='.lastTimestamp'

# Events for specific resource
kubectl get events --field-selector involvedObject.name=my-pod

# Watch events
kubectl get events -w
```

### Check Resource Usage

```bash
# Node resources
kubectl top nodes

# Pod resources
kubectl top pods
kubectl top pods -A
kubectl top pods --containers  # Per container

# Sort by CPU/memory
kubectl top pods --sort-by=cpu
kubectl top pods --sort-by=memory
```

### Describe Resources

```bash
# Nodes
kubectl describe node my-node

# Deployments
kubectl describe deployment my-deployment

# Check resource quotas
kubectl describe resourcequota -n my-namespace

# Check limit ranges
kubectl describe limitrange -n my-namespace
```

## Deployment Debugging

### Rollout Status

```bash
# Check deployment status
kubectl rollout status deployment/my-deployment

# Rollout history
kubectl rollout history deployment/my-deployment

# Rollback
kubectl rollout undo deployment/my-deployment
kubectl rollout undo deployment/my-deployment --to-revision=2

# Pause/resume rollout
kubectl rollout pause deployment/my-deployment
kubectl rollout resume deployment/my-deployment
```

### ReplicaSet Issues

```bash
# List replicasets
kubectl get rs

# Describe replicaset
kubectl describe rs my-deployment-abc123

# Check why pods aren't created
kubectl describe rs my-deployment-abc123 | grep -A 5 Events
```

## Configuration Debugging

### ConfigMaps and Secrets

```bash
# View configmap
kubectl get configmap my-config -o yaml

# View secret (base64 encoded)
kubectl get secret my-secret -o yaml

# Decode secret value
kubectl get secret my-secret -o jsonpath='{.data.password}' | base64 -d

# Check if configmap is mounted correctly
kubectl exec my-pod -- cat /etc/config/my-key
```

### Environment Variables

```bash
# View all env vars in pod
kubectl exec my-pod -- env

# Check specific env var
kubectl exec my-pod -- printenv MY_VAR

# View env from spec
kubectl get pod my-pod -o jsonpath='{.spec.containers[0].env}'
```

## Storage Debugging

### PersistentVolume Issues

```bash
# List PVs and PVCs
kubectl get pv
kubectl get pvc -A

# Describe PVC
kubectl describe pvc my-pvc

# Check if volume is mounted
kubectl exec my-pod -- df -h
kubectl exec my-pod -- mount | grep my-volume

# Check volume permissions
kubectl exec my-pod -- ls -la /data
```

## Node Debugging

### Node Status

```bash
# Node status
kubectl get nodes
kubectl describe node my-node

# Check node conditions
kubectl get nodes -o jsonpath='{range .items[*]}{.metadata.name}{"\t"}{.status.conditions[-1].type}{"\t"}{.status.conditions[-1].status}{"\n"}{end}'

# Node labels
kubectl get nodes --show-labels

# Cordon/drain node
kubectl cordon my-node
kubectl drain my-node --ignore-daemonsets --delete-emptydir-data
kubectl uncordon my-node
```

## Cluster Debugging

### API Server

```bash
# Check cluster info
kubectl cluster-info
kubectl cluster-info dump

# API versions
kubectl api-versions
kubectl api-resources

# Check component status (deprecated but useful)
kubectl get componentstatuses
```

### RBAC Debugging

```bash
# Check permissions
kubectl auth can-i get pods
kubectl auth can-i '*' '*'  # Check admin access

# Check as specific user
kubectl auth can-i get pods --as=system:serviceaccount:default:my-sa

# List all permissions
kubectl auth can-i --list
```

## Useful One-Liners

```bash
# Get all failing pods
kubectl get pods -A --field-selector=status.phase!=Running,status.phase!=Succeeded

# Get pods not in Running state
kubectl get pods -A | grep -v Running | grep -v Completed

# Get all images in cluster
kubectl get pods -A -o jsonpath='{range .items[*]}{.spec.containers[*].image}{"\n"}{end}' | sort -u

# Get pods sorted by restart count
kubectl get pods --sort-by='.status.containerStatuses[0].restartCount'

# Delete all failed pods
kubectl delete pods --field-selector=status.phase=Failed -A

# Get pods on specific node
kubectl get pods -A --field-selector spec.nodeName=my-node

# Get pod IPs
kubectl get pods -o wide -o custom-columns='NAME:.metadata.name,IP:.status.podIP'

# Force delete stuck pod
kubectl delete pod my-pod --grace-period=0 --force
```

## Summary

Effective debugging starts with `kubectl get` and `kubectl describe` to understand resource state. Use `kubectl logs` for application issues, `kubectl exec` for interactive debugging, and `kubectl debug` for ephemeral containers. For networking, test with port-forward and temporary pods with network tools. Always check events and resource usage when troubleshooting.

---

## 📘 Go Further with Kubernetes Recipes

**Love this recipe? There's so much more!** This is just one of **100+ hands-on recipes** in our comprehensive **[Kubernetes Recipes book](https://amzn.to/3DzC8QA)**.

Inside the book, you'll master:
- ✅ Production-ready deployment strategies
- ✅ Advanced networking and security patterns  
- ✅ Observability, monitoring, and troubleshooting
- ✅ Real-world best practices from industry experts

> *"The practical, recipe-based approach made complex Kubernetes concepts finally click for me."*

**👉 [Get Your Copy Now](https://amzn.to/3DzC8QA)** — Start building production-grade Kubernetes skills today!
