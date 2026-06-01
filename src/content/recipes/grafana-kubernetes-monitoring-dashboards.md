---
title: "Grafana Kubernetes Monitoring Dashboards Guide"
description: "Deploy and configure Grafana dashboards for Kubernetes monitoring including dashboard 6417 for pod metrics, dashboard 315 for cluster overview, and custom dashboards with Prometheus data sources."
tags:
  - "grafana"
  - "prometheus"
  - "monitoring"
  - "dashboards"
  - "metrics"
category: "observability"
publishDate: "2026-06-01"
author: "Luca Berton"
difficulty: "intermediate"
relatedRecipes:
  - "prometheus-monitoring-kubernetes"
  - "kubernetes-observability-stack"
  - "dcgm-exporter-gpu-metrics-kubernetes"
---

> 💡 **Quick Answer:** Grafana dashboard 6417 ("Kubernetes Pods") and dashboard 315 ("Kubernetes Cluster Monitoring") are the most popular community dashboards. Import them via ID in Grafana UI or provision as ConfigMaps with the kube-prometheus-stack Helm chart. Both require a Prometheus data source scraping kube-state-metrics and kubelet/cAdvisor.

## The Problem

- Kubernetes generates thousands of metrics but no built-in visualization
- Setting up dashboards from scratch is time-consuming and error-prone
- Community dashboards (6417, 315) require specific Prometheus labels to work
- Dashboard provisioning must survive pod restarts (GitOps-friendly)
- GPU, storage, and networking metrics need additional dashboards beyond defaults
- kube-prometheus-stack ships dashboards but they may not cover all use cases

## The Solution

### Install Grafana with kube-prometheus-stack

```bash
helm repo add prometheus-community https://prometheus-community.github.io/helm-charts
helm repo update

helm install monitoring prometheus-community/kube-prometheus-stack \
  --namespace monitoring \
  --create-namespace \
  --set grafana.adminPassword="admin" \
  --set grafana.persistence.enabled=true \
  --set grafana.persistence.size=10Gi
```

### Dashboard 6417: Kubernetes Pods Monitoring

Dashboard 6417 provides per-pod CPU, memory, network, and filesystem metrics.

```yaml
# Import via Grafana ConfigMap provisioning
apiVersion: v1
kind: ConfigMap
metadata:
  name: grafana-dashboard-k8s-pods
  namespace: monitoring
  labels:
    grafana_dashboard: "1"    # Sidecar picks up ConfigMaps with this label
data:
  k8s-pods.json: |-
    {
      "__inputs": [{
        "name": "DS_PROMETHEUS",
        "type": "datasource",
        "pluginId": "prometheus"
      }],
      "id": null,
      "uid": "k8s-pods-6417",
      "title": "Kubernetes Pods",
      "tags": ["kubernetes", "pods"],
      "timezone": "browser",
      "panels": []
    }
```

**Import by ID (easiest method):**

```text
1. Open Grafana → Dashboards → Import
2. Enter dashboard ID: 6417
3. Select Prometheus data source
4. Click Import

Required metrics (from kube-state-metrics + cAdvisor):
• container_cpu_usage_seconds_total
• container_memory_working_set_bytes
• container_network_receive_bytes_total
• container_network_transmit_bytes_total
• container_fs_usage_bytes
• kube_pod_info
• kube_pod_container_resource_requests
• kube_pod_container_resource_limits
```

### Dashboard 315: Kubernetes Cluster Monitoring

Dashboard 315 provides cluster-level overview: node status, total pods, CPU/memory pressure, and namespace breakdown.

```text
Import by ID: 315
Name: "Kubernetes Cluster Monitoring (via Prometheus)"

Required metrics:
• node_cpu_seconds_total (node-exporter)
• node_memory_MemAvailable_bytes (node-exporter)
• kubelet_running_pods
• kube_node_status_condition
• kube_namespace_status_phase
• kube_deployment_status_replicas
```

### Provision Dashboards via Helm Values

