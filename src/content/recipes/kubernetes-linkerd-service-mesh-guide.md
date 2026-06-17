---
title: "Linkerd: Lightweight K8s Service Mesh"
description: "Deploy Linkerd service mesh in Kubernetes for mTLS, traffic splitting, retries, and observability. A lighter, zero-config alternative to Istio."
publishDate: "2026-05-02"
author: "Luca Berton"
category: "networking"
difficulty: "intermediate"
timeToComplete: "12 minutes"
kubernetesVersion: "1.28+"
tags:
  - "linkerd"
  - "service-mesh"
  - "networking"
  - "mtls"
  - "observability"
relatedRecipes:
  - "kubernetes-service-mesh-istio-guide"
  - "kubernetes-gateway-api-guide"
  - "kubernetes-networkpolicy-guide"
  - "kubernetes-cilium-networking-guide"
---

> 💡 **Quick Answer:** Linkerd is the lightweight CNCF service mesh — simpler than Istio, ~10MB sidecar, zero-config mTLS. Install: `linkerd install --crds | kubectl apply -f -` then `linkerd install | kubectl apply -f -`. Inject sidecars: `kubectl annotate namespace default linkerd.io/inject=enabled`. Get mTLS, golden metrics (success rate, latency, throughput), retries, and traffic splitting out of the box.

## The Problem

You need service mesh features but:

- Istio is complex and resource-heavy
- You just need mTLS and observability
- Minimal operational overhead is critical
- Quick time-to-value matters
- Resource-constrained environments (edge, small clusters)

## The Solution

### Install Linkerd

```bash
# Install CLI
curl -fsL https://run.linkerd.io/install | sh
export PATH=$HOME/.linkerd2/bin:$PATH

# Verify cluster is ready
linkerd check --pre

# Install CRDs
linkerd install --crds | kubectl apply -f -

# Install control plane
linkerd install | kubectl apply -f -

# Verify installation
linkerd check
# All checks should pass ✅

# Install viz extension (dashboard + metrics)
linkerd viz install | kubectl apply -f -
linkerd viz check
```

### Inject Sidecars

```bash
# Annotate namespace for auto-injection
kubectl annotate namespace production linkerd.io/inject=enabled

# Restart existing pods to get sidecar
kubectl rollout restart deployment -n production

# Or inject manually
kubectl get deploy my-app -o yaml | linkerd inject - | kubectl apply -f -

# Verify injection
kubectl get pods -n production
# NAME                     READY   STATUS
# my-app-xxx               2/2     Running   ← 2 containers = sidecar injected

# Check proxy status
linkerd viz stat deployment -n production
# NAME     MESHED   SUCCESS   RPS   LATENCY_P50   LATENCY_P99
# my-app   3/3      100.00%   45    2ms           15ms
# api      2/2      99.95%    120   5ms           50ms
```

### mTLS (Automatic)

```bash
# mTLS is ON by default — zero configuration!

# Verify mTLS
linkerd viz edges deployment -n production
# SRC        DST        SRC_NS       DST_NS       SECURED
# frontend   api        production   production   √
# api        database   production   production   √

# Check certificate identity
linkerd viz tap deployment/api -n production
# Shows mTLS status for each request

# mTLS identity format:
# <serviceaccount>.<namespace>.serviceaccount.identity.linkerd.cluster.local
```

### Traffic Split (Canary)

```yaml
# Using SMI TrafficSplit
apiVersion: split.smi-spec.io/v1alpha2
kind: TrafficSplit
metadata:
  name: api-canary
  namespace: production
spec:
  service: api                    # Root service
  backends:
  - service: api-stable
    weight: 900                   # 90%
  - service: api-canary
    weight: 100                   # 10%

# Services must exist:
# api          → root (clients connect here)
# api-stable   → current version pods
# api-canary   → new version pods
```

### Service Profiles (Retries, Timeouts)

```yaml
apiVersion: linkerd.io/v1alpha2
kind: ServiceProfile
metadata:
  name: api.production.svc.cluster.local
  namespace: production
spec:
  routes:
  - name: GET /api/orders
    condition:
      method: GET
      pathRegex: /api/orders
    isRetryable: true
    timeout: 5s
  
  - name: POST /api/orders
    condition:
      method: POST
      pathRegex: /api/orders
    isRetryable: false            # Don't retry writes
    timeout: 10s
  
  retryBudget:
    retryRatio: 0.2               # Max 20% extra requests
    minRetriesPerSecond: 10
    ttl: 10s
```

### Dashboard and Observability

```bash
# Open Linkerd dashboard
linkerd viz dashboard

# CLI metrics
linkerd viz stat deployment -n production
linkerd viz stat pod -n production

# Top (live requests)
linkerd viz top deployment/api -n production

# Tap (live request stream)
linkerd viz tap deployment/api -n production
# req id=0:0 proxy=in  src=10.244.1.5:54321 dst=10.244.2.8:8080 :method=GET :path=/api/orders
# rsp id=0:0 proxy=in  src=10.244.1.5:54321 dst=10.244.2.8:8080 :status=200 latency=3ms

# Routes (per-route metrics)
linkerd viz routes deployment/api -n production
# ROUTE                    SUCCESS   RPS   LATENCY_P50   LATENCY_P99
# GET /api/orders          100.00%   45    2ms           12ms
# POST /api/orders         99.95%    12    8ms           45ms
# [DEFAULT]                100.00%   3     1ms           5ms

# Grafana dashboards
linkerd viz dashboard --grafana
```

### Multi-Cluster

```bash
# Install multicluster extension
linkerd multicluster install | kubectl apply -f -

# Link clusters
linkerd multicluster link --cluster-name west | kubectl --context=east apply -f -

# Mirror services across clusters
kubectl label service api -n production mirror.linkerd.io/exported=true

# Service becomes available in other cluster as:
# api.production.svc.cluster.local (local)
# api-west.production.svc.cluster.local (remote)
```

### Linkerd vs Istio Comparison

```
Feature              | Linkerd            | Istio
---------------------|--------------------|-----------------
Complexity           | Simple             | Complex
Sidecar memory       | ~10MB              | ~50-100MB
mTLS                 | Zero-config        | Config required
Learning curve       | Hours              | Days/Weeks
Traffic management   | Basic (SMI)        | Advanced (VirtualService)
Protocol support     | HTTP/gRPC/TCP      | HTTP/gRPC/TCP/WebSocket
Custom resources     | Few                | Many
CNCF status          | Graduated          | Graduated
```

## Common Issues

**Sidecar not injected**

Namespace missing annotation. Add: `kubectl annotate ns <name> linkerd.io/inject=enabled`. Restart pods.

**"certificate expired" errors**

Linkerd trust anchor certificate expired. Rotate: `linkerd upgrade | kubectl apply -f -`.

**Metrics not showing**

Viz extension not installed or Prometheus not scraping. Check: `linkerd viz check`.

## Best Practices

- **Start with Linkerd** if you mainly need mTLS and observability
- **Use Service Profiles** for per-route retries and timeouts
- **Monitor golden signals** — success rate, latency, throughput
- **Auto-inject per namespace** — not globally
- **Rotate trust anchors** before expiry (default 1 year)

## Key Takeaways

- Linkerd is the simplest CNCF service mesh — zero-config mTLS
- ~10MB sidecar proxy — fraction of Istio's resource usage
- Golden metrics out of the box: success rate, latency, throughput
- TrafficSplit for canary deployments, ServiceProfile for retries/timeouts
- Best for teams wanting mesh benefits without Istio complexity
