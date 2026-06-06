---
title: "NVIDIA Network Operator NicClusterPolicy"
description: "Deploy NVIDIA Network Operator on OpenShift with NicClusterPolicy for DOCA telemetry, NIC feature discovery, RDMA IPAM, and OFED drivers. GitOps-managed"
tags:
  - "nvidia"
  - "network-operator"
  - "rdma"
  - "mellanox"
  - "openshift"
category: "networking"
publishDate: "2026-05-05"
author: "Luca Berton"
difficulty: "advanced"
relatedRecipes:
  - "nvidia-gpu-operator-gitops-openshift"
  - "runai-distributed-training-openshift"
  - "validate-gpu-topology-nccl"
  - "multi-node-training-kubernetes"
---

> 💡 **Quick Answer:** The NVIDIA Network Operator manages Mellanox NIC infrastructure via a `NicClusterPolicy` CRD. It deploys DOCA telemetry, NIC Feature Discovery, NV-IPAM for RDMA networking, and precompiled OFED drivers — all GitOps-managed via ArgoCD on OpenShift.

## The Problem

Multi-node GPU training requires high-bandwidth RDMA networking (InfiniBand or RoCE). Managing the full Mellanox NIC stack involves:

- OFED driver installation on every node
- NIC feature discovery (ConnectX model, firmware, capabilities)
- DOCA telemetry for NIC-level metrics
- IPAM for SR-IOV Virtual Functions
- Keeping everything consistent across upgrades

## The Solution

### NicClusterPolicy Custom Resource

```yaml
apiVersion: mellanox.com/v1alpha1
kind: NicClusterPolicy
metadata:
  name: nic-cluster-policy
  annotations:
    argocd.argoproj.io/tracking-id: "nvidia-network-operator:mellanox.com/NicClusterPolicy:nvidia-network-operator/nic-cluster-policy"
spec:
  # --- DOCA Telemetry Service ---
  # Collects NIC-level metrics (bandwidth, errors, counters)
  docaTelemetryService:
    image: doca_telemetry
    imagePullSecrets: []
    repository: nvcr.io/nvidia/doca
    version: "sha256:13c2a2d055e501c03c6451413b85476ceafbc2fbffc7443952294c196f3f89f3"

  # --- NIC Feature Discovery ---
  # Labels nodes with NIC capabilities (link speed, RDMA support, FW version)
  nicFeatureDiscovery:
    image: nic-feature-discovery
    imagePullSecrets: []
    repository: nvcr.io/nvidia/mellanox
    version: "sha256:1330e3a7ea2491bc310bfc4766769389ceb56d050831bf9c145b7bfb6aba36c4"

  # --- NV-IPAM (IP Address Management for RDMA) ---
  nvIpam:
    enableWebhook: false
    image: nvidia-k8s-ipam
    imagePullSecrets: []
    repository: nvcr.io/nvidia/mellanox
    version: network-operator-v25.10.0

  # --- OFED Driver ---
  ofedDriver:
    imagePullSecrets: []
    readinessProbe:
      initialDelaySeconds: 10
      periodSeconds: 30
    forcePrecompiled: true
    terminationGracePeriodSeconds: 300
```

### Key Components Explained

| Component | Image | Purpose |
|-----------|-------|---------|
| `docaTelemetryService` | `nvcr.io/nvidia/doca` | NIC-level telemetry (bandwidth, packet counters, errors) |
| `nicFeatureDiscovery` | `nvcr.io/nvidia/mellanox` | Labels nodes with NIC capabilities for scheduling |
| `nvIpam` | `nvidia-k8s-ipam` | IP address management for SR-IOV/RDMA interfaces |
| `ofedDriver` | (from node OS) | Mellanox OFED kernel drivers for RDMA |

### OFED Driver Settings

```yaml
ofedDriver:
  # Use precompiled drivers (faster than compiling on each node)
  forcePrecompiled: true
  
  # Allow 300s for driver unload during upgrades
  terminationGracePeriodSeconds: 300
  
  # Health check: driver loaded and NIC operational
  readinessProbe:
    initialDelaySeconds: 10    # Wait 10s after Pod starts
    periodSeconds: 30          # Check every 30s
```

### NIC Feature Discovery Labels

After NIC Feature Discovery runs, nodes get labels like:

