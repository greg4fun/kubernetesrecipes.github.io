---
title: "How to Configure Local Persistent Volumes"
description: "Use local persistent volumes for high-performance storage with node-local SSDs. Configure local storage classes and handle node affinity constraints."
category: "storage"
difficulty: "intermediate"
publishDate: "2026-01-22"
tags: ["local-storage", "persistent-volumes", "ssd", "performance", "storage"]
---

# How to Configure Local Persistent Volumes

Local persistent volumes provide direct access to node-local storage devices for high-performance workloads. Ideal for databases and caching systems that need low-latency disk access.

## Local Storage Class

```yaml
# local-storage-class.yaml
apiVersion: storage.k8s.io/v1
kind: StorageClass
metadata:
  name: local-storage
provisioner: kubernetes.io/no-provisioner
volumeBindingMode: WaitForFirstConsumer  # Critical for local volumes
reclaimPolicy: Delete
```

## Create Local Persistent Volume

```yaml
# local-pv.yaml
apiVersion: v1
kind: PersistentVolume
metadata:
  name: local-pv-node1
  labels:
    type: local
spec:
  capacity:
    storage: 100Gi
  volumeMode: Filesystem
  accessModes:
    - ReadWriteOnce
  persistentVolumeReclaimPolicy: Retain
  storageClassName: local-storage
  local:
    path: /mnt/disks/ssd1
  nodeAffinity:
    required:
      nodeSelectorTerms:
        - matchExpressions:
            - key: kubernetes.io/hostname
              operator: In
              values:
                - node1
```

## Prepare Node Storage

```bash
# On each node, prepare local disks
# Format and mount disk
sudo mkfs.ext4 /dev/nvme1n1
sudo mkdir -p /mnt/disks/ssd1
sudo mount /dev/nvme1n1 /mnt/disks/ssd1

# Add to fstab for persistence
echo '/dev/nvme1n1 /mnt/disks/ssd1 ext4 defaults 0 0' | sudo tee -a /etc/fstab

# Set permissions
sudo chmod 777 /mnt/disks/ssd1
```

## PVC for Local Storage

```yaml
# local-pvc.yaml
apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: local-data
  namespace: default
spec:
  storageClassName: local-storage
  accessModes:
    - ReadWriteOnce
  resources:
    requests:
      storage: 50Gi
```

## StatefulSet with Local Volumes

```yaml
# statefulset-local.yaml
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
          ports:
            - containerPort: 5432
          volumeMounts:
            - name: data
              mountPath: /var/lib/postgresql/data
          env:
            - name: POSTGRES_PASSWORD
              valueFrom:
                secretKeyRef:
                  name: postgres-secret
                  key: password
            - name: PGDATA
              value: /var/lib/postgresql/data/pgdata
  volumeClaimTemplates:
    - metadata:
        name: data
      spec:
        storageClassName: local-storage
        accessModes:
          - ReadWriteOnce
        resources:
          requests:
            storage: 100Gi
```

## Local Volume Provisioner (Automated)

```bash
# Install local static provisioner
kubectl apply -f https://raw.githubusercontent.com/kubernetes-sigs/sig-storage-local-static-provisioner/master/deployment/kubernetes/example/default_example_provisioner_generated.yaml
```

```yaml
# provisioner-config.yaml
apiVersion: v1
kind: ConfigMap
metadata:
  name: local-provisioner-config
  namespace: kube-system
data:
  storageClassMap: |
    local-storage:
      hostDir: /mnt/disks
      mountDir: /mnt/disks
      blockCleanerCommand:
        - "/scripts/shred.sh"
        - "2"
      volumeMode: Filesystem
      fsType: ext4
```

## Multiple Local Volumes per Node

```yaml
# Create PV for each local disk
apiVersion: v1
kind: PersistentVolume
metadata:
  name: local-pv-node1-disk1
spec:
  capacity:
    storage: 500Gi
  volumeMode: Filesystem
  accessModes:
    - ReadWriteOnce
  storageClassName: local-ssd
  local:
    path: /mnt/disks/ssd1
  nodeAffinity:
    required:
      nodeSelectorTerms:
        - matchExpressions:
            - key: kubernetes.io/hostname
              operator: In
              values:
                - node1
---
apiVersion: v1
kind: PersistentVolume
metadata:
  name: local-pv-node1-disk2
spec:
  capacity:
    storage: 500Gi
  volumeMode: Filesystem
  accessModes:
    - ReadWriteOnce
  storageClassName: local-ssd
  local:
    path: /mnt/disks/ssd2
  nodeAffinity:
    required:
      nodeSelectorTerms:
        - matchExpressions:
            - key: kubernetes.io/hostname
              operator: In
              values:
                - node1
```

## Block Mode Local Volume

```yaml
# block-local-pv.yaml
apiVersion: v1
kind: PersistentVolume
metadata:
  name: local-block-pv
spec:
  capacity:
    storage: 200Gi
  volumeMode: Block  # Raw block device
  accessModes:
    - ReadWriteOnce
  storageClassName: local-block
  local:
    path: /dev/nvme2n1  # Raw device path
  nodeAffinity:
    required:
      nodeSelectorTerms:
        - matchExpressions:
            - key: kubernetes.io/hostname
              operator: In
              values:
                - node1
---
# PVC for block volume
apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: block-pvc
spec:
  storageClassName: local-block
  volumeMode: Block
  accessModes:
    - ReadWriteOnce
  resources:
    requests:
      storage: 200Gi
---
# Pod using block volume
apiVersion: v1
kind: Pod
metadata:
  name: block-pod
spec:
  containers:
    - name: app
      image: myapp:v1
      volumeDevices:  # Not volumeMounts
        - name: data
          devicePath: /dev/xvda
  volumes:
    - name: data
      persistentVolumeClaim:
        claimName: block-pvc
```

## Monitoring Local Storage

```bash
# Check PV status
kubectl get pv -l type=local

# Check which node has the PV
kubectl get pv local-pv-node1 -o jsonpath='{.spec.nodeAffinity}'

# Check disk space on nodes
kubectl get nodes -o custom-columns=\
NAME:.metadata.name,\
DISK:.status.allocatable.ephemeral-storage
```

## Node Maintenance Considerations

```yaml
# Before draining node with local volumes:
# 1. Backup data
# 2. Scale down workloads
# 3. Data won't move with pod

# Use pod anti-affinity to spread replicas
apiVersion: apps/v1
kind: StatefulSet
metadata:
  name: cassandra
spec:
  template:
    spec:
      affinity:
        podAntiAffinity:
          requiredDuringSchedulingIgnoredDuringExecution:
            - labelSelector:
                matchLabels:
                  app: cassandra
              topologyKey: kubernetes.io/hostname
```

## Cleanup

```bash
# Delete PVC first
kubectl delete pvc local-data

# Then delete PV
kubectl delete pv local-pv-node1

# Clean up node disk
ssh node1 'sudo rm -rf /mnt/disks/ssd1/*'
```

## Summary

Local persistent volumes provide high-performance storage using node-attached disks. Use `WaitForFirstConsumer` binding mode, configure node affinity, and understand that data doesn't migrate between nodes. Ideal for databases and caching layers requiring low latency. Plan for node failures with replication at the application level.

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
