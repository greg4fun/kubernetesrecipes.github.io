---
title: "NodePort Raw Traffic vs HTTPS Ingress"
description: "Route raw GPU inference traffic via NodePort for low-latency gRPC and HTTPS model serving via OpenShift ingress controller."
publishDate: "2026-02-26"
author: "Luca Berton"
category: "networking"
difficulty: "intermediate"
tags:
  - "nodeport"
  - "ingress"
  - "grpc"
  - "tls"
  - "inference"
  - "multi-tenant"
relatedRecipes:
  - "haproxy-keepalived-multi-tenant-gpu"
  - "multi-tenant-gpu-namespace-isolation"
  - "triton-autoscaling-gpu-metrics"
  - "triton-vllm-kubernetes"
  - "networkpolicy-deny-default-gpu"
  - "gpu-tenant-monitoring-chargeback"
---

> 💡 **Quick Answer:** Use NodePort for raw TCP/gRPC traffic (model inference, NCCL, custom protocols) where TLS termination at the ingress adds unacceptable latency. Use the OpenShift ingress controller (HAProxy-based Router) for HTTPS REST APIs, dashboards, and notebooks where TLS termination, path routing, and certificate management matter.

## The Problem

GPU inference serving has two distinct traffic patterns: low-latency gRPC streams (Triton, vLLM, TensorRT-LLM) that need raw TCP passthrough, and HTTPS REST APIs (model endpoints, dashboards, Jupyter) that need TLS termination and path-based routing. Forcing everything through the ingress controller adds latency to gRPC. Exposing everything via NodePort loses TLS management and routing.

## The Solution

### Pattern 1: Raw Traffic via NodePort

```yaml
# NodePort for raw gRPC inference (no TLS termination)
apiVersion: v1
kind: Service
metadata:
  name: triton-grpc
  namespace: tenant-alpha
  labels:
    app: triton-inference
spec:
  type: NodePort
  selector:
    app: triton-inference
  ports:
    - name: grpc
      port: 8001
      targetPort: 8001
      nodePort: 30801      # Raw gRPC — no TLS overhead
      protocol: TCP
    - name: metrics
      port: 8002
      targetPort: 8002
      nodePort: 30802      # Prometheus metrics
      protocol: TCP
---
# NodePort for vLLM raw inference
apiVersion: v1
kind: Service
metadata:
  name: vllm-raw
  namespace: tenant-alpha
spec:
  type: NodePort
  selector:
    app: vllm-serving
  ports:
    - name: inference
      port: 8000
      targetPort: 8000
      nodePort: 30800
      protocol: TCP
```

### Pattern 2: HTTPS via Ingress Controller

```yaml
# Route for HTTPS REST API (TLS terminated at ingress)
apiVersion: route.openshift.io/v1
kind: Route
metadata:
  name: triton-https
  namespace: tenant-alpha
  annotations:
    haproxy.router.openshift.io/timeout: "300s"
    haproxy.router.openshift.io/balance: "leastconn"
spec:
  host: inference-alpha.apps.gpu-cluster.example.com
  path: /v2
  to:
    kind: Service
    name: triton-http
    weight: 100
  port:
    targetPort: http
  tls:
    termination: edge
    insecureEdgeTerminationPolicy: Redirect
    certificate: |
      -----BEGIN CERTIFICATE-----
      ... tenant-alpha wildcard cert ...
      -----END CERTIFICATE-----
    key: |
      -----BEGIN RSA PRIVATE KEY-----
      ... key ...
      -----END RSA PRIVATE KEY-----
---
# Route for Jupyter notebooks
apiVersion: route.openshift.io/v1
kind: Route
metadata:
  name: jupyter-alpha
  namespace: tenant-alpha
spec:
  host: notebooks-alpha.apps.gpu-cluster.example.com
  to:
    kind: Service
    name: jupyter-service
  tls:
    termination: edge
    insecureEdgeTerminationPolicy: Redirect
```

### For Vanilla Kubernetes (Ingress)

```yaml
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: model-api
  namespace: tenant-alpha
  annotations:
    nginx.ingress.kubernetes.io/proxy-read-timeout: "300"
    nginx.ingress.kubernetes.io/proxy-body-size: "100m"
    nginx.ingress.kubernetes.io/ssl-redirect: "true"
spec:
  ingressClassName: nginx
  tls:
    - hosts:
        - inference-alpha.example.com
      secretName: alpha-tls-cert
  rules:
    - host: inference-alpha.example.com
      http:
        paths:
          - path: /v2
            pathType: Prefix
            backend:
              service:
                name: triton-http
                port:
                  number: 8000
          - path: /health
            pathType: Exact
            backend:
              service:
                name: triton-http
                port:
                  number: 8000
```

