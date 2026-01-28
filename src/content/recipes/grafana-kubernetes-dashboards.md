---
title: "How to Monitor Kubernetes with Grafana Dashboards"
description: "Create comprehensive Grafana dashboards for Kubernetes monitoring. Learn to visualize cluster, node, pod, and application metrics effectively."
category: "observability"
difficulty: "intermediate"
publishDate: "2026-01-22"
tags: ["grafana", "monitoring", "dashboards", "prometheus", "visualization"]
---

# How to Monitor Kubernetes with Grafana Dashboards

Grafana dashboards provide visual insights into your Kubernetes cluster. Learn to create dashboards for cluster overview, node health, pod performance, and application metrics.

## Deploy Grafana

```yaml
# grafana-deployment.yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: grafana
  namespace: monitoring
spec:
  replicas: 1
  selector:
    matchLabels:
      app: grafana
  template:
    metadata:
      labels:
        app: grafana
    spec:
      containers:
        - name: grafana
          image: grafana/grafana:10.2.0
          ports:
            - containerPort: 3000
          env:
            - name: GF_SECURITY_ADMIN_PASSWORD
              valueFrom:
                secretKeyRef:
                  name: grafana-secret
                  key: admin-password
            - name: GF_INSTALL_PLUGINS
              value: grafana-piechart-panel,grafana-clock-panel
          volumeMounts:
            - name: grafana-storage
              mountPath: /var/lib/grafana
            - name: datasources
              mountPath: /etc/grafana/provisioning/datasources
            - name: dashboards-config
              mountPath: /etc/grafana/provisioning/dashboards
            - name: dashboards
              mountPath: /var/lib/grafana/dashboards
          resources:
            limits:
              memory: 512Mi
              cpu: 500m
      volumes:
        - name: grafana-storage
          persistentVolumeClaim:
            claimName: grafana-pvc
        - name: datasources
          configMap:
            name: grafana-datasources
        - name: dashboards-config
          configMap:
            name: grafana-dashboards-config
        - name: dashboards
          configMap:
            name: grafana-dashboards
```

## Prometheus Data Source

```yaml
# grafana-datasources.yaml
apiVersion: v1
kind: ConfigMap
metadata:
  name: grafana-datasources
  namespace: monitoring
data:
  datasources.yaml: |
    apiVersion: 1
    datasources:
      - name: Prometheus
        type: prometheus
        access: proxy
        url: http://prometheus:9090
        isDefault: true
        editable: false
      - name: Loki
        type: loki
        access: proxy
        url: http://loki:3100
        editable: false
```

## Cluster Overview Dashboard

```yaml
# grafana-dashboards.yaml
apiVersion: v1
kind: ConfigMap
metadata:
  name: grafana-dashboards
  namespace: monitoring
data:
  cluster-overview.json: |
    {
      "dashboard": {
        "title": "Kubernetes Cluster Overview",
        "panels": [
          {
            "title": "Cluster CPU Usage",
            "type": "gauge",
            "gridPos": {"h": 8, "w": 6, "x": 0, "y": 0},
            "targets": [{
              "expr": "sum(rate(container_cpu_usage_seconds_total{container!=\"\"}[5m])) / sum(machine_cpu_cores) * 100",
              "legendFormat": "CPU %"
            }],
            "fieldConfig": {
              "defaults": {
                "unit": "percent",
                "max": 100,
                "thresholds": {
                  "steps": [
                    {"value": 0, "color": "green"},
                    {"value": 70, "color": "yellow"},
                    {"value": 85, "color": "red"}
                  ]
                }
              }
            }
          },
          {
            "title": "Cluster Memory Usage",
            "type": "gauge",
            "gridPos": {"h": 8, "w": 6, "x": 6, "y": 0},
            "targets": [{
              "expr": "sum(container_memory_working_set_bytes{container!=\"\"}) / sum(machine_memory_bytes) * 100",
              "legendFormat": "Memory %"
            }],
            "fieldConfig": {
              "defaults": {
                "unit": "percent",
                "max": 100,
                "thresholds": {
                  "steps": [
                    {"value": 0, "color": "green"},
                    {"value": 70, "color": "yellow"},
                    {"value": 85, "color": "red"}
                  ]
                }
              }
            }
          },
          {
            "title": "Running Pods",
            "type": "stat",
            "gridPos": {"h": 4, "w": 4, "x": 12, "y": 0},
            "targets": [{
              "expr": "sum(kube_pod_status_phase{phase=\"Running\"})",
              "legendFormat": "Running"
            }]
          },
          {
            "title": "Failed Pods",
            "type": "stat",
            "gridPos": {"h": 4, "w": 4, "x": 16, "y": 0},
            "targets": [{
              "expr": "sum(kube_pod_status_phase{phase=\"Failed\"})",
              "legendFormat": "Failed"
            }],
            "fieldConfig": {
              "defaults": {
                "thresholds": {
                  "steps": [
                    {"value": 0, "color": "green"},
                    {"value": 1, "color": "red"}
                  ]
                }
              }
            }
          }
        ]
      }
    }
```

## Essential PromQL Queries for Dashboards

