---
title: "How to Implement Distributed Tracing with Jaeger"
description: "Deploy Jaeger for distributed tracing in Kubernetes. Learn to instrument applications, trace requests across services, and identify performance bottlenecks."
category: "observability"
difficulty: "advanced"
publishDate: "2026-01-22"
tags: ["tracing", "jaeger", "opentelemetry", "observability", "microservices"]
---

# How to Implement Distributed Tracing with Jaeger

Distributed tracing helps you understand request flow across microservices. Jaeger provides end-to-end tracing for identifying latency issues and debugging distributed systems.

## Deploy Jaeger Operator

```bash
# Install cert-manager (required)
kubectl apply -f https://github.com/cert-manager/cert-manager/releases/download/v1.13.0/cert-manager.yaml

# Install Jaeger Operator
kubectl create namespace observability
kubectl apply -f https://github.com/jaegertracing/jaeger-operator/releases/download/v1.51.0/jaeger-operator.yaml -n observability
```

## Simple All-in-One Deployment

```yaml
# jaeger-allinone.yaml
apiVersion: jaegertracing.io/v1
kind: Jaeger
metadata:
  name: jaeger
  namespace: observability
spec:
  strategy: allInOne
  allInOne:
    image: jaegertracing/all-in-one:1.51
    options:
      log-level: info
  storage:
    type: memory
    options:
      memory:
        max-traces: 100000
  ingress:
    enabled: true
  agent:
    strategy: DaemonSet
```

## Production Setup with Elasticsearch

```yaml
# jaeger-production.yaml
apiVersion: jaegertracing.io/v1
kind: Jaeger
metadata:
  name: jaeger-production
  namespace: observability
spec:
  strategy: production
  collector:
    replicas: 2
    maxReplicas: 5
    resources:
      limits:
        cpu: 500m
        memory: 512Mi
      requests:
        cpu: 100m
        memory: 128Mi
  query:
    replicas: 2
    resources:
      limits:
        cpu: 500m
        memory: 512Mi
  storage:
    type: elasticsearch
    options:
      es:
        server-urls: http://elasticsearch:9200
        index-prefix: jaeger
        num-shards: 3
        num-replicas: 1
    esIndexCleaner:
      enabled: true
      numberOfDays: 7
      schedule: "55 23 * * *"
  agent:
    strategy: DaemonSet
```

## OpenTelemetry Collector Integration

```yaml
# otel-collector.yaml
apiVersion: v1
kind: ConfigMap
metadata:
  name: otel-collector-config
  namespace: observability
data:
  config.yaml: |
    receivers:
      otlp:
        protocols:
          grpc:
            endpoint: 0.0.0.0:4317
          http:
            endpoint: 0.0.0.0:4318
      jaeger:
        protocols:
          thrift_http:
            endpoint: 0.0.0.0:14268
          grpc:
            endpoint: 0.0.0.0:14250

    processors:
      batch:
        timeout: 10s
      memory_limiter:
        check_interval: 1s
        limit_mib: 400
        spike_limit_mib: 100

    exporters:
      jaeger:
        endpoint: jaeger-collector.observability.svc:14250
        tls:
          insecure: true

    service:
      pipelines:
        traces:
          receivers: [otlp, jaeger]
          processors: [memory_limiter, batch]
          exporters: [jaeger]
---
apiVersion: apps/v1
kind: Deployment
metadata:
  name: otel-collector
  namespace: observability
spec:
  replicas: 2
  selector:
    matchLabels:
      app: otel-collector
  template:
    metadata:
      labels:
        app: otel-collector
    spec:
      containers:
        - name: collector
          image: otel/opentelemetry-collector-contrib:0.91.0
          args: ["--config=/etc/otel/config.yaml"]
          ports:
            - containerPort: 4317  # OTLP gRPC
            - containerPort: 4318  # OTLP HTTP
            - containerPort: 14268 # Jaeger thrift
          volumeMounts:
            - name: config
              mountPath: /etc/otel
          resources:
            limits:
              memory: 512Mi
              cpu: 500m
      volumes:
        - name: config
          configMap:
            name: otel-collector-config
---
apiVersion: v1
kind: Service
metadata:
  name: otel-collector
  namespace: observability
spec:
  ports:
    - name: otlp-grpc
      port: 4317
    - name: otlp-http
      port: 4318
    - name: jaeger-thrift
      port: 14268
  selector:
    app: otel-collector
```

## Python Application Instrumentation

