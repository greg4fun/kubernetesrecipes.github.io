---
title: "What's New in Envoy Gateway v1.10.0: Upgrade Guide for Kubernetes Operators"
description: "Envoy Gateway v1.10.0 adds PDB eviction policy, graceful shutdown tuning, Lua filter whitelisting, and ClusterSettings fixes. Upgrade steps and verification included."
publishDate: "2026-11-07"
author: "Luca Berton"
category: "networking"
difficulty: "intermediate"
timeToComplete: "20 minutes"
kubernetesVersion: "1.29+"
tags:
  - "envoy-gateway"
  - "gateway-api"
  - "envoy"
  - "helm"
  - "upgrade"
  - "tls"
  - "networking"
---
> 💡 **Quick Answer:** Envoy Gateway v1.10.0 is a maintenance-plus-features release: it adds a configurable `PodDisruptionBudget.unhealthyPodEvictionPolicy`, a `healthCheckFailureDelay` for graceful shutdown, an allow-list for Lua filter env vars/paths, a new `maxRequestHeaderLimit` on `ClientTrafficPolicy`, and fixes several `ClusterSettings`/`ListenerSet` merge-eligibility bugs. Upgrade via Helm and re-check any custom Lua filters and merged `BackendTrafficPolicy`/`ClusterSettings` behavior per listener.

## The Problem

Operators running Envoy Gateway v1.9.x need to know whether v1.10.0 changes runtime behavior around traffic policy merging, PDB handling during node drains, or Lua-based filters before rolling it into a fleet. The GitHub changelog is long (mostly chores/dependabot), so the signal needs to be separated from the noise.

## The Solution

Upgrade the `envoy-gateway` Helm release to `v1.10.0`, review the behavior change to `ClusterSettings` merge eligibility (now decided per-listener instead of per-rule), and opt into the new PDB eviction policy and shutdown health-check delay if relevant to your cluster's node-drain and rollout strategy.

## What's New

