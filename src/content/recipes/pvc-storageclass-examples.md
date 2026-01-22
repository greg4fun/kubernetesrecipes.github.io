---
title: "How to Create and Use PersistentVolumeClaims with StorageClasses"
description: "Learn how to provision persistent storage for your Kubernetes workloads using PersistentVolumeClaims and StorageClasses. Includes examples for dynamic provisioning with different cloud providers."
category: "storage"
difficulty: "beginner"
timeToComplete: "15 minutes"
kubernetesVersion: "1.25+"
prerequisites:
  - "A Kubernetes cluster with a storage provisioner"
  - "kubectl configured to access your cluster"
relatedRecipes:
  - "statefulset-storage-patterns"
  - "troubleshooting-pending-pvc"
tags:
  - storage
  - pvc
  - persistentvolume
  - storageclass
  - dynamic-provisioning
publishDate: "2026-01-20"
author: "Luca Berton"
---

## The Problem

Your application needs persistent storage that survives pod restarts and rescheduling. You need a way to request storage dynamically without pre-creating volumes.

## The Solution

Use PersistentVolumeClaims (PVCs) with StorageClasses to dynamically provision storage from your cluster's storage backend.

## Understanding the Storage Model

Kubernetes storage has three main components:

1. **StorageClass** - Defines the "classes" of storage available (fast SSD, slow HDD, etc.)
2. **PersistentVolume (PV)** - A piece of storage provisioned by an admin or dynamically
3. **PersistentVolumeClaim (PVC)** - A request for storage by a user

## Step 1: Check Available StorageClasses

List the StorageClasses in your cluster:

```bash
kubectl get storageclass
```

Example output:

```
NAME                 PROVISIONER             RECLAIMPOLICY   VOLUMEBINDINGMODE      AGE
standard (default)   kubernetes.io/gce-pd    Delete          Immediate              30d
fast-ssd             kubernetes.io/gce-pd    Delete          Immediate              30d
```

The `(default)` marker shows which class is used when none is specified.

## Step 2: Create a PersistentVolumeClaim

Create a basic PVC that requests 10Gi of storage:

```yaml
apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: my-app-storage
spec:
  accessModes:
    - ReadWriteOnce
  resources:
    requests:
      storage: 10Gi
  # storageClassName: fast-ssd  # Uncomment to use a specific class
```

Apply it:

```bash
kubectl apply -f my-pvc.yaml
```

Check the PVC status:

```bash
kubectl get pvc my-app-storage
```

## Step 3: Use the PVC in a Pod

Mount the PVC in your pod:

```yaml
apiVersion: v1
kind: Pod
metadata:
  name: my-app
spec:
  containers:
    - name: my-app
      image: nginx
      volumeMounts:
        - name: data
          mountPath: /data
  volumes:
    - name: data
      persistentVolumeClaim:
        claimName: my-app-storage
```

## Access Modes Explained

| Mode | Short | Description |
|------|-------|-------------|
| ReadWriteOnce | RWO | Can be mounted read-write by one node |
| ReadOnlyMany | ROX | Can be mounted read-only by many nodes |
| ReadWriteMany | RWX | Can be mounted read-write by many nodes |

> **Note:** Not all storage backends support all access modes. Check your provider's documentation.

## StorageClass Examples by Provider

### AWS EBS

```yaml
apiVersion: storage.k8s.io/v1
kind: StorageClass
metadata:
  name: fast-ssd
provisioner: ebs.csi.aws.com
parameters:
  type: gp3
  iops: "3000"
  throughput: "125"
reclaimPolicy: Delete
volumeBindingMode: WaitForFirstConsumer
allowVolumeExpansion: true
```

### GCP Persistent Disk

```yaml
apiVersion: storage.k8s.io/v1
kind: StorageClass
metadata:
  name: fast-ssd
provisioner: pd.csi.storage.gke.io
parameters:
  type: pd-ssd
reclaimPolicy: Delete
volumeBindingMode: WaitForFirstConsumer
allowVolumeExpansion: true
```

### Azure Disk

```yaml
apiVersion: storage.k8s.io/v1
kind: StorageClass
metadata:
  name: fast-ssd
provisioner: disk.csi.azure.com
parameters:
  skuName: Premium_LRS
reclaimPolicy: Delete
volumeBindingMode: WaitForFirstConsumer
allowVolumeExpansion: true
```

### Local Path (for development)

```yaml
apiVersion: storage.k8s.io/v1
kind: StorageClass
metadata:
  name: local-path
provisioner: rancher.io/local-path
reclaimPolicy: Delete
volumeBindingMode: WaitForFirstConsumer
```

## Expanding a PVC

If `allowVolumeExpansion: true` is set on the StorageClass, you can expand PVCs:

```bash
# Edit the PVC to increase storage
kubectl patch pvc my-app-storage -p '{"spec":{"resources":{"requests":{"storage":"20Gi"}}}}'
```

> **Note:** You can only expand PVCs, never shrink them.

## Complete Example: WordPress with MySQL

```yaml
---
# MySQL PVC
apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: mysql-pvc
spec:
  accessModes:
    - ReadWriteOnce
  resources:
    requests:
      storage: 20Gi
---
# WordPress PVC
apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: wordpress-pvc
spec:
  accessModes:
    - ReadWriteOnce
  resources:
    requests:
      storage: 10Gi
---
# MySQL Deployment
apiVersion: apps/v1
kind: Deployment
metadata:
  name: mysql
spec:
  replicas: 1
  selector:
    matchLabels:
      app: mysql
  template:
    metadata:
      labels:
        app: mysql
    spec:
      containers:
        - name: mysql
          image: mysql:8.0
          env:
            - name: MYSQL_ROOT_PASSWORD
              value: "password"  # Use Secrets in production!
            - name: MYSQL_DATABASE
              value: wordpress
          ports:
            - containerPort: 3306
          volumeMounts:
            - name: mysql-data
              mountPath: /var/lib/mysql
      volumes:
        - name: mysql-data
          persistentVolumeClaim:
            claimName: mysql-pvc
---
# MySQL Service
apiVersion: v1
kind: Service
metadata:
  name: mysql
spec:
  selector:
    app: mysql
  ports:
    - port: 3306
---
# WordPress Deployment
apiVersion: apps/v1
kind: Deployment
metadata:
  name: wordpress
spec:
  replicas: 1
  selector:
    matchLabels:
      app: wordpress
  template:
    metadata:
      labels:
        app: wordpress
    spec:
      containers:
        - name: wordpress
          image: wordpress:latest
          env:
            - name: WORDPRESS_DB_HOST
              value: mysql
            - name: WORDPRESS_DB_PASSWORD
              value: "password"
          ports:
            - containerPort: 80
          volumeMounts:
            - name: wordpress-data
              mountPath: /var/www/html
      volumes:
        - name: wordpress-data
          persistentVolumeClaim:
            claimName: wordpress-pvc
```

## Common Issues

### PVC stuck in Pending

Check the PVC events:

```bash
kubectl describe pvc my-app-storage
```

Common causes:
- No StorageClass available
- Storage quota exceeded
- Wrong access mode for the storage type

### Volume not mounting

Check pod events:

```bash
kubectl describe pod my-app
```

Look for mount errors in the Events section.

## Summary

You've learned how to:

1. List available StorageClasses
2. Create PersistentVolumeClaims
3. Mount PVCs in pods
4. Understand access modes
5. Create custom StorageClasses

## References

- [Kubernetes Persistent Volumes](https://kubernetes.io/docs/concepts/storage/persistent-volumes/)
- [Storage Classes](https://kubernetes.io/docs/concepts/storage/storage-classes/)
