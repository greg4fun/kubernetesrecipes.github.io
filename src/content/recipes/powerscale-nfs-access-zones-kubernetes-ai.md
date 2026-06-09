---
title: "Dell PowerScale NFS Access Zones for Kubernetes AI Storage"
description: "Configure Dell PowerScale (Isilon) access zones and SmartConnect pools for Kubernetes AI workloads. Covers groupnet/subnet/pool hierarchy, NFS export isolation per environment, and IP pool sizing for GPU training cluster storage."
tags:
  - "storage"
  - "nfs"
  - "networking"
  - "configuration"
  - "architecture"
category: "storage"
publishDate: "2026-06-08"
author: "Luca Berton"
difficulty: "advanced"
relatedRecipes:
  - "kubernetes-nfs-persistent-volumes"
  - "kubernetes-storage-class-configuration"
  - "openshift-persistent-storage-nfs"
---

> 💡 **Quick Answer:** Dell PowerScale (Isilon) uses a hierarchy of Groupnet → Subnet → Pool to organize network access to NFS exports. For Kubernetes AI clusters, create separate SmartConnect pools per environment (dev, staging, production) within a shared NFS subnet. Each pool gets a dedicated IP range and DNS name, enabling per-namespace PersistentVolume isolation without separate physical clusters.

## The Problem

- Multiple Kubernetes environments (dev, staging, prod) need isolated NFS storage
- AI training jobs generate massive I/O — need dedicated bandwidth per workload
- IP address pools must be sized for concurrent NFS client connections
- SmartConnect DNS-based load balancing requires proper pool configuration
- Backup and management traffic must be separated from data traffic

## The Solution

### PowerScale Network Hierarchy

```text
Groupnet (groupnet0)
│   DNS: ns1.example.com, ns2.example.com
│
├── Subnet: subnet-data (10.233.192.0/22)
│   │   Purpose: NFS data traffic for Kubernetes workloads
│   │
│   ├── Pool: pool-platform-nfs
│   │   IPs: 10.233.193.1 - 10.233.193.12  (12 IPs)
│   │   SmartConnect: platform-nfs.storage.example.com
│   │   Purpose: Platform services (registry, GitOps, monitoring)
│   │
│   ├── Pool: pool-dev-nfs
│   │   IPs: 10.233.193.13 - 10.233.193.24  (12 IPs)
│   │   SmartConnect: dev-nfs.storage.example.com
│   │   Purpose: Development workloads
│   │
│   ├── Pool: pool-staging-nfs
│   │   IPs: 10.233.193.37 - 10.233.193.48  (12 IPs)
│   │   SmartConnect: staging-nfs.storage.example.com
│   │   Purpose: Staging/pre-production
│   │
│   └── Pool: pool-prod-nfs
│       IPs: 10.233.195.37 - 10.233.195.48  (12 IPs)
│       SmartConnect: prod-nfs.storage.example.com
│       Purpose: Production training jobs
│
├── Subnet: subnet-smartconnect (10.233.209.0/24)
│   │   Purpose: SmartConnect service IPs (DNS delegation)
│   │
│   └── (SmartConnect zone IPs for DNS round-robin)
│
├── Subnet: subnet-mgmt (10.233.200.0/22)
│   │   Purpose: Cluster management, OneFS web UI, SSH
│   │
│   └── (Admin access IPs)
│
└── Subnet: subnet-backup (10.232.210.0/24)
        Purpose: Backup replication traffic (isolated)
```

### Kubernetes StorageClass Per Pool

```yaml
# Development StorageClass
apiVersion: storage.k8s.io/v1
kind: StorageClass
metadata:
  name: powerscale-dev
provisioner: csi-isilon.dellemc.com
parameters:
  ClusterName: "cluster1"
  AccessZone: "dev-zone"
  IsiPath: "/ifs/kubernetes/dev"
  NfsHost: "dev-nfs.storage.example.com"    # SmartConnect pool DNS
  RootClientEnabled: "true"
reclaimPolicy: Delete
allowVolumeExpansion: true
mountOptions:
  - nfsvers=4.1
  - rsize=1048576
  - wsize=1048576

---
# Production StorageClass (larger IO, retain policy)
apiVersion: storage.k8s.io/v1
kind: StorageClass
metadata:
  name: powerscale-prod
provisioner: csi-isilon.dellemc.com
parameters:
  ClusterName: "cluster1"
  AccessZone: "prod-zone"
  IsiPath: "/ifs/kubernetes/prod"
  NfsHost: "prod-nfs.storage.example.com"
  RootClientEnabled: "true"
reclaimPolicy: Retain
allowVolumeExpansion: true
mountOptions:
  - nfsvers=4.1
  - rsize=1048576
  - wsize=1048576
  - hard
  - intr
```

### IP Pool Sizing for AI Workloads

```text
Pool Sizing Formula:
  IPs needed = max_concurrent_nodes × connections_per_node × safety_factor

Example: 16-node GPU cluster, 4 mount points per node, 1.5× safety
  IPs = 16 × 4 × 1.5 = 96 IPs (use /25 subnet minimum)

For SmartConnect load balancing:
  - Round-robin distributes connections across pool IPs
  - Each IP represents one OneFS node's NFS service
  - More IPs = more OneFS nodes serving that pool = more bandwidth

Typical sizing:
  Platform pool:  12 IPs (low traffic, metadata-heavy)
  Dev pool:       12 IPs (moderate, bursty)
  Staging pool:   12 IPs (mirrors production patterns)
  Prod pool:      24+ IPs (high throughput, training data)
```

### Access Zone Configuration

