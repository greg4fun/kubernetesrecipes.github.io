---
title: "How to Implement Distributed Tracing with Jaeger"
description: "Deploy Jaeger for distributed tracing in Kubernetes. Trace requests across microservices to identify latency issues and debug complex systems."
category: "observability"
difficulty: "intermediate"
publishDate: "2026-01-22"
tags: ["jaeger", "tracing", "observability", "opentelemetry", "debugging"]
---

# How to Implement Distributed Tracing with Jaeger

Jaeger provides distributed tracing for microservices architectures. Trace requests across services to identify latency bottlenecks and understand system behavior.

## Install Jaeger Operator

```bash
# Install cert-manager (required)
kubectl apply -f https://github.com/cert-manager/cert-manager/releases/download/v1.13.0/cert-manager.yaml

# Wait for cert-manager
kubectl wait --for=condition=Available deployment --all -n cert-manager --timeout=300s

# Install Jaeger Operator
kubectl create namespace observability
kubectl apply -f https://github.com/jaegertracing/jaeger-operator/releases/download/v1.51.0/jaeger-operator.yaml -n observability
```

## Deploy Jaeger (All-in-One)

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
  ingress:
    enabled: true
  agent:
    strategy: DaemonSet
```

## Production Jaeger with Elasticsearch

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
        cpu: 1
        memory: 1Gi
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
        server-urls: https://elasticsearch:9200
        index-prefix: jaeger
        tls:
          ca: /es/certificates/ca.crt
    secretName: jaeger-es-secret
  volumeMounts:
    - name: certificates
      mountPath: /es/certificates/
      readOnly: true
  volumes:
    - name: certificates
      secret:
        secretName: elasticsearch-certs
```

## OpenTelemetry Collector with Jaeger

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
          grpc:
            endpoint: 0.0.0.0:14250
          thrift_http:
            endpoint: 0.0.0.0:14268

    processors:
      batch:
        timeout: 1s
        send_batch_size: 1024
      memory_limiter:
        check_interval: 1s
        limit_mib: 1000

    exporters:
      jaeger:
        endpoint: jaeger-collector.observability:14250
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
  replicas: 1
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
            - containerPort: 14250 # Jaeger gRPC
            - containerPort: 14268 # Jaeger HTTP
          volumeMounts:
            - name: config
              mountPath: /etc/otel
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
  selector:
    app: otel-collector
  ports:
    - name: otlp-grpc
      port: 4317
    - name: otlp-http
      port: 4318
    - name: jaeger-grpc
      port: 14250
    - name: jaeger-http
      port: 14268
```

## Instrument Python Application

```python
# app.py
from opentelemetry import trace
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import BatchSpanProcessor
from opentelemetry.exporter.otlp.proto.grpc.trace_exporter import OTLPSpanExporter
from opentelemetry.instrumentation.flask import FlaskInstrumentor
from opentelemetry.instrumentation.requests import RequestsInstrumentor
from flask import Flask

# Configure tracing
trace.set_tracer_provider(TracerProvider())
otlp_exporter = OTLPSpanExporter(
    endpoint="otel-collector.observability:4317",
    insecure=True
)
trace.get_tracer_provider().add_span_processor(
    BatchSpanProcessor(otlp_exporter)
)

app = Flask(__name__)
FlaskInstrumentor().instrument_app(app)
RequestsInstrumentor().instrument()

tracer = trace.get_tracer(__name__)

@app.route('/api/orders')
def get_orders():
    with tracer.start_as_current_span("fetch-orders") as span:
        span.set_attribute("order.count", 10)
        # Your business logic
        return {"orders": []}
```

## Instrument Node.js Application

```javascript
// tracing.js
const { NodeSDK } = require('@opentelemetry/sdk-node');
const { OTLPTraceExporter } = require('@opentelemetry/exporter-trace-otlp-grpc');
const { getNodeAutoInstrumentations } = require('@opentelemetry/auto-instrumentations-node');

const sdk = new NodeSDK({
  traceExporter: new OTLPTraceExporter({
    url: 'grpc://otel-collector.observability:4317',
  }),
  instrumentations: [getNodeAutoInstrumentations()],
  serviceName: 'my-nodejs-service',
});

sdk.start();
```

## Instrument Go Application

```go
// main.go
package main

import (
    "context"
    "go.opentelemetry.io/otel"
    "go.opentelemetry.io/otel/exporters/otlp/otlptrace/otlptracegrpc"
    "go.opentelemetry.io/otel/sdk/trace"
)

func initTracer() func() {
    exporter, _ := otlptracegrpc.New(context.Background(),
        otlptracegrpc.WithEndpoint("otel-collector.observability:4317"),
        otlptracegrpc.WithInsecure(),
    )
    
    tp := trace.NewTracerProvider(
        trace.WithBatcher(exporter),
    )
    otel.SetTracerProvider(tp)
    
    return func() { tp.Shutdown(context.Background()) }
}

func main() {
    cleanup := initTracer()
    defer cleanup()
    
    tracer := otel.Tracer("my-service")
    ctx, span := tracer.Start(context.Background(), "operation")
    defer span.End()
    
    // Your code here
}
```

## Auto-Inject Sidecar

```yaml
# Enable sidecar injection for namespace
apiVersion: v1
kind: Namespace
metadata:
  name: my-app
  annotations:
    sidecar.jaegertracing.io/inject: "true"
---
# Or per deployment
apiVersion: apps/v1
kind: Deployment
metadata:
  name: myapp
  annotations:
    sidecar.jaegertracing.io/inject: "jaeger"
spec:
  template:
    spec:
      containers:
        - name: myapp
          image: myapp:v1
          env:
            - name: JAEGER_AGENT_HOST
              value: localhost
            - name: JAEGER_AGENT_PORT
              value: "6831"
```

## Access Jaeger UI

```bash
# Port forward
kubectl port-forward svc/jaeger-query -n observability 16686:16686

# Or via Ingress
```

```yaml
# jaeger-ingress.yaml
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: jaeger-ui
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

## Query Traces via API

```bash
# Get services
curl "http://jaeger.example.com/api/services"

# Get traces for service
curl "http://jaeger.example.com/api/traces?service=my-service&limit=20"

# Get specific trace
curl "http://jaeger.example.com/api/traces/{traceID}"
```

## Summary

Jaeger provides end-to-end distributed tracing for microservices. Deploy with the Jaeger Operator, instrument applications with OpenTelemetry, and use the UI to analyze request flows. Use production storage (Elasticsearch, Cassandra) for retention and scale collector replicas for high throughput.
