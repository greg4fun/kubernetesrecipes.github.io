---
title: "Prometheus Operator v0.95.1: Maintenance Release"
description: "Prometheus Operator v0.95.1 is a maintenance release fixing broken v0.95.0 image publishing. Upgrade steps and verification for operators."
publishDate: "2026-11-07"
author: "Luca Berton"
category: "observability"
difficulty: "beginner"
timeToComplete: "10 minutes"
kubernetesVersion: "1.28+"
tags:
  - "prometheus-operator"
  - "prometheus"
  - "monitoring"
  - "crds"
  - "upgrade"
  - "maintenance-release"
---
> 💡 **Quick Answer:** Prometheus Operator v0.95.1 is a maintenance-only release that fixes a broken CI pipeline which failed to publish container images for v0.95.0. There are no functional changes, new features, or breaking changes in this release — operators should skip v0.95.0 entirely and upgrade directly from v0.94.1 to v0.95.1.

## The Problem

The `v0.95.0` tag was cut, but the CI workflow responsible for building and publishing the container images failed partway through. As a result, the `quay.io/prometheus-operator/prometheus-operator:v0.95.0` (and related `prometheus-config-reloader` / `admission-webhook`) images were never reliably published. Anyone who tried to pull `v0.95.0` may have hit `ImagePullBackOff` or gotten an incomplete image.

## The Solution

The maintainers re-ran the release pipeline under tag `v0.95.1` to publish the correct, complete set of images. The source code and CRDs for `v0.95.1` are effectively the same as what was intended for `v0.95.0` — this is purely a packaging/CI fix, not a code or API change.

## What's New

According to the published release notes, this is strictly a maintenance release:

- No new CRD fields, API changes, or deprecations are documented for this tag.
- No bug fixes beyond the broken image publishing are called out.
- The release notes are thin by design — see the [v0.95.1 release page](https://github.com/prometheus-operator/prometheus-operator/releases/tag/v0.95.1) for the authoritative, up-to-date text rather than relying on a summary here.

If you were already running `v0.94.1`, treat this as the next available release in the `v0.95.x` line — there is no need to look for `v0.95.0` separately, since its images are not usable.

## Upgrade Steps

### Option 1: kubectl (CRDs + Operator bundle)

```bash
# Apply the updated CRDs first
kubectl apply --server-side -f https://raw.githubusercontent.com/prometheus-operator/prometheus-operator/v0.95.1/example/prometheus-operator-crd/monitoring.coreos.com_alertmanagerconfigs.yaml
kubectl apply --server-side -f https://raw.githubusercontent.com/prometheus-operator/prometheus-operator/v0.95.1/example/prometheus-operator-crd/monitoring.coreos.com_alertmanagers.yaml
kubectl apply --server-side -f https://raw.githubusercontent.com/prometheus-operator/prometheus-operator/v0.95.1/example/prometheus-operator-crd/monitoring.coreos.com_podmonitors.yaml
kubectl apply --server-side -f https://raw.githubusercontent.com/prometheus-operator/prometheus-operator/v0.95.1/example/prometheus-operator-crd/monitoring.coreos.com_probes.yaml
kubectl apply --server-side -f https://raw.githubusercontent.com/prometheus-operator/prometheus-operator/v0.95.1/example/prometheus-operator-crd/monitoring.coreos.com_prometheusagents.yaml
kubectl apply --server-side -f https://raw.githubusercontent.com/prometheus-operator/prometheus-operator/v0.95.1/example/prometheus-operator-crd/monitoring.coreos.com_prometheuses.yaml
kubectl apply --server-side -f https://raw.githubusercontent.com/prometheus-operator/prometheus-operator/v0.95.1/example/prometheus-operator-crd/monitoring.coreos.com_prometheusrules.yaml
kubectl apply --server-side -f https://raw.githubusercontent.com/prometheus-operator/prometheus-operator/v0.95.1/example/prometheus-operator-crd/monitoring.coreos.com_scrapeconfigs.yaml
kubectl apply --server-side -f https://raw.githubusercontent.com/prometheus-operator/prometheus-operator/v0.95.1/example/prometheus-operator-crd/monitoring.coreos.com_servicemonitors.yaml
kubectl apply --server-side -f https://raw.githubusercontent.com/prometheus-operator/prometheus-operator/v0.95.1/example/prometheus-operator-crd/monitoring.coreos.com_thanosrulers.yaml

# Bump the operator image
kubectl -n monitoring set image deployment/prometheus-operator \
  prometheus-operator=quay.io/prometheus-operator/prometheus-operator:v0.95.1
```

### Option 2: Helm (kube-prometheus-stack or standalone chart)

```bash
helm repo update prometheus-community

helm upgrade prometheus-operator prometheus-community/prometheus-operator \
  --namespace monitoring \
  --set image.tag=v0.95.1
```

If you manage the operator via `prometheus-community/kube-prometheus-stack`, check which chart version pins `v0.95.1` before upgrading the whole chart, and override just the operator image tag if the chart hasn't bumped it yet:

```bash
helm upgrade kube-prometheus-stack prometheus-community/kube-prometheus-stack \
  --namespace monitoring \
  --set prometheusOperator.image.tag=v0.95.1
```

## Verify

```bash
# Confirm the running image tag
kubectl -n monitoring get deployment prometheus-operator \
  -o jsonpath='{.spec.template.spec.containers[0].image}'

# Confirm the operator pod is healthy
kubectl -n monitoring get pods -l app.kubernetes.io/name=prometheus-operator

# Confirm CRDs report the expected version in status (if your workflow tracks this)
kubectl get crd prometheuses.monitoring.coreos.com -o yaml | grep -A2 'app.kubernetes.io/version'
```

The deployment image should read `...:v0.95.1`, and the pod should be `Running` with `0` restarts shortly after rollout.

## Common Issues

- **Stuck on `v0.95.0` with `ImagePullBackOff`**: this confirms the known CI publishing issue. Switch the image tag directly to `v0.95.1` — don't wait for `v0.95.0` to resolve, it won't.
- **CRD apply fails with `metadata.annotations: Too long`**: use `--server-side` as shown above; this is a known kubectl limitation with large CRD annotations, not specific to this release.
- **Helm chart still references an older operator tag**: check `helm show values prometheus-community/kube-prometheus-stack | grep -A2 'prometheusOperator:'` and override `prometheusOperator.image.tag` explicitly until the chart catches up.

## Best Practices

- Pin the operator image tag explicitly in GitOps manifests (Argo CD/Flux) rather than tracking `latest`, so broken CI publishes like `v0.95.0` never silently reach production.
- Before any operator upgrade, diff the CRDs between versions (`kubectl diff -f <crd-file>`) to catch schema changes early, even on maintenance releases.
- Watch the [releases page](https://github.com/prometheus-operator/prometheus-operator/releases) rather than just the changelog in-repo — maintenance tags like this one are sometimes only explained in the GitHub release description.
- Roll out operator upgrades to a staging/monitoring namespace first and confirm `ServiceMonitor`/`PrometheusRule` reconciliation still succeeds before touching production clusters.
