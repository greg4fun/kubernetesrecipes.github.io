---
title: "Gateway API gRPC Routes"
description: "Configure Kubernetes Gateway API GRPCRoute for gRPC traffic routing. Service-level matching, header-based routing, and traffic splitting for gRPC services."
publishDate: "2026-04-20"
author: "Luca Berton"
category: "networking"
difficulty: "advanced"
timeToComplete: "15 minutes"
kubernetesVersion: "1.30+"
tags:
  - gateway-api
  - grpc
  - networking
  - routing
relatedRecipes:
  - "kubernetes-gateway-api"
  - "gateway-api-httproutes-tls-k3s"
  - "kubernetes-load-balancing"
---

> 💡 **Quick Answer:** Use `GRPCRoute` (GA in Gateway API v1.2+) to route gRPC traffic by service name, method, or headers. Attach to a Gateway listener on port 443 with `protocol: HTTPS`. Match gRPC services with `matches[].method.service` and `matches[].method.method`. Traffic splitting works like HTTPRoute `backendRefs` with weights.

## The Problem

gRPC uses HTTP/2 with service/method-based routing that doesn't fit the traditional path-based Ingress model. You need native gRPC routing with service-level matching, header-based canary deployments, and proper load balancing.

## The Solution

### Gateway Setup

```yaml
apiVersion: gateway.networking.k8s.io/v1
kind: Gateway
metadata:
  name: grpc-gateway
  namespace: infrastructure
spec:
  gatewayClassName: cilium  # or istio, envoy-gateway, etc.
  listeners:
    - name: grpc
      protocol: HTTPS
      port: 443
      tls:
        mode: Terminate
        certificateRefs:
          - name: grpc-tls-cert
```

### Basic GRPCRoute

```yaml
apiVersion: gateway.networking.k8s.io/v1
kind: GRPCRoute
metadata:
  name: user-service-route
  namespace: production
spec:
  parentRefs:
    - name: grpc-gateway
      namespace: infrastructure
  hostnames:
    - "api.example.com"
  rules:
    - matches:
        - method:
            service: "user.v1.UserService"
      backendRefs:
        - name: user-service
          port: 50051
    - matches:
        - method:
            service: "order.v1.OrderService"
      backendRefs:
        - name: order-service
          port: 50051
```

### Method-Level Routing

```yaml
apiVersion: gateway.networking.k8s.io/v1
kind: GRPCRoute
metadata:
  name: method-routing
spec:
  parentRefs:
    - name: grpc-gateway
      namespace: infrastructure
  rules:
    # Route specific methods to specialized backends
    - matches:
        - method:
            service: "ai.v1.InferenceService"
            method: "Predict"
      backendRefs:
        - name: inference-gpu
          port: 50051
    - matches:
        - method:
            service: "ai.v1.InferenceService"
            method: "GetModel"
      backendRefs:
        - name: inference-cpu
          port: 50051
```

### Header-Based Canary

```yaml
apiVersion: gateway.networking.k8s.io/v1
kind: GRPCRoute
metadata:
  name: canary-route
spec:
  parentRefs:
    - name: grpc-gateway
      namespace: infrastructure
  rules:
    # Canary: header x-canary=true goes to v2
    - matches:
        - method:
            service: "payment.v1.PaymentService"
          headers:
            - name: x-canary
              value: "true"
      backendRefs:
        - name: payment-service-v2
          port: 50051
    # Default: all other traffic to v1
    - matches:
        - method:
            service: "payment.v1.PaymentService"
      backendRefs:
        - name: payment-service-v1
          port: 50051
```

### Traffic Splitting (Weighted)

```yaml
apiVersion: gateway.networking.k8s.io/v1
kind: GRPCRoute
metadata:
  name: weighted-route
spec:
  parentRefs:
    - name: grpc-gateway
      namespace: infrastructure
  rules:
    - matches:
        - method:
            service: "search.v1.SearchService"
      backendRefs:
        - name: search-service-v1
          port: 50051
          weight: 90
        - name: search-service-v2
          port: 50051
          weight: 10
```

## gRPC Backend Service

```yaml
apiVersion: v1
kind: Service
metadata:
  name: user-service
  namespace: production
spec:
  selector:
    app: user-service
  ports:
    - name: grpc
      port: 50051
      targetPort: 50051
      protocol: TCP
      appProtocol: kubernetes.io/h2c  # Important: signals HTTP/2
```

## Verify Routes

```bash
# Check route status
kubectl get grpcroute -A

# Test with grpcurl
grpcurl -d '{"user_id": "123"}' \
  -authority api.example.com \
  api.example.com:443 \
  user.v1.UserService/GetUser
```

## Common Issues

| Issue | Cause | Fix |
|-------|-------|-----|
| Connection reset | Backend not HTTP/2 | Set `appProtocol: kubernetes.io/h2c` on Service |
| Route not attached | Gateway doesn't allow namespace | Add `allowedRoutes` to Gateway |
| 404 on method | Service/method name wrong | Must match proto definition exactly |
| TLS errors | Certificate doesn't cover hostname | Update cert SANs |
| No traffic splitting | Controller doesn't support weights | Check controller docs |

## Best Practices

1. **Always use TLS** — gRPC in production should be encrypted
2. **Set `appProtocol`** — Tells the gateway the backend speaks HTTP/2
3. **Use service-level matching first** — Method-level only when needed
4. **Health check with gRPC health protocol** — Not HTTP probes
5. **Monitor per-method latency** — gRPC services can have wildly different method costs

## Key Takeaways

- GRPCRoute is GA in Gateway API v1.2+ for native gRPC routing
- Match traffic by gRPC service name, method, and headers
- Traffic splitting enables gRPC canary deployments
- Backend services need `appProtocol: kubernetes.io/h2c` for HTTP/2
- Works with Cilium, Istio, Envoy Gateway, and other Gateway API implementations
