---
title: "How to Configure CSI Drivers for Storage"
description: "Install and configure Container Storage Interface (CSI) drivers for cloud and on-premises storage. Set up dynamic provisioning with AWS EBS, GCP PD, and more."
category: "storage"
difficulty: "intermediate"
publishDate: "2026-01-22"
tags: ["csi", "storage", "ebs", "provisioning", "volumes"]
---

# How to Configure CSI Drivers for Storage

Container Storage Interface (CSI) drivers enable Kubernetes to use various storage systems. Install CSI drivers for dynamic volume provisioning with cloud providers and on-premises storage.

## AWS EBS CSI Driver

```bash
# Install AWS EBS CSI Driver using Helm
helm repo add aws-ebs-csi-driver https://kubernetes-sigs.github.io/aws-ebs-csi-driver
helm install aws-ebs-csi-driver aws-ebs-csi-driver/aws-ebs-csi-driver \
  --namespace kube-system \
  --set controller.serviceAccount.annotations."eks\.amazonaws\.com/role-arn"=arn:aws:iam::123456789:role/EBSCSIDriverRole
```

```yaml
# ebs-storage-class.yaml
apiVersion: storage.k8s.io/v1
kind: StorageClass
metadata:
  name: ebs-gp3
  annotations:
    storageclass.kubernetes.io/is-default-class: "true"
provisioner: ebs.csi.aws.com
parameters:
  type: gp3
  iops: "3000"
  throughput: "125"
  encrypted: "true"
  fsType: ext4
reclaimPolicy: Delete
volumeBindingMode: WaitForFirstConsumer
allowVolumeExpansion: true
```

## GCP Persistent Disk CSI Driver

```bash
# GKE has built-in CSI driver, create StorageClass
```

```yaml
# gcp-pd-storage-class.yaml
apiVersion: storage.k8s.io/v1
kind: StorageClass
metadata:
  name: pd-ssd
provisioner: pd.csi.storage.gke.io
parameters:
  type: pd-ssd
  replication-type: regional-pd  # For regional HA
reclaimPolicy: Retain
volumeBindingMode: WaitForFirstConsumer
allowVolumeExpansion: true
---
apiVersion: storage.k8s.io/v1
kind: StorageClass
metadata:
  name: pd-balanced
provisioner: pd.csi.storage.gke.io
parameters:
  type: pd-balanced
reclaimPolicy: Delete
volumeBindingMode: WaitForFirstConsumer
```

## Azure Disk CSI Driver

```yaml
# azure-disk-storage-class.yaml
apiVersion: storage.k8s.io/v1
kind: StorageClass
metadata:
  name: managed-premium
provisioner: disk.csi.azure.com
parameters:
  skuName: Premium_LRS
  cachingMode: ReadOnly
reclaimPolicy: Delete
volumeBindingMode: WaitForFirstConsumer
allowVolumeExpansion: true
---
apiVersion: storage.k8s.io/v1
kind: StorageClass
metadata:
  name: azure-ultra-disk
provisioner: disk.csi.azure.com
parameters:
  skuName: UltraSSD_LRS
  DiskIOPSReadWrite: "4000"
  DiskMBpsReadWrite: "125"
reclaimPolicy: Delete
volumeBindingMode: WaitForFirstConsumer
```

## NFS CSI Driver

```bash
# Install NFS CSI Driver
helm repo add csi-driver-nfs https://raw.githubusercontent.com/kubernetes-csi/csi-driver-nfs/master/charts
helm install csi-driver-nfs csi-driver-nfs/csi-driver-nfs \
  --namespace kube-system
```

```yaml
# nfs-storage-class.yaml
apiVersion: storage.k8s.io/v1
kind: StorageClass
metadata:
  name: nfs-csi
provisioner: nfs.csi.k8s.io
parameters:
  server: nfs-server.example.com
  share: /exports/kubernetes
reclaimPolicy: Delete
volumeBindingMode: Immediate
mountOptions:
  - nfsvers=4.1
  - hard
  - timeo=600
  - retrans=3
```

## Longhorn CSI (On-Premises)

```bash
# Install Longhorn
helm repo add longhorn https://charts.longhorn.io
helm install longhorn longhorn/longhorn \
  --namespace longhorn-system \
  --create-namespace \
  --set defaultSettings.defaultDataPath="/var/lib/longhorn"
```

