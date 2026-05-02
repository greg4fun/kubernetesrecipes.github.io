---
title: "K8s PV and PVC: Persistent Storage Guide"
description: "Create Kubernetes PersistentVolumes and PersistentVolumeClaims. StorageClass, dynamic provisioning, access modes, reclaim policies, and volume expansion."
publishDate: "2026-05-02"
author: "Luca Berton"
category: "storage"
difficulty: "intermediate"
timeToComplete: "12 minutes"
kubernetesVersion: "1.28+"
tags:
  - "persistent-volumes"
  - "storage"
  - "pvc"
  - "storageclass"
  - "cka"
relatedRecipes:
  - "local-persistent-volumes"
  - "troubleshooting-pending-pvc"
  - "kubernetes-persistentvolumeclaimspec"
  - "etcd-backup-restore"
---

> 💡 **Quick Answer:** Create a PVC: `kubectl apply -f` a PersistentVolumeClaim requesting storage size and access mode. With a StorageClass, volumes are provisioned automatically (dynamic provisioning). Access modes: `ReadWriteOnce` (single node), `ReadOnlyMany` (many nodes read), `ReadWriteMany` (many nodes read/write). Reclaim policies: `Delete` (default for dynamic) removes data on PVC deletion, `Retain` keeps it.

## The Problem

Container storage is ephemeral — data is lost when pods restart:

- Database pods lose all data on crash
- Log collectors lose buffered logs
- File uploads disappear on pod reschedule
- No persistent state across deployments

## The Solution

### Dynamic Provisioning (Recommended)

```yaml
# 1. StorageClass (usually pre-installed by cloud provider)
apiVersion: storage.k8s.io/v1
kind: StorageClass
metadata:
  name: fast-ssd
provisioner: kubernetes.io/aws-ebs    # or pd.csi.storage.gke.io, disk.csi.azure.com
parameters:
  type: gp3
reclaimPolicy: Delete
allowVolumeExpansion: true
volumeBindingMode: WaitForFirstConsumer

---
# 2. PVC — requests storage
apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: postgres-data
spec:
  accessModes:
  - ReadWriteOnce
  storageClassName: fast-ssd
  resources:
    requests:
      storage: 50Gi

---
# 3. Pod using PVC
apiVersion: v1
kind: Pod
metadata:
  name: postgres
spec:
  containers:
  - name: postgres
    image: postgres:16
    volumeMounts:
    - name: data
      mountPath: /var/lib/postgresql/data
  volumes:
  - name: data
    persistentVolumeClaim:
      claimName: postgres-data
```

### Static Provisioning

```yaml
# Admin creates PV manually
apiVersion: v1
kind: PersistentVolume
metadata:
  name: nfs-pv
spec:
  capacity:
    storage: 100Gi
  accessModes:
  - ReadWriteMany
  persistentVolumeReclaimPolicy: Retain
  nfs:
    server: nfs.example.com
    path: /exports/data

---
# PVC binds to matching PV
apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: shared-data
spec:
  accessModes:
  - ReadWriteMany
  resources:
    requests:
      storage: 100Gi
  storageClassName: ""    # Empty = no dynamic provisioning
```

### Access Modes

| Mode | Abbreviation | Description |
|------|-------------|-------------|
| ReadWriteOnce | RWO | Single node read/write |
| ReadOnlyMany | ROX | Multiple nodes read-only |
| ReadWriteMany | RWX | Multiple nodes read/write |
| ReadWriteOncePod | RWOP | Single pod (K8s 1.27+) |

```bash
# Check access modes supported by StorageClass
kubectl get storageclass
kubectl describe storageclass fast-ssd
```

### Volume Expansion

```bash
# Expand PVC (StorageClass must have allowVolumeExpansion: true)
kubectl patch pvc postgres-data -p '{"spec":{"resources":{"requests":{"storage":"100Gi"}}}}'

# Check status
kubectl get pvc postgres-data
# NAME            STATUS   VOLUME   CAPACITY   ACCESS MODES
# postgres-data   Bound    pv-xxx   100Gi      RWO

# Some CSI drivers require pod restart for filesystem expansion
kubectl delete pod postgres
```

### StatefulSet with VolumeClaimTemplates

```yaml
apiVersion: apps/v1
kind: StatefulSet
metadata:
  name: postgres
spec:
  serviceName: postgres
  replicas: 3
  selector:
    matchLabels:
      app: postgres
  template:
    metadata:
      labels:
        app: postgres
    spec:
      containers:
      - name: postgres
        image: postgres:16
        volumeMounts:
        - name: data
          mountPath: /var/lib/postgresql/data
  volumeClaimTemplates:          # Auto-creates PVC per replica
  - metadata:
      name: data
    spec:
      accessModes: ["ReadWriteOnce"]
      storageClassName: fast-ssd
      resources:
        requests:
          storage: 50Gi
# Creates: data-postgres-0, data-postgres-1, data-postgres-2
```

## Common Issues

**PVC stuck in Pending**

No matching PV or StorageClass not configured. Check: `kubectl describe pvc <name>` for events. See [troubleshooting-pending-pvc](/recipes/troubleshooting/troubleshooting-pending-pvc/).

**Data lost after pod restart**

Volume not mounted or using `emptyDir` instead of PVC. Verify: `kubectl describe pod <name> | grep -A5 Volumes`.

**"volume is already exclusively attached"**

RWO volume can't attach to multiple nodes. Pod must schedule on same node, or use RWX access mode.

## Best Practices

- **Always use dynamic provisioning** — let StorageClass handle PV creation
- **Set `WaitForFirstConsumer`** — binds volume to pod's node (topology-aware)
- **Use `Retain` for databases** — don't auto-delete production data
- **StatefulSet + volumeClaimTemplates** — one PVC per replica automatically
- **Monitor PVC usage** with `kubelet_volume_stats_used_bytes` Prometheus metric

## Key Takeaways

- PVCs request storage; PVs provide it; StorageClass automates provisioning
- Dynamic provisioning with StorageClass is the standard approach
- RWO for databases, RWX for shared filesystems, RWOP for strict single-pod
- Volume expansion supported with `allowVolumeExpansion: true` in StorageClass
- StatefulSet `volumeClaimTemplates` create per-replica persistent storage
