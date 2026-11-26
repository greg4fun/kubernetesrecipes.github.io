---
title: "What's New in OpenTelemetry Operator v0.164.0"
description: "v0.164.0 drops v1alpha1 Collector API serving and bumps .NET auto-instrumentation to 1.20.0. Upgrade steps and migration notes inside."
publishDate: "2026-11-26"
author: "Luca Berton"
category: "observability"
difficulty: "intermediate"
timeToComplete: "20 minutes"
kubernetesVersion: "1.24+"
tags:
  - "opentelemetry"
  - "kubernetes-operator"
  - "observability"
  - "api-deprecation"
  - "auto-instrumentation"
  - "target-allocator"
  - "helm"
---
> 💡 **Quick Answer:** OpenTelemetry Operator v0.164.0 stops serving the `OpenTelemetryCollector` v1alpha1 API (use v1beta1) and bumps the default .NET auto-instrumentation image to 1.20.0, dropping .NET 8/9 support; it also adds a new target allocator feature gate and several target-allocator/auto-instrumentation bug fixes.

## The Problem

Teams running OpenTelemetryCollector manifests, tooling, or GitOps pipelines pinned to `apiVersion: opentelemetry.io/v1alpha1` will start getting 404s once the operator is upgraded, since v1alpha1 is no longer served. Separately, anyone relying on the default .NET auto-instrumentation image will silently lose support for .NET 8/9 workloads after upgrade.

## The Solution

Update all Collector manifests, CI templates, and controllers to `v1beta1` before upgrading the operator, trigger migration of any etcd-stored v1alpha1 objects, and pin `spec.dotnet.image` explicitly if any workload still targets .NET 8 or .NET 9.

## Whats New

**🛑 Breaking changes**

