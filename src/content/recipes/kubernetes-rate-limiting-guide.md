---
title: "Kubernetes Rate Limiting Guide"
description: "Implement rate limiting in Kubernetes with Ingress annotations, Gateway API, Envoy filters, and application-level middleware. Protect APIs from abuse."
publishDate: "2026-05-02"
author: "Luca Berton"
category: "networking"
difficulty: "intermediate"
timeToComplete: "15 minutes"
kubernetesVersion: "1.28+"
tags:
  - "rate-limiting"
  - "ingress"
  - "gateway-api"
  - "envoy"
  - "networking"
  - "security"
relatedRecipes:
  - "kubernetes-ingress-guide"
  - "kubernetes-gateway-api-guide"
  - "nginx-ingress-limit-burst-multiplier"
  - "kubernetes-ingress-fundamentals"
  - "kubernetes-ingress-nginx-guide"
  - "kubernetes-networkpolicy-guide"
  - "kubernetes-linkerd-service-mesh-guide"
---

> 💡 **Quick Answer:** For NGINX Ingress, add annotations: `nginx.ingress.kubernetes.io/limit-rps: "10"` and `nginx.ingress.kubernetes.io/limit-burst-multiplier: "5"`. For Gateway API with Envoy, use `BackendTrafficPolicy` with `rateLimit`. For Istio, use `EnvoyFilter` with `envoy.filters.http.local_ratelimit`. Application-level rate limiting (Redis + middleware) gives the finest control.

## The Problem

Without rate limiting, Kubernetes services are vulnerable to:

- API abuse and scraping
- DDoS overwhelming pods and triggering autoscaling costs
- Noisy neighbors in multi-tenant clusters
- Webhook floods from CI/CD systems
- Brute-force attacks on authentication endpoints

## The Solution

### NGINX Ingress Rate Limiting

```yaml
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: api-ingress
  annotations:
    # Rate limit: 10 requests/second per client IP
    nginx.ingress.kubernetes.io/limit-rps: "10"
    # Burst: allow 50 requests in queue (5x multiplier)
    nginx.ingress.kubernetes.io/limit-burst-multiplier: "5"
    # Rate limit by IP (default) or other key
    nginx.ingress.kubernetes.io/limit-whitelist: "10.0.0.0/8"
    # Custom response when rate limited
    nginx.ingress.kubernetes.io/custom-http-errors: "429"
    
    # Connection limits
    nginx.ingress.kubernetes.io/limit-connections: "5"
    
    # Rate limit by request per minute (alternative)
    nginx.ingress.kubernetes.io/limit-rpm: "600"
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
              number: 8080
```

### Gateway API Rate Limiting (Envoy Gateway)

```yaml
apiVersion: gateway.envoyproxy.io/v1alpha1
kind: BackendTrafficPolicy
metadata:
  name: rate-limit-policy
spec:
  targetRefs:
  - group: gateway.networking.k8s.io
    kind: HTTPRoute
    name: api-route
  rateLimit:
    type: Local
    local:
      rules:
      - clientSelectors:
        - headers:
          - name: x-api-key
            type: Distinct           # Per unique API key
        limit:
          requests: 100
          unit: Minute
      - limit:                       # Default: per source IP
          requests: 10
          unit: Second

---
apiVersion: gateway.networking.k8s.io/v1
kind: HTTPRoute
metadata:
  name: api-route
spec:
  parentRefs:
  - name: my-gateway
  hostnames:
  - api.example.com
  rules:
  - matches:
    - path:
        type: PathPrefix
        value: /api
    backendRefs:
    - name: api-service
      port: 8080
```

### Istio Rate Limiting

```yaml
apiVersion: networking.istio.io/v1alpha3
kind: EnvoyFilter
metadata:
  name: rate-limit
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
          "@type": type.googleapis.com/envoy.extensions.filters.http.local_ratelimit.v3.LocalRateLimit
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
```

### Application-Level Rate Limiting (Redis)

```yaml
# Deploy Redis for shared rate limit state
apiVersion: apps/v1
kind: Deployment
metadata:
  name: redis-ratelimit
spec:
  replicas: 1
  selector:
    matchLabels:
      app: redis-ratelimit
  template:
    metadata:
      labels:
        app: redis-ratelimit
    spec:
      containers:
      - name: redis
        image: redis:7-alpine
        ports:
        - containerPort: 6379
        resources:
          requests:
            cpu: 100m
            memory: 128Mi
---
apiVersion: v1
kind: Service
metadata:
  name: redis-ratelimit
spec:
  selector:
    app: redis-ratelimit
  ports:
  - port: 6379
```

