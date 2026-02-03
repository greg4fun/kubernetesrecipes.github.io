---
title: "How to Configure Dynamic Volume Provisioning"
description: "Set up dynamic volume provisioning in Kubernetes with StorageClasses. Learn to configure provisioners for AWS EBS, GCP PD, Azure Disk, and NFS."
category: "storage"
difficulty: "intermediate"
publishDate: "2026-01-22"
tags: ["storage", "pv", "pvc", "storageclass", "provisioning"]
---

> 💡 **Quick Answer:** Create a `StorageClass` with a provisioner (e.g., `kubernetes.io/aws-ebs`, `pd.csi.storage.gke.io`), then use `PersistentVolumeClaim` with `storageClassName` matching your class. Kubernetes automatically provisions the underlying volume. Set a default StorageClass with annotation `storageclass.kubernetes.io/is-default-class: "true"`.
>
> **Key command:** `kubectl get sc` to list StorageClasses; `kubectl get pvc` to check claim status (Bound = provisioned).
>
> **Gotcha:** Ensure your cloud IAM/service account has permissions to create volumes, and CSI driver is installed for your storage backend.

# How to Configure Dynamic Volume Provisioning

Dynamic provisioning automatically creates PersistentVolumes when PersistentVolumeClaims are created. Configure StorageClasses for your cloud provider or storage backend.

## Understanding StorageClasses

```yaml
# Basic StorageClass structure
apiVersion: storage.k8s.io/v1
kind: StorageClass
metadata:
  name: fast-ssd
provisioner: kubernetes.io/aws-ebs  # Provider-specific
parameters:
  type: gp3                         # Storage type
reclaimPolicy: Delete               # Delete or Retain
volumeBindingMode: WaitForFirstConsumer  # Immediate or WaitForFirstConsumer
allowVolumeExpansion: true          # Allow resizing
```

## AWS EBS StorageClasses

```yaml
# aws-gp3.yaml - General purpose SSD
apiVersion: storage.k8s.io/v1
kind: StorageClass
metadata:
  name: gp3
  annotations:
    storageclass.kubernetes.io/is-default-class: "true"
provisioner: ebs.csi.aws.com
parameters:
  type: gp3
  iops: "3000"
  throughput: "125"
  encrypted: "true"
  kmsKeyId: "arn:aws:kms:us-east-1:123456789:key/abc123"
reclaimPolicy: Delete
volumeBindingMode: WaitForFirstConsumer
allowVolumeExpansion: true
---
# aws-io2.yaml - High performance SSD
apiVersion: storage.k8s.io/v1
kind: StorageClass
metadata:
  name: io2-high-iops
provisioner: ebs.csi.aws.com
parameters:
  type: io2
  iops: "10000"
  encrypted: "true"
reclaimPolicy: Retain
volumeBindingMode: WaitForFirstConsumer
allowVolumeExpansion: true
```

## GCP Persistent Disk StorageClasses

```yaml
# gcp-ssd.yaml
apiVersion: storage.k8s.io/v1
kind: StorageClass
metadata:
  name: ssd
provisioner: pd.csi.storage.gke.io
parameters:
  type: pd-ssd
  replication-type: regional-pd  # For HA
reclaimPolicy: Delete
volumeBindingMode: WaitForFirstConsumer
allowVolumeExpansion: true
---
# gcp-balanced.yaml
apiVersion: storage.k8s.io/v1
kind: StorageClass
metadata:
  name: balanced
  annotations:
    storageclass.kubernetes.io/is-default-class: "true"
provisioner: pd.csi.storage.gke.io
parameters:
  type: pd-balanced
reclaimPolicy: Delete
volumeBindingMode: WaitForFirstConsumer
allowVolumeExpansion: true
```

## Azure Disk StorageClasses

```yaml
# azure-premium.yaml
apiVersion: storage.k8s.io/v1
kind: StorageClass
metadata:
  name: premium-ssd
provisioner: disk.csi.azure.com
parameters:
  skuName: Premium_LRS
  cachingMode: ReadOnly
  enableBursting: "true"
reclaimPolicy: Delete
volumeBindingMode: WaitForFirstConsumer
allowVolumeExpansion: true
---
# azure-standard.yaml
apiVersion: storage.k8s.io/v1
kind: StorageClass
metadata:
  name: standard
  annotations:
    storageclass.kubernetes.io/is-default-class: "true"
provisioner: disk.csi.azure.com
parameters:
  skuName: StandardSSD_LRS
reclaimPolicy: Delete
volumeBindingMode: WaitForFirstConsumer
allowVolumeExpansion: true
```

## NFS Dynamic Provisioning

