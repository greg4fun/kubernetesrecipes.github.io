---
title: "How to Set Up Container Logging"
description: "Implement effective logging strategies for Kubernetes containers. Configure log collection, aggregation, and analysis with various logging patterns."
category: "observability"
difficulty: "beginner"
publishDate: "2026-01-22"
tags: ["logging", "observability", "fluentd", "elasticsearch", "troubleshooting"]
author: "Luca Berton"
---

> 💡 **Quick Answer:** Containers should log to **stdout/stderr** (not files). Kubernetes captures these via container runtime. Use `kubectl logs <pod>` to view. For aggregation, deploy log collectors (Fluent Bit, Fluentd) as DaemonSet to ship logs to Elasticsearch, Loki, or cloud services.
>
> **Key command:** `kubectl logs <pod> -c <container> --previous` (view previous container's logs after crash).
>
> **Gotcha:** Logs are lost when pods are deleted—always ship to external storage. Node-level logs rotate automatically but have limited retention.

# How to Set Up Container Logging

Kubernetes logging requires applications to write to stdout/stderr. The kubelet captures these logs and makes them available via `kubectl logs`.

## View Container Logs

```bash
# Basic log viewing
kubectl logs my-pod

# Specific container in multi-container pod
kubectl logs my-pod -c my-container

# Previous container (after restart/crash)
kubectl logs my-pod --previous

# Follow logs (tail -f)
kubectl logs my-pod -f

# Last N lines
kubectl logs my-pod --tail=100

# Logs since timestamp
kubectl logs my-pod --since=1h
kubectl logs my-pod --since-time="2024-01-15T10:00:00Z"

# All pods with label
kubectl logs -l app=my-app --all-containers
```

## Logging Patterns

### Pattern 1: Direct to stdout (Recommended)

```yaml
# Application logs to stdout
apiVersion: apps/v1
kind: Deployment
metadata:
  name: my-app
spec:
  template:
    spec:
      containers:
        - name: app
          image: my-app:latest
          # App configured to log to stdout
          env:
            - name: LOG_OUTPUT
              value: "stdout"
```

### Pattern 2: Sidecar for Log Processing

```yaml
# sidecar-logging.yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: app-with-sidecar
spec:
  template:
    spec:
      containers:
        - name: app
          image: my-app:latest
          volumeMounts:
            - name: logs
              mountPath: /var/log/app
        - name: log-shipper
          image: fluent/fluent-bit:latest
          volumeMounts:
            - name: logs
              mountPath: /var/log/app
            - name: fluent-config
              mountPath: /fluent-bit/etc
      volumes:
        - name: logs
          emptyDir: {}
        - name: fluent-config
          configMap:
            name: fluent-bit-config
```

### Pattern 3: Node-level Agent (DaemonSet)

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
```

## Fluent Bit Configuration

```yaml
# fluent-bit-configmap.yaml
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
        Parsers_File  parsers.conf
    
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
        K8S-Logging.Parser  On
    
    [OUTPUT]
        Name            es
        Match           *
        Host            elasticsearch.logging.svc.cluster.local
        Port            9200
        Index           kubernetes
        Type            _doc
  
  parsers.conf: |
    [PARSER]
        Name        docker
        Format      json
        Time_Key    time
        Time_Format %Y-%m-%dT%H:%M:%S.%L
```

## Structured Logging

```json
// Good: Structured JSON logging
{"timestamp":"2024-01-15T10:30:00Z","level":"info","message":"Request processed","requestId":"abc123","duration":45,"status":200}

// Bad: Unstructured text
[2024-01-15 10:30:00] INFO: Request processed in 45ms
```

```yaml
# App configured for JSON logging
env:
  - name: LOG_FORMAT
    value: "json"
  - name: LOG_LEVEL
    value: "info"
```

## Log Aggregation Stack Options

| Stack | Components | Best For |
|-------|------------|----------|
| EFK | Elasticsearch, Fluent Bit, Kibana | Full-text search, enterprise |
| PLG | Promtail, Loki, Grafana | Cost-effective, Prometheus users |
| Cloud | Fluent Bit to CloudWatch/Stackdriver | Managed Kubernetes |

## Deploy Loki Stack

```bash
# Install Loki stack with Helm
helm repo add grafana https://grafana.github.io/helm-charts
helm repo update

helm install loki grafana/loki-stack \
  --namespace logging \
  --create-namespace \
  --set grafana.enabled=true \
  --set promtail.enabled=true
```

## Log Rotation

```yaml
# Container runtime handles log rotation
# Configure in kubelet (usually /etc/kubernetes/kubelet.conf):
# containerLogMaxSize: "10Mi"
# containerLogMaxFiles: 5
```

## Troubleshooting Logs

```bash
# Pod events (not logs, but useful)
kubectl describe pod my-pod

# kubelet logs (node level)
journalctl -u kubelet

# Container runtime logs
journalctl -u containerd

# Check if logs exist on node
# SSH to node, then:
ls /var/log/containers/
```

## Best Practices

1. **Log to stdout/stderr** - not files inside containers
2. **Use structured logging** (JSON) for easier parsing
3. **Include context** - request IDs, user IDs, timestamps
4. **Set appropriate log levels** - DEBUG in dev, INFO/WARN in prod
5. **Ship logs externally** - pods are ephemeral
6. **Add resource limits** to log collectors
7. **Use sampling** for high-volume logs
