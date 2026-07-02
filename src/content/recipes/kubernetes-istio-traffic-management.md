---
title: "Istio Traffic Management Kubernetes"
description: "Advanced Istio traffic management on Kubernetes. VirtualService routing, DestinationRule load balancing, traffic mirroring, fault injection."
publishDate: "2026-04-24"
author: "Luca Berton"
category: "networking"
difficulty: "advanced"
timeToComplete: "15 minutes"
kubernetesVersion: "1.28+"
tags:
  - "istio"
  - "traffic-management"
  - "virtual-service"
  - "circuit-breaker"
relatedRecipes:
  - "kubernetes-pod-security-standards"
  - "kubernetes-rbac-least-privilege"
  - "openshift-routes-vs-ingress"
---

> 💡 **Quick Answer:** Advanced Istio traffic management on Kubernetes. VirtualService routing, DestinationRule load balancing, traffic mirroring, fault injection, and circuit breaking.

## The Problem

Plain Kubernetes Services load-balance evenly across all healthy pods — there's no way to split traffic by percentage for a canary, route by header for a beta cohort, inject failures to test resilience, or trip a circuit breaker before a failing backend takes down its callers. Istio's VirtualService and DestinationRule add that layer on top of the Service.

## The Solution

### VirtualService + DestinationRule: Percentage-Based Splitting

`DestinationRule` defines named subsets from pod labels; `VirtualService` routes traffic across those subsets by weight:

```yaml
apiVersion: networking.istio.io/v1beta1
kind: VirtualService
metadata:
  name: product-service
spec:
  hosts: [product-service]
  http:
    - match:
        - headers: {user-group: {exact: beta-testers}}
      route:
        - destination: {host: product-service, subset: v2}
          weight: 100
    - route:
        - destination: {host: product-service, subset: v1}
          weight: 90
        - destination: {host: product-service, subset: v2}
          weight: 10
---
apiVersion: networking.istio.io/v1beta1
kind: DestinationRule
metadata:
  name: product-service
spec:
  host: product-service
  subsets:
    - name: v1
      labels: {version: v1}
    - name: v2
      labels: {version: v2}
```

### Header and Path-Based Routing

```yaml
apiVersion: networking.istio.io/v1beta1
kind: VirtualService
metadata:
  name: reviews-routing
spec:
  hosts: [reviews]
  http:
    - match: [{headers: {end-user: {exact: jason}}}]
      route: [{destination: {host: reviews, subset: v2}}]
    - match: [{headers: {user-agent: {prefix: "Mobile"}}}]
      route: [{destination: {host: reviews, subset: mobile-optimized}}]
    - route: [{destination: {host: reviews, subset: v1}}]   # default
```

```yaml
# Path-based: /v2/* to the new API version, /admin/* to a separate service
apiVersion: networking.istio.io/v1beta1
kind: VirtualService
metadata:
  name: api-routing
spec:
  hosts: [api.example.com]
  http:
    - match: [{uri: {prefix: "/v2/"}}]
      rewrite: {uri: "/"}
      route: [{destination: {host: api-service, subset: v2}}]
    - match: [{uri: {prefix: "/admin/"}}]
      route: [{destination: {host: admin-service, subset: v1}}]
    - route: [{destination: {host: frontend-service}}]   # default
```

### Fault Injection for Resilience Testing

Inject a delay or error behind a header so you can trigger it on demand without affecting real traffic:

```yaml
apiVersion: networking.istio.io/v1beta1
kind: VirtualService
metadata:
  name: fault-injection
spec:
  hosts: [payment-service]
  http:
    - match: [{headers: {x-test-scenario: {exact: "latency"}}}]
      fault: {delay: {percentage: {value: 100}, fixedDelay: 7s}}
      route: [{destination: {host: payment-service}}]
    - match: [{headers: {x-test-scenario: {exact: "error"}}}]
      fault: {abort: {percentage: {value: 50}, httpStatus: 500}}
      route: [{destination: {host: payment-service}}]
```

### Circuit Breaking

