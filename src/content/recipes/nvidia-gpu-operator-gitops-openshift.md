---
title: "NVIDIA GPU Operator GitOps on OpenShift"
description: "Deploy NVIDIA GPU Operator on OpenShift via GitOps with ArgoCD. Covers ClusterPolicy configuration, DCGM exporter, drain settings, tolerations, and rolling"
tags:
  - "nvidia"
  - "gpu-operator"
  - "openshift"
  - "gitops"
  - "argocd"
category: "ai"
publishDate: "2026-05-05"
author: "Luca Berton"
difficulty: "advanced"
relatedRecipes:
  - "nvidia-gpu-operator-setup"
  - "runai-observability-opentelemetry-openshift"
  - "openshift-nvidia-mig-reconfiguration"
  - "nvidia-gpu-feature-discovery-kubernetes"
---

> 💡 **Quick Answer:** Deploy the NVIDIA GPU Operator via ArgoCD GitOps using a ClusterPolicy custom resource. Key settings: `maxParallelUpgrades: 1`, `maxUnavailable: 25%`, drain with `timeoutSeconds: 300`, DCGM exporter with ServiceMonitor, and tolerations for `nvidia-gpu-only` NoSchedule taint.

## The Problem

Managing GPU infrastructure on OpenShift at scale requires:

- Consistent configuration across multiple clusters
- Controlled rolling upgrades (can't take all GPU nodes offline)
- DCGM metrics export to Prometheus/ServiceMonitor
- Proper drain behavior before driver upgrades
- GitOps reconciliation for audit and rollback

## The Solution

### ClusterPolicy GitOps Configuration

```yaml
# gitops/resources/nvidia-gpu-operator/base/cluster-policy.yaml
apiVersion: nvidia.com/v1
kind: ClusterPolicy
metadata:
  name: gpu-cluster-policy
spec:
  operator:
    defaultRuntime: crio
    use_ocp_driver_toolkit: true

  driver:
    enabled: true
    upgradePolicy:
      autoUpgrade: true
      drain:
        deleteEmptyDir: true
        enable: true
        force: true
        timeoutSeconds: 300
      maxParallelUpgrades: 1
      maxUnavailable: 25%
      podDeletion:
        deleteEmptyDir: true
        force: true
        timeoutSeconds: 300
      waitForCompletion:
        timeoutSeconds: 0
    repoConfig:
      configMapName: ""
    certConfig:
      name: ""
    licensingConfig:
      nlsEnabled: false
      configMapName: ""
    virtualTopology:
      config: ""
    kernelModuleConfig:
      name: ""

  dcgmExporter:
    enabled: true
    serviceMonitor:
      enabled: true
  
  dcgm:
    enabled: true

  daemonsets:
    updateStrategy: RollingUpdate
    rollingUpdate:
      maxUnavailable: "1"
    tolerations:
      - effect: NoSchedule
        key: nvidia-gpu-only

  devicePlugin:
    enabled: true

  gfd:
    enabled: true

  migManager:
    enabled: true

  toolkit:
    enabled: true

  validator:
    plugin:
      env:
        - name: WITH_WORKLOAD
          value: "false"
```

### ArgoCD Application

```yaml
# gitops/applications/nvidia-gpu-operator.yaml
apiVersion: argoproj.io/v1alpha1
kind: Application
metadata:
  name: nvidia-gpu-operator
  namespace: openshift-gitops
spec:
  project: infrastructure
  source:
    repoURL: https://git.example.com/platform/gitops.git
    path: resources/nvidia-gpu-operator/base
    targetRevision: main
  destination:
    server: https://kubernetes.default.svc
    namespace: nvidia-gpu-operator
  syncPolicy:
    automated:
      prune: true
      selfHeal: true
    syncOptions:
      - CreateNamespace=true
      - ServerSideApply=true
```

### Key Settings Explained

| Setting | Value | Why |
|---------|-------|-----|
| `maxParallelUpgrades` | 1 | Only upgrade one node at a time (protect GPU capacity) |
| `maxUnavailable` | 25% | No more than 25% of GPU nodes offline during DaemonSet update |
| `drain.timeoutSeconds` | 300 | Wait up to 5 min for workloads to evacuate before force |
| `drain.force` | true | Force drain even with non-replicated Pods |
| `drain.deleteEmptyDir` | true | Allow eviction of Pods with emptyDir volumes |
| `podDeletion.force` | true | Force-delete Pods that won't evict gracefully |
| `waitForCompletion.timeoutSeconds` | 0 | Don't wait for Jobs to complete during drain |
| `dcgmExporter.serviceMonitor` | true | Auto-create ServiceMonitor for Prometheus discovery |
| `tolerations: nvidia-gpu-only` | NoSchedule | DaemonSets run on tainted GPU-only nodes |

### Kustomize Overlay for Multiple Clusters

```yaml
# gitops/resources/nvidia-gpu-operator/overlays/production/kustomization.yaml
apiVersion: kustomize.config.k8s.io/v1beta1
kind: Kustomization
resources:
  - ../../base
patches:
  - target:
      kind: ClusterPolicy
      name: gpu-cluster-policy
    patch: |
      - op: replace
        path: /spec/driver/upgradePolicy/maxParallelUpgrades
        value: 2
      - op: replace
        path: /spec/driver/upgradePolicy/maxUnavailable
        value: "10%"
```

### Run:ai Backend Components (Terminal Output)

The GPU Operator coexists with Run:ai backend services:

```bash
# Typical runai-backend namespace Pods:
oc get pods -n runai-backend

# NAME                                              READY   STATUS
# nodepool-controller-69db9bc8-h2wxw                1/1     Running
# runai-backend-frontend-78b56b867d-bjt9f           1/1     Running
# runai-backend-grafana-5dfc66bl64-lp15b            2/2     Running
# runai-backend-identity-manager-85c454db4f-w29kj   1/1     Running
# runai-backend-identity-manager-reconciler-ugbp4   1/1     Running
# runai-backend-k8s-objects-tracker-85fbf40746-dpb2f 1/1    Running
# runai-backend-metric-stores-migrator-lm5lr        0/1     Completed
# runai-backend-metrics-service-b67fdff46-446vm     1/1     Running
# runai-backend-nats-0                              1/1     Running
# runai-backend-nats-1                              1/1     Running
```

### Monitoring GPU Operator Health

```bash
# Check ClusterPolicy status
oc get clusterpolicy gpu-cluster-policy -o jsonpath='{.status.state}'
# Expected: "ready"

# Check all GPU Operator DaemonSets
oc get ds -n nvidia-gpu-operator

# Verify DCGM exporter metrics
oc exec -n nvidia-gpu-operator ds/nvidia-dcgm-exporter -- \
  curl -s localhost:9400/metrics | head -20

# Check ServiceMonitor was created
oc get servicemonitor -n nvidia-gpu-operator
```

### Upgrade Strategy

```text
Driver upgrade flow (maxParallelUpgrades=1):

1. Cordon GPU node #1
2. Drain with 300s timeout (force=true)
3. Upgrade driver Pod on node #1
4. Validate GPU (nvidia-smi test)
5. Uncordon node #1
6. Move to node #2 (sequential)

Total fleet upgrade time: N_nodes × (~10 min per node)
```

## Common Issues

### Driver upgrade stuck — Pod won't evict
- **Cause**: PDB blocks eviction or Pod has `terminationGracePeriodSeconds` > drain timeout
- **Fix**: `podDeletion.force: true` with `timeoutSeconds: 300` handles this

### DCGM exporter not scraped by Prometheus
- **Cause**: ServiceMonitor label selector doesn't match Prometheus operator
- **Fix**: Verify `oc get servicemonitor -n nvidia-gpu-operator -o yaml` labels match Prometheus `serviceMonitorSelector`

### DaemonSets not scheduling on GPU nodes
- **Cause**: GPU nodes have `nvidia-gpu-only` taint but DaemonSet missing toleration
- **Fix**: Add `tolerations` in ClusterPolicy `daemonsets` section

## Best Practices

1. **`maxParallelUpgrades: 1`** — safest for production; increase only if you have spare GPU capacity
2. **GitOps for ClusterPolicy** — audit trail, rollback, multi-cluster consistency
3. **ServiceMonitor for DCGM** — automatic Prometheus discovery, no manual scrape config
4. **Tolerations on all DaemonSets** — ensures GPU Operator components run on tainted nodes
5. **Separate overlays per environment** — production stricter (10% maxUnavailable), staging looser

## Key Takeaways

- GPU Operator ClusterPolicy is the single config for all NVIDIA components
- GitOps via ArgoCD ensures consistent GPU infrastructure across clusters
- Rolling upgrades with `maxParallelUpgrades: 1` protect GPU capacity
- DCGM exporter + ServiceMonitor = automatic GPU metrics in Prometheus
- Drain settings (300s timeout, force) handle stubborn workloads during upgrades
- Tolerations ensure DaemonSets schedule on dedicated GPU nodes
