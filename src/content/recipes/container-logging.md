---
title: "How to Configure Container Logging"
description: "Set up effective logging for Kubernetes workloads. Configure log formats, implement structured logging, and integrate with logging backends."
category: "observability"
difficulty: "beginner"
publishDate: "2026-01-22"
tags: ["logging", "observability", "stdout", "fluentd", "structured-logging"]
---

# How to Configure Container Logging

Kubernetes captures container logs from stdout and stderr. Understanding logging patterns and configuration ensures effective debugging and monitoring.

## Basic Logging Concepts

```bash
# Kubernetes captures logs from:
# - stdout (standard output)
# - stderr (standard error)

# Logs are stored on nodes at:
# /var/log/containers/<pod>_<namespace>_<container>-<id>.log
# /var/log/pods/<namespace>_<pod>_<uid>/<container>/

# View container logs
kubectl logs mypod
kubectl logs mypod -c mycontainer  # Specific container
```

## View Logs

```bash
# Basic log viewing
kubectl logs mypod

# Follow logs (like tail -f)
kubectl logs mypod -f

# Last N lines
kubectl logs mypod --tail=100

# Logs from last hour
kubectl logs mypod --since=1h

# Logs since timestamp
kubectl logs mypod --since-time="2024-01-20T10:00:00Z"

# Logs from previous container instance
kubectl logs mypod --previous

# Logs from all containers in pod
kubectl logs mypod --all-containers

# Logs from multiple pods
kubectl logs -l app=myapp

# Logs with timestamps
kubectl logs mypod --timestamps
```

## Application Logging Best Practices

```yaml
# Write to stdout/stderr, not files
# Let Kubernetes handle log collection

# Example Python app
# app.py
import logging
import sys

# Configure logging to stdout
logging.basicConfig(
    stream=sys.stdout,
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)
logger.info("Application started")
```

```yaml
# Node.js example
# Use console.log/console.error
console.log(JSON.stringify({
  timestamp: new Date().toISOString(),
  level: 'info',
  message: 'Request processed',
  requestId: '123'
}));
```

## Structured Logging (JSON)

```yaml
# deployment-with-json-logging.yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: api-server
spec:
  replicas: 3
  selector:
    matchLabels:
      app: api-server
  template:
    metadata:
      labels:
        app: api-server
    spec:
      containers:
        - name: api
          image: myapi:v1
          env:
            - name: LOG_FORMAT
              value: "json"
            - name: LOG_LEVEL
              value: "info"
```

```json
// JSON log output (recommended)
{
  "timestamp": "2024-01-20T10:30:00.000Z",
  "level": "info",
  "message": "Request handled",
  "method": "GET",
  "path": "/api/users",
  "status": 200,
  "duration_ms": 45,
  "request_id": "abc-123",
  "user_id": "user-456"
}
```

## Sidecar Logging Pattern

```yaml
# sidecar-logging.yaml
apiVersion: v1
kind: Pod
metadata:
  name: app-with-log-sidecar
spec:
  containers:
    # Main application
    - name: app
      image: myapp:v1
      volumeMounts:
        - name: logs
          mountPath: /var/log/app
    
    # Log streaming sidecar
    - name: log-streamer
      image: busybox:latest
      command:
        - /bin/sh
        - -c
        - tail -F /var/log/app/app.log
      volumeMounts:
        - name: logs
          mountPath: /var/log/app
          readOnly: true
  
  volumes:
    - name: logs
      emptyDir: {}
```

## Multiple Log Streams

```yaml
# multiple-log-streams.yaml
apiVersion: v1
kind: Pod
metadata:
  name: multi-stream-logs
spec:
  containers:
    - name: app
      image: myapp:v1
      volumeMounts:
        - name: logs
          mountPath: /var/log/app
    
    # Sidecar for access logs
    - name: access-log
      image: busybox:latest
      command: ["tail", "-F", "/var/log/app/access.log"]
      volumeMounts:
        - name: logs
          mountPath: /var/log/app
          readOnly: true
    
    # Sidecar for error logs
    - name: error-log
      image: busybox:latest
      command: ["tail", "-F", "/var/log/app/error.log"]
      volumeMounts:
        - name: logs
          mountPath: /var/log/app
          readOnly: true
  
  volumes:
    - name: logs
      emptyDir: {}
```

```bash
# View specific log stream
kubectl logs multi-stream-logs -c access-log
kubectl logs multi-stream-logs -c error-log
```

## Log Level Configuration

```yaml
# configmap-log-level.yaml
apiVersion: v1
kind: ConfigMap
metadata:
  name: app-config
data:
  LOG_LEVEL: "debug"
  LOG_FORMAT: "json"
---
apiVersion: apps/v1
kind: Deployment
metadata:
  name: myapp
spec:
  template:
    spec:
      containers:
        - name: app
          image: myapp:v1
          envFrom:
            - configMapRef:
                name: app-config
```

## Fluent Bit DaemonSet

