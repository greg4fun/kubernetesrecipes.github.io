---
title: "NVIDIA CNS with Insight Operator for Network Diagnostics"
description: "Deploy NVIDIA Cloud-Native Stack (CNS) with the Insight Operator and NVIDIA Insight tools for deep GPU fabric diagnostics. Collect NIC firmware health, link quality, topology discovery, and cable diagnostics across Kubernetes GPU clusters."
tags:
  - "nvidia"
  - "cns"
  - "insight"
  - "networking"
  - "diagnostics"
  - "observability"
category: "observability"
publishDate: "2026-05-22"
author: "Luca Berton"
difficulty: "advanced"
relatedRecipes:
  - "nvidia-doca-telemetry-network-monitoring-kubernetes"
  - "nvidia-network-operator-kubernetes"
  - "dcgm-exporter-gpu-metrics-prometheus"
  - "enable-pfc-mellanox-connectx-rdma"
---

> 💡 **Quick Answer:** NVIDIA Cloud-Native Stack (CNS) bundles the GPU Operator, Network Operator, and Insight tools into a validated deployment. The Insight Operator adds deep NIC/switch diagnostics — firmware health checks, link quality monitoring, cable testing, and topology discovery — beyond what standard telemetry provides.

## The Problem

- Standard monitoring shows counters but not root causes (why is the link degraded?)
- Firmware bugs, cable degradation, and transceiver aging cause intermittent NCCL failures
- No visibility into switch-to-NIC negotiation issues or speed downgrades
- Need proactive diagnostics — detect problems before training jobs fail
- Large GPU clusters have hundreds of links; manual `mlxlink` checks don't scale

## The Solution

### NVIDIA Cloud-Native Stack (CNS) Components

```text
NVIDIA Cloud-Native Stack (CNS)
├── GPU Operator           ← GPU drivers, device plugin, DCGM, MIG
├── Network Operator       ← RDMA, SR-IOV, Multus, NIC drivers
└── Insight Tools          ← Diagnostics, health, topology
    ├── NIC Health Agent   ← Firmware checks, self-test
    ├── Link Monitor       ← Signal quality, BER, FEC rates
    ├── Cable Diagnostics  ← TDR testing, transceiver health
    └── Topology Discovery ← Fabric map, path validation
```

### Deploy CNS with Insight Operator

```yaml
# NicClusterPolicy with Insight tools enabled
apiVersion: mellanox.com/v1alpha1
kind: NicClusterPolicy
metadata:
  name: nic-cluster-policy
spec:
  # Standard Network Operator components
  ofedDriver:
    image: doca-driver
    repository: nvcr.io/nvidia/mellanox
    version: "24.10-0.7.0.0"

  rdmaSharedDevicePlugin:
    image: k8s-rdma-shared-dev-plugin
    repository: nvcr.io/nvidia/mellanox
    version: "1.5.1"

  nvIpam:
    image: nvidia-k8s-ipam
    repository: ghcr.io/mellanox
    version: "0.3.0"

  # Insight tools — network diagnostics
  nicFeatureDiscovery:
    image: nic-feature-discovery
    repository: nvcr.io/nvidia/mellanox
    version: "0.1.0"

  # Enable Insight Agent for deep diagnostics
  insightAgent:
    image: insight-agent
    repository: nvcr.io/nvidia/mellanox
    version: "1.2.0"
    config:
      # Health check interval (seconds)
      healthCheckInterval: 300
      # Enable all diagnostic modules
      enableLinkMonitor: true
      enableCableDiagnostics: true
      enableFirmwareHealth: true
      enableTopologyDiscovery: true
      # Prometheus export
      metricsPort: 9091
```

### Insight Agent DaemonSet