**Features / operator-facing additions**
- `feat(charts)`: Added `unhealthyPodEvictionPolicy` field to the envoy-gateway `PodDisruptionBudget` in the Helm chart ([#9449](https://github.com/envoyproxy/gateway/pull/9449)) — lets you set `AlwaysAllow` or `IfHealthyBudget` for the EG control-plane PDB.
- `feat`: Added `healthCheckFailureDelay` to the shutdown config ([#9363](https://github.com/envoyproxy/gateway/pull/9363)) — gives finer control over graceful-shutdown timing when draining Envoy proxy pods.
- `feat`: Lua filter now supports a whitelist for allowed env vars and paths ([#9220](https://github.com/envoyproxy/gateway/pull/9220)) — tightens the security posture for custom Lua scripts in `EnvoyExtensionPolicy`/filters.
- `api`: Added `maxRequestHeaderLimit` to `ClientTrafficPolicy` ([#9623](https://github.com/envoyproxy/gateway/pull/9623)) — new knob to cap request header size per listener.
- `feat(chart)`: TLS certificate expiration panel added to the Envoy Global Grafana dashboard ([#9615](https://github.com/envoyproxy/gateway/pull/9615)).

**Behavior changes / bug fixes to be aware of**
- `gatewayapi`: ClusterSettings merge eligibility is now decided **per listener** instead of per rule ([#9695](https://github.com/envoyproxy/gateway/pull/9695)) — if you rely on `BackendTrafficPolicy` merging across rules sharing a backend, re-validate behavior after upgrade.
- `gatewayapi`: Fixed `ListenerSet` scope bug in the `MergeBackends` cluster-settings index ([#9692](https://github.com/envoyproxy/gateway/pull/9692)).
- `fix`: Reconcile `ListenerSet` when the referenced TLS Secret changes ([#9634](https://github.com/envoyproxy/gateway/pull/9634)) — TLS rotation on ListenerSet-backed listeners now triggers reconciliation correctly.
- `fix`: Pin consistent-hash load-balancing clients across weighted `backendRefs` ([#9629](https://github.com/envoyproxy/gateway/pull/9629)) — fixes session-affinity drift when weights change.
- `fix`: Added overlap status for duplicate `HTTPRoutes` ([#8373](https://github.com/envoyproxy/gateway/pull/8373)) — better status surfacing when two routes conflict.
- `fix(provider)`: Made the `BackendTLSPolicy` watch optional ([#9517](https://github.com/envoyproxy/gateway/pull/9517)) — avoids errors in clusters without the `BackendTLSPolicy` CRD installed.
- `fix`: Allow single-character labels in `cookieDomain` ([#9736](https://github.com/envoyproxy/gateway/pull/9736)).

**Build / dependency**
- Go bumped to 1.26.6 ([#9749](https://github.com/envoyproxy/gateway/pull/9749)).
- `go-control-plane/envoy` bumped to 1.39.0 across example extension servers.

No deprecations or breaking API removals are called out in the changelog for this release. Full details: [v1.10.0 release notes](https://gateway.envoyproxy.io/news/releases/notes/v1.10.0/) and [release page](https://github.com/envoyproxy/gateway/releases/tag/v1.10.0).

## Upgrade Steps

1. Check current release and CRDs:

```bash
helm list -n envoy-gateway-system
kubectl get crd | grep gateway.envoyproxy.io
```

2. Update Gateway API and Envoy Gateway CRDs (if the chart doesn't manage CRDs in your setup, apply them explicitly):

```bash
helm upgrade -i eg oci://docker.io/envoyproxy/gateway-helm \
  --version v1.10.0 \
  -n envoy-gateway-system \
  --create-namespace \
  --set crds.enabled=true
```

3. Roll out and watch the control plane restart:

```bash
kubectl rollout status deployment/envoy-gateway -n envoy-gateway-system
```

4. If you use the new PDB eviction policy, set it explicitly:

```bash
helm upgrade eg oci://docker.io/envoyproxy/gateway-helm \
  --version v1.10.0 \
  -n envoy-gateway-system \
  --set deployment.podDisruptionBudget.unhealthyPodEvictionPolicy=AlwaysAllow
```

5. Review any `BackendTrafficPolicy`/`ClusterSettings` that relied on rule-level merging in light of the per-listener merge change.

## Verify

```bash
# Confirm the running image/version
kubectl get deployment envoy-gateway -n envoy-gateway-system \
  -o jsonpath='{.spec.template.spec.containers[0].image}'

# Confirm CRDs and control plane are healthy
kubectl get pods -n envoy-gateway-system
kubectl get gatewayclass,gateway -A

# Check status on a known Gateway/HTTPRoute for regressions
kubectl describe httproute <name> -n <namespace>
```

Expect no errors in the `envoy-gateway` logs related to `BackendTLSPolicy` watches, and TLS-secret-driven `ListenerSet` reconciliation should fire when you rotate a referenced secret:

```bash
kubectl logs -n envoy-gateway-system deploy/envoy-gateway --tail=100 | grep -i error
```

## Common Issues

- **Unexpected traffic-policy behavior after upgrade**: caused by the per-listener (vs per-rule) `ClusterSettings` merge change (#9695). Re-test `BackendTrafficPolicy` merging across rules sharing backends.
- **Lua filters failing after upgrade**: the new env/path whitelist (#9220) may block previously-working Lua scripts that reference unlisted paths or env vars — update the whitelist config accordingly.
- **Control-plane pod evicted during node drain unexpectedly**: set `unhealthyPodEvictionPolicy` explicitly on the PDB if you depend on EG control-plane availability during maintenance windows.
- **BackendTLSPolicy CRD missing errors**: resolved by #9517; if you still see watch errors, confirm you're actually on v1.10.0.

## Best Practices

- Pin the Helm chart version (`--version v1.10.0`) rather than tracking `latest` in GitOps pipelines.
- Diff `BackendTrafficPolicy`/`ClusterSettings` status before/after upgrade in a staging cluster, given the merge-eligibility change.
- Review and tighten the Lua filter whitelist as part of adopting #9220 rather than leaving it permissive.
- Keep Gateway API CRDs and the Envoy Gateway chart version in lockstep; check the compatibility matrix in the release announcement before upgrading.
- Enable the new TLS certificate expiration panel in the Envoy Global Grafana dashboard to catch cert rotation issues early.
