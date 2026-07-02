---
title: "Local Persistent Volumes Kubernetes"
description: "Configure local persistent volumes on Kubernetes for high-performance storage. Node affinity, local-path-provisioner, and SSD-backed database workloads."
publishDate: "2026-04-25"
author: "Luca Berton"
category: "storage"
difficulty: "intermediate"
timeToComplete: "15 minutes"
kubernetesVersion: "1.28+"
tags:
  - "local-pv"
  - "persistent-volume"
  - "node-affinity"
  - "performance"
relatedRecipes:
  - "nfsordma-persistent-volume"
  - "kubernetes-pod-security-standards"
---

> 💡 **Quick Answer:** Configure local persistent volumes on Kubernetes for high-performance storage. Node affinity, local-path-provisioner, and SSD-backed database workloads.

## The Problem

Network-attached storage adds latency that databases and caches can't always absorb. Local persistent volumes give a pod direct access to a node's own disk — lowest possible latency, at the cost of tying that data permanently to whichever node holds it.

## The Solution

### StorageClass and PersistentVolume

`WaitForFirstConsumer` binding is mandatory — it delays binding until a pod is actually scheduled, so the scheduler can place the pod on the node that has the matching local volume:

```yaml
apiVersion: storage.k8s.io/v1
kind: StorageClass
metadata:
  name: local-storage
provisioner: kubernetes.io/no-provisioner
volumeBindingMode: WaitForFirstConsumer
reclaimPolicy: Delete
```

```yaml
apiVersion: v1
kind: PersistentVolume
metadata:
  name: local-pv-node1
  labels: {type: local}
spec:
  capacity: {storage: 100Gi}
  volumeMode: Filesystem
  accessModes: [ReadWriteOnce]
  persistentVolumeReclaimPolicy: Retain
  storageClassName: local-storage
  local:
    path: /mnt/disks/ssd1
  nodeAffinity:
    required:
      nodeSelectorTerms:
        - matchExpressions:
            - {key: kubernetes.io/hostname, operator: In, values: [node1]}
```

### Prepare the Node's Disk

```bash
sudo mkfs.ext4 /dev/nvme1n1
sudo mkdir -p /mnt/disks/ssd1
sudo mount /dev/nvme1n1 /mnt/disks/ssd1
echo '/dev/nvme1n1 /mnt/disks/ssd1 ext4 defaults 0 0' | sudo tee -a /etc/fstab
```

### StatefulSet Using Local Volumes

```yaml
apiVersion: apps/v1
kind: StatefulSet
metadata:
  name: postgres
spec:
  serviceName: postgres
  replicas: 3
  selector: {matchLabels: {app: postgres}}
  template:
    metadata: {labels: {app: postgres}}
    spec:
      containers:
        - name: postgres
          image: postgres:15
          volumeMounts: [{name: data, mountPath: /var/lib/postgresql/data}]
  volumeClaimTemplates:
    - metadata: {name: data}
      spec:
        storageClassName: local-storage
        accessModes: [ReadWriteOnce]
        resources: {requests: {storage: 100Gi}}
```

### Automate Provisioning Across Many Disks

Hand-writing a PV per disk doesn't scale — the local static provisioner watches a directory convention and creates PVs automatically:

```bash
kubectl apply -f https://raw.githubusercontent.com/kubernetes-sigs/sig-storage-local-static-provisioner/master/deployment/kubernetes/example/default_example_provisioner_generated.yaml
```

```yaml
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
      blockCleanerCommand: ["/scripts/shred.sh", "2"]
      volumeMode: Filesystem
```

### Block Mode (Raw Device Access)

```yaml
apiVersion: v1
kind: PersistentVolume
metadata:
  name: local-block-pv
spec:
  capacity: {storage: 200Gi}
  volumeMode: Block             # raw block device, not a filesystem
  accessModes: [ReadWriteOnce]
  storageClassName: local-block
  local: {path: /dev/nvme2n1}
  nodeAffinity:
    required:
      nodeSelectorTerms:
        - matchExpressions: [{key: kubernetes.io/hostname, operator: In, values: [node1]}]
---
# Pods consuming Block volumes use volumeDevices, not volumeMounts
spec:
  containers:
    - name: app
      volumeDevices: [{name: data, devicePath: /dev/xvda}]
```

### Spreading Replicas Across Nodes

Since data doesn't move with the pod, protect against node loss with anti-affinity instead of relying on the volume itself:

```yaml
affinity:
  podAntiAffinity:
    requiredDuringSchedulingIgnoredDuringExecution:
      - labelSelector: {matchLabels: {app: cassandra}}
        topologyKey: kubernetes.io/hostname
```

### Monitoring and Cleanup

```bash
kubectl get pv -l type=local
kubectl get pv local-pv-node1 -o jsonpath='{.spec.nodeAffinity}'

# Cleanup order matters: PVC first, then PV, then the node's actual disk
kubectl delete pvc local-data
kubectl delete pv local-pv-node1
ssh node1 'sudo rm -rf /mnt/disks/ssd1/*'
```

## Common Issues

| Issue | Cause | Fix |
|-------|-------|-----|
| PVC stuck Pending forever | `volumeBindingMode` isn't `WaitForFirstConsumer`, or no PV matches the pod's eventual node | Set `WaitForFirstConsumer`; verify a PV's `nodeAffinity` actually covers a schedulable node |
| Data "lost" after node failure | Local PVs are physically tied to one node — this is expected, not a bug | Only use local PVs for workloads that replicate at the application layer (databases with their own replication, not single-instance apps) |
| Pod can't be rescheduled after node drain | The PV's data is on the drained node and can't follow the pod | Plan node maintenance around replica counts — drain one replica at a time, never all replicas of a local-PV workload together |
| Stale PV after manual cleanup | PV `reclaimPolicy: Retain` requires manual deletion — it won't auto-clean | Delete the PV object explicitly after removing the underlying disk data |

## Best Practices

- **Always use `WaitForFirstConsumer`** — without it, a PV can bind to a PVC before the scheduler has decided which node the pod will run on, potentially binding on the wrong node
- **Only use local PVs for workloads with their own replication** (distributed databases, Cassandra, etc.) — a local PV is a single point of failure for anything else
- **Automate PV creation with the local static provisioner** once you're managing more than a handful of disks — hand-written PVs don't scale
- **Use pod anti-affinity to spread replicas across nodes** — this is your actual protection against node loss, not the volume itself
- **Plan node maintenance carefully** — draining a node with local volumes doesn't move the data; coordinate with replica counts before draining

## Key Takeaways

- Local PVs trade the durability of network storage for the lowest possible latency — direct node-local disk access
- `volumeBindingMode: WaitForFirstConsumer` is mandatory, not optional, or binding can happen before scheduling decides the node
- Data is physically tied to one node — node failure means that PV's data is gone until the node returns
- Use local PVs only for workloads that replicate at the application layer; pair with pod anti-affinity to actually protect against node loss
- The local static provisioner automates PV creation across many disks — write PVs by hand only for a handful of one-off cases
