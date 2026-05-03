---
title: "Kubernetes 1.36 Statusz and Flagz Endpoints"
description: "Use /statusz and /flagz debug endpoints in Kubernetes 1.36 control plane components. Inspect runtime status and effective flag values without log parsing."
tags:
  - "kubernetes-1.36"
  - "debugging"
  - "control-plane"
  - "operations"
  - "troubleshooting"
category: "troubleshooting"
publishDate: "2026-05-03"
author: "Luca Berton"
difficulty: "beginner"
relatedRecipes:
  - "kubernetes-kubectl-debug-guide"
  - "kubernetes-1-36-graceful-leader-transition"
  - "kubernetes-1-36-native-histograms"
---

> 💡 **Quick Answer:** Kubernetes 1.36 adds **/statusz** and **/flagz** endpoints (KEP-4827, KEP-4828) to control plane components. Query runtime status and effective flag values via HTTP — no log parsing or process inspection required.

## The Problem

Debugging Kubernetes control plane components requires:

- Parsing verbose logs to find configuration issues
- Running `ps aux | grep kube` to check flag values
- SSHing into control plane nodes
- No standard way to check component health beyond `/healthz`

## The Solution

### /statusz — Component Runtime Status

```bash
# Check API server status
kubectl get --raw /statusz
# Output:
# ok
# Started: 2026-05-03T10:00:00Z
# Up: 8h15m
# Go version: go1.24.2
# Compiler: gc
# Platform: linux/amd64

# Check scheduler status
curl -k https://localhost:10259/statusz
```

### /flagz — Effective Flag Values

```bash
# View all effective flags on API server
kubectl get --raw /flagz
# Output shows ALL flags and their effective values:
# --advertise-address=10.0.0.1
# --allow-privileged=true
# --authorization-mode=Node,RBAC
# --enable-admission-plugins=NodeRestriction,PodSecurity
# --etcd-servers=https://10.0.0.1:2379
# --feature-gates=NativeHistograms=true,GracefulLeaderTransition=true
# --service-cluster-ip-range=10.96.0.0/12
# ...

# Check specific component flags
curl -k https://localhost:10257/flagz    # Controller Manager
curl -k https://localhost:10259/flagz    # Scheduler
curl -k https://localhost:10250/flagz    # Kubelet
```

### Quick Debugging Commands

```bash
# Check which feature gates are enabled
kubectl get --raw /flagz | grep feature-gates

# Check if admission plugins are configured correctly
kubectl get --raw /flagz | grep admission

# Verify etcd endpoints
kubectl get --raw /flagz | grep etcd

# Check TLS configuration
kubectl get --raw /flagz | grep tls
```

### Monitoring Integration

```yaml
# Prometheus scrape config for statusz
scrape_configs:
  - job_name: 'k8s-control-plane-status'
    metrics_path: /statusz
    kubernetes_sd_configs:
      - role: endpoints
    relabel_configs:
      - source_labels: [__meta_kubernetes_namespace, __meta_kubernetes_service_name]
        action: keep
        regex: kube-system;kube-apiserver
```

## Common Issues

### Endpoint returns 404
- **Cause**: Feature gate not enabled or component version < 1.36
- **Fix**: Enable `ComponentStatusz` and `ComponentFlagz` feature gates

### Unauthorized access to /flagz
- **Cause**: RBAC doesn't allow access to debug endpoints
- **Fix**: Debug endpoints require authenticated access; use kubectl or service account

## Best Practices

1. **Use /flagz for configuration audits** — verify all components have consistent flags
2. **Check /statusz after upgrades** — confirm components restarted with correct version
3. **Restrict access** — /flagz may expose sensitive configuration; limit to cluster-admin
4. **Integrate with monitoring** — scrape /statusz for uptime tracking
5. **Use in runbooks** — add /flagz checks to troubleshooting procedures

## Key Takeaways

- **/statusz** (KEP-4827) and **/flagz** (KEP-4828) progress in **Kubernetes 1.36**
- Query component runtime status and effective flags via HTTP
- Available on API server, scheduler, controller-manager, and kubelet
- Eliminates need for SSH + process inspection during debugging
- Restrict access — flag values may contain sensitive configuration
