---
title: "How to Implement Container Logging Patterns"
description: "Configure logging for Kubernetes applications. Implement sidecar logging, log aggregation, and structured logging best practices."
category: "observability"
difficulty: "intermediate"
publishDate: "2026-01-22"
tags: ["logging", "observability", "sidecar", "fluentd", "stdout"]
---

# How to Implement Container Logging Patterns

Kubernetes captures container stdout/stderr logs. Learn logging patterns, sidecar collectors, and log aggregation strategies for production observability.

## Basic Logging (stdout/stderr)

```yaml
# stdout-logging.yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: web-app
spec:
  replicas: 3
  selector:
    matchLabels:
      app: web-app
  template:
    metadata:
      labels:
        app: web-app
    spec:
      containers:
        - name: app
          image: myapp:v1
          # Application should log to stdout/stderr
          # Kubernetes captures these automatically
```

```bash
# View logs
kubectl logs web-app-xxxxx

# Follow logs
kubectl logs -f web-app-xxxxx

# Previous container logs (after restart)
kubectl logs web-app-xxxxx --previous

# All pods with label
kubectl logs -l app=web-app

# Last 100 lines
kubectl logs web-app-xxxxx --tail=100

# Logs since timestamp
kubectl logs web-app-xxxxx --since=1h
kubectl logs web-app-xxxxx --since-time="2026-01-22T10:00:00Z"
```

## Structured Logging (JSON)

```python
# Python structured logging
import json
import sys
from datetime import datetime

def log(level, message, **kwargs):
    entry = {
        "timestamp": datetime.utcnow().isoformat(),
        "level": level,
        "message": message,
        **kwargs
    }
    print(json.dumps(entry), file=sys.stdout, flush=True)

# Usage
log("INFO", "Request processed", 
    request_id="abc123",
    duration_ms=45,
    status_code=200)

# Output:
# {"timestamp":"2026-01-22T10:30:00","level":"INFO","message":"Request processed","request_id":"abc123","duration_ms":45,"status_code":200}
```

```javascript
// Node.js structured logging
const log = (level, message, metadata = {}) => {
  const entry = {
    timestamp: new Date().toISOString(),
    level,
    message,
    ...metadata
  };
  console.log(JSON.stringify(entry));
};

// Usage
log('INFO', 'User logged in', { userId: '12345', ip: '192.168.1.1' });
```

```go
// Go structured logging with zerolog
import (
    "os"
    "github.com/rs/zerolog"
    "github.com/rs/zerolog/log"
)

func init() {
    zerolog.TimeFieldFormat = zerolog.TimeFormatUnix
    log.Logger = zerolog.New(os.Stdout).With().Timestamp().Logger()
}

// Usage
log.Info().
    Str("request_id", "abc123").
    Int("status", 200).
    Msg("Request processed")
```

## Sidecar Logging Pattern

```yaml
# sidecar-logging.yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: app-with-sidecar
spec:
  selector:
    matchLabels:
      app: myapp
  template:
    metadata:
      labels:
        app: myapp
    spec:
      containers:
        # Main application writes to file
        - name: app
          image: myapp:v1
          volumeMounts:
            - name: logs
              mountPath: /var/log/app
        
        # Sidecar streams logs to stdout
        - name: log-streamer
          image: busybox
          command: ["sh", "-c", "tail -F /var/log/app/*.log"]
          volumeMounts:
            - name: logs
              mountPath: /var/log/app
              readOnly: true
      
      volumes:
        - name: logs
          emptyDir: {}
```

## Multi-Stream Sidecar

```yaml
# multi-stream-sidecar.yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: multi-log-app
spec:
  selector:
    matchLabels:
      app: multi-log
  template:
    metadata:
      labels:
        app: multi-log
    spec:
      containers:
        - name: app
          image: myapp:v1
          volumeMounts:
            - name: logs
              mountPath: /var/log/app
        
        # Access logs sidecar
        - name: access-logs
          image: busybox
          command: ["sh", "-c", "tail -F /var/log/app/access.log"]
          volumeMounts:
            - name: logs
              mountPath: /var/log/app
              readOnly: true
        
        # Error logs sidecar
        - name: error-logs
          image: busybox
          command: ["sh", "-c", "tail -F /var/log/app/error.log"]
          volumeMounts:
            - name: logs
              mountPath: /var/log/app
              readOnly: true
      
      volumes:
        - name: logs
          emptyDir: {}
```

```bash
# View specific container logs
kubectl logs multi-log-app-xxx -c access-logs
kubectl logs multi-log-app-xxx -c error-logs
```