### Kong Plugin (API-Key-Based Limits)

If you're already running Kong as your ingress controller, rate limiting is a plugin attached to the Ingress rather than a separate Envoy config:

```yaml
apiVersion: configuration.konghq.com/v1
kind: KongPlugin
metadata: {name: rate-limit-by-key}
spec:
  plugin: rate-limiting
  config:
    second: 10
    policy: redis                 # shared state across replicas — see Common Issues below
    redis_host: redis.default.svc.cluster.local
    limit_by: header
    header_name: X-API-Key         # per-API-key instead of per-IP
---
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: api-ingress
  annotations: {konghq.com/plugins: rate-limit-by-key}
spec:
  ingressClassName: kong
  rules: [{host: api.example.com, http: {paths: [{path: /, pathType: Prefix, backend: {service: {name: api-service, port: {number: 80}}}}]}}]
```

### Standalone Envoy Rate Limit Service (Multi-Tier by Descriptor)

For rules more complex than a single per-route limit — different limits per path, per user, and per subscription tier simultaneously — Envoy's own ratelimit service reads a descriptor config instead of embedding rules in the filter itself:

```yaml
apiVersion: v1
kind: ConfigMap
metadata: {name: rate-limit-config}
data:
  config.yaml: |
    domain: production
    descriptors:
      - {key: path, value: /api/v1/users, rate_limit: {unit: second, requests_per_unit: 10}}
      - {key: api_tier, value: free, rate_limit: {unit: hour, requests_per_unit: 100}}
      - {key: api_tier, value: premium, rate_limit: {unit: hour, requests_per_unit: 10000}}
---
apiVersion: apps/v1
kind: Deployment
metadata: {name: ratelimit}
spec:
  replicas: 2
  selector: {matchLabels: {app: ratelimit}}
  template:
    metadata: {labels: {app: ratelimit}}
    spec:
      containers:
        - name: ratelimit
          image: envoyproxy/ratelimit:v1.4.0
          env:
            - {name: RUNTIME_ROOT, value: /data}
            - {name: RUNTIME_SUBDIRECTORY, value: ratelimit}
            - {name: REDIS_URL, value: "redis:6379"}
          volumeMounts: [{name: config, mountPath: /data/ratelimit/config}]
      volumes: [{name: config, configMap: {name: rate-limit-config}}]
```

Reference this from the Istio `EnvoyFilter` above by swapping `local_ratelimit` for `envoy.filters.http.ratelimit` pointed at this service's gRPC port (8081) — the local filter enforces per-instance limits, this one enforces global limits shared across all instances via Redis.

### Rate Limit Comparison

| Method | Scope | Granularity | State | Best For |
|--------|-------|-------------|-------|----------|
| NGINX Ingress annotations | Per Ingress | IP-based | In-memory | Simple API protection |
| Gateway API BackendTrafficPolicy | Per route | Header/IP | Local or Redis | Modern API gateways |
| Istio EnvoyFilter | Per workload | Flexible | Local | Service mesh users |
| Application + Redis | Per endpoint | Custom keys | Shared (Redis) | Fine-grained API limits |

## Common Issues

**Rate limiting per pod instead of global**

Local rate limiters are per-instance. With 3 replicas, effective limit is 3x configured. Use Redis-backed global rate limiting for accuracy.

**Webhook CI/CD floods still hitting**

Rate limit by source IP — CI/CD uses few IPs. Or add dedicated rate limit on `/webhook` path with lower threshold.

**Legitimate users getting 429**

Increase burst multiplier, whitelist internal CIDRs, or use API key-based limits instead of IP-based.

## Best Practices

- **Layer rate limits** — infrastructure (Ingress) + application (Redis) for defense in depth
- **Rate limit by API key** for authenticated endpoints, IP for anonymous
- **Set burst multiplier to 3-5x** — allows natural traffic spikes
- **Return `Retry-After` header** with 429 responses — helps well-behaved clients
- **Whitelist internal traffic** — don't rate limit health checks or internal services
- **Monitor 429 rates** — high 429 rates may mean limits are too tight

## Key Takeaways

- NGINX Ingress: `limit-rps` annotation for quick per-IP rate limiting
- Gateway API: `BackendTrafficPolicy` with local or global rate limit rules
- Application-level with Redis gives the most control but adds complexity
- Local rate limiters multiply with replicas — use global/Redis for accurate limits
- Always set burst multiplier and whitelist internal CIDRs
