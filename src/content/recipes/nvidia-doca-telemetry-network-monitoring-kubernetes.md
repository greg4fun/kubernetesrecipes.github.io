---
title: "NVIDIA DOCA Telemetry for Network Monitoring on Kubernetes"
description: "Deploy NVIDIA DOCA Telemetry Service (DTS) to collect real-time network metrics from BlueField DPUs and ConnectX NICs. Export RoCE counters, port errors, congestion signals, and traffic stats to Prometheus for GPU fabric observability."
tags:
  - "nvidia"
  - "doca"
  - "telemetry"
  - "dpus"
  - "rdma"
  - "networking"
  - "observability"
category: "observability"
publishDate: "2026-05-22"
author: "Luca Berton"
difficulty: "advanced"
relatedRecipes:
  - "nvidia-doca-perftest-rdma-benchmarking"
  - "enable-pfc-mellanox-connectx-rdma"
  - "nccl-pxn-cross-nic-nvlink"
  - "dcgm-exporter-gpu-metrics-prometheus"
---

> 💡 **Quick Answer:** NVIDIA DOCA Telemetry Service (DTS) runs on BlueField DPUs or host systems with ConnectX NICs to collect hardware-level network counters (port stats, RoCE metrics, congestion events, error rates) and exports them to Prometheus. Deploy as a DaemonSet on GPU worker nodes for full fabric observability.

## The Problem

- GPU training jobs fail silently due to network degradation — no visibility into NIC-level stats
- RoCE congestion (ECN marks, PFC pauses) causes NCCL slowdowns but isn't surfaced in standard monitoring
- Need hardware-level counters: port errors, packet drops, retransmits, bandwidth utilization
- Standard node_exporter doesn't expose RDMA/InfiniBand/RoCE-specific metrics
- BlueField DPU telemetry requires specialized collection agents

## The Solution

### DOCA Telemetry Service Architecture

```text
┌─────────────────────────────────────────────────────────────┐
│ GPU Worker Node                                              │
│                                                              │
│  ┌──────────────┐    ┌─────────────────────────────────┐    │
│  │ NCCL Traffic │───▶│ ConnectX-7 / BlueField-3 DPU   │    │
│  └──────────────┘    └──────────┬──────────────────────┘    │
│                                  │ hardware counters          │
│                       ┌──────────▼──────────────┐            │
│                       │ DOCA Telemetry Service   │            │
│                       │ (DTS container)          │            │
│                       │ - Port counters          │            │
│                       │ - RoCE/IB metrics        │            │
│                       │ - PFC/ECN stats          │            │
│                       │ - Error rates            │            │
│                       └──────────┬──────────────┘            │
│                                  │ :9090/metrics             │
└──────────────────────────────────┼───────────────────────────┘
                                   ▼
                          ┌─────────────────┐
                          │   Prometheus     │
                          │   + Grafana      │
                          └─────────────────┘
```

### Deploy DOCA Telemetry as DaemonSet

```yaml
apiVersion: apps/v1
kind: DaemonSet
metadata:
  name: doca-telemetry
  namespace: nvidia-network-operator
  labels:
    app: doca-telemetry
spec:
  selector:
    matchLabels:
      app: doca-telemetry
  template:
    metadata:
      labels:
        app: doca-telemetry
      annotations:
        prometheus.io/scrape: "true"
        prometheus.io/port: "9090"
        prometheus.io/path: "/metrics"
    spec:
      nodeSelector:
        nvidia.com/gpu.present: "true"       # Only GPU nodes with NICs
      tolerations:
        - key: nvidia.com/gpu
          operator: Exists
          effect: NoSchedule
      hostNetwork: true                       # Access host NIC counters
      hostPID: true
      containers:
        - name: dts
          image: nvcr.io/nvidia/doca/doca_telemetry:2.9.0
          securityContext:
            privileged: true                  # Required for hardware counter access
          ports:
            - containerPort: 9090
              name: metrics
              protocol: TCP
          env:
            - name: DTS_CONFIG_DIR
              value: "/etc/dts"
            - name: DTS_PROMETHEUS_PORT
              value: "9090"
            - name: DTS_COLLECTION_INTERVAL_MS
              value: "1000"                   # 1-second collection interval
          volumeMounts:
            - name: dts-config
              mountPath: /etc/dts
            - name: sys
              mountPath: /sys
              readOnly: true
            - name: infiniband
              mountPath: /dev/infiniband
          resources:
            requests:
              cpu: "100m"
              memory: "256Mi"
            limits:
              cpu: "500m"
              memory: "512Mi"
      volumes:
        - name: dts-config
          configMap:
            name: doca-telemetry-config
        - name: sys
          hostPath:
            path: /sys
        - name: infiniband
          hostPath:
            path: /dev/infiniband
```