```yaml
# kube-prometheus-stack values for dashboard provisioning
grafana:
  dashboardProviders:
    dashboardproviders.yaml:
      apiVersion: 1
      providers:
        - name: default
          orgId: 1
          folder: "Kubernetes"
          type: file
          disableDeletion: false
          editable: true
          options:
            path: /var/lib/grafana/dashboards/default

  dashboards:
    default:
      # Import community dashboards by ID
      kubernetes-pods:
        gnetId: 6417
        revision: 1
        datasource: Prometheus
      cluster-monitoring:
        gnetId: 315
        revision: 3
        datasource: Prometheus
      node-exporter-full:
        gnetId: 1860
        revision: 33
        datasource: Prometheus
      nginx-ingress:
        gnetId: 9614
        revision: 1
        datasource: Prometheus

  # Sidecar for ConfigMap-based dashboards
  sidecar:
    dashboards:
      enabled: true
      label: grafana_dashboard
      labelValue: "1"
      searchNamespace: ALL
      folderAnnotation: grafana_folder
      provider:
        foldersFromFilesStructure: true
```

### Essential Kubernetes Dashboards

```text
ID     | Name                                    | Focus
───────┼─────────────────────────────────────────┼──────────────────────
6417   | Kubernetes Pods                         | Per-pod CPU/mem/net/fs
315    | Kubernetes Cluster Monitoring           | Cluster overview
1860   | Node Exporter Full                      | Per-node system metrics
9614   | NGINX Ingress Controller                | Ingress traffic/errors
7249   | Kubernetes Cluster (Prometheus)         | Namespace breakdown
14205  | Kubernetes PVC (Volumes)                | PV/PVC utilization
12006  | Kubernetes apiserver                    | API server performance
13332  | kube-state-metrics v2                   | KSM full metrics
14981  | CoreDNS                                 | DNS query rates/errors
12239  | ETCD                                    | etcd cluster health
───────┴─────────────────────────────────────────┴──────────────────────

GPU-Specific:
12239  | NVIDIA DCGM Exporter                    | GPU utilization/temp/mem
18462  | NVIDIA GPU Operator                     | Operator health + GPUs
```

### Custom Dashboard: Namespace Resource Usage

```json
{
  "title": "Namespace Resource Usage",
  "uid": "ns-resources",
  "panels": [
    {
      "title": "CPU Usage by Namespace",
      "type": "timeseries",
      "targets": [{
        "expr": "sum(rate(container_cpu_usage_seconds_total{namespace!=\"\",container!=\"\"}[5m])) by (namespace)",
        "legendFormat": "{{namespace}}"
      }]
    },
    {
      "title": "Memory Usage by Namespace",
      "type": "timeseries",
      "targets": [{
        "expr": "sum(container_memory_working_set_bytes{namespace!=\"\",container!=\"\"}) by (namespace)",
        "legendFormat": "{{namespace}}"
      }]
    },
    {
      "title": "Pod Count by Namespace",
      "type": "stat",
      "targets": [{
        "expr": "count(kube_pod_info) by (namespace)",
        "legendFormat": "{{namespace}}"
      }]
    }
  ]
}
```

### Useful PromQL Queries for Kubernetes Dashboards

```promql
# Top 10 pods by CPU
topk(10, sum(rate(container_cpu_usage_seconds_total{container!=""}[5m])) by (pod, namespace))

# Pods exceeding memory requests
sum(container_memory_working_set_bytes{container!=""}) by (pod, namespace)
/
sum(kube_pod_container_resource_requests{resource="memory"}) by (pod, namespace) > 1

# OOMKilled pods in last hour
increase(kube_pod_container_status_last_terminated_reason{reason="OOMKilled"}[1h]) > 0

# Node CPU saturation (>80%)
100 - (avg by (instance) (rate(node_cpu_seconds_total{mode="idle"}[5m])) * 100) > 80

# PVC usage percentage
kubelet_volume_stats_used_bytes / kubelet_volume_stats_capacity_bytes * 100 > 80

# API server request latency P99
histogram_quantile(0.99, sum(rate(apiserver_request_duration_seconds_bucket{verb!="WATCH"}[5m])) by (le, verb))

# Pod restart rate
sum(increase(kube_pod_container_status_restarts_total[1h])) by (pod, namespace) > 3
```

