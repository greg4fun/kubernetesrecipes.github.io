---
title: "K8s Kubelet Configuration and Tuning"
description: "Configure Kubernetes kubelet with KubeletConfiguration API. Resource reservation, eviction thresholds, image garbage collection, and node allocatable settings."
publishDate: "2026-05-02"
author: "Luca Berton"
category: "configuration"
difficulty: "advanced"
timeToComplete: "12 minutes"
kubernetesVersion: "1.28+"
tags:
  - "kubelet"
  - "node-management"
  - "configuration"
  - "performance"
  - "cka"
relatedRecipes:
  - "kubernetes-kubeadm-upgrade-guide"
  - "kubernetes-resource-quota-limitrange"
  - "debug-oom-killed"
  - "kubernetes-projected-volumes-guide"
  - "kubernetes-qos-classes-guide"
  - "kubernetes-kubeadm-init-guide"
---

> 💡 **Quick Answer:** Kubelet config lives at `/var/lib/kubelet/config.yaml`. Key settings: `systemReserved` (CPU/memory for OS), `kubeReserved` (for kubelet/container runtime), `evictionHard` (when to evict pods), `maxPods` (default 110). After changes: `systemctl restart kubelet`. Use `KubeletConfiguration` API object for declarative config.

## The Problem

Default kubelet settings don't fit all workloads:

- No system resource reservation → kubelet/OS can be starved
- Default eviction thresholds too aggressive or too lenient
- Image garbage collection fills disk
- Pod density limits (maxPods) too low for dense nodes
- Container log sizes unbounded

## The Solution

### KubeletConfiguration

```yaml
# /var/lib/kubelet/config.yaml
apiVersion: kubelet.config.k8s.io/v1beta1
kind: KubeletConfiguration

# Resource Reservation
systemReserved:
  cpu: 500m
  memory: 1Gi
  ephemeral-storage: 1Gi
kubeReserved:
  cpu: 500m
  memory: 1Gi
  ephemeral-storage: 1Gi
enforceNodeAllocatable:
- pods
- system-reserved
- kube-reserved

# Eviction Thresholds
evictionHard:
  memory.available: 500Mi
  nodefs.available: 10%
  imagefs.available: 15%
  nodefs.inodesFree: 5%
evictionSoft:
  memory.available: 1Gi
  nodefs.available: 15%
evictionSoftGracePeriod:
  memory.available: 1m30s
  nodefs.available: 2m
evictionMinimumReclaim:
  memory.available: 500Mi
  nodefs.available: 5%

# Pod Limits
maxPods: 250                    # Default: 110
podPidsLimit: 4096              # Max PIDs per pod

# Image Garbage Collection
imageMinimumGCAge: 2m
imageGCHighThresholdPercent: 85
imageGCLowThresholdPercent: 80

# Container Log Management
containerLogMaxSize: 50Mi
containerLogMaxFiles: 5

# Certificate Rotation
rotateCertificates: true
serverTLSBootstrap: true

# Topology Manager (for GPU/NUMA nodes)
topologyManagerPolicy: best-effort   # none|best-effort|restricted|single-numa-node

# CPU Manager
cpuManagerPolicy: static           # none|static
reservedSystemCPUs: "0-1"          # Reserve CPUs 0-1 for system
```

### Node Allocatable Calculation

```
Node Capacity (total hardware):          32 CPU, 128Gi RAM
 - systemReserved:                        0.5 CPU, 1Gi
 - kubeReserved:                          0.5 CPU, 1Gi
 - evictionHard (memory.available):       500Mi
 = Allocatable (for pods):               31 CPU, 125.5Gi

# View allocatable
kubectl describe node worker-1 | grep -A6 Allocatable
# Allocatable:
#   cpu:                31
#   memory:             125.5Gi
#   ephemeral-storage:  95Gi
#   pods:               250
```

### Node Resource Reporting

```bash
# Full node capacity and allocatable
kubectl describe node worker-1

# JSON output
kubectl get node worker-1 -o json | jq '{
  capacity: .status.capacity,
  allocatable: .status.allocatable
}'

# All nodes resource comparison
kubectl top nodes
# NAME        CPU(cores)   CPU%   MEMORY(bytes)   MEMORY%
# worker-1    12350m       39%    45120Mi         35%
# worker-2    8210m        26%    38400Mi         30%
```

### kubeadm Configuration

```yaml
# Set kubelet config during cluster init
apiVersion: kubeadm.k8s.io/v1beta3
kind: ClusterConfiguration
---
apiVersion: kubelet.config.k8s.io/v1beta1
kind: KubeletConfiguration
systemReserved:
  cpu: 500m
  memory: 1Gi
kubeReserved:
  cpu: 500m
  memory: 1Gi
evictionHard:
  memory.available: 500Mi
maxPods: 250
containerLogMaxSize: 50Mi
```

### Apply Changes

```bash
# Edit kubelet config
vim /var/lib/kubelet/config.yaml

# Restart kubelet
systemctl daemon-reload
systemctl restart kubelet

# Verify
systemctl status kubelet
kubectl describe node $(hostname) | grep -A10 Allocatable
```

## Common Issues

**Node shows NotReady after kubelet restart**

Config syntax error. Check: `journalctl -u kubelet --tail=50`. Validate YAML.

**Pods evicted unexpectedly**

Eviction thresholds too high. Check: `kubectl describe node | grep Conditions`. Adjust `evictionHard` thresholds.

**maxPods limit reached but node has resources**

Default is 110. Increase `maxPods` in kubelet config. Also check CIDR allocation — need enough pod IPs.

## Best Practices

- **Always set systemReserved + kubeReserved** — protect kubelet and OS
- **Tune eviction thresholds** for your workload — too aggressive causes churn
- **Set containerLogMaxSize** — unbounded logs fill disk
- **`cpuManagerPolicy: static`** for latency-sensitive workloads — guarantees exclusive CPUs
- **Monitor node conditions** — DiskPressure, MemoryPressure, PIDPressure indicate tuning needed

## Key Takeaways

- Kubelet config at `/var/lib/kubelet/config.yaml` controls node behavior
- Reserve resources for system (OS) and kube (kubelet/runtime) to prevent starvation
- Eviction thresholds determine when pods get evicted under resource pressure
- Container log rotation prevents disk fills
- `maxPods: 250` for dense nodes, `cpuManagerPolicy: static` for guaranteed CPUs
