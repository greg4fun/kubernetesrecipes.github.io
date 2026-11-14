---
title: "OpenTelemetry Operator v0.163.0: TLS Hardening and Fixes"
description: "OpenTelemetry Operator v0.163.0 adds Target Allocator TLS controls, bundle related images, and fixes OpAMP, nginx auto-instrumentation and ConfigMap bugs."
publishDate: "2026-11-12"
author: "Luca Berton"
category: "observability"
difficulty: "intermediate"
timeToComplete: "15 minutes"
kubernetesVersion: "1.28+"
tags:
  - "opentelemetry"
  - "opentelemetry-operator"
  - "target-allocator"
  - "auto-instrumentation"
  - "helm"
  - "tls"
  - "opamp"
---
> 💡 **Quick Answer:** OpenTelemetry Operator v0.163.0 hardens Target Allocator and operator TLS (min version, cipher suites, curve preferences), fixes several bugs affecting OpAMP bridges, nginx auto-instrumentation, dry-run Events, and literal `<<` keys in collector ConfigMaps. No breaking API changes; upgrade is routine via Helm.

## The Problem

Operators running the OpenTelemetry Operator on v0.162.0 or earlier hit a handful of rough edges: TLS cipher/curve configuration was not exposed for the Target Allocator or operator webhook server, `kubectl apply --dry-run=server` generated spurious Kubernetes Events, re-injecting nginx auto-instrumentation into a Pod was not idempotent, and OpAMP bridges could accidentally restart or delete collectors they didn't manage. Image registries with a port in the address (e.g. `localhost:5000/...`) also produced invalid `app.kubernetes.io/version` labels.

## The Solution

Upgrade to v0.163.0, which ships targeted enhancements and bug fixes with no breaking CRD or API changes. Key operator-facing items:

## Whats New

