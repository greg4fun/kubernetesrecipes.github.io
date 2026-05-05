---
title: "OpenShift GPU Node Resource Planning"
description: "Plan CPU, memory, and overhead budgets for GPU nodes running NVIDIA GPU Operator, Network Operator, Run:ai, and OpenShift infrastructure Pods. Understand what consumes resources before your AI workloads even start."
tags:
  - "openshift"
  - "gpu"
  - "capacity-planning"
  - "resource-management"
  - "nvidia"
category: "ai"
publishDate: "2026-05-05"
author: "Luca Berton"
difficulty: "advanced"
relatedRecipes:
  - "nvidia-gpu-operator-gitops-openshift"
  - "nvidia-network-operator-nicclusterpolicy"
  - "runai-observability-opentelemetry-openshift"
  - "kubernetes-resource-quota-limitrange"
---

> 💡 **Quick Answer:** A typical OpenShift GPU node runs 40+ infrastructure Pods before any AI workload starts. These consume ~4-8 GB RAM and ~2-4 CPU cores of overhead. Plan node sizing accordingly — a 192-core / 1.5TB RAM node may only have ~180 cores and ~1.4TB available for training.

## The Problem

GPU nodes aren't just GPUs. Each node runs a stack of infrastructure:

- NVIDIA GPU Operator (5 Pods)
- NVIDIA Network Operator (4-5 Pods)
- OpenShift platform (15+ Pods)
- Run:ai scheduler and exporters (5+ Pods)
- Monitoring and networking (10+ Pods)

Understanding this overhead is critical for capacity planning.

## The Solution

### Typical GPU Node Pod Inventory

```text
NAMESPACE                         POD                                    CPU REQ    MEM REQ    MEM LIMIT
─────────────────────────────────────────────────────────────────────────────────────────────────────────
# NVIDIA GPU Operator (5 Pods)
nvidia-gpu-operator               nvidia-device-plugin-daemonset         0          0          0
nvidia-gpu-operator               nvidia-driver-daemonset                0          0          0
nvidia-gpu-operator               nvidia-mig-manager                     0          0          0
nvidia-gpu-operator               nvidia-node-status-exporter            0          0          0
nvidia-gpu-operator               nvidia-operator-validator              0          0          0

# NVIDIA Network Operator (4 Pods)
nvidia-network-operator           mofed-rhel9.6-ds                       0          0          0
nvidia-network-operator           network-operator-sriov-device-plugin   0          0          0
nvidia-network-operator           nic-feature-discovery-ds               0          0          0
nvidia-network-operator           nv-ipam-node                           100m       300m       150Mi

# OpenShift Cluster Node Tuning
openshift-cluster-node-tuning     tuned                                  10m        0          0

# OpenShift DNS (2 Pods)
openshift-dns                     dns-default                            0          0          0
openshift-dns                     node-resolver                          60m        0          110Mi

# OpenShift Image Registry
openshift-image-registry          node-ca                                5m         0          0

# OpenShift Ingress
openshift-ingress-canary          ingress-canary                         10m        0          0

# OpenShift Insights
openshift-insights                insights-runtime-extractor             10m        0          0

# OpenShift KNI Infra (HA/Networking)
openshift-kni-infra               coredns-node                           0          0          0
openshift-kni-infra               keepalived-node                        30m (0%)   0          0

# OpenShift Kube Storage Version Migrator
openshift-kube-storage-version    migrator                               20m (0%)   0          0

# OpenShift Machine Config
openshift-machine-config-operator kube-rbac-proxy-crio                   1m         0          0
openshift-machine-config-operator machine-config-daemon                  20m        0          50Mi

# OpenShift Monitoring
openshift-monitoring              node-exporter                          4m (0%)    0          0

# OpenShift Multus (3 Pods)
openshift-multus                  multus-additional-cni-plugins          10m        0          0
openshift-multus                  multus-kube                            10m        0          0
openshift-multus                  network-metrics-daemon                 20m (0%)   0          0

# OpenShift Network Diagnostics
openshift-network-diagnostics     network-check-target                   10m (0%)   0          120Mi

# OpenShift Network Operator
openshift-network-operator        iptables-alerter                       10m (0%)   10m (0%)   0

# OpenShift NFD
openshift-nfd                     nfd-worker                             10m        0          65Mi

# OpenShift NMState
openshift-nmstate                 nmstate-handler                        0 (0%)     0          0

# OpenShift OVN Kubernetes
openshift-ovn-kubernetes          ovnkube-node                           100m       500m       100Mi

# OpenShift SR-IOV (2 Pods)
openshift-sriov-network-operator  sriov-device-plugin                    80m (0%)   0          1634Mi
openshift-sriov-network-operator  sriov-network-config-daemon            10m        0          54Mi

# RHACS (Security)
rhacs-operator                    collector                              10m        0          0

# Run:ai Backend (6+ Pods)
runai-backend                     runai-backend-catalog-service          7m (0%)    275m (1%)  340Mi
runai-backend                     runai-backend-cluster-service          70m        200m       500m
runai-backend                     runai-backend-frontend                 15m        0          500m
runai-backend                     runai-backend-metrics-service          25m        0          500m
runai-backend                     runai-backend-org-unit-service         25m        0          500m
runai-backend                     runai-container-toolkit                250m       500m (0%)  256Mi

# Run:ai (Node-Level)
runai                             runai-node-exporter                    0 (0%)     1500m (0%) 2G1 (0%)
runai                             runai-runtime-installer                10m        0          0
```

