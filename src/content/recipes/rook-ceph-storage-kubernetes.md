---
title: "Rook Ceph Storage Cluster on Kubernetes"
description: "Deploy Rook Ceph for enterprise-grade distributed storage on Kubernetes. Block, file, and object storage with self-healing and automatic rebalancing."
category: "storage"
difficulty: "advanced"
publishDate: "2026-04-02"
tags: ["rook", "ceph", "storage", "distributed", "block", "object", "kubernetes"]
author: "Luca Berton"
relatedRecipes:
  - "longhorn-distributed-storage"
  - "pvc-pending-troubleshooting"
  - "persistent-volume-resize-troubleshooting"
---

> 💡 **Quick Answer:** Deploy Rook Ceph for enterprise-grade distributed storage on Kubernetes. Block, file, and object storage with self-healing and automatic rebalancing.

## The Problem

You need enterprise-grade storage that provides block (RBD), shared file (CephFS), and object (S3-compatible) storage from the same cluster. Rook automates Ceph lifecycle management on Kubernetes.

## The Solution

### Step 1: Install Rook Operator

```bash
helm repo add rook-release https://charts.rook.io/release
helm repo update

helm install rook-ceph rook-release/rook-ceph \
  --namespace rook-ceph --create-namespace \
  --set csi.enableRBDDriver=true \
  --set csi.enableCephFSDriver=true
```

### Step 2: Create CephCluster

```yaml
apiVersion: ceph.rook.io/v1
kind: CephCluster
metadata:
  name: rook-ceph
  namespace: rook-ceph
spec:
  cephVersion:
    image: quay.io/ceph/ceph:v18.2
  dataDirHostPath: /var/lib/rook
  mon:
    count: 3
    allowMultiplePerNode: false
  mgr:
    count: 2
    allowMultiplePerNode: false
  dashboard:
    enabled: true
    ssl: true
  storage:
    useAllNodes: true
    useAllDevices: false
    devices:
      - name: sdb          # Dedicated disk for Ceph OSD
      - name: sdc
    config:
      osdsPerDevice: "1"
  resources:
    osd:
      requests:
        cpu: "2"
        memory: 4Gi
      limits:
        cpu: "4"
        memory: 8Gi
```

### Step 3: Create StorageClasses

```yaml
# Block storage (RBD) — for databases, stateful apps
apiVersion: ceph.rook.io/v1
kind: CephBlockPool
metadata:
  name: replicapool
  namespace: rook-ceph
spec:
  failureDomain: host
  replicated:
    size: 3
---
apiVersion: storage.k8s.io/v1
kind: StorageClass
metadata:
  name: ceph-block
provisioner: rook-ceph.rbd.csi.ceph.com
parameters:
  clusterID: rook-ceph
  pool: replicapool
  csi.storage.k8s.io/fstype: ext4
reclaimPolicy: Delete
allowVolumeExpansion: true
---
# Shared filesystem (CephFS) — for ReadWriteMany
apiVersion: ceph.rook.io/v1
kind: CephFilesystem
metadata:
  name: ceph-filesystem
  namespace: rook-ceph
spec:
  metadataPool:
    replicated:
      size: 3
  dataPools:
    - replicated:
        size: 3
  metadataServer:
    activeCount: 1
    activeStandby: true
---
apiVersion: storage.k8s.io/v1
kind: StorageClass
metadata:
  name: ceph-filesystem
provisioner: rook-ceph.cephfs.csi.ceph.com
parameters:
  clusterID: rook-ceph
  fsName: ceph-filesystem
reclaimPolicy: Delete
```

```bash
# Verify cluster health
kubectl -n rook-ceph exec deploy/rook-ceph-tools -- ceph status
# Should show: HEALTH_OK
```

```mermaid
graph TD
    A[Rook Operator] -->|Manages| B[CephCluster]
    B --> C[MON x3 - Cluster state]
    B --> D[OSD x6 - Data storage]
    B --> E[MGR x2 - Monitoring]
    D -->|Block RBD| F[StorageClass: ceph-block]
    D -->|File CephFS| G[StorageClass: ceph-filesystem]
    D -->|Object RGW| H[S3-compatible endpoint]
    F --> I[Database PVCs]
    G --> J[Shared file PVCs - RWX]
    H --> K[Object storage buckets]
```

## Best Practices

- **Start small and iterate** — don't over-engineer on day one
- **Monitor and measure** — you can't improve what you don't measure
- **Automate repetitive tasks** — reduce human error and toil
- **Document your decisions** — future you will thank present you

## Key Takeaways

- This is essential knowledge for production Kubernetes operations
- Start with the simplest approach that solves your problem
- Monitor the impact of every change you make
- Share knowledge across your team with internal runbooks