### DTS Configuration

```yaml
apiVersion: v1
kind: ConfigMap
metadata:
  name: doca-telemetry-config
  namespace: nvidia-network-operator
data:
  dts_config.ini: |
    [General]
    # Collection interval in milliseconds
    collection_interval=1000
    # Export format
    export_format=prometheus
    prometheus_port=9090

    [Counters]
    # Enable all counter sources
    enable_port_counters=true
    enable_extended_counters=true
    enable_rdma_counters=true
    enable_pfc_counters=true
    enable_congestion_counters=true
    enable_error_counters=true
    enable_temperature=true

    [PortCounters]
    # Standard port statistics
    port_rcv_data=true
    port_xmit_data=true
    port_rcv_packets=true
    port_xmit_packets=true
    port_unicast_rcv_packets=true
    port_unicast_xmit_packets=true
    port_multicast_rcv_packets=true
    port_multicast_xmit_packets=true

    [RDMACounters]
    # RoCE / InfiniBand specific
    roce_adp_retrans=true
    roce_adp_retrans_to=true
    roce_slow_restart=true
    roce_slow_restart_cnps=true
    roce_slow_restart_trans=true
    np_cnp_sent=true
    rp_cnp_handled=true
    np_ecn_marked_roce_packets=true
    rx_read_requests=true
    rx_write_requests=true
    rx_atomic_requests=true

    [PFCCounters]
    # Priority Flow Control
    rx_pause_duration=true
    tx_pause_duration=true
    rx_pause_transition=true
    tx_pause_transition=true
    # Per-priority (0-7)
    rx_prio0_pause=true
    tx_prio0_pause=true
    rx_prio3_pause=true
    tx_prio3_pause=true

    [CongestionCounters]
    # ECN and congestion signals
    ecn_marked_packets=true
    cnp_packets_received=true
    cnp_packets_sent=true
    congestion_events=true

    [ErrorCounters]
    # Errors and drops
    port_rcv_errors=true
    port_rcv_remote_physical_errors=true
    port_rcv_switch_relay_errors=true
    port_xmit_discards=true
    port_xmit_constraint_errors=true
    port_rcv_constraint_errors=true
    symbol_error=true
    link_downed=true
    link_error_recovery=true
    local_link_integrity_errors=true
    excessive_buffer_overrun_errors=true

  sources.yaml: |
    # Define which devices to monitor
    sources:
      - type: connectx
        devices: "all"          # Monitor all ConnectX/BlueField ports
        ports: "all"            # All ports on each device
      - type: host_counters
        interfaces: "all"       # Also collect host-level NIC stats
```

### Prometheus ServiceMonitor

