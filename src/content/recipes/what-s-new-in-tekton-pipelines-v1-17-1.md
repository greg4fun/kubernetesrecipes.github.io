---
title: "What's New in Tekton Pipelines v1.17.1"
description: "Patch release for Tekton Pipelines v1.17.1: Go 1.27.3 CVE fix, install/upgrade commands, and image attestation verification."
publishDate: "2026-10-28"
author: "Luca Berton"
category: "security"
difficulty: "beginner"
timeToComplete: "10 minutes"
kubernetesVersion: "1.28+"
tags:
  - "tekton"
  - "tekton-pipelines"
  - "ci-cd"
  - "patch-release"
  - "cve"
  - "go"
  - "attestation"
---
> 💡 **Quick Answer:** Tekton Pipelines v1.17.1 is a patch release on the v1.17.x branch that bumps the `ko` builder image to Go 1.27.3 (#10938), addressing CVE-2026-111943. There are no new features, deprecations, or breaking changes in this release — operators should treat it as a routine security patch upgrade.

## The Problem

Previous v1.17.x builds of Tekton Pipelines were compiled with a Go toolchain version affected by CVE-2026-111943. Anyone running v1.17.0 (or earlier 1.17.x) is exposed to that CVE in the controller/webhook binaries, even though no Tekton-specific functionality is affected.

## The Solution

Upgrade to v1.17.1. This release contains a single fix — bumping the `ko` image used to build Pipelines components to Go 1.27.3 — with no API, CRD, or behavioral changes. It's a drop-in replacement for v1.17.0.

## Whats New

- **Fixes**
 - :bug: `[release-v1.17.x] fix: bump plumbing ko image to Go 1.27.3` (#10938) — resolves CVE-2026-111943 by rebuilding all Pipelines component images with an updated Go toolchain.
- **Features**: none in this release.
- **Deprecation notices**: none in this release.
- **Backward-incompatible changes**: none in this release.
- **Docs / Misc**: no changes called out.

The release notes for v1.17.1 are intentionally thin — it's a targeted CVE backport on the `release-v1.17.x` branch. See the full notes: https://github.com/tektoncd/pipeline/releases/tag/v1.17.1

## Upgrade Steps

Apply the release manifest directly with `kubectl`:

```bash
kubectl apply -f https://infra.tekton.dev/tekton-releases/pipeline/previous/v1.17.1/release.yaml
```

Wait for the controller, webhook, and resolvers deployments to roll out:

```bash
kubectl rollout status deployment/tekton-pipelines-controller -n tekton-pipelines
kubectl rollout status deployment/tekton-pipelines-webhook -n tekton-pipelines
```

If you manage Tekton via a GitOps tool (ArgoCD/Flux), bump the pinned manifest URL/tag in your source repo to `v1.17.1` instead of applying manually.

## Verify

Confirm the installed version matches v1.17.1:

```bash
kubectl get deployment tekton-pipelines-controller -n tekton-pipelines \
 -o jsonpath='{.metadata.labels.app\.kubernetes\.io/version}'
```

Check pod images were rebuilt with the patched Go toolchain (image digests should differ from v1.17.0):

```bash
kubectl get pods -n tekton-pipelines -o jsonpath='{.items[*].spec.containers[*].image}' | tr ' ' '\n' | sort -u
```

Optionally verify the release artifact against its signed attestation (requires `rekor-cli` and `jq`):

```bash
REKOR_UUID=108e9186e8c5677ac8e702d8f174d6509e26698a2f0c98fe78c04629b3a92414e2e9ae50696b433c
RELEASE_FILE=https://infra.tekton.dev/tekton-releases/pipeline/previous/v1.17.1/release.yaml

rekor-cli get --uuid "$REKOR_UUID" --format json | jq -r .Attestation | jq . > attestation.json

REKOR_ATTESTATION_IMAGES=$(cat attestation.json | jq -r '.subject[]|.name + ":v1.17.1@sha256:" + .digest.sha256')

curl -L "$RELEASE_FILE" > release.yaml

for image in $REKOR_ATTESTATION_IMAGES; do
 printf "%s" "$image"; grep -q "$image" release.yaml && echo " ===> ok" || echo " ===> no match";
done
```

Run a smoke-test `Pipeline`/`PipelineRun` to confirm nothing regressed:

```bash
kubectl apply -f https://raw.githubusercontent.com/tektoncd/pipeline/v1.17.1/examples/v1/pipelineruns/no_ci/hello-world.yaml
kubectl get pipelineruns -w
```

## Common Issues

- **Old CRDs stick around after apply**: `kubectl apply` on the release manifest doesn't prune removed resources; if migrating from a much older version, diff CRDs manually before applying.
- **Webhook cert rotation delay**: after upgrade, new `PipelineRun`/`TaskRun` validation may briefly fail with TLS handshake errors until the webhook pod is fully ready — wait for `rollout status` to complete before submitting new runs.
- **Rekor UUID lookup fails**: `rekor-cli` requires network access to the public Rekor transparency log; corporate proxies/firewalls can block this — the attestation check is optional and can be skipped if it's not required by policy.

## Best Practices

- Treat v1.17.1 as a mandatory security patch if you're on v1.17.0 — it closes a Go CVE (CVE-2026-111943) with no functional changes, so there's low upgrade risk.
- Pin the exact release manifest URL (with version tag) in GitOps rather than tracking `latest`, so upgrades are explicit and auditable.
- Verify image provenance via the Rekor attestation in regulated environments before rolling the manifest to production clusters.
- Since this release has no API/CRD changes, no changes to existing `Pipeline`, `Task`, or `PipelineRun` manifests are required.
