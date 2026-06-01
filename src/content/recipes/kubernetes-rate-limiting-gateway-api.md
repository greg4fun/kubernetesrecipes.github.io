---
title: "Kubernetes Rate Limiting with Gateway API"
description: "Implement rate limiting for Kubernetes services using Gateway API, Istio, Kong, NGINX, and Envoy. Protect APIs from abuse with per-service, per-client, and global rate limit policies."
tags:
  - "rate-limiting"
  - "gateway-api"
  - "ingress"
  - "security"
  - "traffic-management"
category: "networking"
publishDate: "2026-06-01"
author: "Luca Berton"
difficulty: "intermediate"
relatedRecipes:
  - "kubernetes-gateway-api-inference-extension"
  - "kubernetes-ingress-nginx-configuration"
  - "istio-ambient-mesh-kubernetes"
---

> 💡 **Quick Answer:** Rate limiting in Kubernetes protects services from traffic spikes and abuse. Implement at the ingress/gateway layer using Gateway API `BackendTrafficPolicy`, NGINX annotations (`limit-rps`), Istio `EnvoyFilter`, or Kong `RateLimiting` plugin. For CI/CD webhooks, use a global rate limit service (Envoy ratelimit) with Redis backend.

## The Problem

- APIs exposed via Ingress/Gateway have no default rate limiting
- A single misbehaving client can overwhelm backend services
- Webhook endpoints (CI/CD, payment) receive uncontrolled burst traffic
- Need per-client, per-route, and global rate limits with different policies
- Rate limit state must be shared across multiple gateway replicas

## The Solution

### Gateway API with Envoy Gateway Rate Limiting

```yaml
# Envoy Gateway BackendTrafficPolicy
apiVersion: gateway.envoyproxy.io/v1alpha1
kind: BackendTrafficPolicy
metadata:
  name: api-rate-limit
  namespace: production
spec:
  targetRefs:
    - group: gateway.networking.k8s.io
      kind: HTTPRoute
      name: api-route
  rateLimit:
    type: Global
    global:
      rules:
        - clientSelectors:
            - headers:
                - name: x-api-key
                  type: Distinct    # Per unique API key
          limit:
            requests: 100
            unit: Minute
        - clientSelectors:
            - sourceCIDR:
                value: "0.0.0.0/0"
                type: Distinct      # Per source IP
          limit:
            requests: 1000
            unit: Hour
```

### NGINX Ingress Rate Limiting

```yaml
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: api-ingress
  namespace: production
  annotations:
    # Rate limit by requests per second
    nginx.ingress.kubernetes.io/limit-rps: "10"

    # Rate limit by requests per minute
    nginx.ingress.kubernetes.io/limit-rpm: "300"

    # Rate limit by connections
    nginx.ingress.kubernetes.io/limit-connections: "5"

    # Burst allowance (queue up to N extra requests)
    nginx.ingress.kubernetes.io/limit-burst-multiplier: "5"

    # Allowlist IPs exempt from rate limiting
    nginx.ingress.kubernetes.io/limit-whitelist: "10.0.0.0/8,172.16.0.0/12"

    # Custom error response when rate limited
    nginx.ingress.kubernetes.io/custom-http-errors: "429"

    # Rate limit key (default: $binary_remote_addr)
    # Use X-Forwarded-For behind load balancer:
    nginx.ingress.kubernetes.io/limit-rate-after: "1m"
spec:
  ingressClassName: nginx
  rules:
    - host: api.example.com
      http:
        paths:
          - path: /api
            pathType: Prefix
            backend:
              service:
                name: api-service
                port:
                  number: 8080
```

### Istio Rate Limiting with EnvoyFilter

```yaml
# Local rate limit (per-pod, no shared state)
apiVersion: networking.istio.io/v1alpha3
kind: EnvoyFilter
metadata:
  name: api-local-ratelimit
  namespace: production
spec:
  workloadSelector:
    labels:
      app: api-service
  configPatches:
    - applyTo: HTTP_FILTER
      match:
        context: SIDECAR_INBOUND
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
                tokens_per_fill: 100
                fill_interval: 60s
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
                - append_action: OVERWRITE_IF_EXISTS_OR_ADD
                  header:
                    key: x-rate-limited
                    value: "true"
```

### Global Rate Limiting with Envoy + Redis

