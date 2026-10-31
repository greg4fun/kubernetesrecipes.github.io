---
title: "What's New in Gateway API v1.7.0: HTTPRoute Retries Go Stable"
description: "Gateway API v1.7.0 promotes HTTPRoute retries to Standard, adds 5 experimental GEPs, and ships breaking changes to SessionPersistence and XBackend CRDs."
publishDate: "2026-10-30"
author: "Luca Berton"
category: "networking"
difficulty: "intermediate"
timeToComplete: "20 minutes"
kubernetesVersion: "1.30+"
tags:
  - "gateway-api"
  - "httproute"
  - "retries"
  - "session-persistence"
  - "crd-upgrade"
  - "conformance"
  - "kubernetes-sigs"
---
> 💡 **Quick Answer:** Gateway API v1.7.0 graduates HTTPRoute retries (`codes`, `attempts`, `backoff`) to the Standard channel and adds six new Experimental GEPs (Gateway Address Routability, Attribute Dictionary, Backend Session Persistence, Pre-routing Filters, ClusterTrustBundle refs, TelemetryPolicy). It also ships breaking changes to the Experimental SessionPersistence and `XBackend` CRDs that require a manifest review before upgrading.

## The Problem

Operators running the Experimental channel of Gateway API need to know which CRD fields moved or were removed before applying v1.7.0, and which previously-experimental features (like HTTPRoute retries) are now safe to depend on in the Standard channel.

## The Solution

Upgrade the CRDs for the channel(s) in use, migrate any manifests touching `SessionPersistence` or `XBackend`, and re-run conformance tests against the controller implementation before rolling to production.

## What's New

