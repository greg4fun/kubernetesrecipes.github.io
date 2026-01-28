---
title: "How to Configure Alertmanager for Kubernetes Alerts"
description: "Set up Alertmanager to route, group, and deliver Kubernetes alerts. Learn to configure Slack, PagerDuty, and email notifications."
category: "observability"
difficulty: "intermediate"
timeToComplete: "30 minutes"
kubernetesVersion: "1.28+"
prerequisites:
  - "A running Kubernetes cluster"
  - "Prometheus Operator installed"
  - "Basic understanding of alerting concepts"
relatedRecipes:
  - "prometheus-metrics-setup"
  - "grafana-dashboards"
tags:
  - alertmanager
  - monitoring
  - alerts
  - notifications
  - observability
publishDate: "2026-01-21"
author: "Luca Berton"
---

## The Problem

You have Prometheus collecting metrics, but you need to be notified when things go wrong instead of constantly watching dashboards.

## The Solution

Configure Alertmanager to receive alerts from Prometheus and route them to the appropriate notification channels based on severity and team.

## Understanding the Flow

```
Prometheus → Alerting Rules → Alertmanager → Notifications
```

## Step 1: Create Alerting Rules

```yaml
apiVersion: monitoring.coreos.com/v1
kind: PrometheusRule
metadata:
  name: kubernetes-alerts
  namespace: monitoring
  labels:
    release: prometheus  # Match your Prometheus operator release
spec:
  groups:
  - name: kubernetes
    rules:
    - alert: PodCrashLooping
      expr: |
        rate(kube_pod_container_status_restarts_total[15m]) > 0
      for: 5m
      labels:
        severity: warning
      annotations:
        summary: "Pod {{ $labels.pod }} is crash looping"
        description: "Pod {{ $labels.pod }} in namespace {{ $labels.namespace }} is restarting frequently."
    
    - alert: PodNotReady
      expr: |
        kube_pod_status_ready{condition="false"} == 1
      for: 15m
      labels:
        severity: warning
      annotations:
        summary: "Pod {{ $labels.pod }} is not ready"
        description: "Pod {{ $labels.pod }} has been not ready for more than 15 minutes."
    
    - alert: HighMemoryUsage
      expr: |
        (container_memory_usage_bytes / container_spec_memory_limit_bytes) > 0.9
      for: 5m
      labels:
        severity: critical
      annotations:
        summary: "High memory usage in {{ $labels.pod }}"
        description: "Container {{ $labels.container }} in pod {{ $labels.pod }} is using more than 90% of its memory limit."
    
    - alert: NodeNotReady
      expr: |
        kube_node_status_condition{condition="Ready",status="true"} == 0
      for: 5m
      labels:
        severity: critical
      annotations:
        summary: "Node {{ $labels.node }} is not ready"
        description: "Node {{ $labels.node }} has been not ready for more than 5 minutes."
```

## Step 2: Configure Alertmanager

### Alertmanager Config Secret

```yaml
apiVersion: v1
kind: Secret
metadata:
  name: alertmanager-main
  namespace: monitoring
type: Opaque
stringData:
  alertmanager.yaml: |
    global:
      resolve_timeout: 5m
      slack_api_url: 'https://hooks.slack.com/services/YOUR/SLACK/WEBHOOK'
    
    route:
      group_by: ['alertname', 'namespace']
      group_wait: 30s
      group_interval: 5m
      repeat_interval: 4h
      receiver: 'slack-notifications'
      routes:
      - match:
          severity: critical
        receiver: 'pagerduty-critical'
        continue: true
      - match:
          severity: critical
        receiver: 'slack-critical'
      - match:
          severity: warning
        receiver: 'slack-warnings'
      - match:
          team: database
        receiver: 'database-team'
    
    receivers:
    - name: 'slack-notifications'
      slack_configs:
      - channel: '#alerts'
        send_resolved: true
        title: '{{ .Status | toUpper }}: {{ .CommonAnnotations.summary }}'
        text: '{{ .CommonAnnotations.description }}'
    
    - name: 'slack-critical'
      slack_configs:
      - channel: '#alerts-critical'
        send_resolved: true
        color: '{{ if eq .Status "firing" }}danger{{ else }}good{{ end }}'
        title: '🚨 {{ .CommonAnnotations.summary }}'
        text: '{{ .CommonAnnotations.description }}'
    
    - name: 'slack-warnings'
      slack_configs:
      - channel: '#alerts-warning'
        send_resolved: true
    
    - name: 'pagerduty-critical'
      pagerduty_configs:
      - service_key: 'YOUR-PAGERDUTY-KEY'
        send_resolved: true
    
    - name: 'database-team'
      email_configs:
      - to: 'database-team@example.com'
        send_resolved: true
    
    inhibit_rules:
    - source_match:
        severity: 'critical'
      target_match:
        severity: 'warning'
      equal: ['alertname', 'namespace']
```

## Slack Configuration

### Rich Slack Messages