- **Collector API v1alpha1 no longer served** (#5037): only `opentelemetry.io/v1beta1` is served now. Clients/tools using v1alpha1 get a 404. Objects stored in etcd as v1alpha1 need migration:
  - Kubernetes 1.30+: handled automatically via the built-in StorageVersionMigration feature.
  - Older clusters: manually re-write each object, e.g. `kubectl get otelcol -A -o json | kubectl apply -f -`.
  - Temporary workaround (re-enable v1alpha1 serving, reverted on next operator upgrade): `kubectl patch crd opentelemetrycollectors.opentelemetry.io --type=json -p='[{"op":"replace","path":"/spec/versions/0/served","value":true}]'`.
- **Default .NET auto-instrumentation bumped to 1.20.0** (#5962): drops .NET 8 and .NET 9 support (both reached upstream EOL). To keep running on those frameworks, pin the previous image in the `Instrumentation` resource: `spec.dotnet.image: ghcr.io/open-telemetry/opentelemetry-operator/autoinstrumentation-dotnet:1.19.1`.

**💡 Enhancements**

- New feature gate `operator.targetallocator.targetsremainingattributes` (#4637): when enabled, the operator passes `--feature-gates=targetallocator.targetsremainingattributes` to the target allocator, which then records `opentelemetry_allocator_targets_remaining` per `job.name`/`k8s.namespace.name` instead of a single total. The target allocator now accepts a `--feature-gates` flag directly.

**🧰 Bug fixes**

- `spec.revisionHistoryLimit` is now applied to the collector DaemonSet in daemonset mode (#5889).
- Python auto-instrumentation injection (including the init container) is skipped when `instrumentation.opentelemetry.io/otel-python-platform` has an unsupported value, fixing a broken `cp -r` init container that blocked pod startup (#5892).
- `/debug/target` on the target allocator no longer writes both the Bad Request and Unknown Target pages when `target_hash` isn't numeric (#5896).
- Target allocator pod now respects `spec.dnsPolicy` (#5951) and `spec.hostPID` (#5961) from the TargetAllocator resource.
- Target allocator Service now respects `spec.sessionAffinity` and `spec.sessionAffinityConfig` (#5965).
- Collector Ingress is updated when `spec.ingress.ingressClassName` changes (#5890).
- `spec.imagePullPolicy` is applied to Java extension init containers (#5893).
- OpAMPBridge deployment now includes volumes from `spec.volumes` (#5895).
- `/jobs/{job}/targets` `_link` value fixed (was pointing to a non-existent `/debug` path returning 404) (#5897).

Component bumps: OpenTelemetry Collector/Contrib v0.164.0, Java instrumentation v2.34.0, .NET instrumentation v1.20.0, Node.js v0.83.1, Python v0.66b2, Ruby v0.1.0, Go v0.24.0, PHP 1.4.2, ApacheHTTPD/Nginx webserver modules 1.0.4.

## Upgrade Steps

1. Audit manifests, GitOps repos, and CI for `apiVersion: opentelemetry.io/v1alpha1` and update them to `v1beta1` before upgrading:

```bash
grep -rl 'opentelemetry.io/v1alpha1' . | xargs sed -i 's#opentelemetry.io/v1alpha1#opentelemetry.io/v1beta1#g'
```

2. If any `Instrumentation` resources must stay on .NET 8/9, pin the image explicitly before upgrading:

```yaml
spec:
  dotnet:
    image: ghcr.io/open-telemetry/opentelemetry-operator/autoinstrumentation-dotnet:1.19.1
```

3. Upgrade the operator via Helm:

```bash
helm repo update open-telemetry
helm upgrade opentelemetry-operator open-telemetry/opentelemetry-operator \
  --namespace opentelemetry-operator-system \
  --version 0.164.0
```

Or apply the manifest directly:

```bash
kubectl apply -f https://github.com/open-telemetry/opentelemetry-operator/releases/download/v0.164.0/opentelemetry-operator.yaml
```

4. On Kubernetes < 1.30, manually migrate v1alpha1-stored objects after the upgrade:

```bash
kubectl get otelcol -A -o json | kubectl apply -f -
```

5. (Optional) Enable the new target allocator targets-remaining-per-job feature gate by setting the operator's feature gate flag, e.g. via Helm values:

```yaml
manager:
  featureGates: "operator.targetallocator.targetsremainingattributes"
```

```bash
helm upgrade opentelemetry-operator open-telemetry/opentelemetry-operator \
  --namespace opentelemetry-operator-system \
  --version 0.164.0 \
  --set manager.featureGates="operator.targetallocator.targetsremainingattributes"
```

## Verify

```bash
# Confirm operator image/version
kubectl get deployment -n opentelemetry-operator-system -o jsonpath='{.items[*].spec.template.spec.containers[*].image}'

# Confirm only v1beta1 is served
kubectl get crd opentelemetrycollectors.opentelemetry.io -o jsonpath='{.spec.versions[*].name}:{.spec.versions[*].served}'

# Confirm existing collectors are reachable under v1beta1
kubectl get opentelemetrycollectors.v1beta1.opentelemetry.io -A

# If feature gate enabled, check target allocator flags
kubectl get pod -n <ta-namespace> -l app.kubernetes.io/component=opentelemetry-targetallocator -o jsonpath='{.items[0].spec.containers[0].args}'
```

## Common Issues

- **404 on `otelcol.opentelemetry.io/v1alpha1`**: manifests or tooling still reference v1alpha1; switch to v1beta1. Use the temporary CRD patch workaround only as a stopgap — it's reverted on the next operator upgrade.
- **.NET pods failing or behaving unexpectedly post-upgrade**: check the framework version in the pod; .NET 8/9 workloads need `spec.dotnet.image` pinned to `1.19.1` until migrated to .NET 10+.
- **Python sidecar pods stuck pending**: confirm `instrumentation.opentelemetry.io/otel-python-platform` is set to a supported value; unsupported values are now skipped (previously crashed the init container).

## Best Practices

- Treat the v1alpha1 → v1beta1 migration as a pre-upgrade gate: run the manifest grep/apply steps in CI before rolling out v0.164.0 to production clusters.
- Pin auto-instrumentation image versions explicitly in `Instrumentation` CRs instead of relying on operator defaults, to avoid surprise EOL-driven bumps on future upgrades.
- Enable `operator.targetallocator.targetsremainingattributes` only after confirming downstream metrics/dashboards expect per-job/per-namespace `opentelemetry_allocator_targets_remaining` instead of a single total.
- On clusters below Kubernetes 1.30, schedule the manual etcd migration step immediately after upgrade to avoid drift between served and stored API versions.