### Graduated to Standard
- **HTTPRoute Retries (GEP-1731)**: `retry.codes`, `retry.attempts`, `retry.backoff` are now Standard-channel fields. `backoff` remains implementation-specific (jitter varies by implementation). Conformance features `HTTPRouteRetryCodes` and `HTTPRouteRetryConnectionError` are now part of Standard conformance. (#5357, #5359)

### New in Experimental
- **Gateway Address Routability (GEP-5093)**: per-address routability scope on Gateway (`Cluster`, empty, or a domain-prefixed value). (#5304)
- **Standardized Attribute Dictionary (GEP-5253)**: OTel-based shared traffic attributes for use by `XTelemetryPolicy` and similar features. (#5256)
- **Session Persistence on Backend (GEP-1619 / GEP-4894)**: session persistence now configured on `XBackend`; route-inline and `BackendTrafficPolicy` attachment points are deprecated. (#4876, #5298)
- **Pre-routing Filters (GEP-5224)**: new `GatewayListenerFilters` feature — listener filters that run before routing, for external auth / payload processing on Gateway and `ListenerSet` listeners. (#5315, #5370)
- **ClusterTrustBundle in `caCertificateRefs` (GEP-5075)**: `BackendTLSPolicy` and Gateway frontend TLS can reference a `ClusterTrustBundle` instead of per-namespace CA ConfigMaps/Secrets. (#5272, #5356)
- **TelemetryPolicy for Distributed Tracing (GEP-4768)**: new `XTelemetryPolicy` API for vendor-neutral tracing config on Gateways (metrics/access logs not yet covered). (#5323)

### Breaking Changes (Experimental channel only — no impact on Standard)
- `SessionPersistence`: `sessionName` → `cookie.name` (Extended, optional) and `header.name` (Core, required); `cookieConfig` renamed to `cookie`; new `HeaderConfig` type. (#4873)
- `SessionPersistence`: cookie `Path` now defaults to `/` instead of being derived from route matches; new `cookie.path` (Extended) for explicit control. (#5046)
- Route-inline and `BackendTrafficPolicy` session persistence are **deprecated** in favor of the `XBackend` resource. (#4876)
- `XBackend`: `spec.port.port` renamed to `spec.port.number`; `spec.port.name` removed; `backendRef.port` is now **prohibited** when the backendRef targets an `XBackend`. (#5287)
- Conformance: `HTTPRouteRetry` and `HTTPRouteRetryBackendTimeout` features removed; `HTTPRouteRetryCodes` added, `HTTPRouteRetryConnectionError` retained. (#5167)
- Conformance: `HTTPRouteBackendRequestRedirect` feature and its test removed. (#5279)

### Go / Build
- `BackendAncestorStatus.AncestorRef` renamed in generated Go types to match docs/JSON serialization. (#5187)
- `ForwardBodyConfig.MaxSize` type changed from `uint16` to `int32`. (#5099)
- Go toolchain bumped to 1.27 and Kubernetes dependencies to v0.37. (#5297, #5232, #5388)

## Upgrade Steps

1. Check which SessionPersistence and `XBackend` fields are currently in use, if on the Experimental channel:

```bash
kubectl get backendtrafficpolicy,xbackend -A -o yaml | grep -E 'sessionName|cookieConfig|port:\s|name:\s' 
```

2. Apply the Standard channel CRDs:

```bash
kubectl apply -f https://github.com/kubernetes-sigs/gateway-api/releases/download/v1.7.0/standard-install.yaml
```

3. If you run the Experimental channel, apply those CRDs instead (superset of Standard):

```bash
kubectl apply -f https://github.com/kubernetes-sigs/gateway-api/releases/download/v1.7.0/experimental-install.yaml
```

4. Migrate any manifests using the old SessionPersistence/XBackend fields:

```yaml
# before
sessionPersistence:
  sessionName: my-session
  cookieConfig:
    lifetimeType: Permanent

# after
sessionPersistence:
  cookie:
    name: my-session
    lifetimeType: Permanent
```

```yaml
# XBackend before
spec:
  port:
    port: 8080
    name: http

# XBackend after
spec:
  port:
    number: 8080
```

5. Upgrade the controller implementation (e.g. Envoy Gateway, Istio, NGINX Gateway Fabric, Cilium) to a version that declares v1.7.0 conformance support — check that implementation's own release notes before proceeding.

6. Re-apply HTTPRoute manifests that use retries if they were previously gated behind an experimental flag in your implementation; the field is now Standard and should work without extra annotations once the controller supports it.

## Verify

```bash
# Confirm CRD versions
kubectl get crd gatewayclasses.gateway.networking.k8s.io -o jsonpath='{.spec.versions[*].name}'

# Confirm retry field is recognized as Standard
kubectl explain httproute.spec.rules.retry

# List installed Gateway API CRDs
kubectl get crd | grep gateway.networking.k8s.io

# Sanity-check an HTTPRoute with retries
kubectl apply -f - <<'EOF'
apiVersion: gateway.networking.k8s.io/v1
kind: HTTPRoute
metadata:
  name: retry-demo
spec:
  parentRefs:
  - name: my-gateway
  rules:
  - backendRefs:
    - name: my-service
      port: 80
    retry:
      codes: [502, 503]
      attempts: 3
EOF
kubectl get httproute retry-demo -o yaml
```

## Common Issues

- **CRD apply fails with field validation errors on `XBackend`**: you're still using `spec.port.port` or `spec.port.name`; switch to `spec.port.number` (#5287).
- **`cookieConfig` not recognized after upgrade**: the field was renamed to `cookie`; update manifests per the migration example above (#4873).
- **Conformance suite reports missing `HTTPRouteRetryBackendTimeout`**: that feature was removed in v1.7.0; drop it from your implementation's conformance profile and rely on `HTTPRouteRetryCodes` / `HTTPRouteRetryConnectionError` (#5167).
- **Controller doesn't honor Standard `retry` field yet**: confirm your Gateway implementation has published v1.7.0 conformance support — the API change alone doesn't add controller behavior.

## Best Practices

- Pin the Gateway API CRD version alongside your controller implementation's documented compatibility matrix; don't upgrade CRDs ahead of controller support.
- Treat all Experimental-channel fields as subject to breaking change between minor releases, as this release demonstrates.
- Run `gateway-api` conformance tests against staging after any CRD bump, especially after retry/session-persistence changes.
- Track GEPs (1731, 5093, 5253, 1619/4894, 5224, 5075, 4768) linked in the release notes before adopting new Experimental features in production.
