---
title: "Kubernetes 1.36 Mixed Version Proxy"
description: "Use the Mixed Version Proxy in Kubernetes 1.36 to handle API version skew during rolling upgrades. Ensures API availability across mixed control plane versions."
tags:
  - "kubernetes-1.36"
  - "api-server"
  - "upgrades"
  - "high-availability"
  - "control-plane"
category: "configuration"
publishDate: "2026-05-03"
author: "Luca Berton"
difficulty: "advanced"
relatedRecipes:
  - "kubernetes-1-36-graceful-leader-transition"
  - "kubernetes-kubeadm-upgrade-guide"
  - "etcd-backup-restore-kubernetes"
---

> 💡 **Quick Answer:** The **Mixed Version Proxy** (KEP-4020) progresses in Kubernetes 1.36, enabling API servers at different versions to proxy requests between each other during rolling upgrades. New API resources remain available even when only some API servers have been upgraded.

## The Problem

During a rolling upgrade of a multi-API-server HA cluster:

- API server A is upgraded to 1.36 (has new resources)
- API server B is still on 1.35 (doesn't know about new resources)
- Client requests hitting B for 1.36-only resources fail with 404
- No way to route version-specific requests to the right server

## The Solution

The Mixed Version Proxy detects which API server supports which resources and proxies requests accordingly.

### How It Works

```
Client → Load Balancer → API Server B (v1.35)
                          ├── /api/v1/pods → handles locally ✓
                          └── /apis/scheduling.k8s.io/v1alpha2/podgroups
                              → proxies to API Server A (v1.36) ✓
```

### Enable Mixed Version Proxy

```bash
kube-apiserver \
  --feature-gates=UnknownVersionInteroperabilityProxy=true \
  --peer-advertise-address=10.0.0.1 \
  --peer-advertise-port=6443
```

### kubeadm Configuration

```yaml
apiVersion: kubeadm.k8s.io/v1beta4
kind: ClusterConfiguration
apiServer:
  extraArgs:
    - name: feature-gates
      value: "UnknownVersionInteroperabilityProxy=true"
    - name: peer-advertise-address
      value: "$(HOST_IP)"
    - name: peer-advertise-port
      value: "6443"
```

### Verify Peer Discovery

```bash
# Check API server peers
kubectl get --raw /apis/apidiscovery.k8s.io/v2 | jq '.items[] | .metadata.name'

# View StorageVersion objects (tracks which API server serves which version)
kubectl get storageversions
```

## Common Issues

### Proxy loop between API servers
- **Cause**: Both servers think the other should handle the request
- **Fix**: Ensure `peer-advertise-address` is correctly set on each server

### Latency spike during upgrades
- **Cause**: Proxied requests add an extra hop
- **Fix**: Expected behavior; completes once all servers are upgraded

## Best Practices

1. **Enable on all API servers** — both old and new versions need the feature gate
2. **Use consistent `peer-advertise-address`** — each server must be reachable by peers
3. **Monitor proxy metrics** — track how many requests are being proxied
4. **Upgrade quickly** — mixed version state should be temporary
5. **Test with canary upgrades** — upgrade one API server first and verify proxy works

## Key Takeaways

- Mixed Version Proxy progresses in **Kubernetes 1.36** (KEP-4020)
- API servers proxy requests for unknown resources to peers that support them
- Ensures zero API downtime during rolling control plane upgrades
- Requires `peer-advertise-address` configuration on all API servers
- Temporary state — remove version skew by completing the upgrade