```yaml
receivers:
- name: 'slack-detailed'
  slack_configs:
  - channel: '#kubernetes-alerts'
    send_resolved: true
    icon_url: https://avatars.githubusercontent.com/u/3380462
    title: '{{ template "slack.default.title" . }}'
    text: '{{ template "slack.default.text" . }}'
    actions:
    - type: button
      text: 'Runbook :notebook:'
      url: '{{ (index .Alerts 0).Annotations.runbook_url }}'
    - type: button
      text: 'Dashboard :chart_with_upwards_trend:'
      url: 'https://grafana.example.com/d/abc123'
```

## PagerDuty Configuration

```yaml
receivers:
- name: 'pagerduty'
  pagerduty_configs:
  - service_key: '<your-integration-key>'
    send_resolved: true
    severity: '{{ if eq .Status "firing" }}critical{{ else }}info{{ end }}'
    description: '{{ .CommonAnnotations.summary }}'
    details:
      firing: '{{ template "pagerduty.default.instances" .Alerts.Firing }}'
      resolved: '{{ template "pagerduty.default.instances" .Alerts.Resolved }}'
      num_firing: '{{ .Alerts.Firing | len }}'
      num_resolved: '{{ .Alerts.Resolved | len }}'
```

## Email Configuration

```yaml
global:
  smtp_smarthost: 'smtp.gmail.com:587'
  smtp_from: 'alertmanager@example.com'
  smtp_auth_username: 'alertmanager@example.com'
  smtp_auth_password: 'your-app-password'

receivers:
- name: 'email'
  email_configs:
  - to: 'oncall@example.com'
    send_resolved: true
    headers:
      subject: '{{ .Status | toUpper }}: {{ .CommonAnnotations.summary }}'
    html: |
      <h2>{{ .Status | toUpper }}</h2>
      <p><strong>Alert:</strong> {{ .CommonAnnotations.summary }}</p>
      <p><strong>Description:</strong> {{ .CommonAnnotations.description }}</p>
```

## OpsGenie Configuration

```yaml
receivers:
- name: 'opsgenie'
  opsgenie_configs:
  - api_key: '<your-api-key>'
    message: '{{ .CommonAnnotations.summary }}'
    description: '{{ .CommonAnnotations.description }}'
    priority: '{{ if eq .CommonLabels.severity "critical" }}P1{{ else }}P3{{ end }}'
```

## Routing Rules

### Team-Based Routing

```yaml
route:
  receiver: 'default'
  routes:
  - match:
      namespace: 'production'
    receiver: 'production-team'
  - match_re:
      namespace: 'team-.*'
    receiver: 'platform-team'
```

### Time-Based Routing

```yaml
route:
  receiver: 'default'
  routes:
  - match:
      severity: critical
    receiver: 'pagerduty'
    active_time_intervals:
    - business-hours
    
time_intervals:
- name: business-hours
  time_intervals:
  - weekdays: ['monday:friday']
    times:
    - start_time: '09:00'
      end_time: '17:00'
    location: 'America/New_York'
```

## Silences

### Create a Silence via API

```bash
# Using amtool
amtool silence add alertname=PodNotReady --duration=2h --comment="Maintenance window"

# Via kubectl
kubectl port-forward -n monitoring svc/alertmanager-main 9093:9093
# Then access http://localhost:9093
```

### Programmatic Silence

```yaml
apiVersion: batch/v1
kind: Job
metadata:
  name: create-silence
spec:
  template:
    spec:
      containers:
      - name: silence
        image: prom/alertmanager
        command:
        - amtool
        - silence
        - add
        - alertname="MaintenanceAlert"
        - --alertmanager.url=http://alertmanager-main:9093
        - --duration=2h
      restartPolicy: Never
```

## Testing Alerts

### Fire a Test Alert

```bash
curl -X POST http://localhost:9093/api/v1/alerts \
  -H "Content-Type: application/json" \
  -d '[{
    "labels": {
      "alertname": "TestAlert",
      "severity": "warning"
    },
    "annotations": {
      "summary": "This is a test alert",
      "description": "Testing Alertmanager configuration"
    }
  }]'
```

## Best Practices

### 1. Don't Alert on Everything

Focus on actionable alerts that require human intervention.

### 2. Set Appropriate Severities

- **Critical**: Immediate action required
- **Warning**: Investigate soon
- **Info**: For dashboards only

### 3. Use Inhibit Rules

Prevent alert storms:

```yaml
inhibit_rules:
- source_match:
    alertname: 'NodeDown'
  target_match_re:
    alertname: 'Pod.*'
  equal: ['node']
```

### 4. Group Related Alerts

```yaml
route:
  group_by: ['alertname', 'cluster', 'service']
  group_wait: 30s
  group_interval: 5m
```

### 5. Include Runbook URLs

```yaml
annotations:
  runbook_url: 'https://wiki.example.com/runbooks/pod-crash-looping'
```

## Key Takeaways

- Define clear alerting rules with appropriate thresholds
- Route alerts based on severity and team ownership
- Use inhibit rules to prevent alert fatigue
- Include actionable information in alerts
- Test your alerting configuration regularly

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
