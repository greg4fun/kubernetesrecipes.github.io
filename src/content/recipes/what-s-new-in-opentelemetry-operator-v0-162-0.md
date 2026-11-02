---
title: "What's New in OpenTelemetry Operator v0.162.0"
description: "OpenTelemetry Operator v0.162.0: NodeJS auto-instrumentation upgrade block, PHP/Ruby support, TLS curve_preferences, RBAC and CA bug fixes."
publishDate: "2026-11-02"
author: "Luca Berton"
category: "observability"
difficulty: "intermediate"
timeToComplete: "20 minutes"
kubernetesVersion: "1.27+"
tags:
  - "opentelemetry"
  - "opentelemetry-operator"
  - "observability"
  - "auto-instrumentation"
  - "helm"
  - "collector"
---
> 💡 **Quick Answer:** OpenTelemetry Operator v0.162.0 blocks automatic NodeJS auto-instrumentation upgrades past 0.79.0 (breaking semantic-convention changes), adds PHP and Ruby auto-instrumentation support, injects TLS `curve_preferences` into collector configs, and fixes CA trust, RBAC privilege-escalation checks, and telemetry serialization bugs.

## The Problem

Operators running the OpenTelemetry Operator need to know whether this release silently changes behavior for existing auto-instrumentation workloads, what new language support is available, and which bug fixes affect RBAC checks (notably on AKS) and TLS defaults before rolling the upgrade into clusters.

## The Solution

Upgrade the operator via Helm or the static manifest, pin `spec.nodejs.image` explicitly if relying on NodeJS auto-instrumentation, and opt in to the new PHP/Ruby instrumentation flags only if needed. No CRD-breaking schema changes are introduced, but the NodeJS auto-instrumentation default behavior changes.

## Whats New

### 🛑 Breaking changes

