---
draft: false
title: "ClusterPolicy MOFED Upgrade Strategy"
description: "Configure safe MOFED driver upgrade policies in the NVIDIA GPU Operator ClusterPolicy with rolling updates, node draining, and rollback procedures."
category: "configuration"
difficulty: "advanced"
timeToComplete: "20 minutes"
kubernetesVersion: "1.27+"
prerequisites:
  - "NVIDIA GPU Operator installed with MOFED enabled"
  - "ClusterPolicy configured"
  - "Multiple GPU nodes for rolling upgrades"
relatedRecipes:
  - "crossplane-infrastructure-management"
  - "scheduler-configuration-tuning"
  - "resource-quotas-namespace"
  - "resource-limits-requests"
  - "pod-resource-management"
  - "pod-mutation-injection"
  - "openshift-project-request-template"
  - "node-taints-tolerations"
  - "kustomize-configuration"
  - "kubernetes-lease-objects"
  - "kubernetes-labels-annotations"
  - "kubernetes-finalizers"
  - "kubernetes-cost-optimization"
  - "kubernetes-api-aggregation"
  - "kubeconfig-contexts"
  - "environment-variables-configmaps"
  - "gpu-operator-mofed-driver"
  - "configure-gpudirect-rdma-gpu-operator"
  - "switch-proprietary-to-open-kernel-modules"
  - "kubernetes-cluster-upgrade"
tags: ["nvidia", "gpu-operator", "mofed", "upgrades", "maintenance"]
publishDate: "2026-02-26"
updatedDate: "2026-02-26"
author: "Luca Berton"
---

> 💡 **Quick Answer:** Set `mofed.upgradePolicy.autoUpgrade: true` with `maxParallelUpgrades: 1` and drain enabled to safely roll MOFED driver updates across GPU nodes one at a time.

## The Problem

Upgrading MOFED drivers on production GPU nodes is risky — a bad driver version can take down RDMA networking across your entire cluster, breaking distributed training jobs. You need:

- **Rolling upgrades** — update one node at a time, not all at once
- **Workload drain** — move pods off the node before replacing drivers
- **Validation** — verify the new driver works before proceeding to the next node
- **Rollback** — revert if something goes wrong

## The Solution

### Step 1: Configure the Upgrade Policy

```yaml
apiVersion: nvidia.com/v1
kind: ClusterPolicy
metadata:
  name: cluster-policy
spec:
  mofed:
    enabled: true
    image: mofed
    repository: nvcr.io/nvstaging/mellanox
    version: "24.07-0.6.1.0"
    upgradePolicy:
      autoUpgrade: true
      maxParallelUpgrades: 1
      waitForCompletion:
        timeoutSeconds: 600
      drain:
        enable: true
        force: true
        podSelector: ""
        timeoutSeconds: 300
        deleteEmptyDir: true
    startupProbe:
      initialDelaySeconds: 10
      periodSeconds: 20
      failureThreshold: 30
```

### Step 2: Trigger an Upgrade

Update the MOFED version in the ClusterPolicy:

```bash
# Patch to new MOFED version
kubectl patch clusterpolicy cluster-policy --type merge -p '{
  "spec": {
    "mofed": {
      "version": "24.10-1.1.4.0"
    }
  }
}'
```

### Step 3: Monitor the Rolling Upgrade

```bash
# Watch MOFED pods restart one at a time
kubectl get pods -n gpu-operator -l app=mofed-ubuntu -w

# Check upgrade state per node
kubectl get nodes -l nvidia.com/gpu.present=true \
  -o custom-columns=\
'NAME:.metadata.name,MOFED:.metadata.annotations.nvidia\.com/mofed-driver-upgrade-state'

# Detailed logs during upgrade
kubectl logs -n gpu-operator -l app=mofed-ubuntu -f --tail=20
```

### Step 4: Validate After Upgrade

```bash
#!/bin/bash
# validate-mofed-upgrade.sh

EXPECTED_VERSION="24.10-1.1.4.0"

for node in $(kubectl get nodes -l nvidia.com/gpu.present=true -o name); do
  NODE_NAME=$(echo "$node" | cut -d/ -f2)
  POD=$(kubectl get pod -n gpu-operator -l app=mofed-ubuntu \
    --field-selector spec.nodeName="$NODE_NAME" -o jsonpath='{.items[0].metadata.name}')

  VERSION=$(kubectl exec -n gpu-operator "$POD" -- ofed_info -s 2>/dev/null | tr -d '[:space:]')
  LINK_STATE=$(kubectl exec -n gpu-operator "$POD" -- ibstat 2>/dev/null | grep "State:" | head -1)

  if [[ "$VERSION" == *"$EXPECTED_VERSION"* ]]; then
    echo "✅ $NODE_NAME: $VERSION | $LINK_STATE"
  else
    echo "❌ $NODE_NAME: $VERSION (expected $EXPECTED_VERSION)"
  fi
done
```

### Step 5: Rollback if Needed

```bash
# Revert to previous MOFED version
kubectl patch clusterpolicy cluster-policy --type merge -p '{
  "spec": {
    "mofed": {
      "version": "24.07-0.6.1.0"
    }
  }
}'

# Monitor rollback
kubectl get pods -n gpu-operator -l app=mofed-ubuntu -w
```

```mermaid
flowchart TD
    A[Update MOFED Version in ClusterPolicy] --> B[Node 1: Drain Workloads]
    B --> C[Node 1: Replace MOFED Driver]
    C --> D{Node 1: Healthy?}
    D -->|Yes| E[Node 1: Uncordon]
    D -->|No| F[Rollback to Previous Version]
    E --> G[Node 2: Drain Workloads]
    G --> H[Node 2: Replace MOFED Driver]
    H --> I{Node 2: Healthy?}
    I -->|Yes| J[Continue to Node N]
    I -->|No| F
```

## Common Issues

### Upgrade Stuck on Drain

Pods with PodDisruptionBudgets may block drain:

```bash
# Force drain with PDB override
kubectl patch clusterpolicy cluster-policy --type merge -p '{
  "spec": {
    "mofed": {
      "upgradePolicy": {
        "drain": {
          "force": true,
          "deleteEmptyDir": true
        }
      }
    }
  }
}'
```

### Timeout During Driver Compilation

Large kernels or slow nodes may need longer startup probes:

```yaml
startupProbe:
  initialDelaySeconds: 30
  periodSeconds: 30
  failureThreshold: 60  # 30 minutes total
```

## Best Practices

- **Always set `maxParallelUpgrades: 1`** in production — never upgrade all nodes simultaneously
- **Test in staging first** — validate the new MOFED version with your workloads before production
- **Enable drain** — workloads should be evacuated before driver replacement
- **Monitor `ibstat` after each node** — verify link state returns to Active
- **Keep the previous version documented** — for quick rollback reference
- **Schedule upgrades during maintenance windows** — even rolling upgrades cause brief disruptions

## Key Takeaways

- The GPU Operator handles MOFED rolling upgrades automatically via the ClusterPolicy `upgradePolicy`
- Set `maxParallelUpgrades: 1` and enable drain for safe production upgrades
- Validate each node with `ofed_info -s` and `ibstat` after the upgrade
- Rollback by simply reverting the version string in the ClusterPolicy
