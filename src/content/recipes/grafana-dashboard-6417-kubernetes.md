---
title: "Grafana Dashboard 6417 Kubernetes Pods"
description: "Import Grafana dashboard 6417 for Kubernetes pod monitoring. Configure Prometheus data source, visualize CPU, memory, network, and disk usage per pod."
publishDate: "2026-05-02"
author: "Luca Berton"
category: "observability"
difficulty: "beginner"
timeToComplete: "15 minutes"
kubernetesVersion: "1.28+"
tags:
  - "grafana"
  - "prometheus"
  - "monitoring"
  - "dashboards"
  - "observability"
relatedRecipes:
  - "kubernetes-grafana-dashboards-guide"
  - "prometheus-monitoring-kubernetes-guide"
  - "kubernetes-pod-resource-monitoring-grafana"
  - "grafana-dashboard-6417-node-exporter"
  - "gpu-operator-node-status-exporter-metrics"
---

> 💡 **Quick Answer:** Grafana dashboard 6417 ("Kubernetes Pods") displays real-time CPU, memory, network I/O, and filesystem usage per pod. Import it via Grafana UI → Dashboards → Import → ID `6417` → select your Prometheus data source. Requires `kube-state-metrics` and `node-exporter` running in your cluster.

## The Problem

You need a comprehensive pod-level monitoring dashboard that shows:

- CPU usage vs requests vs limits per pod
- Memory consumption and OOM risk
- Network receive/transmit bytes per pod
- Filesystem usage inside containers
- Pod restart counts and ready status

Dashboard 6417 is one of the most popular Kubernetes dashboards on Grafana.com with 10M+ downloads.

## The Solution

### Prerequisites

```bash
# Verify Prometheus is scraping Kubernetes metrics
kubectl get pods -n monitoring -l app.kubernetes.io/name=prometheus
kubectl get pods -n monitoring -l app.kubernetes.io/name=kube-state-metrics

# Verify metrics are available
kubectl port-forward -n monitoring svc/prometheus 9090:9090 &
curl -s "http://localhost:9090/api/v1/query?query=container_cpu_usage_seconds_total" | jq '.data.result | length'
```

### Import Dashboard 6417

**Method 1: Grafana UI**

1. Open Grafana → **Dashboards** → **Import**
2. Enter dashboard ID: **6417**
3. Click **Load**
4. Select your **Prometheus** data source
5. Click **Import**

**Method 2: Grafana API**

```bash
# Download dashboard JSON
curl -s https://grafana.com/api/dashboards/6417/revisions/1/download \
  > dashboard-6417.json

# Import via Grafana API
curl -X POST http://admin:admin@grafana:3000/api/dashboards/import \
  -H "Content-Type: application/json" \
  -d "{
    \"dashboard\": $(cat dashboard-6417.json),
    \"overwrite\": true,
    \"inputs\": [{
      \"name\": \"DS_PROMETHEUS\",
      \"type\": \"datasource\",
      \"pluginId\": \"prometheus\",
      \"value\": \"Prometheus\"
    }]
  }"
```

**Method 3: Helm values (kube-prometheus-stack)**

```yaml
# values.yaml for kube-prometheus-stack
grafana:
  dashboardProviders:
    dashboardproviders.yaml:
      apiVersion: 1
      providers:
      - name: default
        folder: Kubernetes
        type: file
        options:
          path: /var/lib/grafana/dashboards/default
  dashboards:
    default:
      kubernetes-pods:
        gnetId: 6417
        revision: 1
        datasource: Prometheus
```

```bash
helm upgrade --install kube-prometheus-stack prometheus-community/kube-prometheus-stack \
  -n monitoring -f values.yaml
```

### Dashboard Panels Explained

| Panel | PromQL Query | What It Shows |
|-------|-------------|---------------|
| CPU Usage | `rate(container_cpu_usage_seconds_total{...}[5m])` | Actual CPU cores consumed |
| CPU Requests | `kube_pod_container_resource_requests{resource="cpu"}` | CPU requests (guaranteed) |
| CPU Limits | `kube_pod_container_resource_limits{resource="cpu"}` | CPU ceiling |
| Memory Usage | `container_memory_working_set_bytes` | Current memory (OOM basis) |
| Memory Requests | `kube_pod_container_resource_requests{resource="memory"}` | Memory requests |
| Network RX | `rate(container_network_receive_bytes_total[5m])` | Inbound bytes/sec |
| Network TX | `rate(container_network_transmit_bytes_total[5m])` | Outbound bytes/sec |
| Restarts | `kube_pod_container_status_restarts_total` | Container restart count |

### Customize for Your Cluster

```json
// Add namespace variable filter
{
  "templating": {
    "list": [
      {
        "name": "namespace",
        "query": "label_values(kube_pod_info, namespace)",
        "type": "query",
        "multi": true,
        "includeAll": true
      },
      {
        "name": "pod",
        "query": "label_values(kube_pod_info{namespace=~\"$namespace\"}, pod)",
        "type": "query",
        "multi": true,
        "includeAll": true
      }
    ]
  }
}
```

### Alternative Dashboards

| Dashboard ID | Name | Focus |
|-------------|------|-------|
| **6417** | Kubernetes Pods | Pod-level CPU/memory/network |
| **315** | Kubernetes Cluster | Cluster overview |
| **1860** | Node Exporter Full | Node-level hardware metrics |
| **7249** | Kubernetes Cluster (Prometheus) | Namespace-level aggregation |
| **13770** | kube-state-metrics v2 | Object state (deployments, jobs) |

## Common Issues

**"No data" on all panels**

Prometheus data source not configured or wrong name. Go to Grafana → Configuration → Data Sources → verify Prometheus URL (usually `http://prometheus-server:9090` or `http://prometheus-kube-prometheus-prometheus:9090`).

**Missing `container_*` metrics**

cAdvisor metrics not being scraped. Check if Prometheus has a `kubelet` job: `up{job="kubelet"}`. For kube-prometheus-stack, this is configured automatically.

**Dashboard shows only system pods**

Namespace filter needs adjustment. Edit the dashboard variable to include your application namespaces.

## Best Practices

- **Pin dashboard revision** in Helm values — prevents unexpected changes on upgrade
- **Add namespace and pod filters** — default dashboard shows everything, gets noisy on large clusters
- **Set alert rules** from dashboard queries — CPU > 90% of limit, memory > 80% of limit
- **Use `container_memory_working_set_bytes`** not `container_memory_usage_bytes` — working set is what triggers OOMKill

## Key Takeaways

- Dashboard 6417 is the standard Kubernetes pod monitoring dashboard (10M+ downloads)
- Import via UI (ID 6417), API, or Helm values for GitOps
- Requires Prometheus + kube-state-metrics + cAdvisor (kubelet) metrics
- Customize with namespace/pod variable filters for large clusters
- Use working set memory (not RSS) for accurate OOM risk visualization
