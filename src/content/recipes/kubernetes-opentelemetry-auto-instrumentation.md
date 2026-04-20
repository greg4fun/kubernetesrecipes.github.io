---
title: "OpenTelemetry Auto-Instrumentation"
description: "Configure OpenTelemetry Operator auto-instrumentation to inject tracing into pods without code changes. Supports Java, Python, Node.js, .NET, and Go."
publishDate: "2026-04-20"
author: "Luca Berton"
category: "observability"
difficulty: "intermediate"
timeToComplete: "15 minutes"
kubernetesVersion: "1.28+"
tags:
  - opentelemetry
  - tracing
  - auto-instrumentation
  - observability
relatedRecipes:
  - "opentelemetry-kubernetes-observability"
  - "opentelemetry-collector"
  - "kubernetes-golden-signals-sli-slo"
---

> 💡 **Quick Answer:** Install OpenTelemetry Operator, create an `Instrumentation` CR, then annotate pods with `instrumentation.opentelemetry.io/inject-java: "true"` (or python/nodejs/dotnet/go). The operator injects init containers and sidecars that auto-instrument your app — zero code changes needed.

## The Problem

Adding distributed tracing to existing applications requires code changes, SDK dependencies, and redeployment. You have dozens of services and need observability quickly without modifying source code.

## The Solution

### Install OpenTelemetry Operator

```bash
# Install cert-manager (required)
kubectl apply -f https://github.com/cert-manager/cert-manager/releases/latest/download/cert-manager.yaml

# Install OTel Operator
kubectl apply -f https://github.com/open-telemetry/opentelemetry-operator/releases/latest/download/opentelemetry-operator.yaml
```

### Create Instrumentation CR

```yaml
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
  sampler:
    type: parentbased_traceidratio
    argument: "0.25"
  java:
    image: ghcr.io/open-telemetry/opentelemetry-operator/autoinstrumentation-java:2.6.0
  python:
    image: ghcr.io/open-telemetry/opentelemetry-operator/autoinstrumentation-python:0.47b0
  nodejs:
    image: ghcr.io/open-telemetry/opentelemetry-operator/autoinstrumentation-nodejs:0.52.0
  dotnet:
    image: ghcr.io/open-telemetry/opentelemetry-operator/autoinstrumentation-dotnet:1.7.0
  go:
    image: ghcr.io/open-telemetry/opentelemetry-operator/autoinstrumentation-go:0.14.0
  env:
    - name: OTEL_RESOURCE_ATTRIBUTES
      value: "k8s.cluster.name=production,deployment.environment=prod"
```

### Annotate Deployments

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: payment-service
  namespace: production
spec:
  template:
    metadata:
      annotations:
        # Pick ONE based on your language:
        instrumentation.opentelemetry.io/inject-java: "true"
        # instrumentation.opentelemetry.io/inject-python: "true"
        # instrumentation.opentelemetry.io/inject-nodejs: "true"
        # instrumentation.opentelemetry.io/inject-dotnet: "true"
        # instrumentation.opentelemetry.io/inject-go: "true"
    spec:
      containers:
        - name: payment
          image: payment-service:v3
```

### What Gets Injected

The operator adds:
1. **Init container** — Copies instrumentation agent to shared volume
2. **Environment variables** — `JAVA_TOOL_OPTIONS`, `OTEL_SERVICE_NAME`, etc.
3. **Shared volume** — Agent JAR/libraries mounted into app container

```bash
# Verify injection
kubectl get pod payment-service-xxx -o jsonpath='{.spec.initContainers[*].name}'
# Output: opentelemetry-auto-instrumentation

kubectl get pod payment-service-xxx -o jsonpath='{.spec.containers[0].env[?(@.name=="OTEL_SERVICE_NAME")].value}'
# Output: payment-service
```

## Multi-Language Namespace

```yaml
# Apply to entire namespace
apiVersion: opentelemetry.io/v1alpha1
kind: Instrumentation
metadata:
  name: auto-instrumentation
  namespace: production
spec:
  exporter:
    endpoint: http://otel-collector.observability:4317
  sampler:
    type: parentbased_traceidratio
    argument: "0.1"
---
# Then annotate each deployment with its language
# Java services:
#   instrumentation.opentelemetry.io/inject-java: "true"
# Python services:
#   instrumentation.opentelemetry.io/inject-python: "true"
```

## Common Issues

| Issue | Cause | Fix |
|-------|-------|-----|
| Pod stuck in Init | Instrumentation image pull fails | Check image registry access |
| No traces appearing | Wrong collector endpoint | Verify `exporter.endpoint` is reachable |
| High latency overhead | Sampling rate too high | Set `argument: "0.1"` (10% sampling) |
| Go instrumentation not working | Requires CGO | Build with CGO_ENABLED=1 |
| Duplicate traces | Both SDK and auto-inject active | Remove SDK if using auto-inject |

## Best Practices

1. **Start with 10-25% sampling** — Full sampling overwhelms backends
2. **Use `parentbased_traceidratio`** — Respects parent span's sampling decision
3. **Pin instrumentation image versions** — Avoid surprise breakage
4. **Test in staging first** — Auto-instrumentation can affect startup time
5. **Combine with manual spans** — Auto-instrumentation captures HTTP/DB; add custom spans for business logic

## Key Takeaways

- Auto-instrumentation injects tracing without code changes via pod annotations
- Supports Java, Python, Node.js, .NET, and Go
- The Operator handles init container injection and environment variable setup
- Always configure sampling to avoid backend overload
- Works alongside manual instrumentation (SDK spans complement auto-spans)
