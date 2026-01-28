---
title: "How to Implement Rate Limiting in Kubernetes"
description: "Protect your services with rate limiting. Configure rate limits using Ingress, service mesh, and API gateways to prevent abuse and ensure fair usage."
category: "networking"
difficulty: "intermediate"
publishDate: "2026-01-22"
tags: ["rate-limiting", "ingress", "api-gateway", "traffic-management", "security"]
---

# How to Implement Rate Limiting in Kubernetes

Rate limiting protects services from abuse, ensures fair resource usage, and prevents cascading failures. Implement rate limiting at the ingress, service mesh, or application level.

## NGINX Ingress Rate Limiting

```yaml
# rate-limited-ingress.yaml
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: api-ingress
  annotations:
    # Limit requests per second per IP
    nginx.ingress.kubernetes.io/limit-rps: "10"
    # Limit connections per IP
    nginx.ingress.kubernetes.io/limit-connections: "5"
    # Burst size (requests allowed above limit temporarily)
    nginx.ingress.kubernetes.io/limit-burst-multiplier: "5"
    # Return 429 when rate limited
    nginx.ingress.kubernetes.io/limit-rate-after: "10m"
    # Whitelist certain IPs
    nginx.ingress.kubernetes.io/limit-whitelist: "10.0.0.0/8,192.168.1.0/24"
spec:
  ingressClassName: nginx
  rules:
    - host: api.example.com
      http:
        paths:
          - path: /
            pathType: Prefix
            backend:
              service:
                name: api-service
                port:
                  number: 80
```

## Rate Limit by Request Size

```yaml
# size-limited-ingress.yaml
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: upload-ingress
  annotations:
    nginx.ingress.kubernetes.io/proxy-body-size: "10m"
    nginx.ingress.kubernetes.io/limit-rate: "100k"  # 100KB/s
    nginx.ingress.kubernetes.io/limit-rate-after: "1m"  # After 1MB
spec:
  ingressClassName: nginx
  rules:
    - host: upload.example.com
      http:
        paths:
          - path: /upload
            pathType: Prefix
            backend:
              service:
                name: upload-service
                port:
                  number: 80
```

## Istio Rate Limiting

```yaml
# istio-rate-limit.yaml
apiVersion: networking.istio.io/v1alpha3
kind: EnvoyFilter
metadata:
  name: rate-limit-filter
  namespace: istio-system
spec:
  workloadSelector:
    labels:
      istio: ingressgateway
  configPatches:
    - applyTo: HTTP_FILTER
      match:
        context: GATEWAY
        listener:
          filterChain:
            filter:
              name: envoy.filters.network.http_connection_manager
      patch:
        operation: INSERT_BEFORE
        value:
          name: envoy.filters.http.local_ratelimit
          typed_config:
            "@type": type.googleapis.com/udpa.type.v1.TypedStruct
            type_url: type.googleapis.com/envoy.extensions.filters.http.local_ratelimit.v3.LocalRateLimit
            value:
              stat_prefix: http_local_rate_limiter
              token_bucket:
                max_tokens: 100
                tokens_per_fill: 10
                fill_interval: 1s
              filter_enabled:
                runtime_key: local_rate_limit_enabled
                default_value:
                  numerator: 100
                  denominator: HUNDRED
              filter_enforced:
                runtime_key: local_rate_limit_enforced
                default_value:
                  numerator: 100
                  denominator: HUNDRED
              response_headers_to_add:
                - append: false
                  header:
                    key: x-rate-limit
                    value: "true"
```

## Istio with External Rate Limit Service

```yaml
# rate-limit-service.yaml
apiVersion: networking.istio.io/v1alpha3
kind: EnvoyFilter
metadata:
  name: rate-limit-envoy-filter
  namespace: istio-system
spec:
  workloadSelector:
    labels:
      istio: ingressgateway
  configPatches:
    - applyTo: HTTP_FILTER
      match:
        context: GATEWAY
      patch:
        operation: INSERT_BEFORE
        value:
          name: envoy.filters.http.ratelimit
          typed_config:
            "@type": type.googleapis.com/envoy.extensions.filters.http.ratelimit.v3.RateLimit
            domain: production-ratelimit
            failure_mode_deny: true
            rate_limit_service:
              grpc_service:
                envoy_grpc:
                  cluster_name: rate_limit_cluster
              transport_api_version: V3
---
apiVersion: networking.istio.io/v1alpha3
kind: EnvoyFilter
metadata:
  name: rate-limit-cluster
  namespace: istio-system
spec:
  configPatches:
    - applyTo: CLUSTER
      patch:
        operation: ADD
        value:
          name: rate_limit_cluster
          type: STRICT_DNS
          connect_timeout: 10s
          lb_policy: ROUND_ROBIN
          http2_protocol_options: {}
          load_assignment:
            cluster_name: rate_limit_cluster
            endpoints:
              - lb_endpoints:
                  - endpoint:
                      address:
                        socket_address:
                          address: ratelimit.default.svc.cluster.local
                          port_value: 8081
```

## Kong Rate Limiting

```yaml
# kong-rate-limit.yaml
apiVersion: configuration.konghq.com/v1
kind: KongPlugin
metadata:
  name: rate-limit
spec:
  plugin: rate-limiting
  config:
    second: 5
    minute: 100
    hour: 1000
    policy: local
    fault_tolerant: true
    hide_client_headers: false
---
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: api-ingress
  annotations:
    konghq.com/plugins: rate-limit
spec:
  ingressClassName: kong
  rules:
    - host: api.example.com
      http:
        paths:
          - path: /
            pathType: Prefix
            backend:
              service:
                name: api-service
                port:
                  number: 80
```