```text
Access Zone: dev-zone
  ├── Base directory: /ifs/kubernetes/dev
  ├── Authentication: System (UID/GID mapping)
  ├── SmartConnect pool: pool-dev-nfs
  ├── NFS exports:
  │   ├── /ifs/kubernetes/dev/datasets    (read-only for training)
  │   ├── /ifs/kubernetes/dev/checkpoints (read-write for model saves)
  │   └── /ifs/kubernetes/dev/scratch     (read-write, no snapshots)
  └── Client restrictions: 10.128.0.0/14 (Kubernetes pod CIDR)

Access Zone: prod-zone
  ├── Base directory: /ifs/kubernetes/prod
  ├── Authentication: System + LDAP (audit trail)
  ├── SmartConnect pool: pool-prod-nfs
  ├── NFS exports:
  │   ├── /ifs/kubernetes/prod/datasets    (read-only, snapshotted)
  │   ├── /ifs/kubernetes/prod/checkpoints (read-write, replicated)
  │   └── /ifs/kubernetes/prod/models      (read-only, published models)
  └── Client restrictions: 10.128.0.0/14 (Kubernetes pod CIDR)
```

### NFS Mount Options for GPU Training

```yaml
# PersistentVolume for training datasets
apiVersion: v1
kind: PersistentVolume
metadata:
  name: training-dataset-prod
spec:
  capacity:
    storage: 10Ti
  accessModes:
    - ReadOnlyMany          # Datasets are read-only during training
  nfs:
    server: prod-nfs.storage.example.com    # SmartConnect DNS
    path: /ifs/kubernetes/prod/datasets
  mountOptions:
    - nfsvers=4.1           # NFSv4.1 for session trunking
    - rsize=1048576         # 1MB read chunks (large sequential reads)
    - wsize=1048576         # 1MB write chunks
    - hard                  # Retry indefinitely (don't corrupt training)
    - intr                  # Allow interrupt (Ctrl+C kills hung mount)
    - noatime               # Don't update access time (reduces metadata IO)
    - nodiratime            # Don't update directory access time
```

### Network Separation Architecture

```text
┌─────────────────────────────────────────────────────────────┐
│                    PowerScale Cluster                         │
│                                                             │
│  ┌─────────────────┐  ┌──────────────┐  ┌───────────────┐  │
│  │  NFS Data Subnet│  │ SmartConnect │  │  Mgmt Subnet  │  │
│  │  10.233.192.0/22│  │ 10.233.209/24│  │ 10.233.200/22 │  │
│  │                 │  │              │  │               │  │
│  │  ←── K8s pods   │  │ ←── DNS SVC  │  │ ←── Admins   │  │
│  │  (data I/O)     │  │ (round-robin)│  │ (Web UI/SSH) │  │
│  └─────────────────┘  └──────────────┘  └───────────────┘  │
│                                                             │
│  ┌─────────────────┐                                        │
│  │  Backup Subnet  │                                        │
│  │  10.232.210.0/24│                                        │
│  │                 │                                        │
│  │  ←── Replication│                                        │
│  │  (DR traffic)   │                                        │
│  └─────────────────┘                                        │
└─────────────────────────────────────────────────────────────┘

Why separate subnets:
  - Data traffic doesn't compete with backup replication
  - Management access is firewall-restricted (admin only)
  - SmartConnect needs its own IPs for DNS delegation
  - Each subnet can have different MTU (9000 for data, 1500 for mgmt)
```

## Common Issues

### SmartConnect DNS not resolving
- **Cause**: SmartConnect zone not delegated in corporate DNS
- **Fix**: Create NS delegation: `storage.example.com → PowerScale SmartConnect IPs`

### NFS mounts hanging during GPU training
- **Cause**: IP pool exhausted, SmartConnect returning stale IPs
- **Fix**: Increase pool IP count; verify all OneFS nodes are healthy in pool

### Cross-environment data leakage
- **Cause**: Access zones not properly restricting client IPs
- **Fix**: Set client restriction per zone to only allow Kubernetes pod CIDR

### Unbalanced I/O across OneFS nodes
- **Cause**: SmartConnect using connection count balancing (not throughput)
- **Fix**: Switch SmartConnect policy to "Round Robin" or "CPU Usage" for AI workloads

### Model checkpoint writes slow
- **Cause**: Small rsize/wsize (default 32KB) causing excessive NFS operations
- **Fix**: Set `rsize=1048576,wsize=1048576` in mountOptions (1MB chunks)

## Best Practices

1. **One SmartConnect pool per environment** — isolates failure domains
2. **Separate subnets for data vs management** — prevents contention
3. **Size IP pools for peak concurrency** — not steady-state
4. **Use NFSv4.1** — session trunking, better locking, delegation
5. **Large rsize/wsize (1MB)** for training data — sequential reads benefit most
6. **ReadOnlyMany for datasets** — prevents accidental corruption during training
7. **Hard mount + intr** for training — never silently fail, but allow kill
8. **Snapshot datasets, not scratch** — scratch dirs regenerate; datasets are precious

## Key Takeaways

- PowerScale hierarchy: Groupnet → Subnet → Pool → Access Zone
- Each K8s environment gets its own SmartConnect pool (DNS name + IP range)
- Separate NFS data, SmartConnect, management, and backup on different subnets
- IP pool size determines max concurrent NFS clients (plan for all GPU nodes)
- Mount options critical for AI: NFSv4.1, 1MB chunks, hard+intr, noatime
- Access zones enforce path and client isolation between environments
- SmartConnect load balances connections across OneFS nodes in the pool