```yaml
# fluent-bit-daemonset.yaml
apiVersion: apps/v1
kind: DaemonSet
metadata:
  name: fluent-bit
  namespace: logging
spec:
  selector:
    matchLabels:
      app: fluent-bit
  template:
    metadata:
      labels:
        app: fluent-bit
    spec:
      serviceAccountName: fluent-bit
      containers:
        - name: fluent-bit
          image: fluent/fluent-bit:latest
          volumeMounts:
            - name: varlog
              mountPath: /var/log
              readOnly: true
            - name: containers
              mountPath: /var/lib/docker/containers
              readOnly: true
            - name: config
              mountPath: /fluent-bit/etc
      volumes:
        - name: varlog
          hostPath:
            path: /var/log
        - name: containers
          hostPath:
            path: /var/lib/docker/containers
        - name: config
          configMap:
            name: fluent-bit-config
---
apiVersion: v1
kind: ConfigMap
metadata:
  name: fluent-bit-config
  namespace: logging
data:
  fluent-bit.conf: |
    [SERVICE]
        Flush         5
        Log_Level     info
        Daemon        off
    
    [INPUT]
        Name              tail
        Path              /var/log/containers/*.log
        Parser            docker
        Tag               kube.*
        Refresh_Interval  5
        Mem_Buf_Limit     50MB
    
    [FILTER]
        Name                kubernetes
        Match               kube.*
        Kube_URL            https://kubernetes.default.svc:443
        Kube_CA_File        /var/run/secrets/kubernetes.io/serviceaccount/ca.crt
        Kube_Token_File     /var/run/secrets/kubernetes.io/serviceaccount/token
        Merge_Log           On
    
    [OUTPUT]
        Name            es
        Match           *
        Host            elasticsearch.logging.svc.cluster.local
        Port            9200
        Index           kubernetes-logs
        Type            _doc
```

## Loki for Log Aggregation

```yaml
# promtail-config.yaml
apiVersion: v1
kind: ConfigMap
metadata:
  name: promtail-config
  namespace: logging
data:
  promtail.yaml: |
    server:
      http_listen_port: 9080
    
    positions:
      filename: /tmp/positions.yaml
    
    clients:
      - url: http://loki:3100/loki/api/v1/push
    
    scrape_configs:
      - job_name: kubernetes-pods
        kubernetes_sd_configs:
          - role: pod
        pipeline_stages:
          - json:
              expressions:
                level: level
                message: msg
          - labels:
              level:
        relabel_configs:
          - source_labels: [__meta_kubernetes_pod_label_app]
            target_label: app
          - source_labels: [__meta_kubernetes_namespace]
            target_label: namespace
          - source_labels: [__meta_kubernetes_pod_name]
            target_label: pod
```

## Log Rotation

```yaml
# Container runtime handles log rotation
# Configure kubelet for log rotation:

# /var/lib/kubelet/config.yaml
containerLogMaxSize: "50Mi"
containerLogMaxFiles: 5
```

## Debugging Log Issues

```bash
# Check if logs are being collected
kubectl logs mypod --tail=10

# Check log file on node
# SSH to node, then:
ls -la /var/log/containers/ | grep mypod
cat /var/log/containers/mypod_*.log

# Check container runtime logs
journalctl -u containerd -f
journalctl -u docker -f

# Verify logging driver
docker inspect <container-id> | jq '.[0].HostConfig.LogConfig'
```

## Logging with Init Containers

```yaml
# init-container-logging.yaml
apiVersion: v1
kind: Pod
metadata:
  name: app-with-init
spec:
  initContainers:
    - name: init-config
      image: busybox:latest
      command:
        - /bin/sh
        - -c
        - |
          echo "$(date) - Initializing configuration..."
          # Init work here
          echo "$(date) - Initialization complete"
  containers:
    - name: app
      image: myapp:v1
```

```bash
# View init container logs
kubectl logs app-with-init -c init-config
```

## Audit Logging

```yaml
# Application audit logging example
# Log important events for compliance

# audit-log.json format
{
  "timestamp": "2024-01-20T10:30:00Z",
  "event_type": "user_login",
  "user_id": "user-123",
  "source_ip": "10.0.0.50",
  "action": "login",
  "result": "success",
  "metadata": {
    "session_id": "sess-abc",
    "user_agent": "Mozilla/5.0..."
  }
}
```

## Log Annotations

```yaml
# Add annotations for log processors
apiVersion: v1
kind: Pod
metadata:
  name: annotated-pod
  annotations:
    # Fluent Bit annotations
    fluentbit.io/parser: json
    fluentbit.io/exclude: "false"
    # Promtail/Loki annotations
    promtail.io/pipeline: json
spec:
  containers:
    - name: app
      image: myapp:v1
```

## Best Practices Summary

```yaml
# 1. Log to stdout/stderr
# Don't write to files inside containers

# 2. Use structured logging (JSON)
{"level":"info","message":"Request handled","request_id":"123"}

# 3. Include context in logs
# - Request ID for tracing
# - User ID for audit
# - Timestamps in ISO format

# 4. Set appropriate log levels
# - debug: Development only
# - info: Normal operations
# - warn: Potential issues
# - error: Failures requiring attention

# 5. Don't log sensitive data
# - No passwords, tokens, or PII
# - Mask or redact sensitive fields

# 6. Use correlation IDs
# - Trace requests across services
# - Include in all related logs
```

## Summary

Kubernetes captures container logs from stdout/stderr automatically. Use structured JSON logging for better parsing and analysis. For applications that write to files, use sidecar containers to stream logs. Configure log aggregation with Fluent Bit, Fluentd, or Promtail to collect and forward logs to centralized systems like Elasticsearch or Loki. Always include relevant context like request IDs and timestamps in log messages.

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