### gRPC Passthrough (TLS at Pod Level)

```yaml
# When you need TLS on gRPC but want to terminate at the pod
apiVersion: route.openshift.io/v1
kind: Route
metadata:
  name: triton-grpc-passthrough
  namespace: tenant-alpha
spec:
  host: grpc-alpha.apps.gpu-cluster.example.com
  to:
    kind: Service
    name: triton-grpc-tls
  port:
    targetPort: grpc-tls
  tls:
    termination: passthrough
    # TLS is terminated inside the Triton container
```

### HAProxy Frontend Integration

```yaml
# haproxy.cfg — tenant-level routing
# Raw gRPC goes to NodePort (no TLS overhead)
frontend ft_alpha_grpc
    bind 10.0.100.10:8001
    mode tcp
    default_backend bk_alpha_grpc

backend bk_alpha_grpc
    mode tcp
    balance roundrobin
    server gpu-1 10.0.1.101:30801 check
    server gpu-2 10.0.1.102:30801 check

# HTTPS goes to ingress controller
frontend ft_alpha_https
    bind 10.0.100.10:443 ssl crt /etc/haproxy/certs/alpha.pem
    mode http
    default_backend bk_alpha_ingress

backend bk_alpha_ingress
    mode http
    balance roundrobin
    server ingress-1 10.0.1.201:443 ssl verify none check
    server ingress-2 10.0.1.202:443 ssl verify none check
```

### When to Use Which

```yaml
nodeport_raw:
  use_for:
    - "gRPC inference (Triton, vLLM, TGI)"
    - "NCCL inter-node communication"
    - "Custom binary protocols"
    - "High-throughput streaming"
  why: "No TLS overhead, lowest latency, raw TCP passthrough"
  tradeoff: "No path routing, no auto TLS, port management"

ingress_https:
  use_for:
    - "REST API model endpoints (/v2/models)"
    - "Jupyter notebooks, dashboards"
    - "Health checks, readiness probes"
    - "Multi-path routing (multiple models on one host)"
  why: "TLS termination, path-based routing, cert management"
  tradeoff: "Additional hop, TLS overhead (~0.5-1ms)"
```

```mermaid
graph TD
    A[Client] --> B{Protocol?}
    
    B -->|gRPC raw| C[HAProxy VIP :8001]
    B -->|HTTPS REST| D[HAProxy VIP :443]
    
    C -->|TCP mode| E[NodePort 30801]
    E --> F[Triton gRPC Pod]
    
    D -->|HTTP mode| G[Ingress Controller]
    G -->|TLS terminated| H[Triton HTTP Pod]
    G -->|path /notebooks| I[Jupyter Pod]
    
    F -->|No TLS overhead| J[~0.1ms added]
    H -->|TLS terminated| K[~1ms added]
```

## Common Issues

- **gRPC through ingress fails** — most ingress controllers need explicit gRPC support; use NodePort or passthrough Route instead
- **NodePort range exhausted** — default range 30000-32767; plan port allocation per tenant (e.g., alpha=308xx, beta=309xx)
- **Mixed traffic on same VIP** — HAProxy can split by port: 443 for HTTPS (http mode), 8001 for gRPC (tcp mode)
- **Large model responses timeout** — set proxy timeout to ≥300s for LLM inference; default 30s is too short
- **HTTP/2 not working through ingress** — OpenShift Router needs `haproxy.router.openshift.io/hsts_header` and HTTP/2 enabled

## Best Practices

- NodePort for latency-sensitive gRPC inference — every millisecond matters for p99
- Ingress for REST APIs, dashboards, notebooks — TLS and routing justify the overhead
- Allocate NodePort ranges per tenant for organized port management
- Use passthrough Route for gRPC that needs TLS without ingress overhead
- Set timeouts ≥300s for LLM inference endpoints — token generation is slow
- Monitor both paths independently — separate HAProxy log facilities per tenant

## Key Takeaways

- Raw NodePort: lowest latency for gRPC/TCP, no TLS overhead, ideal for inference hot path
- HTTPS Ingress: TLS termination, path routing, cert management, ideal for APIs and UIs
- Use both patterns simultaneously — split by protocol at the HAProxy frontend
- Port allocation per tenant prevents NodePort conflicts
- gRPC passthrough Route is the middle ground — TLS at pod level, no ingress TLS overhead
