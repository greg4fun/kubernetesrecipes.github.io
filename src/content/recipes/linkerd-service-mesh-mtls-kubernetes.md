---
title: "Kubernetes Linkerd Service Mesh mTLS Guide"
description: "Deploy Linkerd service mesh on Kubernetes for automatic mTLS, traffic observability, and reliability features. Zero-config encryption, per-route"
tags:
  - "linkerd"
  - "service-mesh"
  - "mtls"
  - "observability"
  - "traffic-management"
category: "networking"
publishDate: "2026-06-01"
author: "Luca Berton"
difficulty: "intermediate"
relatedRecipes:
  - "kubernetes-network-policy-guide"
---

> 💡 **Quick Answer:** Linkerd provides automatic mutual TLS (mTLS) between all meshed pods with zero application changes. Install the control plane (`linkerd install`), inject the sidecar proxy (`linkerd inject`), and all pod-to-pod communication is encrypted and authenticated. Get per-route golden metrics (success rate, latency, throughput) via the Linkerd dashboard or Prometheus.

## The Problem

- Pod-to-pod traffic is unencrypted by default — anyone on the network can sniff it
- No visibility into per-service success rates and latencies without instrumentation
- Implementing retries, timeouts, and circuit breaking in every service is tedious
- mTLS with cert-manager requires per-service certificate management
- Need traffic shifting for canary deployments without application code changes

## The Solution

### Install Linkerd

```bash
# Install CLI
curl -fsL https://run.linkerd.io/install | sh
export PATH=$HOME/.linkerd2/bin:$PATH

# Verify cluster readiness
linkerd check --pre

# Install control plane
linkerd install --crds | kubectl apply -f -
linkerd install | kubectl apply -f -

# Verify installation
linkerd check

# Install observability extension (Prometheus + dashboard)
linkerd viz install | kubectl apply -f -
linkerd viz check
```

### Inject Sidecar (Enable mTLS)

```bash
# Inject entire namespace (all new pods get sidecar)
kubectl annotate namespace production linkerd.io/inject=enabled

# Restart existing deployments to pick up sidecar
kubectl rollout restart deployment -n production

# Or inject specific deployment
kubectl get deployment my-app -n production -o yaml | \
  linkerd inject - | kubectl apply -f -

# Verify mTLS is active
linkerd viz edges -n production
# SRC          DST          SRC_NS      DST_NS      SECURED
# frontend     api-server   production  production  √
# api-server   database     production  production  √
```

### Verify Encryption

```bash
# Check if traffic is secured
linkerd viz tap deployment/api-server -n production
# req id=0:0 proxy=in  src=10.0.1.5:54321 dst=10.0.2.10:8080 tls=true :method=GET :path=/api/health

# Dashboard
linkerd viz dashboard &
# Opens browser with per-service golden metrics
```

### Traffic Splitting (Canary)

```yaml
# Split traffic between stable and canary
apiVersion: split.smi-spec.io/v1alpha2
kind: TrafficSplit
metadata:
  name: api-server-split
  namespace: production
spec:
  service: api-server
  backends:
    - service: api-server-stable
      weight: 900    # 90%
    - service: api-server-canary
      weight: 100    # 10%
```

### Service Profiles (Retries + Timeouts)

```yaml
apiVersion: linkerd.io/v1alpha2
kind: ServiceProfile
metadata:
  name: api-server.production.svc.cluster.local
  namespace: production
spec:
  routes:
    - name: "GET /api/health"
      condition:
        method: GET
        pathRegex: "/api/health"
      isRetryable: true
      timeout: 5s
    - name: "POST /api/orders"
      condition:
        method: POST
        pathRegex: "/api/orders"
      isRetryable: false    # Don't retry non-idempotent
      timeout: 30s
  retryBudget:
    retryRatio: 0.2         # Max 20% extra load from retries
    minRetriesPerSecond: 10
    ttl: 10s
```

### Observability (Golden Metrics)

```bash
# Per-deployment metrics
linkerd viz stat deployment -n production
# NAME          MESHED   SUCCESS   RPS    LATENCY_P50   LATENCY_P95   LATENCY_P99
# api-server    3/3      99.8%     150    5ms           25ms          100ms
# frontend      2/2      100.0%    80     2ms           10ms          50ms
# database      1/1      99.5%     200    3ms           15ms          80ms

# Per-route metrics
linkerd viz routes deployment/api-server -n production
# ROUTE                  SUCCESS   RPS   LATENCY_P50   LATENCY_P95   LATENCY_P99
# GET /api/health        100.0%    10    1ms           2ms           5ms
# GET /api/users         99.9%     50    8ms           30ms          120ms
# POST /api/orders       99.5%     20    15ms          50ms          200ms

# Top (real-time request stream)
linkerd viz top deployment/api-server -n production
```

