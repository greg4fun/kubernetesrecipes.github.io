---
title: "How to Set Up Alertmanager for Prometheus"
description: "Configure Alertmanager to route and manage Prometheus alerts. Set up notification channels including Slack, PagerDuty, and email with routing rules."
category: "observability"
difficulty: "intermediate"
publishDate: "2026-01-22"
tags: ["alertmanager", "prometheus", "alerts", "notifications", "monitoring"]
---

> 💡 **Quick Answer:** Install Alertmanager via **kube-prometheus-stack Helm chart** (`helm install prometheus prometheus-community/kube-prometheus-stack -n monitoring`). Configure notification channels in `alertmanager.yaml` with receivers for Slack, PagerDuty, or email, and routing rules to match alerts by severity/team.
>
> **Key command:** `kubectl -n monitoring create secret generic alertmanager-config --from-file=alertmanager.yaml`
>
> **Gotcha:** Prometheus must be configured with `--alertmanager-url` pointing to your Alertmanager service endpoint.

# How to Set Up Alertmanager for Prometheus

Alertmanager handles alerts from Prometheus, managing deduplication, grouping, silencing, and routing to notification channels like Slack, PagerDuty, and email.

## Install Alertmanager

```bash
# Using Helm with kube-prometheus-stack
helm repo add prometheus-community https://prometheus-community.github.io/helm-charts
helm install prometheus prometheus-community/kube-prometheus-stack \
  --namespace monitoring \
  --create-namespace

# Or standalone Alertmanager
helm install alertmanager prometheus-community/alertmanager \
  --namespace monitoring
```

## Basic Alertmanager Configuration

```yaml
# alertmanager-config.yaml
apiVersion: v1
kind: Secret
metadata:
  name: alertmanager-main
  namespace: monitoring
stringData:
  alertmanager.yaml: |
    global:
      resolve_timeout: 5m
      smtp_smarthost: 'smtp.example.com:587'
      smtp_from: 'alerts@example.com'
      smtp_auth_username: 'alerts@example.com'
      smtp_auth_password: 'password'
      slack_api_url: 'https://hooks.slack.com/services/xxx/yyy/zzz'

    route:
      group_by: ['alertname', 'namespace']
      group_wait: 30s
      group_interval: 5m
      repeat_interval: 4h
      receiver: 'default-receiver'
      routes:
        - match:
            severity: critical
          receiver: 'pagerduty-critical'
        - match:
            severity: warning
          receiver: 'slack-warnings'

    receivers:
      - name: 'default-receiver'
        email_configs:
          - to: 'team@example.com'
            
      - name: 'slack-warnings'
        slack_configs:
          - channel: '#alerts'
            send_resolved: true
            title: '{{ .Status | toUpper }}: {{ .CommonLabels.alertname }}'
            text: >-
              {{ range .Alerts }}
              *Alert:* {{ .Annotations.summary }}
              *Description:* {{ .Annotations.description }}
              *Severity:* {{ .Labels.severity }}
              {{ end }}

      - name: 'pagerduty-critical'
        pagerduty_configs:
          - service_key: 'your-pagerduty-service-key'
            severity: critical
```

## Slack Integration

```yaml
# slack-receiver.yaml
receivers:
  - name: 'slack-alerts'
    slack_configs:
      - api_url: 'https://hooks.slack.com/services/T00/B00/XXX'
        channel: '#kubernetes-alerts'
        username: 'Alertmanager'
        icon_emoji: ':warning:'
        send_resolved: true
        title: '{{ template "slack.title" . }}'
        text: '{{ template "slack.text" . }}'
        actions:
          - type: button
            text: 'Runbook :book:'
            url: '{{ (index .Alerts 0).Annotations.runbook_url }}'
          - type: button
            text: 'Dashboard :chart:'
            url: '{{ (index .Alerts 0).Annotations.dashboard_url }}'
```

## PagerDuty Integration

```yaml
# pagerduty-receiver.yaml
receivers:
  - name: 'pagerduty'
    pagerduty_configs:
      - routing_key: 'your-pagerduty-routing-key'
        severity: '{{ .CommonLabels.severity }}'
        description: '{{ .CommonAnnotations.summary }}'
        details:
          firing: '{{ template "pagerduty.instances" .Alerts.Firing }}'
          num_firing: '{{ .Alerts.Firing | len }}'
          num_resolved: '{{ .Alerts.Resolved | len }}'
          resolved: '{{ template "pagerduty.instances" .Alerts.Resolved }}'
```

## Email Configuration

```yaml
# email-receiver.yaml
receivers:
  - name: 'email-team'
    email_configs:
      - to: 'oncall@example.com, platform-team@example.com'
        from: 'alertmanager@example.com'
        smarthost: 'smtp.gmail.com:587'
        auth_username: 'alertmanager@example.com'
        auth_identity: 'alertmanager@example.com'
        auth_password: 'app-password'
        send_resolved: true
        headers:
          Subject: '[{{ .Status | toUpper }}] {{ .CommonLabels.alertname }}'
        html: '{{ template "email.html" . }}'
```

