---
title: "What's New in Traefik v3.8.0: Gateway API & CVEs"
description: "Traefik v3.8.0 fixes 3 CVEs, adds Gateway API ListenerSet support, per-router timeouts, and requires reading the v3.8 migration guide."
publishDate: "2026-11-26"
author: "Luca Berton"
category: "networking"
difficulty: "intermediate"
timeToComplete: "20 minutes"
kubernetesVersion: "1.27+"
tags:
  - "traefik"
  - "ingress-controller"
  - "gateway-api"
  - "helm-upgrade"
  - "cve"
  - "reverse-proxy"
---
> 💡 **Quick Answer:** Traefik v3.8.0 patches three CVEs, expands Gateway API support (ListenerSet, HTTPRoute retries/mirroring/CORS, client cert validation) and adds per-router timeouts and a new experimental Yaegi v2 plugin runtime; it drops Gateway API v1.5.x support, so read the official migration guide before upgrading in cluster.

## The Problem

Operators running Traefik as their Kubernetes Ingress or Gateway API controller need to patch three security advisories shipped in this release and decide whether their Gateway API CRD versions and plugin configs are compatible with v3.8's changes, particularly the TCPRoute v1 switch and the dropped v1.5.x support.

## The Solution

Upgrade the Traefik controller (Helm chart or Deployment image) to v3.8.0, update the Kubernetes Gateway API CRDs to a version ≥ v1.6.x (no v1.5.x), and review any ServersTransport/timeout or plugin configuration that may be affected by the new defaults described in the migration guide.

## Whats New

**Security (CVE fixes)**
- [GHSA-3rh5-223h-cpwr](https://github.com/traefik/traefik/security/advisories/GHSA-3rh5-223h-cpwr)
- [GHSA-42x2-976f-ph52](https://github.com/traefik/traefik/security/advisories/GHSA-42x2-976f-ph52)
- [GHSA-9657-c2gv-wjpj](https://github.com/traefik/traefik/security/advisories/GHSA-9657-c2gv-wjpj)

All three are fixed by simply upgrading to v3.8.0; check the advisories for severity details relevant to your exposure (public-facing ingress vs. internal).

**Kubernetes / Gateway API enhancements**
- Gateway API **ListenerSet (GEP-1713)** support (#12909)
- **TCPRoute** now consumed via its v1 API — **Gateway API v1.5.x support dropped** (#13626)
- Gateway API listener isolation and new **listener filters** (#13738, #14320)
- **BackendTLSPolicy** support extended to TLSRoute and gRPC backends, plus SAN validation (#13332, #13265, #13249)
- Gateway **client certificate validation** and backend client certs (#14129, #14119)
- HTTPRoute **retry**, **RequestMirror filter**, **CORS filter**, and **backendRequest timeout** (#14127, #14123, #13437, #14130)
- **ClusterTrustBundle** CA certificate references for CRD IngressRoute (#13410)
- New **GatewayClass** option (#14029)
- `managedFields` stripped from Kubernetes informers to cut memory use (#13396)
- **Per-router timeouts** across Docker, Ingress, middleware, CRD and Gateway API providers (#13537)
- New forwarding timeouts in `ServersTransport` CRD (#12716)
- `reportNodeInternalIPs` option for Ingress status (#12920)
- `disableHTTPEntryPoint` option for the ingress-nginx compatibility provider (#13354)

**Middleware / proxy**
- New **tap middleware** (#13962)
- Circuit breaker: minimum request count option (#13459)
- `disableRequestBuffer` / `disableResponseBuffer` for the buffering middleware (#13029)
- `nginx.ingress.kubernetes.io/limit-allowlist` annotation support (#12918)
- Optional `X-Forwarded-Scheme` / `X-Scheme` headers (#12914)
- Double wildcard support in Host/HostSNI matchers (#13882)

**ACME / Plugins / Observability**
- `reusePrivateKey` option for ACME (#13004)
- Experimental **Yaegi v2** plugin runtime with `fileMapping` and `mounts` settings (#14276, #14303)
- `urn:k8s:configmap:` resolution in plugin configuration (#14118)
- OTel resource built once (perf) (#13923); `QUERY` added as a recognized HTTP method for metrics labeling (#13667)

## Upgrade Steps

1. Read the official migration notes first: https://doc.traefik.io/traefik/v3.8/migrate/v3/#v380
2. If using Gateway API, update CRDs to a supported version (v1.6.x+, not v1.5.x):

```bash
kubectl kustomize "github.com/kubernetes-sigs/gateway-api/config/crd?ref=v1.6.0" | kubectl apply -f -
```

3. Upgrade via Helm:

```bash
helm repo update traefik
helm upgrade traefik traefik/traefik \
  --namespace traefik \
  --version 3.8.0 \
  --reuse-values
```

4. Or upgrade a manually-managed Deployment:

```bash
kubectl -n traefik set image deployment/traefik \
  traefik=traefik:v3.8.0
kubectl -n traefik rollout status deployment/traefik
```

5. If relying on experimental plugins, review any Yaegi plugin manifests against the new Yaegi v2 runtime flags before enabling it.

## Verify

```bash
kubectl -n traefik get pods -l app.kubernetes.io/name=traefik
kubectl -n traefik exec deploy/traefik -- traefik version
```

Confirm the reported version is `3.8.0`, then check the Traefik dashboard or logs for Gateway API resource acceptance:

```bash
kubectl get gatewayclass,gateway -A
kubectl -n traefik logs deploy/traefik --tail=100 | grep -i gatewayapi
```

## Common Issues

- **Gateway API resources stop reconciling**: caused by still running Gateway API v1.5.x CRDs; update CRDs to v1.6.x+ since v1.5.x support was removed in this release (#13626).
- **TLSRoute/gRPC backend TLS not applied as expected**: BackendTLSPolicy behavior changed for these routes; re-check policy attachment per the migration guide.
- **Custom plugins failing to load**: the experimental Yaegi v2 runtime changes plugin file resolution (`fileMapping`, `mounts`); pin to the legacy runtime if not ready to migrate.

## Best Practices

- Always apply the CVE-fixing release promptly to internet-facing ingress controllers; treat this as a priority patch, not just a feature release.
- Pin the Gateway API CRD version explicitly in GitOps manifests to avoid silent incompatibilities on future Traefik upgrades.
- Test per-router timeout and BackendTLSPolicy changes in staging before rolling out to production ingress, since timeout defaults can affect long-lived connections.