### GitOps Dashboard Provisioning with ArgoCD

```yaml
# Store dashboards in Git, deploy via ArgoCD
apiVersion: v1
kind: ConfigMap
metadata:
  name: grafana-dashboard-gpu-cluster
  namespace: monitoring
  labels:
    grafana_dashboard: "1"
  annotations:
    grafana_folder: "GPU Monitoring"
data:
  gpu-cluster.json: |
    {
      "title": "GPU Cluster Overview",
      "panels": [
        {
          "title": "GPU Utilization",
          "targets": [{
            "expr": "avg(DCGM_FI_DEV_GPU_UTIL) by (gpu, Hostname)"
          }]
        },
        {
          "title": "GPU Memory Used",
          "targets": [{
            "expr": "DCGM_FI_DEV_FB_USED / (DCGM_FI_DEV_FB_USED + DCGM_FI_DEV_FB_FREE) * 100"
          }]
        }
      ]
    }
```

## Common Issues

### Dashboard shows "No Data" after import
- **Cause**: Prometheus data source not selected, or metric names differ between versions
- **Fix**: Verify data source in dashboard settings; check metric names in Prometheus explore

### Dashboard 6417 missing some pods
- **Cause**: `kube-state-metrics` not scraping all namespaces
- **Fix**: Ensure KSM has cluster-wide RBAC; check `--namespaces` flag isn't set

### Grafana sidecar not picking up ConfigMap dashboards
- **Cause**: Wrong label (`grafana_dashboard: "1"` required) or sidecar not enabled
- **Fix**: Check label matches `sidecar.dashboards.label` in Helm values; verify sidecar container is running

### High cardinality causing slow dashboard load
- **Cause**: Queries with too many label dimensions (e.g., all pods across all namespaces)
- **Fix**: Add namespace filter variable; use `topk()` to limit series; set appropriate time range

### Dashboard metrics missing after kube-prometheus-stack upgrade
- **Cause**: Metric names changed between Prometheus/KSM versions (e.g., `kube_pod_container_resource_requests_cpu_cores` → `kube_pod_container_resource_requests{resource="cpu"}`)
- **Fix**: Update dashboard panels to new metric names; import latest dashboard revision

## Best Practices

1. **Provision dashboards as ConfigMaps** — survives pod restarts, GitOps-friendly
2. **Use dashboard folders** — organize by team/service via `grafana_folder` annotation
3. **Set refresh intervals wisely** — 30s for ops dashboards, 5m for capacity planning
4. **Add alerting rules alongside dashboards** — Grafana alerts or PrometheusRules
5. **Use template variables** — namespace, pod, node selectors for interactive filtering
6. **Version dashboards in Git** — track changes, review before deploying
7. **Limit time ranges** — default to 6h/12h; long ranges cause high query load
8. **Test PromQL in Explore first** — verify queries return expected data before adding to panels
9. **Pin dashboard revisions** — community dashboards update; pin to tested revision
10. **Separate operational vs. capacity dashboards** — different refresh rates and time ranges

## Key Takeaways

- Dashboard 6417 (Kubernetes Pods) and 315 (Cluster Monitoring) are the most popular Grafana dashboards for K8s
- Import by ID in Grafana UI or provision via kube-prometheus-stack Helm values (`gnetId`)
- ConfigMap + sidecar pattern enables GitOps dashboard management
- Required stack: Prometheus + kube-state-metrics + node-exporter + cAdvisor (all included in kube-prometheus-stack)
- Custom dashboards use PromQL — master `sum`, `rate`, `topk`, `histogram_quantile` for K8s metrics
- GPU monitoring needs DCGM Exporter metrics (`DCGM_FI_DEV_GPU_UTIL`, `DCGM_FI_DEV_FB_USED`)
- Label `grafana_dashboard: "1"` on ConfigMaps for automatic sidecar pickup
- Always pin community dashboard revisions in production Helm values