## Advanced Routing

```yaml
# advanced-routing.yaml
route:
  receiver: 'default'
  group_by: ['alertname', 'cluster', 'service']
  group_wait: 30s
  group_interval: 5m
  repeat_interval: 4h
  
  routes:
    # Critical alerts go to PagerDuty immediately
    - match:
        severity: critical
      receiver: 'pagerduty'
      group_wait: 10s
      repeat_interval: 1h
      continue: true  # Also send to next matching route
      
    # Database alerts to DBA team
    - match_re:
        alertname: ^(Postgres|MySQL|Redis).*$
      receiver: 'dba-slack'
      
    # Namespace-based routing
    - match:
        namespace: production
      receiver: 'production-alerts'
      routes:
        - match:
            severity: warning
          receiver: 'prod-warnings'
          
    # Time-based routing (business hours)
    - match:
        severity: warning
      receiver: 'slack-warnings'
      active_time_intervals:
        - business-hours

time_intervals:
  - name: business-hours
    time_intervals:
      - weekdays: ['monday:friday']
        times:
          - start_time: '09:00'
            end_time: '17:00'
```

## Inhibition Rules

```yaml
# inhibition-rules.yaml
inhibit_rules:
  # Don't alert for warnings if critical is firing
  - source_match:
      severity: 'critical'
    target_match:
      severity: 'warning'
    equal: ['alertname', 'namespace']
    
  # Don't alert if cluster is down
  - source_match:
      alertname: 'ClusterDown'
    target_match_re:
      alertname: '.+'
    equal: ['cluster']
    
  # Inhibit pod alerts if node is down
  - source_match:
      alertname: 'NodeDown'
    target_match:
      alertname: 'PodCrashLooping'
    equal: ['node']
```

## Prometheus Alert Rules

```yaml
# prometheus-rules.yaml
apiVersion: monitoring.coreos.com/v1
kind: PrometheusRule
metadata:
  name: kubernetes-alerts
  namespace: monitoring
spec:
  groups:
    - name: kubernetes.rules
      rules:
        - alert: PodCrashLooping
          expr: |
            rate(kube_pod_container_status_restarts_total[15m]) * 60 * 5 > 0
          for: 5m
          labels:
            severity: warning
          annotations:
            summary: "Pod {{ $labels.namespace }}/{{ $labels.pod }} is crash looping"
            description: "Pod has restarted {{ $value }} times in the last 15 minutes"
            runbook_url: "https://runbooks.example.com/pod-crashloop"

        - alert: HighMemoryUsage
          expr: |
            (container_memory_usage_bytes / container_spec_memory_limit_bytes) > 0.9
          for: 5m
          labels:
            severity: warning
          annotations:
            summary: "High memory usage in {{ $labels.namespace }}/{{ $labels.pod }}"
            description: "Memory usage is at {{ $value | humanizePercentage }}"

        - alert: PodNotReady
          expr: |
            kube_pod_status_ready{condition="true"} == 0
          for: 15m
          labels:
            severity: critical
          annotations:
            summary: "Pod {{ $labels.namespace }}/{{ $labels.pod }} not ready"
```

## Silence Alerts

```bash
# Create silence via CLI
amtool silence add alertname=PodCrashLooping \
  --alertmanager.url=http://alertmanager:9093 \
  --comment="Known issue, fix in progress" \
  --duration=2h

# List active silences
amtool silence query --alertmanager.url=http://alertmanager:9093

# Expire silence
amtool silence expire <silence-id> --alertmanager.url=http://alertmanager:9093
```

## Access Alertmanager UI

```bash
# Port forward
kubectl port-forward svc/alertmanager-main -n monitoring 9093:9093

# Access UI at http://localhost:9093
```

## Test Alert Configuration

```bash
# Send test alert
curl -X POST http://alertmanager:9093/api/v1/alerts \
  -H "Content-Type: application/json" \
  -d '[{
    "labels": {
      "alertname": "TestAlert",
      "severity": "warning",
      "namespace": "default"
    },
    "annotations": {
      "summary": "This is a test alert",
      "description": "Testing alertmanager routing"
    }
  }]'
```

## Summary

Alertmanager centralizes alert management for Prometheus. Configure receivers for multiple channels, use routing rules to direct alerts based on labels, and set up inhibition to reduce noise. Use silences for maintenance windows and test configurations before production deployment.

---

## 📘 Go Further with Kubernetes Recipes

**Love this recipe? There's so much more!** This is just one of **100+ hands-on recipes** in our comprehensive **[Kubernetes Recipes book](https://amzn.to/3DzC8QA)**.

Inside the book, you'll master:
- ✅ Production-ready deployment strategies
- ✅ Advanced networking and security patterns  
- ✅ Observability, monitoring, and troubleshooting
- ✅ Real-world best practices from industry experts

> *"The practical, recipe-based approach made complex Kubernetes concepts finally click for me."*

**👉 [Get Your Copy Now](https://amzn.to/3DzC8QA)** — Start building production-grade Kubernetes skills today!