**Enhancements**
- `auto-instrumentation`: Emits an `InstrumentationRequestRejected` Pod Event when a namespace has no matching `Instrumentation` resource (#5855) — easier to diagnose silent injection failures.
- `target allocator`: New HTTPS server fields `min_version`, `cipher_suites`, `curve_preferences`, overridable via CLI flags `--https-min-version`, `--https-cipher-suites`, `--https-curve-preferences` (#5840). Curve preferences use IANA numeric IDs (e.g. 23 = secp256r1, 29 = X25519). Unset fields keep the existing default (TLS 1.2, Go defaults).
- `operator`: New `--tls-curve-preferences` flag / `TLS_CURVE_PREFERENCES` env var for the operator's own TLS supported groups (#5830).
- `target allocator`: When `--tls-configure-operands` is set, the Target Allocator's `https` config is now populated from the operator's TLS profile automatically (#5844).
- `collector`: Namespace-scoped Role/RoleBinding is created for the k8sattributes processor when `filter.namespace` is set (#5525) — tighter RBAC instead of cluster-wide.
- `operator`: Related images added to the OLM bundle, useful for disconnected/air-gapped installs (#5823).

**Bug fixes**
- `collector`: Dry-run admission requests (`kubectl apply --dry-run=server`, `kubectl diff`) no longer generate Kubernetes Events (#5738).
- `collector`: Mutating webhook no longer overwrites `service.telemetry` under the declarative `resource.attributes` schema (#5207).
- `target allocator`: `prometheusCR.denyFSAccessThroughSMs` is now preserved when converting between `v1alpha1` and `v1beta1` (#5904).
- `collector`: ConfigMaps containing a literal `<<` map key are written correctly (quoted) instead of being rejected as unrenderable — fixed upstream in `go.yaml.in/yaml/v3` v3.0.6 (#5866).
- `auto-instrumentation`: nginx injection is now idempotent; re-injecting into the same Pod is a no-op (#5810).
- `opamp`: Bridge no longer restarts/deletes collectors it doesn't manage; bridge name now comes from the `OpAMPBridge` resource name, so multiple bridges in one cluster can distinguish their collectors via a `name`-labeled selector instead of only the generic `opentelemetry.io/opamp-reporting: "true"` label (#5616, #5920).
- `operator`: Operator NetworkPolicy is reconciled when API server IPs change, by watching EndpointSlices (#5559).
- `target allocator`: Removed a redundant CRD default on `spec.targetAllocator.mtls.tls.certificateAuthorityCertificate.configMap.key` (operator already defaults to `ca.crt`) (#5841).
- `auto-instrumentation`: Upgrades to breaking instrumentation versions are blocked when images include a digest (#5856).
- `collector, target allocator, opamp`: `app.kubernetes.io/version` label is now derived correctly from image tags even when the registry address includes a port (e.g. `localhost:5000/otel/collector:0.100.0`) (#5801).
- `cluster observability`: Added `RELATED_IMAGE_CLUSTER_OBSERVABILITY_COLLECTOR` env var mapping (#5803).

**Bundled components**
- OpenTelemetry Collector / Contrib v0.163.2
- Java auto-instrumentation v2.33.1-3, .NET v1.19.1-1, Node.js v0.83.0-2, Python v0.66b2-4, Ruby v0.1.0, Go v0.24.0, PHP ext 1.4.2, ApacheHTTPD/Nginx webserver v1.0.4-5

## Upgrade Steps

Check the currently installed version:

```bash
kubectl get deployment -n opentelemetry-operator-system \
  opentelemetry-operator-controller-manager \
  -o jsonpath='{.spec.template.spec.containers[0].image}'
```

Upgrade via the official Helm chart (adjust release name/namespace to your setup):

```bash
helm repo add open-telemetry https://open-telemetry.github.io/opentelemetry-helm-charts
helm repo update

helm upgrade opentelemetry-operator open-telemetry/opentelemetry-operator \
  --namespace opentelemetry-operator-system \
  --set manager.image.tag=0.163.0 \
  --reuse-values
```

If you manage the operator directly with manifests instead of Helm:

```bash
kubectl apply -f \
  https://github.com/open-telemetry/opentelemetry-operator/releases/download/v0.163.0/opentelemetry-operator.yaml
```

Optional: enable the new TLS hardening flags on the operator deployment, for example to restrict curve preferences (23 = secp256r1, 29 = X25519):

```bash
kubectl set env deployment/opentelemetry-operator-controller-manager \
  -n opentelemetry-operator-system \
  TLS_CURVE_PREFERENCES="23,29"
```

Or set the equivalent fields in the Target Allocator config if you run a standalone Target Allocator with `--tls-configure-operands` enabled.

## Verify

Confirm the operator pods are running the new image:

```bash
kubectl get pods -n opentelemetry-operator-system \
  -l app.kubernetes.io/name=opentelemetry-operator \
  -o jsonpath='{.items[*].spec.containers[*].image}'
```

Check operator logs for startup errors after upgrade:

```bash
kubectl logs -n opentelemetry-operator-system \
  deployment/opentelemetry-operator-controller-manager --tail=100
```

If using auto-instrumentation, confirm a namespace without an `Instrumentation` resource now emits the rejection Event:

```bash
kubectl get events -n <namespace> --field-selector reason=InstrumentationRequestRejected
```

## Common Issues

- **CRDs not updated by Helm**: `helm upgrade` does not update CRDs by default; apply the CRD manifests from the release assets separately if the chart's CRD subchart wasn't bumped.
- **Existing TLS behavior unaffected**: leaving the new `min_version`/`cipher_suites`/`curve_preferences` fields unset preserves prior behavior (TLS 1.2, Go default ciphers/curves) — no action required unless you want stricter settings.
- **OpAMP bridge naming change**: after upgrade, the bridge's generated config now carries `name: <OpAMPBridge name>`. If you relied on the generic `opentelemetry.io/opamp-reporting: "true"` label across multiple bridges in one cluster, review labeling to avoid overlap now that name-based selection is available.
- **Digest-pinned images and upgrades**: if auto-instrumentation images are pinned by digest, breaking version upgrades are now blocked (#5856) — expect to see this surfaced as a rejected admission rather than a silent breakage.

## Best Practices

- Pin the operator version explicitly in Helm (`manager.image.tag`) rather than tracking `latest`, and review the release notes for every bump given the frequent weekly cadence of this project.
- Enable the new TLS curve/cipher flags in regulated environments to meet compliance baselines (e.g., disable weak curves by only listing 23 and 29).
- Audit OpAMP bridge labels after upgrading if running multiple bridges per cluster, to take advantage of the new name-scoped collector management.
- Test `kubectl apply --dry-run=server` and `kubectl diff` workflows in CI to confirm the Event-spam fix behaves as expected in your pipelines.

