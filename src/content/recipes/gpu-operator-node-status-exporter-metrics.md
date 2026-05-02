---
title: "GPU Operator Node Status Exporter Metrics"
description: "Monitor NVIDIA GPU Operator node validation with gpu_operator_node_driver_ready and status exporter metrics. Prometheus alerts for GPU node health."
publishDate: "2026-05-02"
author: "Luca Berton"
category: "observability"
difficulty: "intermediate"
timeToComplete: "15 minutes"
kubernetesVersion: "1.28+"
tags:
  - "nvidia"
  - "gpu-operator"
  - "prometheus"
  - "metrics"
  - "monitoring"
relatedRecipes:
  - "nvidia-gpu-operator-troubleshooting"
  - "gpu-feature-discovery-kubernetes"
  - "prometheus-monitoring-kubernetes-guide"
---

> 💡 **Quick Answer:** The GPU Operator node-status-exporter exposes validation metrics at `:9400/metrics`. Key metric: `gpu_operator_node_driver_ready{node="gpu-node-1"} 1` indicates the driver is ready. Monitor `gpu_operator_node_*_ready` for driver, toolkit, device-plugin, and DCGM validation states. Scrape with Prometheus ServiceMonitor and alert on `gpu_operator_node_driver_ready == 0` to catch driver failures.

## The Problem

GPU Operator manages multiple components per node (driver, toolkit, device-plugin, DCGM). When any component fails:

- Pods requesting GPUs stay Pending with no clear error
- Node labels show `nvidia.com/gpu.present=true` but `nvidia.com/gpu` allocatable is 0
- Manual `kubectl describe node` is required to diagnose
- No alerting on GPU node degradation

## The Solution

### Node Status Exporter Metrics

```bash
# The GPU Operator deploys node-status-exporter as a DaemonSet
kubectl get pods -n gpu-operator -l app=nvidia-operator-validator
# nvidia-operator-validator-xxxxx   1/1   Running   0   5m

# Check metrics endpoint
kubectl exec -n gpu-operator nvidia-operator-validator-xxxxx -- \
  curl -s localhost:9400/metrics | grep gpu_operator

# Key metrics:
# gpu_operator_node_driver_ready{node="gpu-node-1"} 1
# gpu_operator_node_container_toolkit_ready{node="gpu-node-1"} 1
# gpu_operator_node_device_plugin_ready{node="gpu-node-1"} 1
# gpu_operator_node_dcgm_ready{node="gpu-node-1"} 1
# gpu_operator_node_dcgm_exporter_ready{node="gpu-node-1"} 1
# gpu_operator_node_mig_manager_ready{node="gpu-node-1"} 1
# gpu_operator_gpu_nodes_total 4
# gpu_operator_gpu_nodes_ready 4
```

### Metrics Reference

| Metric | Values | Meaning |
|--------|--------|---------|
| `gpu_operator_node_driver_ready` | 0/1 | NVIDIA driver loaded and functional |
| `gpu_operator_node_container_toolkit_ready` | 0/1 | nvidia-container-toolkit configured |
| `gpu_operator_node_device_plugin_ready` | 0/1 | nvidia-device-plugin running |
| `gpu_operator_node_dcgm_ready` | 0/1 | DCGM daemon running |
| `gpu_operator_node_dcgm_exporter_ready` | 0/1 | DCGM exporter scraping GPU metrics |
| `gpu_operator_node_mig_manager_ready` | 0/1 | MIG manager operational (if MIG enabled) |
| `gpu_operator_gpu_nodes_total` | int | Total nodes with GPU hardware |
| `gpu_operator_gpu_nodes_ready` | int | Nodes with all validations passing |

### Prometheus ServiceMonitor

```yaml
apiVersion: monitoring.coreos.com/v1
kind: ServiceMonitor
metadata:
  name: gpu-operator-validator
  namespace: gpu-operator
  labels:
    app: gpu-operator
spec:
  selector:
    matchLabels:
      app: nvidia-operator-validator
  endpoints:
  - port: metrics
    interval: 30s
    path: /metrics
```

### Alerting Rules