```yaml
apiVersion: apps/v1
kind: DaemonSet
metadata:
  name: nvidia-insight-agent
  namespace: nvidia-network-operator
spec:
  selector:
    matchLabels:
      app: nvidia-insight-agent
  template:
    metadata:
      labels:
        app: nvidia-insight-agent
      annotations:
        prometheus.io/scrape: "true"
        prometheus.io/port: "9091"
    spec:
      nodeSelector:
        feature.node.kubernetes.io/network-sriov.capable: "true"
      tolerations:
        - key: nvidia.com/gpu
          operator: Exists
          effect: NoSchedule
      hostNetwork: true
      containers:
        - name: insight-agent
          image: nvcr.io/nvidia/mellanox/insight-agent:1.2.0
          securityContext:
            privileged: true
          ports:
            - containerPort: 9091
              name: metrics
          env:
            - name: INSIGHT_HEALTH_INTERVAL
              value: "300"
            - name: INSIGHT_LINK_MONITOR_INTERVAL
              value: "60"
            - name: INSIGHT_CABLE_DIAG_INTERVAL
              value: "3600"
            - name: INSIGHT_LOG_LEVEL
              value: "info"
          volumeMounts:
            - name: sys
              mountPath: /sys
            - name: dev
              mountPath: /dev
            - name: mst
              mountPath: /dev/mst
          resources:
            requests:
              cpu: "100m"
              memory: "256Mi"
            limits:
              cpu: "500m"
              memory: "512Mi"
      volumes:
        - name: sys
          hostPath:
            path: /sys
        - name: dev
          hostPath:
            path: /dev
        - name: mst
          hostPath:
            path: /dev/mst
```

### NIC Health Diagnostics

```bash
# Run NIC self-test (mlxlink-based)
kubectl exec -n nvidia-network-operator ds/nvidia-insight-agent -- \
  insight-cli nic-health --device mlx5_0

# Output:
# Device: mlx5_0 (ConnectX-7)
# ────────────────────────────────────────────
# Firmware Version:    28.42.1000 ✅
# Firmware Status:     Valid
# PCI Link Speed:      Gen5 x16 (64 GT/s) ✅
# PCI Width:           x16 (no degradation) ✅
# Temperature:         52°C (max 105°C) ✅
# Link Speed:          400 Gb/s (NDR) ✅
# Physical Link:       Up
# Logical Link:        Up
# FEC Mode:            RS-FEC (544,514) ✅
# Eye Opening:         Good (margin: 42%)
# Self-Test:           PASSED ✅

# Batch health check across all nodes
kubectl get pods -n nvidia-network-operator -l app=nvidia-insight-agent \
  -o jsonpath='{range .items[*]}{.spec.nodeName}{"\n"}{end}' | \
  while read node; do
    echo "=== $node ==="
    kubectl exec -n nvidia-network-operator \
      $(kubectl get pod -n nvidia-network-operator -l app=nvidia-insight-agent \
        --field-selector spec.nodeName=$node -o name) -- \
      insight-cli nic-health --all --format=short
  done
```

### Link Quality Monitoring

```bash
# Real-time link quality (BER, FEC errors, eye diagram)
kubectl exec -n nvidia-network-operator ds/nvidia-insight-agent -- \
  insight-cli link-monitor --device mlx5_0 --port 1

# Output:
# Link Quality Report — mlx5_0/1
# ────────────────────────────────────────────
# Speed:                400 Gb/s (4x 106.25 GBaud)
# FEC Mode:             RS-FEC (544,514)
# FEC Corrected CW:     1,234 (rate: 2.3e-8) ✅ Normal
# FEC Uncorrected CW:   0 ✅
# Raw BER:              1.2e-12 ✅ (threshold: 1e-6)
# Effective BER:        0 (post-FEC) ✅
# Symbol Errors:        0 ✅
# Link Flaps (24h):     0 ✅
# Eye Height (mV):      38 ✅ (min: 15)
# Eye Width (ps):       12 ✅ (min: 5)
#
# Status: HEALTHY — link operating within spec

# Check for degraded links (pre-failure detection)
kubectl exec -n nvidia-network-operator ds/nvidia-insight-agent -- \
  insight-cli link-monitor --all --degraded-only

# Shows only links with:
# - FEC corrected rate > 1e-6 (high correction = cable/connector issue)
# - Eye opening < 50% margin
# - BER approaching threshold
# - Recent link flaps
```

### Cable Diagnostics (TDR)