```yaml
# Install NFS subdir external provisioner first:
# helm install nfs-provisioner nfs-subdir-external-provisioner/nfs-subdir-external-provisioner \
#   --set nfs.server=10.0.0.100 --set nfs.path=/exports

# nfs-storageclass.yaml
apiVersion: storage.k8s.io/v1
kind: StorageClass
metadata:
  name: nfs-client
provisioner: cluster.local/nfs-subdir-external-provisioner
parameters:
  archiveOnDelete: "true"  # Keep data on PVC deletion
  pathPattern: "${.PVC.namespace}/${.PVC.name}"
reclaimPolicy: Delete
volumeBindingMode: Immediate
mountOptions:
  - hard
  - nfsvers=4.1
```

## Using StorageClasses in PVCs

```yaml
# pvc-with-storageclass.yaml
apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: database-data
spec:
  accessModes:
    - ReadWriteOnce
  storageClassName: gp3  # Reference StorageClass
  resources:
    requests:
      storage: 100Gi
```

## StatefulSet with Dynamic Provisioning

```yaml
# statefulset-dynamic.yaml
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
          image: postgres:15
          volumeMounts:
            - name: data
              mountPath: /var/lib/postgresql/data
  volumeClaimTemplates:
    - metadata:
        name: data
      spec:
        accessModes: ["ReadWriteOnce"]
        storageClassName: gp3
        resources:
          requests:
            storage: 50Gi
```

## Volume Expansion

```yaml
# Ensure StorageClass has allowVolumeExpansion: true

# Expand existing PVC (edit the spec)
apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: database-data
spec:
  accessModes:
    - ReadWriteOnce
  storageClassName: gp3
  resources:
    requests:
      storage: 200Gi  # Increased from 100Gi
```

```bash
# Or use kubectl patch
kubectl patch pvc database-data -p '{"spec":{"resources":{"requests":{"storage":"200Gi"}}}}'

# Check expansion status
kubectl describe pvc database-data
```

## Topology-Aware Provisioning

```yaml
# topology-storageclass.yaml
apiVersion: storage.k8s.io/v1
kind: StorageClass
metadata:
  name: zone-aware-ssd
provisioner: ebs.csi.aws.com
parameters:
  type: gp3
volumeBindingMode: WaitForFirstConsumer  # Required for topology
allowedTopologies:
  - matchLabelExpressions:
      - key: topology.ebs.csi.aws.com/zone
        values:
          - us-east-1a
          - us-east-1b
```

## Set Default StorageClass

```bash
# Remove default from current
kubectl patch storageclass standard \
  -p '{"metadata": {"annotations":{"storageclass.kubernetes.io/is-default-class":"false"}}}'

# Set new default
kubectl patch storageclass gp3 \
  -p '{"metadata": {"annotations":{"storageclass.kubernetes.io/is-default-class":"true"}}}'

# Verify
kubectl get storageclass
```

## Storage Quotas per Namespace

```yaml
# storage-quota.yaml
apiVersion: v1
kind: ResourceQuota
metadata:
  name: storage-quota
  namespace: development
spec:
  hard:
    persistentvolumeclaims: "10"
    requests.storage: "100Gi"
    # Per StorageClass limits
    gp3.storageclass.storage.k8s.io/requests.storage: "50Gi"
    gp3.storageclass.storage.k8s.io/persistentvolumeclaims: "5"
```

## Troubleshooting Provisioning

```bash
# Check provisioner pods
kubectl get pods -n kube-system | grep csi

# Check CSI driver
kubectl get csidrivers

# View provisioner logs
kubectl logs -n kube-system -l app=ebs-csi-controller -c csi-provisioner

# Check PVC events
kubectl describe pvc my-pvc

# Check StorageClass
kubectl describe storageclass gp3
```

## Common Issues

| Issue | Cause | Solution |
|-------|-------|----------|
| PVC stuck Pending | No default StorageClass | Set default or specify storageClassName |
| Provisioning failed | CSI driver not installed | Install appropriate CSI driver |
| Volume not in zone | WaitForFirstConsumer not set | Use topology-aware binding |
| Cannot expand | allowVolumeExpansion false | Create new StorageClass with expansion |

## Summary

Dynamic volume provisioning simplifies storage management in Kubernetes. Configure StorageClasses for your cloud provider, use `WaitForFirstConsumer` for topology awareness, enable volume expansion for flexibility, and apply quotas for resource governance.

---

## 📘 Go Further with Kubernetes Recipes

**Love this recipe? There's so much more!** This is just one of **100+ hands-on recipes** in our comprehensive **[Kubernetes Recipes book](https://amzn.to/3DzC8QA)**.

Inside the book, you'll master:
- ✅ Production-ready deployment strategies
- ✅ Advanced networking and security patterns  
- ✅ Observability, monitoring, and troubleshooting
- ✅ Real-world best practices from industry experts

> *"The practical, recipe-based approach made complex Kubernetes concepts finally click for me."*

**👉 [Get Your Copy Now](https://amzn.to/3DzC8QA)** — Start building production-grade Kubernetes skills today!