```yaml
apiVersion: monitoring.coreos.com/v1
kind: ServiceMonitor
metadata:
  name: doca-telemetry
  namespace: nvidia-network-operator
  labels:
    release: prometheus           # Match your Prometheus operator selector
spec:
  selector:
    matchLabels:
      app: doca-telemetry
  endpoints:
    - port: metrics
      interval: 15s
      path: /metrics
  namespaceSelector:
    matchNames:
      - nvidia-network-operator
---
# Service for ServiceMonitor target discovery
apiVersion: v1
kind: Service
metadata:
  name: doca-telemetry
  namespace: nvidia-network-operator
  labels:
    app: doca-telemetry
spec:
  clusterIP: None                 # Headless — one target per node
  selector:
    app: doca-telemetry
  ports:
    - name: metrics
      port: 9090
      targetPort: 9090
```

### Key Metrics Exposed

```bash
# Verify metrics are being collected
kubectl exec -n nvidia-network-operator ds/doca-telemetry -- \
  curl -s localhost:9090/metrics | head -50

# Example metrics:
# HELP doca_port_rcv_data_bytes Total bytes received on port
# TYPE doca_port_rcv_data_bytes counter
doca_port_rcv_data_bytes{device="mlx5_0",port="1"} 8.234e+12

# HELP doca_roce_adp_retrans RoCE adaptive retransmissions
# TYPE doca_roce_adp_retrans counter
doca_roce_adp_retrans{device="mlx5_0",port="1"} 42

# HELP doca_np_cnp_sent Congestion Notification Packets sent
# TYPE doca_np_cnp_sent counter
doca_np_cnp_sent{device="mlx5_0",port="1"} 1523

# HELP doca_rx_pause_duration_us PFC pause duration in microseconds
# TYPE doca_rx_pause_duration_us counter
doca_rx_pause_duration_us{device="mlx5_0",port="1",priority="3"} 85432

# HELP doca_port_rcv_errors Total receive errors
# TYPE doca_port_rcv_errors counter
doca_port_rcv_errors{device="mlx5_0",port="1"} 0
```

### Prometheus Alert Rules for Network Health

```yaml
apiVersion: monitoring.coreos.com/v1
kind: PrometheusRule
metadata:
  name: doca-network-alerts
  namespace: nvidia-network-operator
spec:
  groups:
    - name: gpu-network-health
      rules:
        # RoCE retransmissions indicate congestion or errors
        - alert: HighRoCERetransmissions
          expr: rate(doca_roce_adp_retrans[5m]) > 100
          for: 2m
          labels:
            severity: warning
          annotations:
            summary: "High RoCE retransmissions on {{ $labels.device }}"
            description: "Node {{ $labels.instance }} device {{ $labels.device }} has {{ $value }}/s retransmissions — check for cable issues or switch congestion."

        # PFC pauses indicate back-pressure (network congestion)
        - alert: ExcessivePFCPauses
          expr: rate(doca_tx_pause_duration_us[5m]) > 10000
          for: 5m
          labels:
            severity: warning
          annotations:
            summary: "Excessive PFC pause on {{ $labels.device }} priority {{ $labels.priority }}"
            description: "PFC is throttling traffic — switch buffers may be full."

        # Port errors indicate physical layer problems
        - alert: PortReceiveErrors
          expr: rate(doca_port_rcv_errors[5m]) > 0
          for: 1m
          labels:
            severity: critical
          annotations:
            summary: "Port receive errors on {{ $labels.device }}"
            description: "Physical layer errors detected — check cable, transceiver, or port."

        # Link down events
        - alert: LinkDown
          expr: increase(doca_link_downed[5m]) > 0
          for: 0m
          labels:
            severity: critical
          annotations:
            summary: "NIC link went down on {{ $labels.instance }}"
            description: "Device {{ $labels.device }} experienced link down — NCCL jobs will fail."

        # Low bandwidth utilization (possible misconfiguration)
        - alert: LowFabricUtilization
          expr: |
            rate(doca_port_xmit_data_bytes[5m]) < 1e9
            and on(instance) kube_node_labels{label_nvidia_com_gpu_present="true"}
          for: 10m
          labels:
            severity: info
          annotations:
            summary: "GPU node {{ $labels.instance }} network underutilized"
            description: "Less than 1 GB/s transmitted — verify NCCL is using the correct NIC."
```

