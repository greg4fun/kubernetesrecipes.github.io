---
title: "Kubernetes 1.36 CSI Differential Snapshots"
description: "Use CSI differential snapshots in Kubernetes 1.36 to track changed blocks between snapshots. Enables incremental backups and faster disaster recovery."
tags:
  - "kubernetes-1.36"
  - "csi"
  - "snapshots"
  - "backup"
  - "block-storage"
category: "storage"
publishDate: "2026-05-03"
author: "Luca Berton"
difficulty: "advanced"
relatedRecipes:
  - "kubernetes-1-36-volume-group-snapshot"
  - "kubernetes-velero-backup-guide"
  - "kubernetes-persistent-volume-guide"
---

> 💡 **Quick Answer:** CSI Differential Snapshots (Changed Block Tracking) moves to **Beta in Kubernetes 1.36**. Query which blocks changed between two snapshots for incremental backups — transfer only changed data instead of full volume copies.

## The Problem

Traditional volume backups copy the **entire volume** every time:

- 1TB volume with 10MB of changes → still copies 1TB
- Backup windows stretch for hours
- Network bandwidth saturated during backups
- RPO (Recovery Point Objective) limited by backup speed
- Storage costs multiply with full-copy retention

## The Solution

Differential snapshots let backup tools query **which blocks changed** between two snapshots, enabling true incremental backups.

### How It Works

```
Snapshot A (Monday) ──────────────────────────────
                     │ Block 1: unchanged        │
                     │ Block 2: CHANGED ← 4KB    │
                     │ Block 3: unchanged        │
                     │ Block 4: CHANGED ← 4KB    │
                     │ Block 5-1000: unchanged   │
Snapshot B (Tuesday) ──────────────────────────────

Differential query: "What changed between A and B?"
Answer: Blocks 2 and 4 → only 8KB to transfer (not 1TB)
```

### SnapshotMetadata Service

The CSI driver exposes a `SnapshotMetadata` gRPC service that backup controllers query:

```yaml
# The external-snapshot-metadata sidecar handles the gRPC communication
apiVersion: apps/v1
kind: Deployment
metadata:
  name: csi-snapshot-metadata
  namespace: kube-system
spec:
  replicas: 1
  selector:
    matchLabels:
      app: csi-snapshot-metadata
  template:
    metadata:
      labels:
        app: csi-snapshot-metadata
    spec:
      serviceAccountName: csi-snapshot-metadata
      containers:
        - name: snapshot-metadata
          image: registry.k8s.io/sig-storage/external-snapshot-metadata:v1.0.0
          args:
            - "--csi-address=/csi/csi.sock"
            - "--leader-election"
          volumeMounts:
            - name: socket-dir
              mountPath: /csi
        - name: csi-driver
          image: registry.example.com/csi-driver:v3.0
          volumeMounts:
            - name: socket-dir
              mountPath: /csi
      volumes:
        - name: socket-dir
          emptyDir: {}
```

### Using with Velero for Incremental Backups

```yaml
apiVersion: velero.io/v1
kind: BackupStorageLocation
metadata:
  name: incremental-storage
  namespace: velero
spec:
  provider: aws
  default: true
  objectStorage:
    bucket: k8s-backups
  config:
    region: us-east-1
---
apiVersion: velero.io/v1
kind: Schedule
metadata:
  name: db-incremental
  namespace: velero
spec:
  schedule: "0 * * * *"    # Hourly
  template:
    includedNamespaces:
      - production
    snapshotMoveData: true
    datamover: velero
    csiSnapshotTimeout: 30m
    # Velero uses differential snapshots when CSI driver supports it
    defaultVolumesToFsBackup: false
```

### Query Changed Blocks (API Example)

```bash
# List available snapshot metadata
kubectl get snapshotmetadata -n production

# The backup controller queries the CSI driver's SnapshotMetadata service:
# GetMetadataDelta(baseSnapshotId, targetSnapshotId)
# Returns: list of (offset, length) pairs for changed blocks

# Verify CSI driver supports snapshot metadata
kubectl get csidriver <driver-name> -o jsonpath='{.spec.capabilities}'
```

### Performance Impact

```bash
# Full backup (traditional):
# 1TB volume → 1TB transfer → ~30 minutes at 500MB/s

# Incremental backup (differential):
# 1TB volume, 50MB changed → 50MB transfer → ~0.1 seconds at 500MB/s

# Savings: 99.995% less data transferred
# RPO improvement: hourly backups become feasible
```

## Common Issues

### CSI driver doesn't support SnapshotMetadata
- **Cause**: Feature requires CSI driver implementation
- **Fix**: Check with your storage vendor; AWS EBS and some enterprise drivers support it

### Changed block query returns error
- **Cause**: Snapshots from different volumes or incompatible snapshot pairs
- **Fix**: Both snapshots must be from the same volume; base must be older than target

### Backup tool doesn't leverage differential snapshots
- **Cause**: Backup controller not updated to use the SnapshotMetadata API
- **Fix**: Update to latest Velero or backup tool version with CBT support

## Best Practices

1. **Keep reference snapshots** — retain at least the last full-backup snapshot as a base
2. **Schedule frequent incrementals** — hourly is practical with differential snapshots
3. **Periodic full backups** — do a full backup weekly to prevent long incremental chains
4. **Monitor changed-block ratios** — high change rates may indicate unexpected write patterns
5. **Test incremental restores** — verify full restore from chain of incrementals works correctly

## Key Takeaways

- CSI Differential Snapshots are **Beta in Kubernetes 1.36** (enabled by default)
- Query which blocks changed between two snapshots for incremental backups
- Reduces backup data transfer by 95-99%+ for typical workloads
- Enables hourly RPO for terabyte-scale volumes
- Requires CSI driver support for the SnapshotMetadata service