```bash
# Check NIC labels on a node
oc get node <gpu-node> -o json | jq '.metadata.labels | with_entries(select(.key | startswith("network.nvidia.com")))'

# Example labels:
# network.nvidia.com/nic-feature-discovery.present: "true"
# network.nvidia.com/nic.mlx5_0.link-speed: "200Gbps"
# network.nvidia.com/nic.mlx5_0.rdma-capable: "true"
# network.nvidia.com/nic.mlx5_0.fw-version: "28.42.1000"
# network.nvidia.com/nic.mlx5_0.device-id: "ConnectX-7"
```

### DOCA Telemetry Metrics

```text
# DOCA telemetry exposes NIC counters:
doca_nic_rx_bytes_total         — Total bytes received
doca_nic_tx_bytes_total         — Total bytes transmitted
doca_nic_rx_packets_total       — Total packets received
doca_nic_tx_packets_total       — Total packets transmitted
doca_nic_rx_errors_total        — Receive errors
doca_nic_tx_errors_total        — Transmit errors
doca_nic_rx_drop_total          — Dropped receive packets
doca_nic_link_state             — Link up/down status
doca_nic_port_temperature       — NIC port temperature
```

### Integration with GPU Operator

```text
GPU Operator (ClusterPolicy)          Network Operator (NicClusterPolicy)
├── nvidia-driver                      ├── ofed-driver
├── device-plugin                      ├── nic-feature-discovery
├── gpu-feature-discovery              ├── doca-telemetry
├── dcgm-exporter                      ├── nv-ipam
├── mig-manager                        └── sriov-network-operator (optional)
└── toolkit

Together they enable:
  GPU compute + RDMA networking = Multi-node distributed training
```

### Verify Network Operator Health

```bash
# Check NicClusterPolicy status
oc get nicclusterpolicy nic-cluster-policy -o jsonpath='{.status.state}'
# Expected: "ready"

# Check all Network Operator Pods
oc get pods -n nvidia-network-operator

# Verify OFED driver loaded
oc debug node/<gpu-node> -- chroot /host ofed_info -s
# Expected: "MLNX_OFED_LINUX-25.10-..."

# Check NIC status
oc debug node/<gpu-node> -- chroot /host ibstat
# Expected: State: Active, Rate: 200 Gb/sec

# Verify RDMA device available
oc debug node/<gpu-node> -- chroot /host rdma link show
```

### ArgoCD GitOps Structure

```text
gitops/
├── resources/
│   ├── nvidia-gpu-operator/
│   │   └── base/
│   │       └── cluster-policy.yaml
│   └── nvidia-network-operator/
│       └── base/
│           ├── nic-cluster-policy.yaml
│           └── kustomization.yaml
└── applications/
    ├── nvidia-gpu-operator.yaml
    └── nvidia-network-operator.yaml
```

## Common Issues

### OFED driver Pod stuck in Init
- **Cause**: Precompiled driver not available for current kernel
- **Fix**: Set `forcePrecompiled: false` to compile on-node (slower but always works)

### NIC Feature Discovery not labeling nodes
- **Cause**: DaemonSet not scheduling (missing tolerations)
- **Fix**: Ensure NicClusterPolicy has tolerations matching GPU node taints

### DOCA telemetry high memory usage
- **Cause**: Large number of VFs or counters with high cardinality
- **Fix**: Configure telemetry collection interval or filter specific counters

### Network Operator version mismatch with GPU Operator
- **Cause**: OFED version incompatible with NVIDIA driver
- **Fix**: Check NVIDIA compatibility matrix; pin both to tested versions

## Best Practices

1. **Pin images by SHA256** — reproducible deployments, no surprise tag updates
2. **`forcePrecompiled: true`** — faster rollouts (no compile step per node)
3. **`terminationGracePeriodSeconds: 300`** — allow OFED to cleanly unload
4. **GitOps both operators together** — GPU and Network operators must be version-compatible
5. **Monitor DOCA telemetry** — NIC errors indicate fabric issues before they affect training
6. **Version `network-operator-v25.10.0`** — match NV-IPAM to network operator release

## Key Takeaways

- `NicClusterPolicy` is the single CRD managing all Mellanox NIC infrastructure
- DOCA telemetry provides NIC-level metrics (bandwidth, errors, temperature)
- NIC Feature Discovery labels nodes for RDMA-aware scheduling
- NV-IPAM manages IPs for SR-IOV Virtual Functions
- OFED driver with `forcePrecompiled: true` speeds up node provisioning
- ArgoCD manages both GPU Operator and Network Operator for consistent infrastructure
- Pin images by SHA256 digest for reproducible production deployments
