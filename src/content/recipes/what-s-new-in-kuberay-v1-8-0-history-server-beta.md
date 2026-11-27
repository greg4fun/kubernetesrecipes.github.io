---
title: "What's New in KubeRay v1.8.0: History Server Beta"
description: "KubeRay v1.8.0 adds History Server beta, node label delivery, node event forwarding, and idle RayCluster termination."
publishDate: "2026-11-27"
author: "Luca Berton"
category: "observability"
difficulty: "intermediate"
timeToComplete: "20 minutes"
kubernetesVersion: "1.28+"
tags:
  - "kuberay"
  - "ray"
  - "kubernetes"
  - "history-server"
  - "autoscaling"
  - "helm"
  - "node-labels"
---
> 💡 **Quick Answer:** KubeRay v1.8.0 graduates the Ray History Server to beta (it can now serve **running** RayClusters from the object store without proxying), and adds three alpha/new features: Node Label Delivery, Kubernetes Node Event Forwarding, and idle RayCluster self-termination. Most new capabilities are off by default behind feature gates, so upgrading from v1.7.1 is low-risk if you don't opt in.

## The Problem

Operators running Ray on Kubernetes have historically had three pain points: (1) inspecting a *running* RayCluster's history required proxying into the live cluster since the History Server only served completed/dead clusters; (2) Ray couldn't see real Kubernetes node attributes (rack, zone, GPU topology) for scheduling decisions; and (3) autoscaler v2 could scale workers to zero, but the head Pod kept running indefinitely, reserving capacity and cost even on fully idle clusters.

## The Solution

KubeRay v1.8.0 addresses all three directly:

- The **History Server** (beta) now reads periodically-uploaded logs from the object store and lists running clusters in `/clusters` without proxying, controlled by `--enable-live-clusters` (disabled by default, i.e., object-store serving is the default path).
- **Node Label Delivery** (alpha) lets the operator copy allowlisted Kubernetes node labels onto Ray node labels via `workerGroupSpecs[].labelRefs`, enabling scheduling on real node attributes.
- **Idle RayCluster termination** lets `spec.idleTerminationOptions` suspend or delete a RayCluster once no Ray driver has connected for `timeoutSeconds`, finally letting the head Pod go idle-dormant instead of running forever.

## Whats New

### Ray History Server (beta)
- Serves **running** RayClusters from the object store when `--enable-live-clusters` is disabled (default).
- New reload button on the cluster selection page, or `?reload=true` on `enter_cluster/`; auto-refresh when a cluster transitions running → dead.
- New storage backend: Oracle Cloud Infrastructure Object Storage via `--storage-backend=oci`.
- Refs: #5347, #5463, #5467, #5321. Sample: `ray-cluster.historyserver.yaml`. Docs: [History Server Quick Start](https://docs.ray.io/en/master/kuberay/user-guides/history-server.html).

### Node Label Delivery (alpha, disabled by default)
- Set `workerGroupSpecs[].labelRefs` on the RayCluster; allowlist keys on the operator via `configuration.allowedNodeLabels` (Helm) or `--allowed-node-labels`.
- Requires operator admission webhooks (`webhooks.enabled: true`, needs cert-manager; incompatible with `singleNamespaceInstall`) and `rayVersion` >= 2.45.0.
- Enable with the chart's `featureGates` value, or directly on the operator:
  ```
  --feature-gates=NodeLabelDelivery=true
  ```
- Refs: #5260, #5329, #5300, #5501.

### Kubernetes Node Event Forwarding (alpha, disabled by default)
- Forwards Kubernetes Node events (e.g., GPU XID errors from node-problem-detector) to affected RayCluster CRs, surfaced in the Ray Dashboard.
- Enable via Helm `nodeEventForwarder.enabled` + feature gate `RayNodeEventForwarder=true`. Filter with `nodeEventForwarder.sources`, `.reasons`, `.types` (default `Warning` only).
- Not supported with `singleNamespaceInstall: true`.
- Ref: #4978. Docs: [Enable Ray platform events on Kubernetes](https://docs.ray.io/en/master/kuberay/user-guides/k8s-events.html).

### Idle RayCluster termination
- `spec.idleTerminationOptions.timeoutSeconds` + `.policy` (`Suspend` default, or `Delete`) acts once no Ray driver has connected for the timeout.
- Requires `enableInTreeAutoscaling: true` with autoscaler v2 and `rayVersion` >= 2.60.0.
- Ref: #5210. Sample: `ray-cluster.autoscaler-v2-terminate-idle-cluster.yaml`.
  ```yaml
  spec:
    enableInTreeAutoscaling: true
    idleTerminationOptions:
      timeoutSeconds: 30
      policy: Suspend
    autoscalerOptions:
      version: v2
  ```

