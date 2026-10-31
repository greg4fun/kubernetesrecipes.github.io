---
title: "Velero v1.18.4: What's New and How to Upgrade"
description: "Velero v1.18.4 patches a backup-queue deadlock bug. Minimal changelog — upgrade steps, verification, and notes for operators."
publishDate: "2026-10-29"
author: "Luca Berton"
category: "storage"
difficulty: "beginner"
timeToComplete: "10 minutes"
kubernetesVersion: "1.25+"
tags:
  - "velero"
  - "backup"
  - "restore"
  - "disaster-recovery"
  - "helm"
  - "upgrade"
---
> 💡 **Quick Answer:** Velero v1.18.4 is a small patch release that fixes a single bug where the backup queue could get permanently stuck if a dequeued backup completed while the patch was in flight (#10539). There are no new features, deprecations, or breaking changes in this release — upgrade is safe and low-risk for any v1.18.x user.

## The Problem

Operators running Velero v1.18.0–v1.18.3 could hit a race condition where the backup controller's internal queue became permanently stuck if a backup finished (was dequeued) at the same moment a patch operation was being applied to it. This left the controller unable to process further backups for that queue entry until the pod was restarted.

## The Solution

Velero v1.18.4 fixes this race condition directly in the backup controller logic. No configuration changes or CRD migrations are required — it's a drop-in replacement for any v1.18.x image.

## What's New

The official changelog for this release is intentionally thin — only one change is listed:

- **Fix backup queue permanently stuck when a dequeued backup completes during the patch** (#10539, @pujitha24)

No new CLI flags, no CRD schema changes, no deprecations. If you need the full history across the v1.18 line, check the release page directly: https://github.com/velero-io/velero/releases/tag/v1.18.4

## Upgrade Steps

This is a patch release within the v1.18 line, so the standard in-place upgrade procedure applies. Review the official upgrade guide for any pre-flight checks specific to your installed version: https://velero.io/docs/v1.18/upgrade-to-1.18/

### Using the Velero CLI

```bash
# Install/update the velero CLI to match the target version (optional but recommended)
wget https://github.com/vmware-tanzu/velero/releases/download/v1.18.4/velero-v1.18.4-linux-amd64.tar.gz
tar -xvf velero-v1.18.4-linux-amd64.tar.gz
sudo mv velero-v1.18.4-linux-amd64/velero /usr/local/bin/

# Update the Velero deployment image
kubectl set image deployment/velero \
  velero=velero/velero:v1.18.4 \
  -n velero

# Update the node-agent daemonset if you run it
kubectl set image daemonset/node-agent \
  node-agent=velero/velero:v1.18.4 \
  -n velero
```

### Using Helm

```bash
helm repo update vmware-tanzu

helm upgrade velero vmware-tanzu/velero \
  --namespace velero \
  --reuse-values \
  --set image.tag=v1.18.4
```

## Verify

```bash
# Confirm the server version matches the client
velero version

# Check pod image and rollout status
kubectl get deployment velero -n velero \
  -o jsonpath='{.spec.template.spec.containers[0].image}'
kubectl rollout status deployment/velero -n velero

# Confirm backups continue scheduling normally
kubectl get backups -n velero --sort-by=.metadata.creationTimestamp
```

If you previously saw stuck backup queue entries, trigger a manual backup to confirm the controller processes it without hanging:

```bash
velero backup create verify-1-18-4-test --wait
```

## Common Issues

- **Mismatched client/server versions**: After upgrading the server image, update the local `velero` CLI binary too — mismatches can produce confusing errors on `velero backup describe` or `velero restore describe`.
- **node-agent not updated**: If you use File System Backup (Restic/Kopia), remember the `node-agent` DaemonSet runs a separate image reference and must be bumped alongside the main deployment.
- **Stale plugin images**: Object-store/volume-snapshot plugin sidecars (e.g., `velero-plugin-for-aws`) are versioned independently — this release doesn't touch them, so no action is needed there unless you're tracking separate plugin advisories.

## Best Practices

- Treat patch releases like v1.18.4 as low-risk, same-day upgrades for production clusters already on v1.18.x.
- Always re-run a test backup and restore cycle after any Velero upgrade, even patch-level ones, to confirm controller health.
- Pin the exact image tag (`v1.18.4`) rather than `latest` in your Helm values or manifests to keep upgrades deliberate and auditable.
- Watch the [Velero releases page](https://github.com/velero-io/velero/releases) for subsequent patches in the v1.18 line, since bugfix-only releases like this one tend to ship in quick succession.