## Rate Limit by Header (API Key)

```yaml
# kong-rate-limit-by-key.yaml
apiVersion: configuration.konghq.com/v1
kind: KongPlugin
metadata:
  name: rate-limit-by-key
spec:
  plugin: rate-limiting
  config:
    second: 10
    policy: redis
    redis_host: redis.default.svc.cluster.local
    redis_port: 6379
    limit_by: header
    header_name: X-API-Key
```

## Application-Level Rate Limiting

```yaml
# redis-for-rate-limiting.yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: redis
spec:
  replicas: 1
  selector:
    matchLabels:
      app: redis
  template:
    metadata:
      labels:
        app: redis
    spec:
      containers:
        - name: redis
          image: redis:7-alpine
          ports:
            - containerPort: 6379
---
apiVersion: v1
kind: Service
metadata:
  name: redis
spec:
  ports:
    - port: 6379
  selector:
    app: redis
```

```python
# Python rate limiter example
from flask import Flask, request, jsonify
import redis
import time

app = Flask(__name__)
r = redis.Redis(host='redis', port=6379)

def rate_limit(key, limit, window):
    """Token bucket rate limiter"""
    current = time.time()
    window_key = f"rate:{key}:{int(current // window)}"
    
    count = r.incr(window_key)
    if count == 1:
        r.expire(window_key, window)
    
    if count > limit:
        return False, limit - count
    return True, limit - count

@app.before_request
def check_rate_limit():
    client_ip = request.remote_addr
    allowed, remaining = rate_limit(client_ip, limit=100, window=60)
    
    if not allowed:
        return jsonify({"error": "Rate limit exceeded"}), 429
```

## Rate Limit ConfigMap

```yaml
# rate-limit-config.yaml
apiVersion: v1
kind: ConfigMap
metadata:
  name: rate-limit-config
data:
  config.yaml: |
    domain: production
    descriptors:
      # Global rate limit
      - key: generic_key
        value: default
        rate_limit:
          unit: minute
          requests_per_unit: 1000
      
      # Per-path rate limits
      - key: path
        value: /api/v1/users
        rate_limit:
          unit: second
          requests_per_unit: 10
      
      # Per-user rate limits
      - key: user_id
        rate_limit:
          unit: minute
          requests_per_unit: 100
      
      # Different tiers
      - key: api_tier
        value: free
        rate_limit:
          unit: hour
          requests_per_unit: 100
      - key: api_tier
        value: premium
        rate_limit:
          unit: hour
          requests_per_unit: 10000
```

## Envoy Rate Limit Service

```yaml
# rate-limit-service-deployment.yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: ratelimit
spec:
  replicas: 2
  selector:
    matchLabels:
      app: ratelimit
  template:
    metadata:
      labels:
        app: ratelimit
    spec:
      containers:
        - name: ratelimit
          image: envoyproxy/ratelimit:v1.4.0
          ports:
            - containerPort: 8080
            - containerPort: 8081
            - containerPort: 6070
          env:
            - name: RUNTIME_ROOT
              value: /data
            - name: RUNTIME_SUBDIRECTORY
              value: ratelimit
            - name: REDIS_SOCKET_TYPE
              value: tcp
            - name: REDIS_URL
              value: redis:6379
          volumeMounts:
            - name: config
              mountPath: /data/ratelimit/config
      volumes:
        - name: config
          configMap:
            name: rate-limit-config
---
apiVersion: v1
kind: Service
metadata:
  name: ratelimit
spec:
  ports:
    - name: http
      port: 8080
    - name: grpc
      port: 8081
    - name: debug
      port: 6070
  selector:
    app: ratelimit
```

## Custom Response for Rate Limited Requests

```yaml
# custom-error-response.yaml
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: api-ingress
  annotations:
    nginx.ingress.kubernetes.io/limit-rps: "10"
    nginx.ingress.kubernetes.io/custom-http-errors: "429"
    nginx.ingress.kubernetes.io/default-backend: rate-limit-backend
spec:
  ingressClassName: nginx
  rules:
    - host: api.example.com
      http:
        paths:
          - path: /
            pathType: Prefix
            backend:
              service:
                name: api-service
                port:
                  number: 80
```

## Monitor Rate Limiting

```yaml
# Prometheus queries for rate limiting

# Rate limited requests
sum(rate(nginx_ingress_controller_requests{status="429"}[5m])) by (ingress)

# Requests approaching limit
sum(rate(nginx_ingress_controller_requests[5m])) by (ingress, remote_addr)

# Rate limit efficiency
sum(rate(nginx_ingress_controller_requests{status="429"}[5m])) 
/ 
sum(rate(nginx_ingress_controller_requests[5m]))
```

## Best Practices

```markdown
1. Layer Rate Limits
   - Global limits at ingress
   - Per-service limits in mesh
   - Per-user limits in application

2. Use Sliding Windows
   - Prevents burst at window boundaries
   - More fair distribution

3. Return Helpful Headers
   - X-RateLimit-Limit
   - X-RateLimit-Remaining
   - X-RateLimit-Reset

4. Different Limits by Tier
   - Anonymous < Authenticated < Premium

5. Graceful Degradation
   - Don't fail if rate limiter is down
   - Log but allow traffic
```

## Summary

Rate limiting protects services from abuse and overload. Use NGINX Ingress annotations for simple per-IP limits, service mesh for fine-grained control, and external rate limit services for complex rules. Implement multiple layers with different granularities. Always return helpful headers so clients can adjust their behavior, and monitor rate limit metrics to tune thresholds.

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
