---
title: "Kueue v0.20.2: What's New and How to Upgrade"
description: "Kueue v0.20.2 patch release notes: KueueViz pod-group dashboard, quota bypass fix, metrics leaks fixed, and upgrade steps."
publishDate: "2026-10-16"
author: "Luca Berton"
category: "ai"
difficulty: "intermediate"
timeToComplete: "15 minutes"
kubernetesVersion: "1.29+"
tags:
  - "kueue"
  - "batch-scheduling"
  - "job-queueing"
  - "kueuectl"
  - "fair-sharing"
  - "kueueviz"
  - "patch-release"
---
> 💡 **Quick Answer:** Kueue v0.20.2 is a patch release on the 0.20 line with one small KueueViz feature and ~20 bug fixes, including a quota-bypass fix for Pod groups and several Prometheus metric-leak fixes. Upgrade is a straightforward `helm upgrade` / `kubectl apply`, but read the `v0.19.0` and `v0.20.0` release notes first if you're crossing those minor versions.

## The Problem

Teams running Kueue for batch/AI job queueing need to know whether a patch release contains fixes worth taking immediately — especially anything touching quota accounting, admission correctness, or observability (metrics used for autoscaling/capacity dashboards). v0.20.2 bundles several of these.

## The Solution

Apply v0.20.2. It's a drop-in patch upgrade for anyone already on the 0.20.x line (no CRD schema changes called out). If you're coming from an older minor version, Kueue's release notes explicitly require reading the intermediate `.0` minor release notes first.

## What's New

**Feature**
- KueueViz: the workloads dashboard now shows the Pods belonging to pod-group Workloads, including `StatefulSet` and `LeaderWorkerSet` workloads (#17186).

**Notable bug fixes (operator-relevant)**
- **Security/quota bypass (Pods):** a Pod could bypass ClusterQueue quota by setting the `kueue.x-k8s.io/role-hash` annotation to another role's value and run an oversized Pod under that role's reservation. Kueue now re-verifies each Pod against its PodSet's effective spec before ungating it; a Pod that doesn't fit stays gated and emits a Warning event instead of admitting over-quota (PR referenced in release, no number given in notes — see release page).
- **Pod/AdmissionCheck deadlock:** with the Alpha `SkipReassignmentForPodOwnedWorkloads` feature enabled, single-Pod Workloads preempted/evicted while scheduling-gated (e.g. pending AdmissionCheck) could get stuck forever with `Requeued=False`. Fixed, and Workloads already stuck in this state are **automatically requeued on upgrade** (#17173).
- **DRA:** a Workload updated mid-scheduling could be requeued with quota charged against its *previous* spec, causing over/under-admission. Now handed back to the workload controller to recompute (#17208).
- **FairSharing:** workloads within nominal quota were incorrectly preempted when the ClusterQueue borrowed on an uncontested flavor or within an internal sub-cohort (#17031).
- **JobSet:** an evicted Workload could keep quota reserved (and never requeue) if a JobSet restart recreated already-succeeded child Jobs (#17215).
- **Observability:** stale Prometheus series after ClusterQueue deletion/move for `kueue_cluster_queue_weighted_share`, `kueue_replaced_workload_slices_total`, `kueue_cohort_subtree_quota`, `kueue_cohort_subtree_resource_reservations`, plus stale gauge series after custom-label updates on ClusterQueue/LocalQueue (#17239, #17219, #16941). If you alert on these metrics, expect cleaner series after upgrade — don't be surprised if old series disappear.
- **CLI (`kueuectl`):** fixed `create clusterqueue` rejecting hyphenated resource names (#16987), `list workload` failing on Workloads with empty `spec.queueName` (#16986), `version` printing only the client version under non-default Helm release names (#16953), duplicate rows in `list workload --for` pagination (#17084), and unnecessary remote lookups in `create localqueue --dry-run=client` (#17109).
- **Configuration validation:** `admissionFairSharing.usageSamplingInterval` and `admissionFairSharing.resourceWeights` validation errors now report the offending field correctly (#16943).

⚠️ The upstream release notes text was truncated mid-sentence for one entry describing an Alpha feature gate controlling the role-hash check ("The check is controlled by the Alpha PodI..."). Check the [release page](https://github.com/kubernetes-sigs/kueue/releases/tag/v0.20.2) for the full, untruncated wording and exact feature-gate name before relying on it in automation.

## Upgrade Steps

**Required reading first** if you're crossing minor versions:
- [v0.19.0 release notes](https://github.com/kubernetes-sigs/kueue/releases/tag/v0.19.0)
- [v0.20.0 release notes](https://github.com/kubernetes-sigs/kueue/releases/tag/v0.20.0)
- [v0.20.1 release notes](https://github.com/kubernetes-sigs/kueue/releases/tag/v0.20.1) (patch line you're crossing)

**Option A — Helm:**

```bash
helm upgrade --install kueue oci://registry.k8s.io/kueue/charts/kueue \
  --version 0.20.2 \
  --namespace kueue-system \
  --create-namespace
```

**Option B — kubectl manifest:**

```bash
kubectl apply --server-side -f \
  https://github.com/kubernetes-sigs/kueue/releases/download/v0.20.2/manifests.yaml
```

**Upgrade kueuectl (CLI):**

```bash
kubectl krew upgrade kueue
# or download the binary directly
curl -LO https://github.com/kubernetes-sigs/kueue/releases/download/v0.20.2/kubectl-kueue-linux-amd64
chmod +x kubectl-kueue-linux-amd64 && sudo mv kubectl-kueue-linux-amd64 /usr/local/bin/kubectl-kueue
```

## Verify

```bash
# Controller manager is on the new image/tag
kubectl get deployment kueue-controller-manager -n kueue-system \
  -o jsonpath='{.spec.template.spec.containers[0].image}'

# Pods healthy
kubectl get pods -n kueue-system

# CLI reports matching server/client versions
kueuectl version

# Spot-check that previously stuck Pod-group Workloads (if any) requeued
kubectl get workloads -A -o json | \
  jq '.items[] | select(.status.conditions[]?.type=="Requeued" and .status.conditions[]?.status=="False")'
```

## Common Issues

- **Dashboards show fewer metric series after upgrade:** expected — stale gauge/counter series from deleted ClusterQueues or label updates are now correctly garbage-collected (#17239, #17219, #16941). Update alert thresholds if they depended on the stale series lingering.
- **Previously-stuck Workloads suddenly move:** Workloads parked with `Requeued=False` due to the `SkipReassignmentForPodOwnedWorkloads` bug are auto-requeued on upgrade (#17173) — expect a short burst of scheduling activity right after rollout.
- **Skipping the `.0` minor notes:** if you jump from, say, v0.18.x straight to v0.20.2, you'll miss breaking changes introduced in v0.19.0/v0.20.0. Always read those first.

## Best Practices

- Pin the exact Kueue version in Helm/GitOps manifests (`--version 0.20.2`) rather than tracking `latest`.
- Treat the role-hash quota-bypass fix as a security patch for multi-tenant clusters running Pod-group workloads — prioritize this upgrade on shared clusters.
- Audit any custom Prometheus alerting rules referencing `kueue_cluster_queue_weighted_share`, `kueue_cohort_subtree_quota`, or `kueue_cohort_subtree_resource_reservations` after upgrading, since stale series cleanup changes cardinality.
- If you enable Alpha feature gates (`SkipReassignmentForPodOwnedWorkloads`, admission fair sharing), re-test in a staging cluster before promoting — these remain under active bugfixing.
- Keep `kueuectl` in sync with the controller version to avoid the version-mismatch CLI bug fixed in #16953.