```promql
# CPU Usage per Node
sum(rate(node_cpu_seconds_total{mode!="idle"}[5m])) by (instance) * 100

# Memory Usage per Node  
(node_memory_MemTotal_bytes - node_memory_MemAvailable_bytes) / node_memory_MemTotal_bytes * 100

# Pod CPU Usage
sum(rate(container_cpu_usage_seconds_total{container!="",pod!=""}[5m])) by (namespace, pod)

# Pod Memory Usage
sum(container_memory_working_set_bytes{container!="",pod!=""}) by (namespace, pod)

# Container Restarts
sum(increase(kube_pod_container_status_restarts_total[1h])) by (namespace, pod, container)

# Network I/O
sum(rate(container_network_receive_bytes_total[5m])) by (pod)
sum(rate(container_network_transmit_bytes_total[5m])) by (pod)

# Disk Usage
(node_filesystem_size_bytes - node_filesystem_avail_bytes) / node_filesystem_size_bytes * 100

# API Server Latency
histogram_quantile(0.99, sum(rate(apiserver_request_duration_seconds_bucket{verb!="WATCH"}[5m])) by (le, verb))

# etcd Latency
histogram_quantile(0.99, sum(rate(etcd_request_duration_seconds_bucket[5m])) by (le, operation))
```

## Node Metrics Dashboard Panel

```json
{
  "title": "Node CPU Over Time",
  "type": "timeseries",
  "gridPos": {"h": 8, "w": 12, "x": 0, "y": 8},
  "targets": [{
    "expr": "100 - (avg by (instance) (irate(node_cpu_seconds_total{mode=\"idle\"}[5m])) * 100)",
    "legendFormat": "{{instance}}"
  }],
  "fieldConfig": {
    "defaults": {
      "unit": "percent",
      "custom": {
        "lineWidth": 2,
        "fillOpacity": 10
      }
    }
  },
  "options": {
    "tooltip": {"mode": "multi"}
  }
}
```

## Pod Resources Dashboard Panel

```json
{
  "title": "Top 10 CPU Consuming Pods",
  "type": "table",
  "gridPos": {"h": 8, "w": 12, "x": 0, "y": 16},
  "targets": [{
    "expr": "topk(10, sum(rate(container_cpu_usage_seconds_total{container!=\"\",pod!=\"\"}[5m])) by (namespace, pod))",
    "format": "table",
    "instant": true
  }],
  "transformations": [
    {"id": "organize", "options": {"excludeByName": {"Time": true}}}
  ],
  "fieldConfig": {
    "overrides": [{
      "matcher": {"id": "byName", "options": "Value"},
      "properties": [{"id": "unit", "value": "cores"}]
    }]
  }
}
```

## Dashboard Variables

```json
{
  "templating": {
    "list": [
      {
        "name": "namespace",
        "type": "query",
        "query": "label_values(kube_pod_info, namespace)",
        "refresh": 2,
        "multi": true,
        "includeAll": true
      },
      {
        "name": "pod",
        "type": "query", 
        "query": "label_values(kube_pod_info{namespace=~\"$namespace\"}, pod)",
        "refresh": 2,
        "multi": true,
        "includeAll": true
      },
      {
        "name": "node",
        "type": "query",
        "query": "label_values(kube_node_info, node)",
        "refresh": 2,
        "multi": false,
        "includeAll": true
      }
    ]
  }
}
```

## Application Metrics Panel

```json
{
  "title": "HTTP Request Rate",
  "type": "timeseries",
  "targets": [{
    "expr": "sum(rate(http_requests_total{namespace=\"$namespace\"}[5m])) by (service, method, status)",
    "legendFormat": "{{service}} {{method}} {{status}}"
  }],
  "fieldConfig": {
    "defaults": {
      "unit": "reqps",
      "custom": {"stacking": {"mode": "normal"}}
    }
  }
}
```

## Import Community Dashboards

```bash
# Popular dashboard IDs from grafana.com
# Kubernetes Cluster: 315
# Node Exporter: 1860
# Kubernetes Pods: 6336
# NGINX Ingress: 9614

# Import via Grafana UI:
# Dashboards → Import → Enter ID → Load
```

## Alerting in Grafana

```yaml
# Alert rule example
apiVersion: 1
groups:
  - name: kubernetes-alerts
    folder: Kubernetes
    interval: 1m
    rules:
      - uid: cpu-high
        title: High CPU Usage
        condition: A
        data:
          - refId: A
            relativeTimeRange:
              from: 300
              to: 0
            model:
              expr: sum(rate(container_cpu_usage_seconds_total{container!=""}[5m])) / sum(machine_cpu_cores) * 100
              intervalMs: 1000
        for: 5m
        annotations:
          summary: Cluster CPU usage is above 85%
        labels:
          severity: warning
```

## Summary

Grafana dashboards transform Prometheus metrics into actionable insights. Use cluster overview dashboards for high-level health, node dashboards for infrastructure monitoring, and pod dashboards for application troubleshooting. Leverage variables for dynamic filtering.

---

## 📘 Go Further with Kubernetes Recipes

**Love this recipe? There's so much more!** This is just one of **100+ hands-on recipes** in our comprehensive **[Kubernetes Recipes book](/book)**.

Inside the book, you'll master:
- ✅ Production-ready deployment strategies
- ✅ Advanced networking and security patterns  
- ✅ Observability, monitoring, and troubleshooting
- ✅ Real-world best practices from industry experts

> *"The practical, recipe-based approach made complex Kubernetes concepts finally click for me."*

**👉 [Get Your Copy Now](/book)** — Start building production-grade Kubernetes skills today!
