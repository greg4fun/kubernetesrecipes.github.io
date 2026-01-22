---
title: "How to Use Kubernetes Events for Monitoring"
description: "Monitor cluster activity through Kubernetes events. Capture, filter, and alert on events for troubleshooting and operational visibility."
category: "observability"
difficulty: "beginner"
publishDate: "2026-01-22"
tags: ["events", "monitoring", "troubleshooting", "observability", "alerts"]
---

# How to Use Kubernetes Events for Monitoring

Kubernetes events provide insights into cluster operations: pod scheduling, container crashes, resource issues, and more. Learn to capture and leverage events for monitoring and troubleshooting.

## View Events

```bash
# All events in current namespace
kubectl get events

# Events sorted by time
kubectl get events --sort-by='.lastTimestamp'

# All events across namespaces
kubectl get events -A

# Watch events in real-time
kubectl get events -w

# Events for specific resource
kubectl get events --field-selector involvedObject.name=my-pod

# Only warning events
kubectl get events --field-selector type=Warning
```

## Event Types

```bash
# Event types:
# - Normal: Regular operations (scheduling, pulling images, started)
# - Warning: Issues that may need attention (failed, unhealthy, evicted)

# Filter by type
kubectl get events --field-selector type=Normal
kubectl get events --field-selector type=Warning

# Common event reasons:
# Scheduled, Pulled, Created, Started      - Normal pod lifecycle
# Killing, Unhealthy, BackOff             - Pod issues
# FailedScheduling, FailedMount           - Resource problems
# Evicted, OOMKilling                     - Capacity issues
```

## Detailed Event Information

```bash
# Get event details
kubectl describe events

# JSON output for parsing
kubectl get events -o json

# Custom columns
kubectl get events -o custom-columns=\
'TIME:.lastTimestamp,TYPE:.type,REASON:.reason,OBJECT:.involvedObject.name,MESSAGE:.message'

# Filter specific fields
kubectl get events -o jsonpath='{range .items[*]}{.involvedObject.name}{"\t"}{.reason}{"\t"}{.message}{"\n"}{end}'
```

## Events for Specific Resources

```bash
# Pod events
kubectl get events --field-selector involvedObject.kind=Pod,involvedObject.name=my-pod

# Deployment events
kubectl describe deployment my-deployment | grep -A 20 Events

# Node events
kubectl get events --field-selector involvedObject.kind=Node

# All events for a namespace
kubectl get events -n production

# Events for specific resource type
kubectl get events --field-selector involvedObject.kind=PersistentVolumeClaim
```

## Event Retention

```yaml
# Events expire after 1 hour by default
# Configure kube-apiserver for longer retention:
# --event-ttl=24h

# Check current events
kubectl get events --sort-by='.metadata.creationTimestamp' | tail -20
```

## Capture Events with Event Router

```yaml
# event-router.yaml
# Routes events to stdout for log collection
apiVersion: v1
kind: ServiceAccount
metadata:
  name: event-router
  namespace: kube-system
---
apiVersion: rbac.authorization.k8s.io/v1
kind: ClusterRole
metadata:
  name: event-router
rules:
  - apiGroups: [""]
    resources: ["events"]
    verbs: ["get", "watch", "list"]
---
apiVersion: rbac.authorization.k8s.io/v1
kind: ClusterRoleBinding
metadata:
  name: event-router
subjects:
  - kind: ServiceAccount
    name: event-router
    namespace: kube-system
roleRef:
  kind: ClusterRole
  name: event-router
  apiGroup: rbac.authorization.k8s.io
---
apiVersion: apps/v1
kind: Deployment
metadata:
  name: event-router
  namespace: kube-system
spec:
  replicas: 1
  selector:
    matchLabels:
      app: event-router
  template:
    metadata:
      labels:
        app: event-router
    spec:
      serviceAccountName: event-router
      containers:
        - name: event-router
          image: gcr.io/heptio-images/eventrouter:latest
          volumeMounts:
            - name: config
              mountPath: /etc/eventrouter
      volumes:
        - name: config
          configMap:
            name: event-router-config
---
apiVersion: v1
kind: ConfigMap
metadata:
  name: event-router-config
  namespace: kube-system
data:
  config.json: |
    {
      "sink": "glog"
    }
```

## Export Events to Prometheus

```yaml
# kube-state-metrics exposes event metrics
# Prometheus queries:

# Count of events by reason
sum by (reason) (kube_event_count)

# Warning events rate
sum(rate(kube_event_count{type="Warning"}[5m]))

# Events for specific pod
kube_event_count{involved_object_name="my-pod"}
```

## Alert on Critical Events

