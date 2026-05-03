---
title: "OpenTelemetry in Kubernetes: Traces and Metrics"
description: "Deploy OpenTelemetry Collector in Kubernetes for distributed tracing and metrics. Auto-instrumentation, OTLP export, Jaeger integration."
publishDate: "2026-05-02"
author: "Luca Berton"
category: "observability"
difficulty: "advanced"
timeToComplete: "12 minutes"
kubernetesVersion: "1.28+"
tags:
  - "opentelemetry"
  - "tracing"
  - "observability"
  - "metrics"
  - "monitoring"
relatedRecipes:
  - "kubernetes-prometheus-monitoring-guide"
  - "kubernetes-service-mesh-istio-guide"
  - "kubernetes-probes-liveness-readiness"
---

> 💡 **Quick Answer:** Deploy OpenTelemetry Collector as DaemonSet or Deployment: `helm install otel-collector open-telemetry/opentelemetry-collector`. Apps send traces/metrics via OTLP to the collector, which exports to backends (Jaeger, Prometheus, Grafana Tempo, Datadog). Auto-instrumentation: annotate pods with `instrumentation.opentelemetry.io/inject-python: "true"` — no code changes needed.

## The Problem

Microservices observability requires:

- Distributed tracing across services (which service is slow?)
- Correlating traces, metrics, and logs
- Vendor-neutral instrumentation (avoid lock-in)
- Auto-instrumentation without code changes
- Unified collection pipeline

## The Solution

### Install OpenTelemetry Operator

```bash
# Install cert-manager first (operator dependency)
kubectl apply -f https://github.com/cert-manager/cert-manager/releases/download/v1.14.0/cert-manager.yaml

# Install OTel Operator
kubectl apply -f https://github.com/open-telemetry/opentelemetry-operator/releases/latest/download/opentelemetry-operator.yaml

# Or via Helm
helm repo add open-telemetry https://open-telemetry.github.io/opentelemetry-helm-charts
helm install otel-operator open-telemetry/opentelemetry-operator \
  -n opentelemetry --create-namespace
```

### OpenTelemetry Collector

```yaml
apiVersion: opentelemetry.io/v1beta1
kind: OpenTelemetryCollector
metadata:
  name: otel
  namespace: observability
spec:
  mode: deployment              # deployment, daemonset, sidecar, statefulset
  
  config:
    receivers:
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
    
    processors:
      batch:
        timeout: 5s
        send_batch_size: 1000
      
      memory_limiter:
        check_interval: 1s
        limit_mib: 512
      
      k8sattributes:
        extract:
          metadata:
          - k8s.pod.name
          - k8s.namespace.name
          - k8s.deployment.name
          - k8s.node.name
    
    exporters:
      # Jaeger for traces
      otlp/jaeger:
        endpoint: jaeger-collector.observability:4317
        tls:
          insecure: true
      
      # Prometheus for metrics
      prometheus:
        endpoint: 0.0.0.0:8889
      
      # Grafana Tempo for traces
      otlp/tempo:
        endpoint: tempo.observability:4317
        tls:
          insecure: true
      
      # Loki for logs
      loki:
        endpoint: http://loki.observability:3100/loki/api/v1/push
      
      debug:
        verbosity: detailed
    
    service:
      pipelines:
        traces:
          receivers: [otlp]
          processors: [memory_limiter, k8sattributes, batch]
          exporters: [otlp/jaeger, otlp/tempo]
        metrics:
          receivers: [otlp, prometheus]
          processors: [memory_limiter, batch]
          exporters: [prometheus]
        logs:
          receivers: [otlp]
          processors: [memory_limiter, batch]
          exporters: [loki]
```

### Auto-Instrumentation (No Code Changes)

