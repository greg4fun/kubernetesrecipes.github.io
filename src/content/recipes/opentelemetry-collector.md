---
title: "How to Collect Metrics with OpenTelemetry Collector"
description: "Deploy OpenTelemetry Collector for unified metrics, traces, and logs collection in Kubernetes. Learn pipelines, processors, and exporters configuration."
category: "observability"
difficulty: "advanced"
publishDate: "2026-01-22"
tags: ["opentelemetry", "otel", "metrics", "observability", "collector"]
---

> 💡 **Quick Answer:** Deploy OpenTelemetry Collector as DaemonSet or Deployment. Configure pipeline: **Receivers** (OTLP, Prometheus, etc.) → **Processors** (batch, memory_limiter, attributes) → **Exporters** (Jaeger, Prometheus, Loki, etc.). Apps send telemetry to collector endpoint.
>
> **Key command:** `helm install otel-collector open-telemetry/opentelemetry-collector -f values.yaml`
>
> **Gotcha:** Set `memory_limiter` processor to prevent OOM; use `batch` processor to reduce backend load. Deploy as DaemonSet for logs, Deployment for traces/metrics.

# How to Collect Metrics with OpenTelemetry Collector

OpenTelemetry Collector provides vendor-agnostic telemetry collection. Deploy it as a central pipeline for metrics, traces, and logs with flexible processing and export options.

## Collector Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                   OpenTelemetry Collector                    │
│  ┌──────────┐    ┌────────────┐    ┌──────────────┐        │
│  │ Receivers│ →  │ Processors │ →  │  Exporters   │        │
│  └──────────┘    └────────────┘    └──────────────┘        │
│  - OTLP         - Batch           - Prometheus              │
│  - Prometheus   - Memory Limiter  - Jaeger                  │
│  - Jaeger       - Attributes      - Loki                    │
│  - Kubernetes   - Filter          - OTLP                    │
└─────────────────────────────────────────────────────────────┘
```

## Deploy Collector as DaemonSet

```yaml
# otel-collector-daemonset.yaml
apiVersion: apps/v1
kind: DaemonSet
metadata:
  name: otel-collector
  namespace: observability
spec:
  selector:
    matchLabels:
      app: otel-collector
  template:
    metadata:
      labels:
        app: otel-collector
    spec:
      serviceAccountName: otel-collector
      containers:
        - name: collector
          image: otel/opentelemetry-collector-contrib:0.92.0
          args: ["--config=/etc/otel/config.yaml"]
          ports:
            - containerPort: 4317   # OTLP gRPC
            - containerPort: 4318   # OTLP HTTP
            - containerPort: 8888   # Metrics
            - containerPort: 8889   # Prometheus exporter
          env:
            - name: K8S_NODE_NAME
              valueFrom:
                fieldRef:
                  fieldPath: spec.nodeName
            - name: K8S_POD_NAME
              valueFrom:
                fieldRef:
                  fieldPath: metadata.name
          volumeMounts:
            - name: config
              mountPath: /etc/otel
            - name: varlog
              mountPath: /var/log
              readOnly: true
            - name: containers
              mountPath: /var/lib/docker/containers
              readOnly: true
          resources:
            limits:
              memory: 500Mi
              cpu: 500m
            requests:
              memory: 100Mi
              cpu: 100m
      volumes:
        - name: config
          configMap:
            name: otel-collector-config
        - name: varlog
          hostPath:
            path: /var/log
        - name: containers
          hostPath:
            path: /var/lib/docker/containers
```

## Collector Configuration

```yaml
# otel-collector-config.yaml
apiVersion: v1
kind: ConfigMap
metadata:
  name: otel-collector-config
  namespace: observability
