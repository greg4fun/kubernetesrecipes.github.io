---
title: "What's New in Gateway API v1.6.3: Conformance Test Fixes and Build Updates"
description: "Gateway API v1.6.3 release notes summary: conformance test fixes for TCPRoute/UDPRoute, build tooling updates, and upgrade steps."
publishDate: "2026-10-12"
author: "Luca Berton"
category: "networking"
difficulty: "beginner"
timeToComplete: "10 minutes"
kubernetesVersion: "1.26+"
tags:
  - "gateway-api"
  - "ingress"
  - "conformance"
  - "upgrade"
  - "networking"
  - "crds"
---
> 💡 **Quick Answer:** Gateway API v1.6.3 is a maintenance release focused on conformance test fixes (TCPRoute/UDPRoute no longer "provisional", new `GatewayInvalidParametersRef` test) and a Go toolchain build fix — there are no new user-facing API features, deprecations, or breaking changes in this patch.

## The Problem

Operators tracking Gateway API releases need to know whether a new patch version changes CRDs, controller behavior, or conformance expectations before rolling it into a cluster or CI pipeline.

## The Solution

Upgrade the Gateway API CRDs to v1.6.3 to pick up the latest conformance test definitions and keep the release channel current. Because this is a patch release with no API or CRD schema changes called out in the release notes, the upgrade is low-risk and can be applied directly.

## What's New

The v1.6.3 release notes list only conformance-suite and build changes — no new CRD fields, gateway controller features, or deprecations are mentioned. If your implementation (ingress controller) advertises Gateway API conformance, these changes affect how it gets certified, not how you configure routes.

**Conformance**
- Conformance tests for stable features, notably `TCPRoute` and `UDPRoute`, are no longer marked "provisional" (#5260) — implementations can now be certified as fully conformant for these routes instead of provisionally conformant.
- The `ExpectMirroredRequest` conformance test now forces its timeout to `MaxTimeToConsistency` (#5296), reducing flaky failures in request-mirroring tests.
- Unused namespaces left behind in Mesh conformance tests were actually removed this time (#5251), cleaning up test cluster state.
- A new conformance test, `GatewayInvalidParametersRef`, was added to validate handling of invalid `parametersRef` on a Gateway (#5236).

**Build**
- The Go toolchain used in CI/build now matches the version pinned in `go.work` (#5234), avoiding toolchain drift.

The official release notes are thin by design for this patch — see the [v1.6.3 release page](https://github.com/kubernetes-sigs/gateway-api/releases/tag/v1.6.3) for the full changelog rather than expecting additional feature content here.

## Upgrade Steps

Apply the standard (non-experimental) CRD channel directly from the release tag:

```bash
kubectl apply -f https://github.com/kubernetes-sigs/gateway-api/releases/download/v1.6.3/standard-install.yaml
```

If you track the experimental channel (for features like TCPRoute/UDPRoute still iterating toward GA):

```bash
kubectl apply -f https://github.com/kubernetes-sigs/gateway-api/releases/download/v1.6.3/experimental-install.yaml
```

If you manage the CRDs via Helm (e.g. as a dependency in your own chart), bump the CRD chart reference or re-run your existing install/upgrade process pointing at v1.6.3 — there is no dedicated upstream Helm chart published by this repo, so most teams vendor the YAML manifests above directly.

## Verify

Confirm the CRDs report the new version:

```bash
kubectl get crd gateways.gateway.networking.k8s.io -o jsonpath='{.metadata.labels.gateway\.networking\.k8s\.io/bundle-version}'
```

Check that existing Gateway, HTTPRoute, TCPRoute, and UDPRoute resources are still accepted and unchanged:

```bash
kubectl get gateways.gateway.networking.k8s.io -A
kubectl get tcproutes.gateway.networking.k8s.io -A
kubectl get udproutes.gateway.networking.k8s.io -A
```

If you run the conformance suite against your controller, re-run it to pick up the updated (non-provisional) TCPRoute/UDPRoute expectations:

```bash
go test ./conformance/... -run TestConformance -gateway-class=<your-gateway-class>
```

## Common Issues

- **CRD apply fails with "metadata.annotations: Too long"**: use `kubectl apply --server-side` instead of client-side apply when upgrading CRDs across minor/patch versions.
- **Conformance suite now fails where it previously passed**: this is expected if your controller relied on TCPRoute/UDPRoute being "provisional" (lenient); review failures against #5260 since those routes are now held to the stable conformance bar.
- **Toolchain mismatch errors in local builds**: if building Gateway API from source, ensure your local Go version matches `go.work`, per the fix in #5234.

## Best Practices

- Pin the exact CRD manifest version (`v1.6.3`) in GitOps repos instead of tracking `main`, to avoid unplanned CRD drift.
- Re-run conformance tests in CI after every Gateway API bump, especially after releases that touch conformance test "provisional" status.
- Review the [release page](https://github.com/kubernetes-sigs/gateway-api/releases/tag/v1.6.3) directly for patch releases like this one, since notes are intentionally minimal and don't always warrant a full upgrade runbook.