```yaml
# longhorn-storage-class.yaml
apiVersion: storage.k8s.io/v1
kind: StorageClass
metadata:
  name: longhorn
provisioner: driver.longhorn.io
parameters:
  numberOfReplicas: "3"
  staleReplicaTimeout: "2880"
  fromBackup: ""
  fsType: ext4
reclaimPolicy: Delete
volumeBindingMode: Immediate
allowVolumeExpansion: true
```

## Create PVC with CSI Storage

```yaml
# pvc-csi.yaml
apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: app-data
spec:
  accessModes:
    - ReadWriteOnce
  storageClassName: ebs-gp3
  resources:
    requests:
      storage: 100Gi
---
apiVersion: apps/v1
kind: Deployment
metadata:
  name: myapp
spec:
  selector:
    matchLabels:
      app: myapp
  template:
    metadata:
      labels:
        app: myapp
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
            claimName: app-data
```

## Volume Expansion

```yaml
# Expand existing PVC
apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: app-data
spec:
  accessModes:
    - ReadWriteOnce
  storageClassName: ebs-gp3
  resources:
    requests:
      storage: 200Gi  # Increased from 100Gi
```

```bash
# Check expansion status
kubectl describe pvc app-data | grep -A5 Conditions
```

## CSI Topology

```yaml
# topology-aware-storage.yaml
apiVersion: storage.k8s.io/v1
kind: StorageClass
metadata:
  name: ebs-gp3-topology
provisioner: ebs.csi.aws.com
parameters:
  type: gp3
volumeBindingMode: WaitForFirstConsumer
allowedTopologies:
  - matchLabelExpressions:
      - key: topology.ebs.csi.aws.com/zone
        values:
          - us-east-1a
          - us-east-1b
```

## CSI Driver Status

```bash
# List CSI drivers
kubectl get csidrivers

# Check CSI nodes
kubectl get csinodes

# View storage classes
kubectl get storageclass

# Check CSI controller pods
kubectl get pods -n kube-system -l app=ebs-csi-controller

# View CSI driver capabilities
kubectl describe csidriver ebs.csi.aws.com
```

## Snapshot with CSI

```yaml
# volume-snapshot-class.yaml
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
  name: app-data-snapshot
spec:
  volumeSnapshotClassName: ebs-snapshot-class
  source:
    persistentVolumeClaimName: app-data
```

## Raw Block Volume

```yaml
# block-pvc.yaml
apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: block-pvc
spec:
  accessModes:
    - ReadWriteOnce
  volumeMode: Block
  storageClassName: ebs-gp3
  resources:
    requests:
      storage: 100Gi
---
apiVersion: v1
kind: Pod
metadata:
  name: block-pod
spec:
  containers:
    - name: app
      image: myapp:v1
      volumeDevices:
        - name: data
          devicePath: /dev/xvda
  volumes:
    - name: data
      persistentVolumeClaim:
        claimName: block-pvc
```

## Troubleshooting CSI

```bash
# Check CSI controller logs
kubectl logs -n kube-system -l app=ebs-csi-controller -c csi-provisioner

# Check node driver logs
kubectl logs -n kube-system -l app=ebs-csi-node -c ebs-plugin

# Describe stuck PVC
kubectl describe pvc <pvc-name>

# Check events
kubectl get events --field-selector reason=ProvisioningFailed
```

## Summary

CSI drivers provide standardized storage integration for Kubernetes. Install the appropriate driver for your storage backend, create StorageClasses with desired parameters, and use dynamic provisioning with PVCs. Enable volume expansion and snapshots for data management. Use WaitForFirstConsumer binding for topology-aware scheduling.

---

## 📘 Go Further with Kubernetes Recipes

**Love this recipe? There's so much more!** This is just one of **100+ hands-on recipes** in our comprehensive **[Kubernetes Recipes book](/book)**.

Inside the book, you'll master:
- ✅ Production-ready deployment strategies
- ✅ Advanced networking and security patterns  
- ✅ Observability, monitoring, and troubleshooting
- ✅ Real-world best practices from industry experts

> *"The practical, recipe-based approach made complex Kubernetes concepts finally click for me."*

**👉 [Get Your Copy Now](/book)** — Start building production-grade Kubernetes skills today!