### Other notable changes
- `scaleStrategy.scaleGate` on worker groups lets an external controller (e.g., Kueue) gate scale-up so the autoscaler falls back to another worker group immediately instead of waiting for the allocate timeout (#5094).
- KubeRay now sets `RAY_AUTH_MODE=disabled` on Ray containers when `spec.authOptions.mode` is unset, preserving compatibility with Ray 2.61 (which enables token auth by default); a user-set `RAY_AUTH_MODE` is never overridden (#5496, #5573).
- `workerGroupSpecs` is now a map list keyed by `groupName`, so Server-Side Apply merges per worker group instead of replacing the whole list (#4986) — review any SSA field-manager tooling that assumed list-replace semantics.
- New alpha API `gcsFaultToleranceOptions.activePassiveHeadOptions` and feature gate `GCSFaultToleranceActivePassiveHead` — API and validation only in this release; standby head provisioning is not yet implemented (#4910, #5289).
- RayService: `clusterUpgradeOptions.gatewayRef` attaches an incremental upgrade to an existing Gateway instead of creating one per RayService; exactly one of `gatewayClassName` or `gatewayRef` must be set (#5018).
- RayCronJob `jobTemplate` now accepts `metadata` (labels/annotations) copied onto generated RayJobs (#5383).
- Operator: Kubernetes Workload-Aware Scheduling now resizes gangs in place by patching `minCount` on the existing Workload/Pod group (details truncated in the provided notes — see the [full release page](https://github.com/kuberay-project/kuberay/releases/tag/v1.8.0) for the rest of this item).

> The supplied release notes are truncated after the "Operator" section; check the [release page](https://github.com/kuberay-project/kuberay/releases/tag/v1.8.0) for any remaining items (bug fixes, CRD changes) before upgrading production clusters.

## Upgrade Steps

```bash
# Check current CRD/operator version
kubectl get deployment -n kuberay-operator-system kuberay-operator -o jsonpath='{.spec.template.spec.containers[0].image}'

# Update Helm repo
helm repo update kuberay

# Upgrade the operator (CRDs + controller) to v1.8.0
helm upgrade kuberay-operator kuberay/kuberay-operator \
  --namespace kuberay-operator-system \
  --version 1.8.0

# Optional: enable alpha feature gates via Helm values
helm upgrade kuberay-operator kuberay/kuberay-operator \
  --namespace kuberay-operator-system \
  --version 1.8.0 \
  --set featureGates.NodeLabelDelivery=true \
  --set featureGates.RayNodeEventForwarder=true \
  --set nodeEventForwarder.enabled=true \
  --set webhooks.enabled=true
```

If running without Helm, apply the updated CRDs and operator manifest directly:

```bash
kubectl apply --server-side -f https://github.com/kuberay-project/kuberay/releases/download/v1.8.0/kuberay-operator.yaml
```

## Verify

```bash
# Confirm operator image/version
kubectl get pods -n kuberay-operator-system -l app.kubernetes.io/name=kuberay-operator \
  -o jsonpath='{.items[0].spec.containers[0].image}'

# Confirm CRDs include new fields (e.g., idleTerminationOptions)
kubectl explain raycluster.spec.idleTerminationOptions

# If NodeLabelDelivery is enabled, confirm the mutating webhook is registered
kubectl get mutatingwebhookconfigurations | grep kuberay

# If History Server is deployed, hit the /clusters endpoint
kubectl port-forward svc/kuberay-history-server 8080:8080 -n kuberay-operator-system
curl http://localhost:8080/clusters
```

## Common Issues

- **Node Label Delivery webhook not firing**: confirm `webhooks.enabled: true`, cert-manager is installed and healthy, and the chart was *not* installed with `singleNamespaceInstall: true` — the two are incompatible.
- **`rayVersion` too old**: Node Label Delivery needs Ray >= 2.45.0; idle termination needs Ray >= 2.60.0. Pods will silently not pick up the feature if the Ray image is older.
- **RayCluster never idles-out**: idle termination requires `enableInTreeAutoscaling: true` with `autoscalerOptions.version: v2`; autoscaler v1 is not supported.
- **Unexpected auth failures after upgrading Ray images to 2.61+**: if you previously relied on Ray's default auth behavior and also set a custom `RAY_AUTH_MODE`, note that KubeRay no longer overrides a user-supplied value — review your env vars.
- **Server-Side Apply conflicts on `workerGroupSpecs`**: since the field is now a map list keyed by `groupName`, GitOps tools performing whole-list replace may see diff noise; switch to per-group patches.

## Best Practices

- Treat History Server, Node Label Delivery, Node Event Forwarding, and active-passive GCS HA as **alpha/beta** — test in staging before enabling feature gates in production.
- Enable only the feature gates you need; each alpha feature (`NodeLabelDelivery`, `RayNodeEventForwarder`, `GCSFaultToleranceActivePassiveHead`) is explicitly opt-in.
- Pin `rayVersion` per-cluster and verify minimum version requirements (2.45.0 for node labels, 2.60.0 for idle termination, 2.61 auth-mode awareness) before relying on the corresponding KubeRay feature.
- If adopting idle termination, start with `policy: Suspend` rather than `Delete` to avoid irreversible teardown while tuning `timeoutSeconds`.
- Review the [v1.8.0 release page](https://github.com/kuberay-project/kuberay/releases/tag/v1.8.0) directly for the full changelog, since bug fixes and the remainder of the "Operator" section were cut off in the notes used for this recipe.