### Resource Overhead Summary

```text
Category                     CPU Requests   Memory Requests   Memory Limits
─────────────────────────────────────────────────────────────────────────────
NVIDIA GPU Operator          ~0             ~0                ~0
NVIDIA Network Operator      ~200m          ~500m             ~300Mi
OpenShift Platform           ~400m          ~1Gi              ~2Gi
Run:ai                       ~400m          ~3Gi              ~5Gi
Monitoring/Networking        ~200m          ~500m             ~2Gi
─────────────────────────────────────────────────────────────────────────────
TOTAL OVERHEAD               ~1.2 cores     ~5 Gi             ~9 Gi
```

### Node Sizing Formula

```text
Available for AI workloads = Node Total - System Reserved - Infra Overhead

Example: 192-core / 1.5 TiB node
  System reserved (kubelet):    2 cores,    16 Gi
  Infra Pod overhead:           1.2 cores,  5 Gi
  Available for training:       ~188 cores, ~1.48 TiB

For GPU memory: Full GPU memory is available (infra Pods don't request GPU)
  8× H100 80GB = 640 GB GPU memory, all for AI workloads
```

### Monitor Actual Usage

```bash
# Per-node resource consumption (all Pods)
oc adm top pods --all-namespaces --sort-by=memory | head -30

# Node allocatable vs capacity
oc get node <gpu-node> -o json | jq '{
  capacity: .status.capacity,
  allocatable: .status.allocatable
}'

# What's actually being used (live)
oc adm top node <gpu-node>

# Breakdown by namespace
oc adm top pods -A --no-headers | \
  awk '{ns=$1; cpu+=$3; mem+=$4} END {print ns, cpu"m", mem"Mi"}'
```

### Overcommitment Warning

```text
⚠️  "Total limits may be over 100 percent, i.e., Overcommitted."

This is normal for GPU nodes. Infrastructure Pods set low requests
but may burst. Key is:
- Requests = guaranteed minimum (used for scheduling)
- Limits = maximum allowed (OOM-killed if exceeded)

If sum(requests) < node allocatable → scheduling works fine
If sum(actual usage) > allocatable → OOM kills start
```

### Right-Sizing Infrastructure Pods

```yaml
# Run:ai node exporter is the heaviest infra Pod
# Requests: 1500m CPU, 2Gi memory
# If GPU metrics are critical, keep these limits

# SR-IOV device plugin also significant
# Memory limit: 1634Mi (manages VF allocation state)

# For nodes with limited memory (e.g., 512Gi total):
# Consider reducing monitoring Pod limits
# or moving non-essential services to infra nodes
```

## Common Issues

### AI workload pending — "Insufficient memory"
- **Cause**: Infra Pod requests + AI workload requests > allocatable
- **Fix**: Account for ~5Gi infra overhead; request slightly less than full node memory

### Node eviction due to memory pressure
- **Cause**: Infra Pods exceeding limits during spikes
- **Fix**: Set `system-reserved` in kubelet config; use `eviction-hard` thresholds

### SR-IOV device plugin using 1.6Gi
- **Cause**: Normal for managing many VFs (64+ per NIC)
- **Fix**: Expected behavior; factor into capacity planning

## Best Practices

1. **Account for ~5Gi RAM overhead** on every GPU node for infra
2. **Set `system-reserved`** in kubelet to protect against workload starvation
3. **Monitor infra Pod growth** — new operators add overhead silently
4. **GPU memory is unaffected** — infra Pods use CPU/RAM only
5. **Run:ai exporter is heavy** (2Gi) — it collects per-GPU per-Pod metrics
6. **Use dedicated infra nodes** for Run:ai backend (frontend, catalog, cluster-service)

## Key Takeaways

- 40+ infra Pods run on each GPU node consuming ~1.2 cores and ~5Gi RAM
- GPU memory (H100/A100) is fully available — infra Pods don't request GPUs
- Overcommitment warnings are normal — requests matter for scheduling
- Plan node RAM as: `Total - 16Gi system - 5Gi infra = available for training`
- Run:ai node-exporter and SR-IOV plugin are the heaviest per-node infra Pods
- Monitor with `oc adm top` to catch infra Pod memory creep over time