```bash
# Time-Domain Reflectometry — finds cable faults
kubectl exec -n nvidia-network-operator ds/nvidia-insight-agent -- \
  insight-cli cable-diag --device mlx5_0 --port 1

# Output:
# Cable Diagnostics — mlx5_0/1
# ────────────────────────────────────────────
# Cable Type:           AOC (Active Optical Cable)
# Vendor:               Mellanox Technologies
# Part Number:          MFS1S00-H030V
# Serial:               MT2318FT01234
# Length:               30m
# Temperature:          42°C (max: 70°C) ✅
# TX Power (Lane 1-4):  -1.2, -1.1, -1.3, -1.2 dBm ✅
# RX Power (Lane 1-4):  -3.4, -3.2, -3.5, -3.3 dBm ✅
# Voltage:              3.28V ✅
# TDR Test:             PASSED — no faults detected
# Cable Health Score:   98/100 ✅
#
# Warnings: None

# Identify failing cables before they cause job failures
kubectl exec -n nvidia-network-operator ds/nvidia-insight-agent -- \
  insight-cli cable-diag --all --warnings-only

# Example output for degraded cable:
# ⚠️  gpu-node-07 mlx5_2/1:
#   RX Power Lane 3: -8.2 dBm (threshold: -7.0 dBm)
#   Cable Health Score: 62/100
#   Recommendation: Schedule cable replacement within 2 weeks
```

### Topology Discovery

```bash
# Discover GPU fabric topology (NIC → switch → NIC paths)
kubectl exec -n nvidia-network-operator ds/nvidia-insight-agent -- \
  insight-cli topology discover

# Output:
# GPU Fabric Topology
# ════════════════════════════════════════════
# 
# Leaf Switch: sw-leaf-01 (Quantum-2 QM9700)
# ├── Port 1  ← gpu-node-01/mlx5_0 (400G NDR) ✅
# ├── Port 2  ← gpu-node-01/mlx5_1 (400G NDR) ✅
# ├── Port 3  ← gpu-node-02/mlx5_0 (400G NDR) ✅
# ├── Port 4  ← gpu-node-02/mlx5_1 (400G NDR) ✅
# └── Uplink  → sw-spine-01 Port 33 (800G NDR)
#
# Leaf Switch: sw-leaf-02 (Quantum-2 QM9700)
# ├── Port 1  ← gpu-node-03/mlx5_0 (400G NDR) ✅
# ├── Port 2  ← gpu-node-03/mlx5_1 (400G NDR) ✅
# ├── Port 3  ← gpu-node-04/mlx5_0 (400G NDR) ✅
# ├── Port 4  ← gpu-node-04/mlx5_1 (200G HDR) ⚠️ Speed mismatch!
# └── Uplink  → sw-spine-01 Port 34 (800G NDR)

# Validate NCCL path between two nodes
kubectl exec -n nvidia-network-operator ds/nvidia-insight-agent -- \
  insight-cli topology path --src gpu-node-01 --dst gpu-node-03

# Path: gpu-node-01/mlx5_0 → sw-leaf-01:P1 → sw-spine-01:P33→P34 → sw-leaf-02:P1 → gpu-node-03/mlx5_0
# Hops: 3 (leaf-spine-leaf)
# Max bandwidth: 400 Gb/s (bottleneck: NIC speed)
# Latency estimate: ~2.1 μs
```

### Prometheus Metrics from Insight

```yaml
# Insight-specific metrics beyond standard DTS counters
# TYPE nvidia_insight_nic_health_score gauge
nvidia_insight_nic_health_score{device="mlx5_0",node="gpu-node-01"} 100

# TYPE nvidia_insight_cable_health_score gauge
nvidia_insight_cable_health_score{device="mlx5_0",port="1",node="gpu-node-01"} 98

# TYPE nvidia_insight_fec_corrected_rate gauge
nvidia_insight_fec_corrected_rate{device="mlx5_0",port="1"} 2.3e-8

# TYPE nvidia_insight_eye_height_mv gauge
nvidia_insight_eye_height_mv{device="mlx5_0",port="1"} 38

# TYPE nvidia_insight_link_flaps_total counter
nvidia_insight_link_flaps_total{device="mlx5_0",port="1"} 0

# TYPE nvidia_insight_cable_temperature_celsius gauge
nvidia_insight_cable_temperature_celsius{device="mlx5_0",port="1"} 42
```

### Alert on Degradation (Before Failure)

