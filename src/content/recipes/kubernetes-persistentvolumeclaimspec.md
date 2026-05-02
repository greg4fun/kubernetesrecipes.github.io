---
title: "K8s PersistentVolumeClaimSpec Reference"
description: "Complete PersistentVolumeClaimSpec reference for Kubernetes. accessModes, storageClassName, resources, selector, volumeMode, and dataSource explained."
publishDate: "2026-05-02"
author: "Luca Berton"
category: "storage"
difficulty: "beginner"
timeToComplete: "10 minutes"
kubernetesVersion: "1.28+"
tags:
  - "storage"
  - "pvc"
  - "persistent-volumes"
  - "storageclass"
relatedRecipes:
  - "kubernetes-persistent-volumes-guide"
  - "troubleshooting-pending-pvc"
---

> 💡 **Quick Answer:** `PersistentVolumeClaimSpec` defines storage requirements: `accessModes` (ReadWriteOnce/ReadWriteMany/ReadOnlyMany), `resources.requests.storage` (size like 10Gi), `storageClassName` (which provisioner to use), and optionally `volumeMode` (Filesystem or Block), `selector` (bind to specific PV), and `dataSource` (clone or snapshot). Most PVCs only need accessModes + storage size + storageClassName.

## The Problem

PVC specs have many fields and it's unclear which are required, what values are valid, and how they interact with StorageClasses and PVs.

## The Solution

### Minimal PVC

```yaml
apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: my-data
spec:
  accessModes:
  - ReadWriteOnce
  resources:
    requests:
      storage: 10Gi
  storageClassName: standard
```

### Complete PersistentVolumeClaimSpec

```yaml
apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: my-data
  namespace: production
spec:
  # Required: How the volume can be mounted
  accessModes:
  - ReadWriteOnce          # Single node read-write
  # - ReadWriteMany        # Multiple nodes read-write (NFS, CephFS)
  # - ReadOnlyMany         # Multiple nodes read-only
  # - ReadWriteOncePod     # Single pod read-write (K8s 1.27+)
  
  # Required: Storage size
  resources:
    requests:
      storage: 10Gi        # Minimum size
    # limits:              # Optional — rarely used
    #   storage: 20Gi
  
  # Which StorageClass to use (omit for cluster default)
  storageClassName: gp3-encrypted
  # storageClassName: ""   # Empty string = bind to pre-provisioned PV only
  
  # Filesystem (default) or Block
  volumeMode: Filesystem
  # volumeMode: Block      # Raw block device — no filesystem
  
  # Bind to specific PV (static provisioning)
  # selector:
  #   matchLabels:
  #     app: database
  #   matchExpressions:
  #   - key: environment
  #     operator: In
  #     values: ["production"]
  
  # Clone from existing PVC or restore from snapshot
  # dataSource:
  #   name: existing-pvc
  #   kind: PersistentVolumeClaim
  # dataSource:
  #   name: my-snapshot
  #   kind: VolumeSnapshot
  #   apiGroup: snapshot.storage.k8s.io
  
  # Cross-namespace clone (K8s 1.29+)
  # dataSourceRef:
  #   name: source-pvc
  #   kind: PersistentVolumeClaim
  #   namespace: other-namespace
```

### Access Modes Comparison

| Mode | Short | Nodes | Use Case |
|------|-------|-------|----------|
| **ReadWriteOnce** | RWO | 1 node | Databases, single-writer apps |
| **ReadWriteMany** | RWX | Multiple | Shared data, CMS uploads, ML datasets |
| **ReadOnlyMany** | ROX | Multiple | Config files, static assets |
| **ReadWriteOncePod** | RWOP | 1 pod | Strict single-writer (K8s 1.27+) |

### StorageClass Examples

```bash
# List available StorageClasses
kubectl get storageclass
# NAME            PROVISIONER             RECLAIMPOLICY   VOLUMEBINDINGMODE
# gp3 (default)   ebs.csi.aws.com        Delete          WaitForFirstConsumer
# efs-sc          efs.csi.aws.com        Retain          Immediate
# standard        kubernetes.io/gce-pd    Delete          Immediate

# See default StorageClass
kubectl get sc -o jsonpath='{.items[?(@.metadata.annotations.storageclass\.kubernetes\.io/is-default-class=="true")].metadata.name}'
```

### Use in Pods

```yaml
apiVersion: v1
kind: Pod
metadata:
  name: my-app
spec:
  containers:
  - name: app
    image: myapp:v1
    volumeMounts:
    - name: data
      mountPath: /data
  volumes:
  - name: data
    persistentVolumeClaim:
      claimName: my-data      # References the PVC
      readOnly: false

---
# StatefulSet with volumeClaimTemplates (auto-creates PVCs)
apiVersion: apps/v1
kind: StatefulSet
metadata:
  name: database
spec:
  serviceName: database
  replicas: 3
  template:
    spec:
      containers:
      - name: db
        volumeMounts:
        - name: data
          mountPath: /var/lib/db
  volumeClaimTemplates:
  - metadata:
      name: data
    spec:                      # This IS the PersistentVolumeClaimSpec
      accessModes: ["ReadWriteOnce"]
      storageClassName: gp3-encrypted
      resources:
        requests:
          storage: 50Gi
```

### Volume Expansion

```bash
# Check if StorageClass allows expansion
kubectl get sc gp3 -o jsonpath='{.allowVolumeExpansion}'
# true

# Expand PVC (only increase — shrinking not supported)
kubectl patch pvc my-data -p '{"spec":{"resources":{"requests":{"storage":"20Gi"}}}}'

# Check expansion status
kubectl get pvc my-data -o yaml | grep -A5 conditions
```

## Common Issues

**PVC stuck in Pending**

Check events: `kubectl describe pvc my-data`. Common causes: no matching StorageClass, no capacity, WaitForFirstConsumer binding mode (needs a pod to schedule first).

**"storageClassName must be provided" error**

No default StorageClass set. Either specify one explicitly or mark a StorageClass as default.

**accessMode mismatch**

PV and PVC accessModes must be compatible. EBS only supports RWO — if you need RWX, use EFS, NFS, or CephFS.

## Best Practices

- **Always specify `storageClassName`** — don't rely on default (it can change)
- **Use `ReadWriteOncePod`** for databases — prevents accidental multi-attach
- **Set `WaitForFirstConsumer`** on StorageClass — ensures volume is in the same zone as the pod
- **Use `volumeClaimTemplates`** in StatefulSets — automatic per-replica PVCs
- **Enable volume expansion** on StorageClass — avoid recreating PVCs for resizing

## Key Takeaways

- Most PVCs need only 3 fields: accessModes, storage size, and storageClassName
- RWO for databases, RWX for shared storage, RWOP for strict single-writer
- `storageClassName: ""` binds to pre-provisioned PVs only (no dynamic provisioning)
- `dataSource` enables PVC cloning and snapshot restore
- StatefulSet `volumeClaimTemplates` spec IS a PersistentVolumeClaimSpec
