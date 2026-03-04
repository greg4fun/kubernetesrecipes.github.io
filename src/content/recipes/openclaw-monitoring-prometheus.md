---
title: "Monitor OpenClaw with Prometheus and Grafana on Kubernetes"
description: "Set up monitoring for OpenClaw AI gateway on Kubernetes with Prometheus metrics, Grafana dashboards, and alerting for uptime, message throughput, and."
category: "observability"
difficulty: "intermediate"
timeToComplete: "20 minutes"
kubernetesVersion: "1.28+"
prerequisites:
  - "OpenClaw deployed on Kubernetes"
  - "Prometheus and Grafana installed (kube-prometheus-stack)"
relatedRecipes:
  - "openclaw-cron-heartbeat-kubernetes"
  - "openclaw-kubernetes-deployment"
  - "openclaw-ha-kubernetes"
  - "prometheus-grafana-setup"
tags:
  - openclaw
  - prometheus
  - grafana
  - monitoring
  - alerting
  - observability
  - dashboards
publishDate: "2026-02-26"
author: "Luca Berton"
---

> 💡 **Quick Answer:** OpenClaw exposes a Control UI on port 18789. Monitor its health with blackbox-exporter HTTP probes, pod metrics via kube-state-metrics, and container resource usage via cAdvisor. Set up alerts for pod restarts, OOM kills, and service downtime.
>
> **Key concept:** OpenClaw is a single-process gateway — monitoring focuses on availability, resource usage, and restart frequency rather than request throughput.
>
> **Gotcha:** OpenClaw doesn't expose a `/metrics` Prometheus endpoint natively. Use blackbox-exporter for HTTP health checks and kube-state-metrics for pod-level metrics.

## The Problem

- No visibility into whether the AI assistant is online and responding
- Pod crashes go unnoticed until users complain
- No resource usage trending to right-size the deployment
- Channel disconnections (WhatsApp session expiry) aren't detected

## The Solution

Combine Kubernetes-native metrics (kube-state-metrics, cAdvisor) with HTTP health probes to build a comprehensive monitoring stack.

## Monitoring Setup

```yaml
# openclaw-monitoring.yaml
apiVersion: monitoring.coreos.com/v1
kind: PodMonitor
metadata:
  name: openclaw-health
  namespace: openclaw
spec:
  selector:
    matchLabels:
      app: openclaw
  podMetricsEndpoints: []
---
# Blackbox exporter probe for HTTP health
apiVersion: monitoring.coreos.com/v1
kind: Probe
metadata:
  name: openclaw-http
  namespace: openclaw
spec:
  interval: 30s
  module: http_2xx
  prober:
    url: blackbox-exporter.monitoring:9115
  targets:
    staticConfig:
      static:
        - openclaw.openclaw.svc.cluster.local:80
---
# Alerting rules
apiVersion: monitoring.coreos.com/v1
kind: PrometheusRule
metadata:
  name: openclaw-alerts
  namespace: openclaw
spec:
  groups:
    - name: openclaw.rules
      rules:
        - alert: OpenClawDown
          expr: probe_success{job="probe/openclaw/openclaw-http"} == 0
          for: 3m
          labels:
            severity: critical
          annotations:
            summary: "OpenClaw gateway is unreachable"
            description: "HTTP health check failed for 3+ minutes"
        
        - alert: OpenClawCrashLooping
          expr: increase(kube_pod_container_status_restarts_total{namespace="openclaw",container="openclaw"}[1h]) > 3
          labels:
            severity: warning
          annotations:
            summary: "OpenClaw is crash-looping ({{ $value }} restarts/hour)"
        
        - alert: OpenClawOOM
          expr: kube_pod_container_status_last_terminated_reason{namespace="openclaw",reason="OOMKilled"} == 1
          labels:
            severity: warning
          annotations:
            summary: "OpenClaw was OOM killed — increase memory limits"
        
        - alert: OpenClawHighMemory
          expr: |
            container_memory_working_set_bytes{namespace="openclaw",container="openclaw"} /
            container_spec_memory_limit_bytes{namespace="openclaw",container="openclaw"} > 0.85
          for: 10m
          labels:
            severity: warning
          annotations:
            summary: "OpenClaw memory usage above 85%"
        
        - alert: OpenClawPVCFull
          expr: |
            kubelet_volume_stats_used_bytes{namespace="openclaw",persistentvolumeclaim=~"openclaw.*"} /
            kubelet_volume_stats_capacity_bytes > 0.9
          labels:
            severity: critical
          annotations:
            summary: "OpenClaw PVC 90% full"
```

## Grafana Dashboard

```json
{
  "title": "OpenClaw Gateway",
  "panels": [
    {
      "title": "Gateway Health",
      "type": "stat",
      "targets": [{"expr": "probe_success{job='probe/openclaw/openclaw-http'}"}]
    },
    {
      "title": "Pod Restarts (24h)",
      "type": "stat",
      "targets": [{"expr": "increase(kube_pod_container_status_restarts_total{namespace='openclaw'}[24h])"}]
    },
    {
      "title": "Memory Usage",
      "type": "timeseries",
      "targets": [{"expr": "container_memory_working_set_bytes{namespace='openclaw',container='openclaw'}"}]
    },
    {
      "title": "CPU Usage",
      "type": "timeseries",
      "targets": [{"expr": "rate(container_cpu_usage_seconds_total{namespace='openclaw',container='openclaw'}[5m])"}]
    },
    {
      "title": "PVC Usage",
      "type": "gauge",
      "targets": [{"expr": "kubelet_volume_stats_used_bytes{namespace='openclaw'} / kubelet_volume_stats_capacity_bytes"}]
    }
  ]
}
```

## Common Issues

### Issue 1: Blackbox exporter not reaching OpenClaw

```bash
# Verify service DNS resolution
kubectl exec -n monitoring deploy/blackbox-exporter -- \
  wget -qO- http://openclaw.openclaw.svc.cluster.local:80/

# Check NetworkPolicy isn't blocking cross-namespace traffic
```

## Best Practices

1. **Alert on downtime, not just restarts** — Use blackbox-exporter HTTP probes
2. **Track PVC usage** — Session data grows over time; alert before it's full
3. **Monitor memory trends** — Right-size limits based on actual usage
4. **Set up PagerDuty/Slack alerts** — Critical alerts should reach you immediately
5. **Dashboard rotation** — Include OpenClaw panel in your NOC dashboard

## Key Takeaways

- **Blackbox-exporter** provides HTTP health monitoring for OpenClaw
- **kube-state-metrics** tracks pod restarts, OOM kills, and lifecycle events
- **cAdvisor** provides CPU and memory usage for right-sizing
- **PVC monitoring** prevents session data from filling up storage
- **Alerting** ensures you know when your AI assistant goes offline