```yaml
apiVersion: monitoring.coreos.com/v1
kind: PrometheusRule
metadata:
  name: nvidia-insight-alerts
  namespace: nvidia-network-operator
spec:
  groups:
    - name: gpu-fabric-health
      rules:
        - alert: NICHealthDegraded
          expr: nvidia_insight_nic_health_score < 80
          for: 5m
          labels:
            severity: warning
          annotations:
            summary: "NIC health degraded on {{ $labels.node }} {{ $labels.device }}"
            description: "Health score {{ $value }}/100 — run insight-cli nic-health for details."

        - alert: CableHealthCritical
          expr: nvidia_insight_cable_health_score < 70
          for: 5m
          labels:
            severity: warning
          annotations:
            summary: "Cable degrading on {{ $labels.node }} {{ $labels.device }}/{{ $labels.port }}"
            description: "Score {{ $value }}/100 — schedule replacement."

        - alert: HighFECCorrectionRate
          expr: nvidia_insight_fec_corrected_rate > 1e-6
          for: 10m
          labels:
            severity: warning
          annotations:
            summary: "High FEC correction rate on {{ $labels.device }}"
            description: "Rate {{ $value }} — cable/connector degradation likely."

        - alert: LinkFlap
          expr: increase(nvidia_insight_link_flaps_total[1h]) > 0
          labels:
            severity: critical
          annotations:
            summary: "Link flap detected on {{ $labels.node }} {{ $labels.device }}"
            description: "Unstable link — NCCL jobs will experience failures."

        - alert: EyeOpeningLow
          expr: nvidia_insight_eye_height_mv < 20
          for: 5m
          labels:
            severity: warning
          annotations:
            summary: "Low eye opening on {{ $labels.device }}/{{ $labels.port }}"
            description: "Signal integrity marginal ({{ $value }}mV) — approaching failure threshold."
```

### Manual Diagnostics via mlxlink

```bash
# If Insight Operator isn't deployed, use mlxlink directly
# (available in DOCA driver container or host)

# Link status and speed
mlxlink -d mlx5_0 -p 1

# Eye opening measurement
mlxlink -d mlx5_0 -p 1 --show_eye

# FEC counters and BER
mlxlink -d mlx5_0 -p 1 --show_fec

# Cable/transceiver info
mlxlink -d mlx5_0 -p 1 --show_module

# Full diagnostic dump
mlxlink -d mlx5_0 -p 1 -m --json

# Cable TDR test (takes ~30 seconds)
mlxcables -d mlx5_0 --port 1 --read_diag
```

## Common Issues

### Insight agent can't access `/dev/mst`
- **Cause**: Mellanox Software Tools (MST) not started on host
- **Fix**: Run `mst start` on host or ensure DOCA driver container starts MST

### Cable diagnostics show "unsupported"
- **Cause**: Passive copper cables don't support TDR or power monitoring
- **Fix**: Only AOC/transceiver-based cables support full diagnostics

### Topology discovery incomplete
- **Cause**: No LLDP or subnet manager running; can't discover switch hops
- **Fix**: Enable LLDP on switches; or configure OpenSM for IB fabrics

### Health score fluctuates
- **Cause**: FEC corrections are normal at high speeds (400G+); transient spikes
- **Fix**: Alert on sustained degradation (>10min) not momentary spikes

## Best Practices

1. **Run cable diagnostics weekly** — catch degradation before failures
2. **Baseline eye opening after installation** — know your "good" values
3. **Alert on FEC uncorrected > 0** — this means data corruption is possible
4. **Topology discovery after any cabling change** — verify paths are optimal
5. **Track cable temperature** — overheating cables degrade faster
6. **Schedule replacements proactively** — health score <70 = replace within 2 weeks

## Key Takeaways

- NVIDIA CNS bundles GPU Operator + Network Operator + Insight tools
- Insight Operator provides NIC health, link quality, cable diagnostics, topology discovery
- Goes beyond counters — detects *why* links are degraded (eye opening, BER, cable power)
- Proactive: catches cable/connector degradation before NCCL jobs fail
- `mlxlink` is the manual equivalent for one-off diagnostics
- Alert on health scores, FEC rates, eye opening, link flaps — not just error counters
- Topology discovery validates that NCCL traffic takes optimal switch paths