### Grafana Dashboard Queries

```promql
# Throughput per NIC (GB/s)
rate(doca_port_xmit_data_bytes{device=~"mlx5_.*"}[1m]) / 1e9

# RoCE retransmission rate (should be near 0)
rate(doca_roce_adp_retrans[5m])

# PFC pause duration trending (microseconds/second)
rate(doca_tx_pause_duration_us[5m])

# ECN congestion events (CNPs sent = receiver saw ECN)
rate(doca_np_cnp_sent[5m])

# Packet error ratio
rate(doca_port_rcv_errors[5m]) / rate(doca_port_rcv_packets[5m])

# Total RDMA operations/sec
rate(doca_rx_read_requests[1m]) + rate(doca_rx_write_requests[1m])
```

### Verify on Host (Without DTS)

```bash
# Alternative: read counters directly from sysfs (no DTS needed)
# Port counters
cat /sys/class/infiniband/mlx5_0/ports/1/counters/port_rcv_data
cat /sys/class/infiniband/mlx5_0/ports/1/counters/port_xmit_data
cat /sys/class/infiniband/mlx5_0/ports/1/counters/port_rcv_errors

# RoCE-specific (extended hardware counters)
cat /sys/class/infiniband/mlx5_0/ports/1/hw_counters/roce_adp_retrans
cat /sys/class/infiniband/mlx5_0/ports/1/hw_counters/np_cnp_sent
cat /sys/class/infiniband/mlx5_0/ports/1/hw_counters/rp_cnp_handled

# PFC counters via ethtool
ethtool -S ens1f0np0 | grep pause
#   rx_prio3_pause: 0
#   tx_prio3_pause: 15234
#   rx_pause_ctrl_phy: 0
#   tx_pause_ctrl_phy: 15234

# All RoCE counters at once
rdma statistic show link mlx5_0/1
```

## Common Issues

### DTS shows no metrics
- **Cause**: Missing `/dev/infiniband` mount or no RDMA devices on node
- **Fix**: Verify `ls /dev/infiniband/` on host; ensure NIC drivers loaded (`mlx5_core`)

### Counters stuck at zero
- **Cause**: No RDMA traffic flowing; or monitoring wrong port/device
- **Fix**: Run `ibstat` to find active port; verify `DTS_DEVICES=all` includes correct NIC

### Permission denied reading hw_counters
- **Cause**: Container not privileged; or SELinux blocking sysfs access
- **Fix**: `privileged: true` in securityContext; or add specific capabilities (`CAP_NET_ADMIN`, `CAP_SYS_RAWIO`)

### High PFC pause but no errors
- **Cause**: Normal back-pressure during large NCCL all-reduce — PFC is working correctly
- **Fix**: Only alert if pauses are sustained (>5min) or correlate with job slowdowns

## Best Practices

1. **Deploy on all GPU worker nodes** — network issues are often per-link, not cluster-wide
2. **1-second collection interval** — fast enough to catch transient congestion bursts
3. **Alert on retransmissions, not just errors** — retrans indicates congestion before failures
4. **Correlate with DCGM metrics** — GPU utilization drops often match network congestion spikes
5. **Baseline before production** — know your normal PFC/ECN rates to set meaningful thresholds
6. **Monitor both directions** — TX and RX pauses have different root causes

## Key Takeaways

- DOCA Telemetry Service exposes NIC/DPU hardware counters as Prometheus metrics
- Key signals: RoCE retransmissions, PFC pause duration, ECN/CNP rates, port errors
- Deploy as DaemonSet with `hostNetwork: true` and `privileged: true`
- Alert on retransmissions (congestion), port errors (physical), link down (critical)
- Alternative: read `/sys/class/infiniband/` counters directly or via `ethtool -S`
- Correlate network telemetry with DCGM GPU metrics for full AI infrastructure observability