```python
# app.py
from opentelemetry import trace
from opentelemetry.exporter.otlp.proto.grpc.trace_exporter import OTLPSpanExporter
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import BatchSpanProcessor
from opentelemetry.instrumentation.flask import FlaskInstrumentor
from opentelemetry.instrumentation.requests import RequestsInstrumentor
import os

# Configure tracing
trace.set_tracer_provider(TracerProvider())
otlp_exporter = OTLPSpanExporter(
    endpoint=os.getenv("OTEL_EXPORTER_OTLP_ENDPOINT", "otel-collector:4317"),
    insecure=True
)
trace.get_tracer_provider().add_span_processor(
    BatchSpanProcessor(otlp_exporter)
)

# Auto-instrument Flask and requests
from flask import Flask
app = Flask(__name__)
FlaskInstrumentor().instrument_app(app)
RequestsInstrumentor().instrument()

tracer = trace.get_tracer(__name__)

@app.route("/api/orders")
def get_orders():
    with tracer.start_as_current_span("fetch-orders") as span:
        span.set_attribute("order.count", 10)
        # Your business logic
        return {"orders": []}
```

## Node.js Application Instrumentation

```javascript
// tracing.js
const { NodeSDK } = require('@opentelemetry/sdk-node');
const { OTLPTraceExporter } = require('@opentelemetry/exporter-trace-otlp-grpc');
const { getNodeAutoInstrumentations } = require('@opentelemetry/auto-instrumentations-node');

const sdk = new NodeSDK({
  traceExporter: new OTLPTraceExporter({
    url: process.env.OTEL_EXPORTER_OTLP_ENDPOINT || 'grpc://otel-collector:4317',
  }),
  instrumentations: [getNodeAutoInstrumentations()],
  serviceName: process.env.OTEL_SERVICE_NAME || 'my-service',
});

sdk.start();

// app.js
const express = require('express');
const { trace } = require('@opentelemetry/api');

const app = express();
const tracer = trace.getTracer('my-service');

app.get('/api/users', async (req, res) => {
  const span = tracer.startSpan('fetch-users');
  try {
    span.setAttribute('user.count', 100);
    // Your logic here
    res.json({ users: [] });
  } finally {
    span.end();
  }
});
```

## Kubernetes Deployment with Tracing

```yaml
# traced-app.yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: order-service
spec:
  replicas: 3
  selector:
    matchLabels:
      app: order-service
  template:
    metadata:
      labels:
        app: order-service
      annotations:
        sidecar.jaegertracing.io/inject: "true"
    spec:
      containers:
        - name: app
          image: order-service:v1
          env:
            - name: OTEL_SERVICE_NAME
              value: "order-service"
            - name: OTEL_EXPORTER_OTLP_ENDPOINT
              value: "http://otel-collector.observability:4317"
            - name: OTEL_TRACES_SAMPLER
              value: "parentbased_traceidratio"
            - name: OTEL_TRACES_SAMPLER_ARG
              value: "0.1"  # Sample 10% of traces
          ports:
            - containerPort: 8080
          resources:
            limits:
              memory: 256Mi
              cpu: 200m
```

## Context Propagation Between Services

```yaml
# Ensure trace context is propagated via headers
# Required headers: traceparent, tracestate (W3C), or uber-trace-id (Jaeger)

apiVersion: v1
kind: ConfigMap
metadata:
  name: app-config
data:
  OTEL_PROPAGATORS: "tracecontext,baggage,jaeger"
```

## Sampling Strategies

```yaml
# jaeger-sampling.yaml
apiVersion: jaegertracing.io/v1
kind: Jaeger
metadata:
  name: jaeger
spec:
  strategy: production
  sampling:
    options:
      default_strategy:
        type: probabilistic
        param: 0.1  # Sample 10%
      service_strategies:
        - service: payment-service
          type: probabilistic
          param: 1.0  # Sample 100% for critical service
        - service: health-check
          type: probabilistic
          param: 0.001  # Sample 0.1% for noisy service
```

## Access Jaeger UI

```bash
# Port forward to access UI
kubectl port-forward svc/jaeger-query -n observability 16686:16686

# Or via Ingress
```

```yaml
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: jaeger
  namespace: observability
spec:
  rules:
    - host: jaeger.example.com
      http:
        paths:
          - path: /
            pathType: Prefix
            backend:
              service:
                name: jaeger-query
                port:
                  number: 16686
```

## Summary

Jaeger provides powerful distributed tracing capabilities for Kubernetes. Use OpenTelemetry for instrumentation, configure appropriate sampling for production, and leverage the Jaeger UI to debug latency issues across your microservices.

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
