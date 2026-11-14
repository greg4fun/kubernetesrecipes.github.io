---
title: "What's New in KServe v0.21.0: DRA Support and CRD Install"
description: "KServe v0.21.0 adds DRA resourceClaims, independent CRD installation, TLS security profile integration, and several LLMInferenceService fixes."
publishDate: "2026-11-03"
author: "Luca Berton"
category: "ai"
difficulty: "intermediate"
timeToComplete: "20 minutes"
kubernetesVersion: "1.29+"
tags:
  - "kserve"
  - "model-serving"
  - "llminferenceservice"
  - "dra"
  - "helm"
  - "crd"
  - "mlops"
---
> 💡 **Quick Answer:** KServe v0.21.0 adds Dynamic Resource Allocation (DRA) support for ServingRuntimes, restructures CRD management for independent installation, integrates with the cluster TLS security profile, and ships numerous `LLMInferenceService` (llmisvc) fixes including flag migrations and a tokenizer sidecar replacement — upgrade via Helm and re-apply CRDs separately before upgrading the controller.

## The Problem

Operators running GPU/accelerator workloads needed a way to request specialized resources (e.g. via DRA ResourceClaims) directly from ServingRuntime specs, and CRD lifecycle was tightly coupled to the main KServe install, making independent CRD versioning and canary LLM deployment testing harder. The `LLMInferenceService` API also carried several deprecated flags and an outdated UDS-based tokenizer sidecar that needed modernization.

## The Solution

v0.21.0 decouples CRD installation from the controller chart, adds first-class DRA `resourceClaims` support on ServingRuntime, moves LLM workload-aware autoscaling (WVA) discovery to annotation-based detection instead of a dedicated VA CRD, and replaces the tokenizer sidecar with a vLLM render deployment. TLS configuration for llmisvc disaggregated-serving sidecars is now driven by a new flag, and the project adds a cluster-wide TLS security profile integration for stricter environments.

## What's New

- **DRA support for ServingRuntime** — `resourceClaims` can now be set in ServingRuntime specs for Dynamic Resource Allocation (PR #5828).
- **Independent CRD installation** — CRD management restructured so CRDs can be installed/upgraded independently of the controller release (PR #5843). Plan upgrades in two steps: CRDs first, controller second.
- **Cluster TLS security profile integration** — KServe can now honor the cluster-wide TLS security profile (PR #5791).
- **llmisvc: tokenizer sidecar replaced** — the UDS tokenizer sidecar is replaced by a vLLM render deployment (PR #5712).
- **llmisvc: WVA annotation-based discovery** — workload-variant-autoscaling (WVA) migrated from a dedicated VA CRD to annotation-based discovery (PR #5722).
- **llmisvc: new TLS flag for disagg-sidecar** — old TLS flag dropped in favor of a new flag for the disaggregated-serving sidecar; update any manifests/scripts referencing the old flag (PR #5875).
- **llmisvc: deprecated flag migrated to metrics-data-source plugin** (PR #5877), plus `--model-server-metrics-scheme` is now correctly migrated when set via `Args` (PR #5892).
- **llmisvc: EndpointPickerConfig apiVersion migrated** (PR #5774) and sample manifests updated from `v1alpha1` to `v1alpha2` (PR #5804) — review any custom llmisvc configs for the API version bump.
- **Canary deployment lifecycle for llmisvc** — new e2e coverage validates canary rollouts and `CanaryPredictorReady` condition handling (PRs #5833, #5849, #5884).
- **Reliability fixes**: data race eliminated in the API resource discovery cache (PR #5891), flaky router `TestServerTimeout` nil-pointer panic fixed (PR #5887), agent no longer crashes on malformed model spec unmarshal (PR #5700), and `--kv-transfer-config` quote escaping fixed (PR #5880).
- **Python SDK fix**: numpy unicode string dtype now correctly maps to `BYTES` in `from_np_dtype` (PR #5889).
- **Docs**: new agentic tool-calling guide and samples for llmisvc (PR #5906); measured startup benchmarks for OCI model delivery paths (PR #5852).

> Release notes were truncated at the source; for the complete, unabridged changelog see the [v0.21.0 release page](https://github.com/kserve/kserve/releases/tag/v0.21.0).

## Upgrade Steps

Since CRD management is now independent of the controller chart (PR #5843), apply CRDs first, then upgrade the controller.

```bash
# 1. Create or confirm the kserve namespace
kubectl create namespace kserve --dry-run=client -o yaml | kubectl apply -f -

# 2. Install/upgrade CRDs independently
helm upgrade --install kserve-crd oci://ghcr.io/kserve/charts/kserve-crd \
  --version v0.21.0 \
  --namespace kserve

# 3. Install/upgrade the KServe controller
helm upgrade --install kserve oci://ghcr.io/kserve/charts/kserve \
  --version v0.21.0 \
  --namespace kserve \
  --set kserve.controller.deploymentMode=RawDeployment
```

If running LLMInferenceService workloads, review manifests for:

```bash
# find references to deprecated llmisvc flags before upgrading
grep -r -- '--model-server-metrics-scheme\|tls-disagg\|apiVersion: .*llminferenceservice' manifests/ 2>/dev/null
```

## Verify

```bash
# Confirm controller and CRD versions
kubectl get pods -n kserve
kubectl get crd | grep -i kserve
kubectl get deployment kserve-controller-manager -n kserve -o jsonpath='{.spec.template.spec.containers[0].image}'

# Confirm ServingRuntime supports resourceClaims field
kubectl explain servingruntime.spec.containers.resources.claims

# Smoke test an InferenceService
kubectl get inferenceservice -A
kubectl get llminferenceservice -A
```

## Common Issues

- **Old TLS flag still referenced for disagg-sidecar**: after PR #5875, the previous flag is dropped. Update deployment templates/Helm values to use the new TLS flag or sidecar startup will fail.
- **llmisvc configs stuck on v1alpha1**: sample manifests moved to `v1alpha2` (PR #5804); if custom CRs still use `v1alpha1` fields removed/renamed, reconciliation may silently skip (see also PR #5890 which skips v1alpha2 InfPool reconcile when the CRD is absent — ensure the CRD is installed).
- **CRD/controller version mismatch**: because CRDs are now installed separately, upgrading only the controller chart without also bumping the `kserve-crd` chart can leave new fields (like `resourceClaims`) unrecognized by the API server.
- **Metrics scrape config silently ignored**: if `--model-server-metrics-scheme` was previously set via raw `Args`, confirm it migrated correctly per PR #5892 by checking the rendered pod spec.

## Best Practices

- Always upgrade the `kserve-crd` chart before the `kserve` controller chart to avoid CRD/controller drift.
- Pin both charts to the same version tag (`v0.21.0`) to keep CRD schema and controller logic in sync.
- Audit llmisvc manifests for deprecated flags and `v1alpha1` apiVersions before upgrading; use `kubectl diff` against rendered Helm output as a dry run.
- Test canary llmisvc rollouts in a staging namespace first, since canary lifecycle handling received significant e2e coverage and fixes in this release.
- Enable DRA `resourceClaims` only after confirming the cluster has a DRA driver and feature gate enabled; this is an opt-in field, not a default behavior change.