```yaml
# prometheus-alerts.yaml
groups:
  - name: kubernetes-events
    rules:
      - alert: PodCrashLooping
        expr: |
          sum by (namespace, pod) (
            kube_event_count{reason="BackOff", type="Warning"}
          ) > 5
        for: 10m
        labels:
          severity: warning
        annotations:
          summary: "Pod {{ $labels.pod }} is crash looping"
      
      - alert: PodEvicted
        expr: |
          kube_event_count{reason="Evicted"} > 0
        for: 1m
        labels:
          severity: critical
        annotations:
          summary: "Pod evicted in {{ $labels.namespace }}"
      
      - alert: FailedScheduling
        expr: |
          sum by (namespace) (
            kube_event_count{reason="FailedScheduling"}
          ) > 0
        for: 5m
        labels:
          severity: warning
        annotations:
          summary: "Pods failing to schedule in {{ $labels.namespace }}"
```

## Watch Specific Event Patterns

```bash
# Watch for OOM kills
kubectl get events -w --field-selector reason=OOMKilling

# Watch for failed scheduling
kubectl get events -w --field-selector reason=FailedScheduling

# Watch for node issues
kubectl get events -w --field-selector involvedObject.kind=Node,type=Warning

# Combined watch script
#!/bin/bash
kubectl get events -w -o custom-columns=\
'TIME:.lastTimestamp,NS:.involvedObject.namespace,KIND:.involvedObject.kind,NAME:.involvedObject.name,REASON:.reason,MESSAGE:.message' \
--field-selector type=Warning
```

## Send Events to Slack

```yaml
# event-watcher.yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: event-watcher
  namespace: monitoring
spec:
  replicas: 1
  selector:
    matchLabels:
      app: event-watcher
  template:
    metadata:
      labels:
        app: event-watcher
    spec:
      serviceAccountName: event-watcher
      containers:
        - name: watcher
          image: bitnami/kubectl:latest
          command:
            - /bin/sh
            - -c
            - |
              kubectl get events -w --field-selector type=Warning -o json | while read -r event; do
                REASON=$(echo "$event" | jq -r '.reason')
                MESSAGE=$(echo "$event" | jq -r '.message')
                OBJECT=$(echo "$event" | jq -r '.involvedObject.name')
                
                curl -X POST -H 'Content-type: application/json' \
                  --data "{\"text\":\"⚠️ K8s Warning: $REASON - $OBJECT: $MESSAGE\"}" \
                  $SLACK_WEBHOOK_URL
              done
          env:
            - name: SLACK_WEBHOOK_URL
              valueFrom:
                secretKeyRef:
                  name: slack-webhook
                  key: url
```

## Event Aggregation

```bash
# Count events by reason
kubectl get events -o json | jq '.items | group_by(.reason) | map({reason: .[0].reason, count: length})'

# Most frequent events
kubectl get events -o json | jq -r '.items | group_by(.reason) | sort_by(-length) | .[:10] | .[] | "\(.[0].reason): \(length)"'

# Events per namespace
kubectl get events -A -o json | jq -r '.items | group_by(.involvedObject.namespace) | .[] | "\(.[0].involvedObject.namespace): \(length)"'
```

## Common Troubleshooting Events

```bash
# Pod won't start - check events
kubectl describe pod <pod-name> | grep -A 10 Events

# Common issues:
# ImagePullBackOff - Registry/image issues
# CrashLoopBackOff - Container crashing
# Pending/FailedScheduling - Resource constraints
# FailedMount - Volume issues
# Unhealthy - Probe failures

# Node issues
kubectl get events --field-selector involvedObject.kind=Node,type=Warning

# PVC issues
kubectl get events --field-selector involvedObject.kind=PersistentVolumeClaim
```

## Kubernetes Event Exporter

```yaml
# kubernetes-event-exporter.yaml
apiVersion: v1
kind: ConfigMap
metadata:
  name: event-exporter-config
  namespace: monitoring
data:
  config.yaml: |
    logLevel: error
    logFormat: json
    route:
      routes:
        - match:
            - receiver: "dump"
        - match:
            - type: "Warning"
              receiver: "slack"
    receivers:
      - name: "dump"
        stdout: {}
      - name: "slack"
        slack:
          channel: "#k8s-alerts"
          token: "${SLACK_TOKEN}"
          message: "{{ .Message }}"
          fields:
            - title: Reason
              value: "{{ .Reason }}"
              short: true
            - title: Object
              value: "{{ .InvolvedObject.Name }}"
              short: true
```

## Summary

Kubernetes events provide real-time visibility into cluster operations. Use `kubectl get events` to view and filter events by type, reason, or resource. Events expire after 1 hour by default, so deploy Event Router or Event Exporter for long-term storage. Export events to Prometheus for metrics and alerting on critical conditions like OOMKilling, Evicted, or FailedScheduling. Integrate with Slack or other channels for immediate notification of issues. Events are essential for troubleshooting pod scheduling, container crashes, and resource problems.
