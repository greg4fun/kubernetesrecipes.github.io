---
title: "K8s CSI Drivers: Container Storage Guide"
description: "Install and configure Kubernetes CSI drivers for persistent storage. CSI architecture, StorageClass provisioners, snapshots, and volume expansion patterns."
publishDate: "2026-05-02"
author: "Luca Berton"
category: "storage"
difficulty: "advanced"
timeToComplete: "15 minutes"
kubernetesVersion: "1.28+"
tags:
  - "csi"
  - "storage"
  - "persistent-volumes"
  - "snapshots"
  - "drivers"
relatedRecipes:
  - "kubernetes-persistent-volume-guide"
  - "kubernetes-local-persistent-volumes"
  - "pvc-pending-troubleshooting"
---

> 💡 **Quick Answer:** CSI (Container Storage Interface) is the standard for Kubernetes storage plugins. Install a CSI driver (e.g., `aws-ebs-csi-driver`, `csi-driver-nfs`), create a StorageClass pointing to the CSI provisioner, then use PVCs as normal. CSI enables dynamic provisioning, snapshots, volume expansion, and cloning — features not available with in-tree drivers.

## The Problem

Kubernetes deprecated in-tree storage plugins (aws-ebs, gce-pd, azure-disk):

- Tied to Kubernetes release cycle
- Can't update storage driver independently
- Limited features (no snapshots, no cloning)
- No standard interface for new storage backends

## The Solution

### CSI Architecture

```
┌─────────────────────────────────────────────┐
│  Kubernetes Control Plane                    │
│  ┌─────────────────┐  ┌──────────────────┐ │
│  │ CSI Controller   │  │ External          │ │
│  │ (Deployment)     │  │ Provisioner       │ │
│  │ - Provisioner    │  │ Snapshotter       │ │
│  │ - Attacher       │  │ Resizer           │ │
│  └─────────────────┘  └──────────────────┘ │
├─────────────────────────────────────────────┤
│  Per Node (DaemonSet)                        │
│  ┌─────────────────┐                        │
│  │ CSI Node Plugin  │                        │
│  │ - Mount/Unmount  │                        │
│  │ - Format volume  │                        │
│  │ - Node stage     │                        │
│  └─────────────────┘                        │
└─────────────────────────────────────────────┘
```

### Install CSI Driver (AWS EBS Example)

```bash
# AWS EBS CSI Driver
helm repo add aws-ebs-csi-driver https://kubernetes-sigs.github.io/aws-ebs-csi-driver
helm install aws-ebs-csi-driver aws-ebs-csi-driver/aws-ebs-csi-driver \
  -n kube-system

# Verify
kubectl get pods -n kube-system -l app.kubernetes.io/name=aws-ebs-csi-driver
kubectl get csidrivers
# NAME              ATTACHREQUIRED   PODINFOONMOUNT
# ebs.csi.aws.com   true            false
```

### Install NFS CSI Driver

```bash
helm repo add csi-driver-nfs https://raw.githubusercontent.com/kubernetes-csi/csi-driver-nfs/master/charts
helm install csi-driver-nfs csi-driver-nfs/csi-driver-nfs \
  -n kube-system

# Create StorageClass for NFS
cat <<EOF | kubectl apply -f -
apiVersion: storage.k8s.io/v1
kind: StorageClass
metadata:
  name: nfs-csi
provisioner: nfs.csi.k8s.io
parameters:
  server: nfs.example.com
  share: /exports/kubernetes
reclaimPolicy: Delete
volumeBindingMode: Immediate
mountOptions:
  - nfsvers=4.1
  - hard
EOF
```

### StorageClass with CSI

```yaml
# AWS EBS gp3
apiVersion: storage.k8s.io/v1
kind: StorageClass
metadata:
  name: ebs-gp3
provisioner: ebs.csi.aws.com
parameters:
  type: gp3
  iops: "3000"
  throughput: "125"
  encrypted: "true"
allowVolumeExpansion: true
reclaimPolicy: Delete
volumeBindingMode: WaitForFirstConsumer

---
# GCP PD CSI
apiVersion: storage.k8s.io/v1
kind: StorageClass
metadata:
  name: pd-ssd
provisioner: pd.csi.storage.gke.io
parameters:
  type: pd-ssd
allowVolumeExpansion: true
volumeBindingMode: WaitForFirstConsumer
```

### Volume Snapshots

```yaml
# VolumeSnapshotClass
apiVersion: snapshot.storage.k8s.io/v1
kind: VolumeSnapshotClass
metadata:
  name: ebs-snapshot-class
driver: ebs.csi.aws.com
deletionPolicy: Delete

---
# Create snapshot
apiVersion: snapshot.storage.k8s.io/v1
kind: VolumeSnapshot
metadata:
  name: db-snapshot
spec:
  volumeSnapshotClassName: ebs-snapshot-class
  source:
    persistentVolumeClaimName: postgres-data

---
# Restore from snapshot
apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: postgres-data-restored
spec:
  accessModes:
  - ReadWriteOnce
  storageClassName: ebs-gp3
  resources:
    requests:
      storage: 50Gi
  dataSource:
    name: db-snapshot
    kind: VolumeSnapshot
    apiGroup: snapshot.storage.k8s.io
```

### Volume Cloning

```yaml
# Clone existing PVC (CSI required)
apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: postgres-data-clone
spec:
  accessModes:
  - ReadWriteOnce
  storageClassName: ebs-gp3
  resources:
    requests:
      storage: 50Gi
  dataSource:
    name: postgres-data          # Source PVC
    kind: PersistentVolumeClaim
```

### Popular CSI Drivers

| Driver | Provisioner | Use Case |
|--------|-----------|----------|
| AWS EBS | `ebs.csi.aws.com` | Block storage on AWS |
| GCP PD | `pd.csi.storage.gke.io` | Block storage on GCP |
| Azure Disk | `disk.csi.azure.com` | Block storage on Azure |
| NFS | `nfs.csi.k8s.io` | NFS shares (RWX) |
| Ceph RBD | `rbd.csi.ceph.com` | Ceph block storage |
| CephFS | `cephfs.csi.ceph.com` | Ceph filesystem (RWX) |
| Longhorn | `driver.longhorn.io` | Distributed storage |
| OpenEBS | `cstor.csi.openebs.io` | Container-native storage |

## Common Issues

**"driver not found" when creating PVC**

CSI driver not installed. Check: `kubectl get csidrivers`. Install the appropriate driver for your storage backend.

**Volume stuck in "Attaching"**

Node-level CSI plugin (DaemonSet) not running. Check: `kubectl get pods -n kube-system -l app=csi-node`.

**Snapshot "not ready"**

VolumeSnapshotClass driver doesn't match PVC's StorageClass provisioner. They must use the same CSI driver.

## Best Practices

- **Use CSI drivers over in-tree plugins** — in-tree are deprecated
- **Enable volume expansion** — `allowVolumeExpansion: true` on StorageClass
- **WaitForFirstConsumer** — binds volume to pod's node for topology awareness
- **Regular snapshots** — automated backup via CronJob + VolumeSnapshot
- **Test restore procedures** — snapshots are useless if restore doesn't work

## Key Takeaways

- CSI is the standard interface for Kubernetes storage plugins
- Install CSI driver → create StorageClass → use PVCs as normal
- CSI enables snapshots, cloning, and expansion not available with in-tree drivers
- Volume snapshots provide point-in-time backup with CSI
- `WaitForFirstConsumer` binding mode is essential for topology-aware provisioning
