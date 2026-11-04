---
title: "What's New in Kubeflow: kubeflow/kubeflow Repo Now Redirects to Component Releases"
description: "Kubeflow's main repo no longer ships release notes; track SDK, Notebooks, Trainer, Katib, Pipelines and more individually."
publishDate: "2026-11-04"
author: "Luca Berton"
category: "deployments"
difficulty: "intermediate"
timeToComplete: "10 minutes"
kubernetesVersion: "1.28+"
tags:
  - "kubeflow"
  - "mlops"
  - "ai"
  - "helm"
  - "deployments"
  - "release-notes"
---
> 💡 **Quick Answer:** The `kubeflow/kubeflow` GitHub repository no longer contains project code or meaningful release notes — it now just redirects operators to the individual component repos (SDK, Notebooks, Spark Operator, Trainer, Katib, Hub/Model Registry, Pipelines), each with its own release cadence and version numbers.

## The Problem

Operators watching `kubeflow/kubeflow` for "what's new" updates will find this release (tagged `redirect`) contains no changelog, no feature list, and no version number to speak of. If you're used to a single monolithic Kubeflow release, this is a structural change, not a feature drop.

## The Solution

Kubeflow has split into independently versioned sub-projects. There is no more single "Kubeflow vX.Y" to install or upgrade as a unit. Instead, track and upgrade each component separately based on what you actually run in your cluster.

## What's New

- `kubeflow/kubeflow` is now a pointer/redirect repo only — **no code, no unified release notes**.
- Component repos and where to watch them:
  - Kubeflow SDK → https://github.com/kubeflow/sdk/releases
  - Kubeflow Notebooks → https://github.com/kubeflow/notebooks/releases
  - Kubeflow Spark Operator → https://github.com/kubeflow/spark-operator/releases
  - Kubeflow Trainer → https://github.com/kubeflow/trainer/releases
  - Kubeflow Katib → https://github.com/kubeflow/katib/releases
  - Kubeflow Hub (Model Registry) → https://github.com/kubeflow/model-registry/releases
  - Kubeflow Pipelines → https://github.com/kubeflow/pipelines/releases
- For full-platform installs, the canonical entry point is now the docs site, not this repo: https://www.kubeflow.org/docs/started/installing-kubeflow/
- No breaking changes, deprecations, or flags are documented in this release — the notes are intentionally thin (it's an index, not a release).

## Upgrade Steps

Because there's nothing to install from `kubeflow/kubeflow` itself, treat this as a pointer to re-point your tooling at the right sources.

1. Identify which Kubeflow components you actually run (check namespaces/Helm releases in your cluster):

```bash
kubectl get ns | grep -i kubeflow
helm list -A | grep -i kubeflow
```

2. For each component in use, go to its dedicated repo's Releases page (listed above) and follow that project's own upgrade guide. Example for Kubeflow Pipelines via `kubectl apply`:

```bash
export PIPELINE_VERSION=<latest-tag-from-kubeflow/pipelines/releases>
kubectl apply -k "github.com/kubeflow/pipelines/manifests/kustomize/cluster-scoped-resources?ref=$PIPELINE_VERSION"
kubectl wait --for=condition=established --timeout=60s crd/pipelines.kubeflow.org
kubectl apply -k "github.com/kubeflow/pipelines/manifests/kustomize/env/platform-agnostic-pns?ref=$PIPELINE_VERSION"
```

3. For a full multi-component deployment, follow the official installation guide rather than any single-repo manifest:

```bash
# See install options (manifests, distributions, kfctl successors)
# https://www.kubeflow.org/docs/started/installing-kubeflow/
```

## Verify

After upgrading a given component, confirm its pods and CRDs are healthy:

```bash
kubectl get pods -n kubeflow
kubectl get crds | grep kubeflow.org
kubectl get deployment -n kubeflow -o wide
```

For Pipelines specifically, check the API server responds:

```bash
kubectl -n kubeflow port-forward svc/ml-pipeline-ui 8080:80
curl -sI http://localhost:8080
```

## Common Issues

- **Stale bookmarks/CI jobs**: if you had automation watching `kubeflow/kubeflow` releases for version bumps, it will stop firing meaningfully — repoint CI to the specific component repo(s) you consume.
- **Version confusion**: there is no single "Kubeflow 1.x" version anymore for most components; document per-component versions in your own change log.
- **Manifest drift**: manifests previously sourced from `kubeflow/kubeflow` (historically `kubeflow/manifests`) should be re-verified against the current official install docs, since paths and kustomize bases can shift between component releases.

## Best Practices

- Pin and track each Kubeflow component's version independently (Notebooks, Pipelines, Katib, Trainer, Spark Operator, Model Registry, SDK) rather than assuming a unified release train.
- Subscribe to Releases/Atom feeds on the individual component repos instead of `kubeflow/kubeflow`.
- Before any upgrade, read that specific component's release notes for breaking changes — this redirect release carries none, but component releases typically do.
- Use the official docs (kubeflow.org) as the source of truth for install topology, since it reflects the current multi-repo structure.