### Authorization Policies (Zero-Trust Beyond Encryption)

mTLS encrypts and authenticates connections, but doesn't by itself restrict *which* services can talk to which — that's what `Server`/`ServerAuthorization` add:

```yaml
apiVersion: policy.linkerd.io/v1beta1
kind: Server
metadata:
  name: backend-server
  namespace: production
spec:
  podSelector: {matchLabels: {app: backend}}
  port: 8080
  proxyProtocol: HTTP/1
---
apiVersion: policy.linkerd.io/v1beta1
kind: ServerAuthorization
metadata:
  name: frontend-to-backend
  namespace: production
spec:
  server: {name: backend-server}
  client:
    meshTLS:
      serviceAccounts: [{name: frontend, namespace: production}]
```

```yaml
# Deny-by-default: nothing can reach backend-server unless explicitly authorized above
apiVersion: policy.linkerd.io/v1beta1
kind: AuthorizationPolicy
metadata:
  name: deny-all
  namespace: production
spec:
  targetRef: {group: policy.linkerd.io, kind: Server, name: backend-server}
  requiredAuthenticationRefs: []
```

### Production Hardening

```bash
# HA control plane — multiple replicas, PDB, strict webhook failure policy
linkerd install --ha | kubectl apply -f -
```

```yaml
# Per-deployment proxy resource tuning and protocol-detection bypass
metadata:
  annotations:
    config.linkerd.io/proxy-cpu-request: "200m"
    config.linkerd.io/proxy-memory-limit: "256Mi"
    config.linkerd.io/skip-outbound-ports: "3306,6379"   # databases, Redis — not HTTP
```

### Multi-Cluster (Federating Two Meshes)

```bash
# On the target cluster
linkerd multicluster install | kubectl apply -f -
# On the source cluster
linkerd multicluster link --cluster-name target | kubectl apply -f -
linkerd multicluster check
```

```yaml
# Label a Service for export to linked clusters
metadata:
  labels: {mirror.linkerd.io/exported: "true"}
```

### Linkerd vs Istio

| | Linkerd | Istio |
|---|---------|-------|
| Proxy resource usage | Very light (~10MB) | Heavier (~50MB) |
| mTLS | Automatic, on by default | Configurable |
| Traffic management | Basic (SMI TrafficSplit) | Advanced (VirtualService/DestinationRule) |
| Learning curve | Low | High |
| Best fit | mTLS + observability with minimal ops overhead | Fine-grained traffic control, fault injection, multi-protocol |

## Common Issues

### Sidecar not injected — pods running without proxy
- **Cause**: Namespace not annotated; or pod has `linkerd.io/inject: disabled`
- **Fix**: `kubectl annotate ns <ns> linkerd.io/inject=enabled`; restart pods

### mTLS not securing traffic between namespaces
- **Cause**: Destination pods not meshed (no sidecar)
- **Fix**: Both source AND destination must have Linkerd sidecar injected

### High latency after enabling Linkerd
- **Cause**: Sidecar proxy adds ~1ms per hop; or resource limits too low on proxy
- **Fix**: Normal for <2ms added latency; increase proxy resources if higher

### "connection reset" errors after injection
- **Cause**: Application using protocols Linkerd can't proxy (non-HTTP, gRPC without h2)
- **Fix**: Mark port as opaque: `config.linkerd.io/opaque-ports: "3306,6379"` (skips protocol detection)

## Best Practices

1. **Inject at namespace level** — ensures all pods get mTLS automatically
2. **Use ServiceProfiles for retries** — only retry idempotent operations
3. **Set retry budgets** — prevent retry storms (20% extra load max)
4. **Monitor golden metrics** — success rate, latency, throughput per service
5. **Mark non-HTTP ports as opaque** — databases, Redis, custom protocols
6. **Use traffic splits for canary** — gradual rollout with instant rollback

## Key Takeaways

- Linkerd provides automatic mTLS with zero application changes — just inject the sidecar
- Sidecar injection via namespace annotation: `linkerd.io/inject=enabled`
- Golden metrics (success rate, RPS, latency percentiles) per service and per route
- ServiceProfiles configure per-route retries, timeouts, and retry budgets
- TrafficSplit enables canary deployments with weighted traffic distribution
- Lighter than Istio — focused on simplicity, security, and observability
- `linkerd viz stat` and `linkerd viz routes` — instant service health visibility
