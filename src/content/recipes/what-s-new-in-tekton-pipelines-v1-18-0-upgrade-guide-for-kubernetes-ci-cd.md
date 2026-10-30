---
title: "What's New in Tekton Pipelines v1.18.0: Upgrade Guide for Kubernetes CI/CD"
description: "Tekton Pipelines v1.18.0 adds step onError continueAndFail, immutable controller labels, and bundle/image fixes. Upgrade steps included."
publishDate: "2026-10-30"
author: "Luca Berton"
category: "deployments"
difficulty: "intermediate"
timeToComplete: "15 minutes"
kubernetesVersion: "1.28+"
tags:
  - "tekton"
  - "ci-cd"
  - "pipelines"
  - "upgrade"
  - "taskrun"
  - "webhook"
  - "supply-chain"
---
> 💡 **Quick Answer:** Tekton Pipelines v1.18.0 adds a new `continueAndFail` option for `step.onError`, makes controller-managed labels immutable via webhook, fixes OCI bundle truncation and PVC cleanup for pipelines-in-pipelines, and ships images with correct `SOURCE_DATE_EPOCH` timestamps. Upgrade by re-applying the official release manifest.

## The Problem

Teams running Tekton need to know whether v1.18.0 (released after v1.17.1) introduces breaking changes before rolling it into clusters that run production CI/CD pipelines. Two of the fixes in this release — immutable controller labels and OCI bundle parsing — can affect existing TaskRuns/PipelineRuns and custom automation that mutates Tekton-managed labels.

## The Solution

Review the changes below, back up current `TaskRun`/`PipelineRun` CRDs if you have automation that patches controller-managed labels, then apply the v1.18.0 release manifest with `kubectl apply`. No CRD schema migration or Tekton CLI (`tkn`) minimum-version bump is called out in the release notes for this version.

## What's New

### Features

- **`continueAndFail` for `step.onError`** (#10536): a new value for `step.onError` lets a step fail without stopping sibling steps — Tekton now continues executing subsequent steps in the `Task`, but marks the overall `TaskRun` as failed once all steps complete. Useful for cleanup/diagnostic steps that must run even after a failure, while still surfacing the failure status.
 ```yaml
 steps:
 - name: run-tests
 image: golang
 onError: continueAndFail
 script: |
 go test ./... || exit 1
 ```

### Fixes

- **Immutable controller-managed labels** (#10687): `tekton.dev/pipeline`, `tekton.dev/pipelineTask`, and `tekton.dev/pipelineRun` labels are now enforced as immutable by the admission webhook once set. Any external controller, GitOps tool, or script that updates these labels on existing `PipelineRun`/`TaskRun` objects will now be **rejected**. Audit automation before upgrading.
- **OCI bundle truncation fix** (#10395): large Tekton bundles resolved from OCI images no longer get truncated, fixing parse failures for big bundle resolvers.
- **Early PVC cleanup fix** (#9727): fixes premature PVC cleanup for child pipelines in pipelines-in-pipelines (PiP) setups, which could break workspace sharing.
- **Reproducible image timestamps** (#10860): published images now carry the release commit's `SOURCE_DATE_EPOCH` as creation timestamp instead of inheriting the base image's, improving supply-chain reproducibility.
- Build toolchain bumped to Go 1.27.3 (#10937).

No deprecation notices or backward-incompatible API changes are called out in this release beyond the label-immutability webhook behavior above.

## Upgrade Steps

```bash
# Check current version
kubectl get deploy tekton-pipelines-controller -n tekton-pipelines -o jsonpath='{.metadata.labels.app\.kubernetes\.io/version}'

# Apply the v1.18.0 release manifest
kubectl apply -f https://infra.tekton.dev/tekton-releases/pipeline/previous/v1.18.0/release.yaml

# Watch the rollout
kubectl rollout status deploy/tekton-pipelines-controller -n tekton-pipelines
kubectl rollout status deploy/tekton-pipelines-webhook -n tekton-pipelines
```

Optional: verify supply-chain attestation before upgrading production clusters.

```bash
REKOR_UUID=108e9186e8c5677a60b5706509f09f5e185c25597018b15d790c34d2a4f4357d357cb747b9fe0109
rekor-cli get --uuid "$REKOR_UUID" --format json | jq -r .Attestation | jq .
```

## Verify

```bash
# Confirm controller/webhook pods are on v1.18.0
kubectl get pods -n tekton-pipelines -l app.kubernetes.io/part-of=tekton-pipelines \
 -o jsonpath='{range .items[*]}{.metadata.name}{"\t"}{.spec.containers[0].image}{"\n"}{end}'

# Smoke-test continueAndFail with a sample TaskRun
cat <<'EOF' | kubectl apply -f -
apiVersion: tekton.dev/v1
kind: TaskRun
metadata:
 generateName: onerror-smoke-
spec:
 taskSpec:
 steps:
 - name: fail-but-continue
 image: busybox
 onError: continueAndFail
 script: exit 1
 - name: cleanup-step
 image: busybox
 script: echo "cleanup still ran"
EOF

kubectl get taskrun -l tekton.dev/task --sort-by=.metadata.creationTimestamp -o wide | tail -1
```

Expect `cleanup-step` to run and the `TaskRun` to end in `Failed` status (not `Error`-abort on first step).

## Common Issues

- **Webhook rejects label updates**: if GitOps controllers (e.g., Argo CD sync hooks) or custom reconcilers patch `tekton.dev/pipeline*` labels on running objects, they will now get `403` admission errors post-upgrade (#10687). Remove that logic or set the labels only at creation time.
- **Stale bundle resolver cache**: if large OCI bundles previously failed to parse, clear any resolver cache and re-pull after upgrading to pick up the #10395 fix.
- **PiP workspace errors before upgrade**: if you hit premature PVC deletion in pipelines-in-pipelines before v1.18.0, confirm the fix (#9727) resolves it after upgrade rather than patching workspace TTLs manually.

## Best Practices

- Pin the exact release manifest URL (`.../previous/v1.18.0/release.yaml`) in GitOps rather than `latest` to keep upgrades auditable and reproducible.
- Verify the Rekor attestation against the release file in CI before promoting the manifest to production, per the commands in the official release notes.
- Audit any custom controllers or scripts for direct mutation of `tekton.dev/pipeline`, `tekton.dev/pipelineTask`, or `tekton.dev/pipelineRun` labels before upgrading, since the webhook now rejects such changes.
- Review the [v1.18.0 release notes](https://github.com/tektoncd/pipeline/releases/tag/v1.18.0) and [docs](https://github.com/tektoncd/pipeline/tree/v1.18.0/docs) for the full changelog, since this recipe only covers operator-relevant features and fixes, not the full dependency-bump list.