```yaml
apiVersion: monitoring.coreos.com/v1
kind: PrometheusRule
metadata:
  name: gpu-operator-alerts
  namespace: gpu-operator
spec:
  groups:
  - name: gpu-operator
    rules:
    # Alert when GPU driver is not ready on any node
    - alert: GPUDriverNotReady
      expr: gpu_operator_node_driver_ready == 0
      for: 5m
      labels:
        severity: critical
      annotations:
        summary: "GPU driver not ready on {{ $labels.node }}"
        description: "NVIDIA driver validation failed for 5+ minutes. GPU workloads cannot schedule."

    # Alert when device plugin is down
    - alert: GPUDevicePluginNotReady
      expr: gpu_operator_node_device_plugin_ready == 0
      for: 5m
      labels:
        severity: critical
      annotations:
        summary: "GPU device plugin not ready on {{ $labels.node }}"

    # Alert when not all GPU nodes are ready
    - alert: GPUNodesNotFullyReady
      expr: gpu_operator_gpu_nodes_ready < gpu_operator_gpu_nodes_total
      for: 10m
      labels:
        severity: warning
      annotations:
        summary: "{{ $value }} of {{ with query \"gpu_operator_gpu_nodes_total\" }}{{ . | first | value }}{{ end }} GPU nodes ready"

    # Alert on DCGM exporter failure (metrics gap)
    - alert: DCGMExporterNotReady
      expr: gpu_operator_node_dcgm_exporter_ready == 0
      for: 5m
      labels:
        severity: warning
      annotations:
        summary: "DCGM exporter not ready on {{ $labels.node }}"
```

### Grafana Dashboard

```json
{
  "panels": [
    {
      "title": "GPU Nodes Ready",
      "type": "stat",
      "targets": [{
        "expr": "gpu_operator_gpu_nodes_ready / gpu_operator_gpu_nodes_total * 100"
      }],
      "fieldConfig": {
        "defaults": { "unit": "percent", "thresholds": { "steps": [
          {"color": "red", "value": 0},
          {"color": "yellow", "value": 80},
          {"color": "green", "value": 100}
        ]}}
      }
    },
    {
      "title": "Node Validation Status",
      "type": "table",
      "targets": [{
        "expr": "{__name__=~\"gpu_operator_node_.*_ready\"}",
        "format": "table",
        "instant": true
      }]
    }
  ]
}
```

### Troubleshoot Failed Validations

```bash
# Check which validation is failing
kubectl get pods -n gpu-operator -l app=nvidia-operator-validator -o wide
kubectl logs -n gpu-operator nvidia-operator-validator-xxxxx

# Check node labels for validation state
kubectl get node gpu-node-1 -o jsonpath='{.metadata.labels}' | jq 'with_entries(select(.key | startswith("nvidia")))'

# Key labels:
# nvidia.com/gpu.deploy.driver: "true"
# nvidia.com/gpu.deploy.container-toolkit: "true"
# nvidia.com/gpu.deploy.device-plugin: "true"
# nvidia.com/gpu.present: "true"
```

## Common Issues

**Metrics endpoint not accessible**

ServiceMonitor selector doesn't match. Check labels: `kubectl get svc -n gpu-operator --show-labels | grep validator`.

**`gpu_operator_node_driver_ready` stuck at 0**

Driver pod is in CrashLoopBackOff. Check: `kubectl logs -n gpu-operator -l app=nvidia-driver-daemonset`. Common cause: kernel version mismatch.

**Metrics show ready but GPUs not allocatable**

Device plugin is ready but failed to register with kubelet. Check: `kubectl describe node <node> | grep nvidia.com/gpu`.

## Best Practices

- **Alert on `driver_ready == 0`** as critical — no GPU workloads can run
- **Alert on `nodes_ready < nodes_total`** as warning — partial cluster degradation
- **30s scrape interval** — validation state doesn't change frequently
- **Include node label** in alerts — identifies which physical node needs attention
- **Pair with DCGM metrics** for complete GPU observability (operator health + GPU hardware)

## Key Takeaways

- GPU Operator exposes `gpu_operator_node_*_ready` metrics via node-status-exporter
- Monitor driver, toolkit, device-plugin, DCGM, and MIG manager readiness per node
- Set Prometheus alerts on `== 0` states to catch GPU node failures before users notice
- `gpu_operator_gpu_nodes_ready vs total` gives cluster-level GPU health at a glance
- Pair with DCGM Exporter metrics for hardware-level GPU monitoring
