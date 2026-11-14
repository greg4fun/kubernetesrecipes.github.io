---
title: "Longhorn v1.13.0: V2 Engine Live Upgrade, Needs K8s v1.34"
description: "Longhorn v1.13.0 adds V2 live upgrade, full interrupt mode, and requires Kubernetes v1.34+. Upgrade steps and gotchas inside."
publishDate: "2026-11-01"
author: "Luca Berton"
category: "storage"
difficulty: "advanced"
timeToComplete: "30 minutes"
kubernetesVersion: "1.34+"
tags:
  - "longhorn"
  - "storage"
  - "csi"
  - "v2-data-engine"
  - "upgrade"
  - "distributed-storage"
  - "spdk"
---
> 💡 **Quick Answer:** Longhorn v1.13.0 brings live upgrade for the V2 Data Engine, full interrupt mode, and several scheduling/retention features, but it **requires Kubernetes v1.34+** and changes how legacy V2 linked-clone volumes behave — plan the control-plane upgrade before touching storage.

## The Problem

Prior to v1.13.0, upgrading Longhorn's V2 Data Engine meant detaching every V2 volume first, causing workload disruption. Idle V2 volumes in polling mode also burned CPU unnecessarily, and large clusters paid a high control-plane overhead for per-node managers.

## The Solution

Longhorn v1.13.0 makes V2 instance managers live-upgradeable (no detach required, under specific conditions), finishes the move to a fully event-driven interrupt mode for idle/low-IO V2 volumes, and introduces a `longhorn-global-manager` Deployment to reduce control-plane load. It also adds volume group snapshots, age-based recurring job retention, topology-constrained replica scheduling, and a scheduler extender.

## What's New

### Breaking Changes

- **Kubernetes v1.34 minimum.** The CSI external-provisioner is upgraded to v6.3.0, which requires Kubernetes v1.34+. You cannot install or upgrade to v1.13.0 on older clusters.
- **Legacy V2 linked-clone volumes** created on Longhorn v1.12.0 or earlier can now only be detached or deleted — they can't be modified further. To replace one, create a new linked clone from the same source volume (no data copy needed). See [Issue #12552](https://github.com/longhorn/longhorn/issues/12552).

### V2 Data Engine

- **Live upgrade** for V2 volumes ([Issue #9104](https://github.com/longhorn/longhorn/issues/9104)): V2 instance managers can be upgraded without detaching volumes — but **only when upgrading from v1.12.2**. If you're on v1.12.0/v1.12.1, or don't meet the [prerequisites](https://longhorn.io/docs/1.13.0/deploy/upgrade/v2-instance-upgrade/#prerequisites), detach all V2 volumes and stop their replicas before upgrading.
- **Full interrupt mode** ([Issue #11662](https://github.com/longhorn/longhorn/issues/11662)): SPDK reactors are now fully event-driven, reducing CPU usage for idle/low-IO V2 volumes. Polling remains the default; enable with the `data-engine-interrupt-mode-enabled` setting (`{"v2":"true"}`), only while no V2 volumes are attached. Expect slightly higher latency under sustained high-throughput workloads.
- **CPU isolation enabled by default** for new installs ([Issue #13724](https://github.com/longhorn/longhorn/issues/13724), [Issue #13973](https://github.com/longhorn/longhorn/issues/13973)): `data-engine-cpu-isolation-enabled` defaults to `{"v2":"true"}` on fresh installs; upgrades from v1.12.x keep the existing value. Only applies in polling mode.

### Known Issues / Limitations

- **V2 volume attach latency at scale** — attaching new volumes slows down in clusters with many attached V2 volumes. Root cause under investigation ([Issue #13241](https://github.com/longhorn/longhorn/issues/13241)).
- **ARM64 NVMe-backed block disks** can cause stuck I/O with SPDK + 2+ CPU cores. Workaround: use [AIO-backed disks](https://longhorn.io/docs/1.13.0/nodes-and-volumes/nodes/multidisk/#using-aio-disks) on ARM64 ([Issue #13243](https://github.com/longhorn/longhorn/issues/13243)).
- **UBLK frontend on kernel v6.17** can trigger a kernel panic on attach. Avoid UBLK on this kernel version ([Issue #13509](https://github.com/longhorn/longhorn/issues/13509)).

### Other Notable Additions

- Volume group snapshots
- Age-based retention for recurring jobs
- Topology-constrained replica scheduling
- A scheduler extender
- New `longhorn-global-manager` Deployment to lower control-plane overhead in large clusters

## Upgrade Steps

1. Confirm the cluster runs Kubernetes v1.34 or later — this is a hard requirement.
2. If your V2 volumes are on v1.12.0/v1.12.1, or don't meet live-upgrade prerequisites, detach all V2 volumes and ensure replicas are stopped first.
3. Back up the Longhorn system (volumes/backups) before upgrading, as always.
4. Upgrade via Helm:

```bash
helm repo add longhorn https://charts.longhorn.io
helm repo update
helm upgrade longhorn longhorn/longhorn \
  --namespace longhorn-system \
  --version 1.13.0
```

Or via kubectl manifest:

```bash
kubectl apply -f https://raw.githubusercontent.com/longhorn/longhorn/v1.13.0/deploy/longhorn.yaml
```

5. If you want interrupt mode for V2 volumes, set it only after confirming no V2 volumes are attached:

```bash
kubectl -n longhorn-system patch settings.longhorn.io data-engine-interrupt-mode-enabled \
  --type merge -p '{"value":"{\"v2\":\"true\"}"}'
```

## Verify

```bash
# Confirm manager image/version
kubectl -n longhorn-system get daemonset longhorn-manager -o jsonpath='{.spec.template.spec.containers[0].image}'

# Confirm new global-manager Deployment is running
kubectl -n longhorn-system get deployment longhorn-global-manager

# Check all volumes reattach and report healthy state
kubectl -n longhorn-system get volumes.longhorn.io

# Check CSI driver/provisioner version matches v6.3.0 expectations
kubectl -n longhorn-system get pods -l app=csi-provisioner -o jsonpath='{.items[0].spec.containers[0].image}'
```

## Common Issues

- **Upgrade blocked / CRD validation errors**: usually means the cluster is below Kubernetes v1.34 — upgrade the control plane first.
- **V2 volume stuck attaching after upgrade**: verify you followed the correct live-upgrade path (only supported from v1.12.2); otherwise detach/reattach manually.
- **Linked-clone volume operations failing**: legacy linked clones from v1.12.0 or earlier only support detach/delete — create a fresh linked clone instead of trying to modify the old one.
- **ARM64 I/O stalls**: switch affected node disks from NVMe to AIO backing.

## Best Practices

- Do not enable interrupt mode or CPU isolation changes while V2 volumes are attached.
- Avoid the UBLK frontend entirely on kernel v6.17 until upstream resolves [Issue #13509](https://github.com/longhorn/longhorn/issues/13509).
- On ARM64 nodes, default to AIO-backed disks rather than NVMe-backed ones until [Issue #13243](https://github.com/longhorn/longhorn/issues/13243) is resolved.
- Stage the Kubernetes v1.34 upgrade and validate it in a non-production cluster before attempting the Longhorn v1.13.0 upgrade.
- Review the [V1 and V2 Volume Feature Support matrix](https://longhorn.io/docs/1.13.0/v1-v2-volume-behavior-and-feature-parity/) if running mixed V1/V2 volumes.