- **NodeJS auto-instrumentation upgrades blocked past 0.79.0** (#2542): the operator no longer auto-upgrades the default NodeJS instrumentation image across the 0.79.0 boundary because of breaking HTTP, network, and database semantic convention changes. If you rely on the default/implicit NodeJS image, pin `spec.nodejs.image` manually to an image using instrumentation 0.79.0+. See [issue #2542](https://github.com/open-telemetry/opentelemetry-operator/issues/2542) for migration details.

### 🚀 New components

- **PHP auto-instrumentation** (#932): disabled by default. Enable on the operator with `--enable-php-instrumentation` (or env var `ENABLE_PHP_AUTO_INSTRUMENTATION=true`), then annotate workloads with `instrumentation.opentelemetry.io/inject-php` and `instrumentation.opentelemetry.io/otel-php-api-version`.
- **Ruby auto-instrumentation (initial)** (#3762): disabled by default. Enable with `--enable-ruby-instrumentation=true`.

### 💡 Enhancements

- **TLS `curve_preferences` injection** (#6893): receivers/extensions with a `tls` block in `spec.config` now get `curve_preferences` defaulted from the cluster's TLS security profile `groups`, following the same defaults-only rule as `min_version`/`cipher_suites` — user-set values are never overridden. Groups without a matching collector spelling are logged at operator startup.

### 🧰 Bug fixes

- **Distrusted emSign root CAs removed** (#5802) from operator, target allocator, OpAMP bridge, and Python auto-instrumentation images. Requires Alpine `ca-certificates` 20261020-r0+ and `certifi` 2026.10.19+ (Python image now `0.66b1-3`). Images built with Go 1.27.3 (includes the 2026-10-19 `crypto/x509` fixes).
- **RBAC privilege-escalation check fix** (#5659): SubjectAccessReviews now include the requesting user's UID and extra fields. Fixes false-deny on authorizers depending on those fields, notably **AKS with Azure RBAC for Kubernetes Authorization**.
- **TargetAllocator Telemetry field made a pointer** (#5695): fixes `omitempty` so `targetAllocator.telemetry` isn't always serialized during server-side apply, which previously broke consumers on CRD versions lacking this field.
- **`service.telemetry` preserved when unparseable** (#5734): unrecognized telemetry config (e.g. `resource.attributes`) is left untouched instead of being overwritten with the default Prometheus reader; an admission warning is emitted instead.

### Bundled component versions

- Collector / Contrib: v0.162.0
- Java: v2.32.0-1, .NET: v1.17.0-2, Node.JS: v0.82.0-1, Python: v0.66b1-3, Ruby: v0.1.0, Go: v0.24.0, PHP: 1.4.1, ApacheHTTPD/Nginx: 1.0.4-2

## Upgrade Steps

```bash
# Helm (recommended)
helm repo add open-telemetry https://open-telemetry.github.io/opentelemetry-helm-charts
helm repo update
helm upgrade --install opentelemetry-operator open-telemetry/opentelemetry-operator \
  --namespace opentelemetry-operator-system --create-namespace \
  --set manager.image.tag=0.162.0
```

```bash
# Static manifest (cert-manager required as a prerequisite)
kubectl apply -f https://github.com/open-telemetry/opentelemetry-operator/releases/download/v0.162.0/opentelemetry-operator.yaml
```

```bash
# Before upgrading, pin NodeJS auto-instrumentation if you rely on the default image
kubectl edit instrumentation <name> -n <namespace>
# set spec.nodejs.image: <image pinned to instrumentation >=0.79.0>
```

```bash
# Optional: enable PHP / Ruby auto-instrumentation flags on the operator deployment
kubectl set env deployment/opentelemetry-operator-controller-manager \
  -n opentelemetry-operator-system \
  ENABLE_PHP_AUTO_INSTRUMENTATION=true \
  ENABLE_RUBY_AUTO_INSTRUMENTATION=true
```

## Verify

```bash
# Confirm operator image/version
kubectl get deployment -n opentelemetry-operator-system opentelemetry-operator-controller-manager \
  -o jsonpath='{.spec.template.spec.containers[0].image}'

# Confirm NodeJS Instrumentation CR is pinned, not relying on operator default
kubectl get instrumentation <name> -n <namespace> -o jsonpath='{.spec.nodejs.image}'

# Check for admission warnings on collectors with unparsed service.telemetry
kubectl apply -f collector.yaml --dry-run=server

# Confirm TLS curve_preferences injected (if a tls block is defined)
kubectl get opentelemetrycollector <name> -n <namespace> -o yaml | grep -A3 curve_preferences
```

## Common Issues

- **NodeJS pods still on an old instrumentation image after upgrade**: expected — the operator intentionally stops auto-upgrading past 0.79.0; set `spec.nodejs.image` explicitly (#2542).
- **AKS clusters denying collector RBAC checks before this release**: upgrade resolves it via #5659; re-test privilege-escalation-sensitive RBAC rules after upgrading.
- **`targetAllocator.telemetry` unexpectedly appearing/disappearing in applied manifests**: fixed by #5695; re-run server-side apply and diff against previous state.
- **CA trust errors in air-gapped/mirrored registries after bumping images**: ensure base images include updated `ca-certificates`/`certifi` per #5802, or your mirror may still serve images with distrusted emSign roots.

## Best Practices

- Audit all `Instrumentation` CRs for NodeJS before upgrading; pin images explicitly rather than relying on operator defaults going forward.
- Enable PHP/Ruby instrumentation flags only in environments that need them — both remain opt-in and may still be maturing (Ruby is "initial version").
- Re-run `kubectl apply --dry-run=server` against collector manifests with `tls` blocks to review newly injected `curve_preferences` before rollout.
- Pin the operator version explicitly in Helm (`--set manager.image.tag=0.162.0`) rather than tracking `latest` for predictable upgrades.
- Review the [full release notes](https://github.com/open-telemetry/opentelemetry-operator/releases/tag/v0.162.0) for any downstream component changes (Collector, Contrib, language SDKs) relevant to your stack.
