---
title: "What's New in Traefik v3.7.17: Upgrade Guide for Kubernetes Operators"
description: "Traefik v3.7.17 patch release: NTLM/Kerberos connection leak fixes, Gateway API status fix, new header-values limit flag, and dependency CVE bumps."
publishDate: "2026-11-02"
author: "Luca Berton"
category: "networking"
difficulty: "intermediate"
timeToComplete: "15 minutes"
kubernetesVersion: "1.28+"
tags:
  - "traefik"
  - "ingress-controller"
  - "gateway-api"
  - "upgrade"
  - "security"
  - "middleware"
---
> 💡 **Quick Answer:** Traefik v3.7.17 is a bug-fix release that patches backend connection leaks (NTLM/Kerberos), fixes Gateway API status handling and ingress-nginx name collisions, adds an entry point option to cap request header values, and bumps several dependencies with security fixes. Upgrade by bumping the image tag or Helm chart `appVersion`/`image.tag` to `v3.7.17`.

## The Problem

Operators running Traefik v3.7.x on earlier patch versions are exposed to a backend connection leak when using NTLM or Kerberos authentication (both in the standard server and the FastProxy experimental path), broken `Flush`/`Hijack`/deadline handling in wrapped `ResponseWriter`s (impacting streaming/WebSocket middlewares), and a bug where the Gateway API provider could overwrite `Gateway` status conditions owned by other controllers in shared Gateway deployments. Several transitive dependencies (lego, go-jose, quic-go, golang.org/x/net, brotli) also received security-relevant bumps.

## The Solution

Upgrade to v3.7.17. There are no new features beyond one new entry point option and a global default setting — this release is primarily bug fixes and dependency updates. Before upgrading, review the official migration guide entry for this patch: https://doc.traefik.io/traefik/v3.7/migrate/v3/#v3717

## Whats New

**Bug fixes relevant to operators:**
- `[server]` Fixed backend connection leak for NTLM and Kerberos authentication (#14144)
- `[server, fastproxy]` Fixed the same leak in the FastProxy experimental backend (#14158)
- `[middleware]` Fixed broken flush, hijack, and deadlines in wrapped `ResponseWriter`s — affects streaming/WebSocket responses behind middlewares (#14082)
- `[middleware, authentication, k8s/crd, k8s, k8s/ingress-nginx]` Fixed secret reference resolution when building middlewares — relevant if you reference Kubernetes Secrets from CRD or ingress-nginx-annotated middlewares (#14083)
- `[k8s/gatewayapi]` Gateway status conditions owned by other controllers are now preserved instead of being overwritten (#14128) — important if multiple controllers manage the same `Gateway` resource
- `[k8s/ingress-nginx]` Fixed generated object name collisions across namespaces in the ingress-nginx compatibility provider (#14140)
- `[logs, k8s/gatewayapi]` User configuration errors in Gateway API processing are now logged at `debug` instead of a noisier level (#14159)

**New configuration options:**
- `[server]` New entry point option to limit the number of request header values (#14111) — check `traefik.yml`/static config entry point docs for the exact flag name before enforcing in production
- `[server]` New global default for `aliasHeadersStrategy` (#13919)

**Dependency bumps (security-relevant):**
- `github.com/go-acme/lego/v5` → v5.6.0 (#14166)
- `github.com/go-jose/go-jose/v4` → v4.1.6 (#14165)
- `github.com/quic-go/quic-go` → v0.64.1 — HTTP/3 users should upgrade promptly (#14132)
- `golang.org/x/net` → v0.62.0 (#14176)
- `github.com/andybalholm/brotli` → v1.2.7 (#14137)

No deprecations or breaking API changes are called out in these release notes beyond what's documented in the linked migration guide section for this patch.

## Upgrade Steps

### Helm

```bash
helm repo update traefik
helm upgrade traefik traefik/traefik \
  --namespace traefik \
  --reuse-values \
  --set image.tag=v3.7.17
```

### Raw Kubernetes manifests / Deployment

```bash
kubectl -n traefik set image deployment/traefik \
  traefik=traefik:v3.7.17

kubectl -n traefik rollout status deployment/traefik
```

### Static binary / Docker Compose

```bash
docker pull traefik:v3.7.17
```

## Verify

```bash
# Confirm the running image version
kubectl -n traefik get deployment traefik -o jsonpath='{.spec.template.spec.containers[0].image}'

# Check Traefik's reported version via API (requires --api.insecure or dashboard exposed)
kubectl -n traefik exec deploy/traefik -- traefik version

# Tail logs for startup errors after rollout
kubectl -n traefik logs deploy/traefik --tail=100 -f
```

If you use the Gateway API provider, confirm other controllers' status conditions on shared `Gateway` objects are no longer being clobbered:

```bash
kubectl get gateway <name> -o yaml | grep -A5 conditions
```

## Common Issues

- **NTLM/Kerberos backends still leaking connections after upgrade**: confirm the Deployment actually rolled to `v3.7.17` (image digest can be cached); force a rollout restart with `kubectl rollout restart deployment/traefik -n traefik`.
- **Gateway status still being overwritten**: this fix only applies to conditions *owned by other controllers*; conditions Traefik itself manages are still updated normally — check the `controllerName` field in the condition.
- **HTTP/3 clients disconnecting**: re-test after the quic-go v0.64.1 bump; report regressions upstream with the specific quic-go version noted.
- **Secrets not resolving in middlewares after fix**: double-check Secret namespace and RBAC — the fix corrects resolution logic but does not grant new permissions; Traefik's ServiceAccount still needs `get`/`list`/`watch` on `secrets` in the relevant namespaces.

## Best Practices

- Pin the exact patch tag (`v3.7.17`) rather than `v3.7` or `latest` to get reproducible rollouts.
- Read the migration guide section for every patch release, even minor-looking ones: https://doc.traefik.io/traefik/v3.7/migrate/v3/#v3717
- If running NTLM/Kerberos-authenticated backends, monitor backend connection counts before and after the upgrade to confirm the leak is resolved.
- Canary the upgrade on a non-critical IngressRoute/Gateway before rolling out cluster-wide, especially if you rely on the Gateway API provider alongside other controllers.
- Track Traefik security advisories directly on GitHub going forward, per PR #14099.