data:
  config.yaml: |
    receivers:
      # Receive OTLP data from applications
      otlp:
        protocols:
          grpc:
            endpoint: 0.0.0.0:4317
          http:
            endpoint: 0.0.0.0:4318
      
      # Scrape Prometheus metrics
      prometheus:
        config:
          scrape_configs:
            - job_name: 'kubernetes-pods'
              kubernetes_sd_configs:
                - role: pod
              relabel_configs:
                - source_labels: [__meta_kubernetes_pod_annotation_prometheus_io_scrape]
                  action: keep
                  regex: true
                - source_labels: [__meta_kubernetes_pod_annotation_prometheus_io_path]
                  action: replace
                  target_label: __metrics_path__
                  regex: (.+)
      
      # Collect Kubernetes events
      k8s_events:
        namespaces: []  # All namespaces
      
      # Host metrics
      hostmetrics:
        collection_interval: 30s
        scrapers:
          cpu:
          memory:
          disk:
          network:
          filesystem:

    processors:
      # Batch for efficiency
      batch:
        timeout: 10s
        send_batch_size: 1000
      
      # Memory protection
      memory_limiter:
        check_interval: 1s
        limit_mib: 400
        spike_limit_mib: 100
      
      # Add Kubernetes metadata
      k8sattributes:
        auth_type: serviceAccount
        extract:
          metadata:
            - k8s.pod.name
            - k8s.pod.uid
            - k8s.namespace.name
            - k8s.node.name
            - k8s.deployment.name
          labels:
            - tag_name: app
              key: app
              from: pod
        pod_association:
          - sources:
              - from: resource_attribute
                name: k8s.pod.ip
      
      # Filter unwanted data
      filter:
        metrics:
          exclude:
            match_type: regexp
            metric_names:
              - go_.*
              - process_.*
      
      # Transform attributes
      attributes:
        actions:
          - key: environment
            value: production
            action: insert
          - key: cluster
            value: main-cluster
            action: insert

    exporters:
      # Prometheus remote write
      prometheusremotewrite:
        endpoint: http://prometheus:9090/api/v1/write
        tls:
          insecure: true
      
      # Prometheus exporter (pull-based)
      prometheus:
        endpoint: 0.0.0.0:8889
        namespace: otel
      
      # Jaeger for traces
      jaeger:
        endpoint: jaeger-collector:14250
        tls:
          insecure: true
      
      # Loki for logs
      loki:
        endpoint: http://loki:3100/loki/api/v1/push
        labels:
          resource:
            k8s.namespace.name: namespace
            k8s.pod.name: pod
      
      # Debug logging
      logging:
        loglevel: info

    extensions:
      health_check:
        endpoint: 0.0.0.0:13133
      zpages:
        endpoint: 0.0.0.0:55679

    service:
      extensions: [health_check, zpages]
      pipelines:
        metrics:
          receivers: [otlp, prometheus, hostmetrics]
          processors: [memory_limiter, k8sattributes, batch]
          exporters: [prometheusremotewrite]
        traces:
          receivers: [otlp]
          processors: [memory_limiter, k8sattributes, batch]
          exporters: [jaeger]
        logs:
          receivers: [otlp, k8s_events]
          processors: [memory_limiter, k8sattributes, batch]
          exporters: [loki]
```

## RBAC for Collector

```yaml
# otel-collector-rbac.yaml
apiVersion: v1
kind: ServiceAccount
metadata:
  name: otel-collector
  namespace: observability
---
apiVersion: rbac.authorization.k8s.io/v1
kind: ClusterRole
metadata:
  name: otel-collector
rules:
  - apiGroups: [""]
    resources:
      - events
      - namespaces
      - namespaces/status
      - nodes
      - nodes/spec
      - pods
      - pods/status
      - services
      - endpoints
    verbs: ["get", "list", "watch"]
  - apiGroups: ["apps"]
    resources:
      - replicasets
      - deployments
      - daemonsets
      - statefulsets
    verbs: ["get", "list", "watch"]
---
apiVersion: rbac.authorization.k8s.io/v1
kind: ClusterRoleBinding
metadata:
  name: otel-collector
roleRef:
  apiGroup: rbac.authorization.k8s.io
  kind: ClusterRole
  name: otel-collector
subjects:
  - kind: ServiceAccount
    name: otel-collector
    namespace: observability
```

## Collector Service

```yaml
# otel-collector-service.yaml
apiVersion: v1
kind: Service
metadata:
  name: otel-collector
  namespace: observability
spec:
  ports:
    - name: otlp-grpc
      port: 4317
      targetPort: 4317
    - name: otlp-http
      port: 4318
      targetPort: 4318
    - name: prometheus
      port: 8889
      targetPort: 8889
  selector:
    app: otel-collector
```

## Application Instrumentation

```yaml
# instrumented-app.yaml
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
          env:
            - name: OTEL_EXPORTER_OTLP_ENDPOINT
              value: "http://otel-collector.observability:4317"
            - name: OTEL_SERVICE_NAME
              value: "myapp"
            - name: OTEL_RESOURCE_ATTRIBUTES
              value: "service.namespace=production,service.version=1.0.0"
            - name: OTEL_TRACES_SAMPLER
              value: "parentbased_traceidratio"
            - name: OTEL_TRACES_SAMPLER_ARG
              value: "0.1"
```

## Gateway Deployment (Centralized)

```yaml
# otel-gateway.yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: otel-gateway
  namespace: observability
spec:
  replicas: 3
  selector:
    matchLabels:
      app: otel-gateway
  template:
    metadata:
      labels:
        app: otel-gateway
    spec:
      containers:
        - name: collector
          image: otel/opentelemetry-collector-contrib:0.92.0
          args: ["--config=/etc/otel/config.yaml"]
          resources:
            limits:
              memory: 2Gi
              cpu: 2000m
          volumeMounts:
            - name: config
              mountPath: /etc/otel
      volumes:
        - name: config
          configMap:
            name: otel-gateway-config
```

## Tail Sampling for Traces

```yaml
# Intelligent trace sampling in config
processors:
  tail_sampling:
    decision_wait: 10s
    num_traces: 100000
    policies:
      # Always sample errors
      - name: errors
        type: status_code
        status_code:
          status_codes: [ERROR]
      # Sample slow traces
      - name: slow-traces
        type: latency
        latency:
          threshold_ms: 1000
      # Sample 10% of remaining
      - name: probabilistic
        type: probabilistic
        probabilistic:
          sampling_percentage: 10
```

## Summary

OpenTelemetry Collector unifies telemetry collection across metrics, traces, and logs. Deploy as DaemonSet for node-level collection and Gateway for centralized processing. Use processors for enrichment, filtering, and sampling before exporting to your observability backends.

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