```yaml
# Deploy rate limit service
apiVersion: apps/v1
kind: Deployment
metadata:
  name: ratelimit
  namespace: rate-limiting
spec:
  replicas: 2
  selector:
    matchLabels:
      app: ratelimit
  template:
    spec:
      containers:
        - name: ratelimit
          image: envoyproxy/ratelimit:latest
          env:
            - name: REDIS_SOCKET_TYPE
              value: "tcp"
            - name: REDIS_URL
              value: "redis.rate-limiting.svc:6379"
            - name: RUNTIME_ROOT
              value: "/data"
            - name: RUNTIME_SUBDIRECTORY
              value: "ratelimit"
            - name: USE_STATSD
              value: "false"
          ports:
            - containerPort: 8080  # HTTP
            - containerPort: 8081  # gRPC
          volumeMounts:
            - name: config
              mountPath: /data/ratelimit/config
      volumes:
        - name: config
          configMap:
            name: ratelimit-config
---
apiVersion: v1
kind: ConfigMap
metadata:
  name: ratelimit-config
  namespace: rate-limiting
data:
  config.yaml: |
    domain: production
    descriptors:
      # Per API key: 1000 req/min
      - key: api_key
        rate_limit:
          unit: minute
          requests_per_unit: 1000

      # Per source IP: 100 req/min
      - key: remote_address
        rate_limit:
          unit: minute
          requests_per_unit: 100

      # Per path: different limits
      - key: path
        value: "/api/v1/webhooks"
        rate_limit:
          unit: second
          requests_per_unit: 50

      # Tiered: free vs premium
      - key: plan
        value: "free"
        rate_limit:
          unit: hour
          requests_per_unit: 100
      - key: plan
        value: "premium"
        rate_limit:
          unit: hour
          requests_per_unit: 10000
```

### Kong Rate Limiting Plugin

```yaml
# Kong rate limiting via KongPlugin CRD
apiVersion: configuration.konghq.com/v1
kind: KongPlugin
metadata:
  name: rate-limit-api
  namespace: production
config:
  minute: 300
  hour: 5000
  policy: redis           # local | cluster | redis
  redis_host: redis.infrastructure.svc
  redis_port: 6379
  redis_timeout: 2000
  limit_by: consumer      # consumer | credential | ip | header | path
  header_name: x-api-key  # When limit_by=header
plugin: rate-limiting
---
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: api-ingress
  annotations:
    konghq.com/plugins: rate-limit-api
spec:
  ingressClassName: kong
  rules:
    - host: api.example.com
      http:
        paths:
          - path: /api
            pathType: Prefix
            backend:
              service:
                name: api-service
                port:
                  number: 8080
```

### Response Headers for Rate Limit Visibility

```text
Standard rate limit response headers:
  X-RateLimit-Limit: 100          # Max requests allowed
  X-RateLimit-Remaining: 42       # Requests remaining in window
  X-RateLimit-Reset: 1717244400   # Unix timestamp when limit resets
  Retry-After: 30                 # Seconds to wait (on 429 response)

HTTP 429 Too Many Requests response:
{
  "error": "rate_limit_exceeded",
  "message": "API rate limit exceeded. Try again in 30 seconds.",
  "retry_after": 30
}
```

## Common Issues

### Rate limit not applied — all requests pass through
- **Cause**: Annotation typo, or Ingress class mismatch
- **Fix**: Verify ingress controller matches annotations; check controller logs

### Rate limit too aggressive — legitimate users blocked
- **Cause**: Limiting by IP behind a load balancer (all traffic from same IP)
- **Fix**: Use `X-Forwarded-For` header; configure `use-forwarded-headers: true`

### Shared rate limit state inconsistent across replicas
- **Cause**: Using local rate limiting instead of global (Redis-backed)
- **Fix**: Deploy centralized rate limit service with Redis; use `policy: redis`

### 429 responses not reaching the client
- **Cause**: CDN or upstream proxy retrying silently
- **Fix**: Configure CDN to pass through 429; set `Retry-After` header

## Best Practices

1. **Layer rate limits** — global (gateway) + per-service + per-endpoint
2. **Use Redis for shared state** — local limits are per-pod, not global
3. **Return proper headers** — `X-RateLimit-Remaining` helps clients self-throttle
4. **Allowlist internal traffic** — don't rate-limit service-to-service calls
5. **Different tiers** — free/premium plans with distinct limits
6. **Burst allowance** — allow short bursts above sustained rate
7. **Monitor 429 rates** — high 429s may indicate legitimate traffic growth
8. **Rate limit by API key, not just IP** — IPs are shared (NAT, proxies)

## Key Takeaways

- Rate limiting protects Kubernetes services from abuse and overload
- NGINX Ingress: simple annotations (`limit-rps`, `limit-rpm`, `limit-connections`)
- Gateway API: `BackendTrafficPolicy` with per-client selectors (IP, header, CIDR)
- Istio: EnvoyFilter for local rate limits, external ratelimit service for global
- Kong: `RateLimiting` plugin with Redis backend for cluster-wide consistency
- Always return `429 Too Many Requests` with `Retry-After` header
- Use Redis-backed global rate limiting when running multiple ingress replicas