```yaml
# Create Instrumentation resource
apiVersion: opentelemetry.io/v1alpha1
kind: Instrumentation
metadata:
  name: auto-instrumentation
  namespace: production
spec:
  exporter:
    endpoint: http://otel-collector.observability:4317
  propagators:
  - tracecontext
  - baggage
  - b3
  sampler:
    type: parentbased_traceidratio
    argument: "0.25"             # Sample 25% of traces
  
  python:
    image: ghcr.io/open-telemetry/opentelemetry-operator/autoinstrumentation-python:latest
  java:
    image: ghcr.io/open-telemetry/opentelemetry-operator/autoinstrumentation-java:latest
  nodejs:
    image: ghcr.io/open-telemetry/opentelemetry-operator/autoinstrumentation-nodejs:latest
  dotnet:
    image: ghcr.io/open-telemetry/opentelemetry-operator/autoinstrumentation-dotnet:latest
  go:
    image: ghcr.io/open-telemetry/opentelemetry-operator/autoinstrumentation-go:latest
```

```yaml
# Annotate pods for auto-instrumentation
apiVersion: apps/v1
kind: Deployment
metadata:
  name: my-python-app
spec:
  template:
    metadata:
      annotations:
        instrumentation.opentelemetry.io/inject-python: "true"
    spec:
      containers:
      - name: app
        image: my-python-app:v1
        env:
        - name: OTEL_SERVICE_NAME
          value: my-python-app

---
# Java app
apiVersion: apps/v1
kind: Deployment
metadata:
  name: my-java-app
spec:
  template:
    metadata:
      annotations:
        instrumentation.opentelemetry.io/inject-java: "true"
```

### Manual Instrumentation (Python Example)

```python
from opentelemetry import trace
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import BatchSpanProcessor
from opentelemetry.exporter.otlp.proto.grpc.trace_exporter import OTLPSpanExporter

# Setup
provider = TracerProvider()
exporter = OTLPSpanExporter(endpoint="http://otel-collector:4317", insecure=True)
provider.add_span_processor(BatchSpanProcessor(exporter))
trace.set_tracer_provider(provider)
tracer = trace.get_tracer(__name__)

# Use in code
@app.route('/api/orders')
def get_orders():
    with tracer.start_as_current_span("get-orders") as span:
        span.set_attribute("order.count", len(orders))
        result = db.query_orders()
        return jsonify(result)
```

### Collector as DaemonSet

```yaml
apiVersion: opentelemetry.io/v1beta1
kind: OpenTelemetryCollector
metadata:
  name: node-collector
spec:
  mode: daemonset
  hostNetwork: true
  config:
    receivers:
      otlp:
        protocols:
          grpc:
            endpoint: 0.0.0.0:4317
      hostmetrics:
        collection_interval: 30s
        scrapers:
          cpu: {}
          memory: {}
          disk: {}
          network: {}
    exporters:
      otlp:
        endpoint: central-collector.observability:4317
    service:
      pipelines:
        metrics:
          receivers: [otlp, hostmetrics]
          exporters: [otlp]
        traces:
          receivers: [otlp]
          exporters: [otlp]
```

## Common Issues

**Traces not appearing in backend**

Check collector logs: `kubectl logs deployment/otel-collector`. Verify exporter endpoint and TLS settings.

**Auto-instrumentation not working**

Operator must be installed. Check: annotation spelling, Instrumentation resource exists in pod's namespace.

**High cardinality metrics causing OOM**

Use processors to filter/aggregate. Add `filter` processor to drop unneeded metrics.

## Best Practices

- **Auto-instrument first** — no code changes, covers 80% of cases
- **Use k8sattributes processor** — enriches telemetry with K8s metadata
- **Sample in production** — 10-25% trace sampling reduces cost
- **DaemonSet for node metrics** — Deployment for aggregation
- **Grafana stack** — Tempo (traces) + Prometheus (metrics) + Loki (logs)

## Key Takeaways

- OpenTelemetry is the vendor-neutral standard for traces, metrics, and logs
- Collector receives, processes, and exports telemetry to any backend
- Auto-instrumentation via annotations — no code changes needed
- k8sattributes processor enriches data with pod/namespace/node info
- Use sampling in production to control costs while maintaining visibility
