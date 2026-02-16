---
draft: false
title: "Enable NIC Feature Discovery in NVIDIA Network Operator"
description: "Enable NIC Feature Discovery through NicClusterPolicy and verify node labels used by SR-IOV and RDMA workflows."
category: "networking"
difficulty: "intermediate"
timeToComplete: "20 minutes"
kubernetesVersion: "1.28+"
prerequisites:
  - "OpenShift or Kubernetes cluster with NVIDIA Network Operator installed"
  - "kubectl or oc CLI access"
  - "A NicClusterPolicy resource"
relatedRecipes:
  - "check-bonding-and-interface-status"
  - "openshift-sriov-vf-creation"
  - "troubleshoot-no-supported-nic-selected"
tags:
  - "nvidia"
  - "network-operator"
  - "nic-feature-discovery"
  - "sriov"
  - "rdma"
publishDate: "2026-02-16"
author: "Luca Berton"
---

> 💡 **Quick Answer:** Enable NIC Feature Discovery by adding `spec.nicFeatureDiscovery.enabled: true` in `NicClusterPolicy`, then verify the daemon runs and node labels are present with `oc get node --show-labels`.

# Enable NIC Feature Discovery in NVIDIA Network Operator

NIC Feature Discovery adds hardware capability labels to nodes so scheduling and network policies can target compatible hosts.

## Enable in `NicClusterPolicy`

```yaml
apiVersion: mellanox.com/v1alpha1
kind: NicClusterPolicy
metadata:
  name: nic-cluster-policy
spec:
  nicFeatureDiscovery:
    enabled: true
    repository: nvcr.io/nvidia/mellanox
    image: nic-feature-discovery
    version: network-operator-v25.10.0
```

Apply it:

```bash
oc apply -f nic-cluster-policy.yaml
```

## Verify DaemonSet and Pods

```bash
oc -n nvidia-network-operator get ds | grep -i feature
oc -n nvidia-network-operator get pods -o wide | grep -i nic-feature
```

## Verify Labels on Nodes

```bash
oc get node -o json | jq '.items[].metadata.labels'
```

Look for labels like:

- `feature.node.kubernetes.io/pci-15b3.present=true`
- `feature.node.kubernetes.io/pci-15b3.sriov.capable=true`
- `feature.node.kubernetes.io/rdma.capable=true`

## Troubleshooting

- No daemonset created: confirm `nicFeatureDiscovery.enabled: true` is set under `spec`.
- No new labels: verify pods are running on target worker nodes.
- Labels exist but scheduling fails: validate node selectors in your SR-IOV and workload manifests.