`outlierDetection` ejects a pod from the load-balancing pool after repeated failures — the mesh-level equivalent of a circuit breaker:

```yaml
apiVersion: networking.istio.io/v1beta1
kind: DestinationRule
metadata:
  name: circuit-breaker
spec:
  host: backend-service
  trafficPolicy:
    connectionPool:
      tcp: {maxConnections: 100}
      http: {http1MaxPendingRequests: 50, maxRequestsPerConnection: 2}
    outlierDetection:
      consecutiveErrors: 5
      interval: 30s
      baseEjectionTime: 30s
      maxEjectionPercent: 50
```

### Timeouts, Retries, and Traffic Mirroring

```yaml
apiVersion: networking.istio.io/v1beta1
kind: VirtualService
metadata:
  name: timeout-retry
spec:
  hosts: [api-service]
  http:
    - route: [{destination: {host: api-service}}]
      timeout: 10s
      retries: {attempts: 3, perTryTimeout: 2s, retryOn: "gateway-error,connect-failure,refused-stream,5xx"}
```

```yaml
# Mirror 10% of production traffic to a test subset — observe without affecting real responses
apiVersion: networking.istio.io/v1beta1
kind: VirtualService
metadata:
  name: traffic-mirroring
spec:
  hosts: [api-service]
  http:
    - route: [{destination: {host: api-service, subset: v1}, weight: 100}]
      mirror: {host: api-service, subset: v2-test}
      mirrorPercentage: {value: 10.0}
```

## Verification

```bash
# Confirm the traffic split matches the configured weights
for i in {1..100}; do kubectl exec -it curl-pod -- curl -s http://product-service:8080/version; done | sort | uniq -c

# Validate config and inspect what's applied
istioctl analyze
kubectl get virtualservice,destinationrule

# Check circuit breaker / outlier ejection stats from the sidecar
kubectl exec -it <pod-name> -c istio-proxy -- curl localhost:15000/stats | grep outlier

# Visualize the mesh
istioctl dashboard kiali
```

## Common Issues

| Issue | Cause | Fix |
|-------|-------|-----|
| Traffic not routing as configured | VirtualService/DestinationRule in different namespaces, or subset labels don't match pod labels | Keep both in the same namespace; verify `subsets[].labels` matches the pod's actual `version` label |
| Circuit breaker never trips | `outlierDetection` thresholds too high, or `connectionPool` limits never hit | Lower `consecutiveErrors`, generate enough load to actually exceed the pool limits |
| High latency after adding retries | Retries compound — 3 attempts × perTryTimeout adds up | Reduce `attempts` or `perTryTimeout`; retries should recover transient failures, not mask a slow upstream |
| VirtualService has no effect on traffic from outside the mesh | VirtualService without a `gateway` applies to in-mesh traffic only | Define a `Gateway` and reference it in the VirtualService's `gateways:` field for ingress traffic |

## Best Practices

- **Start with simple weighted routing**, add header/path matching and fault injection once the basics work
- **Keep VirtualService and DestinationRule together** — same namespace, reviewed as a pair, since they only work in combination
- **Mirror traffic before a real canary** — validate the new version against production traffic shape with zero risk, since mirrored responses are discarded
- **Set a timeout on every route** — without one, a hung upstream can hold connections indefinitely
- **Monitor Envoy stats (`/stats/prometheus`) when tuning circuit breakers** — thresholds set without traffic data are guesses

## Key Takeaways

- `DestinationRule` defines subsets from pod labels; `VirtualService` routes traffic across those subsets — you need both together
- Weighted routing, header matching, and path matching all compose in the same `http[].match`/`route` structure
- Fault injection (`fault.delay`/`fault.abort`) lets you chaos-test resilience on demand, gated behind a header so it never hits real traffic
- `outlierDetection` in `DestinationRule.trafficPolicy` is Istio's circuit breaker — it ejects consistently-failing pods from the load-balancing pool
- A `VirtualService` with no `gateways:` field only applies to mesh-internal traffic — ingress traffic needs an explicit `Gateway`