## Fluentd Sidecar

```yaml
# fluentd-sidecar.yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: app-with-fluentd
spec:
  selector:
    matchLabels:
      app: myapp
  template:
    metadata:
      labels:
        app: myapp
    spec:
      containers:
        - name: app
          image: myapp:v1
          volumeMounts:
            - name: logs
              mountPath: /var/log/app
        
        - name: fluentd
          image: fluent/fluentd:v1.16
          volumeMounts:
            - name: logs
              mountPath: /var/log/app
              readOnly: true
            - name: fluentd-config
              mountPath: /fluentd/etc
          env:
            - name: FLUENT_ELASTICSEARCH_HOST
              value: "elasticsearch.logging.svc"
      
      volumes:
        - name: logs
          emptyDir: {}
        - name: fluentd-config
          configMap:
            name: fluentd-config
---
apiVersion: v1
kind: ConfigMap
metadata:
  name: fluentd-config
data:
  fluent.conf: |
    <source>
      @type tail
      path /var/log/app/*.log
      pos_file /var/log/app/app.log.pos
      tag app.logs
      <parse>
        @type json
      </parse>
    </source>
    
    <match app.**>
      @type elasticsearch
      host "#{ENV['FLUENT_ELASTICSEARCH_HOST']}"
      port 9200
      index_name app-logs
      <buffer>
        @type file
        path /var/log/fluentd-buffers/app
        flush_interval 5s
      </buffer>
    </match>
```

## Node-Level Log Collection (DaemonSet)

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
          image: fluent/fluent-bit:2.2
          volumeMounts:
            - name: varlog
              mountPath: /var/log
              readOnly: true
            - name: containers
              mountPath: /var/lib/docker/containers
              readOnly: true
            - name: config
              mountPath: /fluent-bit/etc/
          env:
            - name: NODE_NAME
              valueFrom:
                fieldRef:
                  fieldPath: spec.nodeName
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
```

## Log Labels and Annotations

```yaml
# labeled-pod.yaml
apiVersion: v1
kind: Pod
metadata:
  name: labeled-app
  labels:
    app: myapp
    environment: production
    team: backend
  annotations:
    fluentd.io/parser: json
    prometheus.io/scrape: "true"
spec:
  containers:
    - name: app
      image: myapp:v1
```

## Application Log Configuration

```yaml
# configmap-logging.yaml
apiVersion: v1
kind: ConfigMap
metadata:
  name: logging-config
data:
  LOG_LEVEL: "info"
  LOG_FORMAT: "json"
  LOG_TIMESTAMP: "true"
---
apiVersion: apps/v1
kind: Deployment
metadata:
  name: configurable-logging
spec:
  selector:
    matchLabels:
      app: myapp
  template:
    spec:
      containers:
        - name: app
          image: myapp:v1
          envFrom:
            - configMapRef:
                name: logging-config
```

## Log Rotation

```yaml
# Log rotation is handled by container runtime
# Configure via kubelet flags or container runtime config

# For apps writing to files, use logrotate sidecar
apiVersion: apps/v1
kind: Deployment
metadata:
  name: app-with-logrotate
spec:
  selector:
    matchLabels:
      app: myapp
  template:
    spec:
      containers:
        - name: app
          image: myapp:v1
          volumeMounts:
            - name: logs
              mountPath: /var/log/app
        
        - name: logrotate
          image: blacklabelops/logrotate
          volumeMounts:
            - name: logs
              mountPath: /var/log/app
            - name: logrotate-config
              mountPath: /etc/logrotate.d
      volumes:
        - name: logs
          emptyDir:
            sizeLimit: 1Gi
        - name: logrotate-config
          configMap:
            name: logrotate-config
```

## Debug Logging

```bash
# Stream all container logs
kubectl logs -f deployment/myapp --all-containers

# Logs from terminated container
kubectl logs myapp-xxx --previous

# Get logs with timestamps
kubectl logs myapp-xxx --timestamps

# Multi-container pod
kubectl logs myapp-xxx -c sidecar

# Cross-namespace
kubectl logs -n production deployment/api
```

## Summary

Kubernetes captures stdout/stderr from containers automatically. Use JSON structured logging for easy parsing and filtering. Implement sidecar containers for apps that write to files. Deploy DaemonSets (Fluent Bit, Fluentd) for node-level log collection. Add metadata via labels and annotations for log enrichment. Configure log levels via ConfigMaps or environment variables. Use `kubectl logs` with `-f`, `--tail`, and `--since` for debugging.
