---
title: "NGINX Ingress limit-burst-multiplier"
description: "Configure nginx.ingress.kubernetes.io/limit-burst-multiplier for rate limiting burst control. Tune burst size, rate limits, and 429 response handling."
publishDate: "2026-05-02"
author: "Luca Berton"
category: "networking"
difficulty: "intermediate"
timeToComplete: "10 minutes"
kubernetesVersion: "1.28+"
tags:
  - "nginx"
  - "ingress"
  - "rate-limiting"
  - "networking"
relatedRecipes:
  - "kubernetes-rate-limiting-guide"
  - "kubernetes-ingress-guide"
  - "kubernetes-gateway-api-guide"
  - "kubernetes-ingress-fundamentals"
---

> 💡 **Quick Answer:** `nginx.ingress.kubernetes.io/limit-burst-multiplier` sets the burst bucket size as a multiple of the per-second rate limit. Default is `5`. With `limit-rps: "10"` and `limit-burst-multiplier: "3"`, the burst bucket holds 30 requests. This means a client can send 30 requests instantly, then must stay under 10/s. Set it to `1` for strict rate limiting, `5-10` for APIs with natural traffic spikes.

## The Problem

NGINX Ingress rate limiting with `limit-rps` alone is too strict:

- Legitimate browser page loads send 10-20 requests simultaneously (CSS, JS, images)
- API clients batch requests then pause
- WebSocket upgrades need burst capacity
- Default burst of 5x can be too generous for API protection

## The Solution

### How limit-burst-multiplier Works

```yaml
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: api-ingress
  annotations:
    # Rate: 10 requests per second
    nginx.ingress.kubernetes.io/limit-rps: "10"
    # Burst: 3x rate = 30 request burst bucket
    nginx.ingress.kubernetes.io/limit-burst-multiplier: "3"
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

**What happens:**

```
t=0.0s: Client sends 30 requests instantly → all accepted (burst bucket)
t=0.1s: Client sends 1 request → rejected (429) — bucket empty
t=0.1s: Bucket refills at 10/s → 1 token available after 100ms
t=1.0s: Bucket has 10 tokens → can burst 10 more
t=3.0s: Bucket full again at 30 tokens
```

### Configuration Examples

```yaml
# Strict API protection (no burst)
annotations:
  nginx.ingress.kubernetes.io/limit-rps: "5"
  nginx.ingress.kubernetes.io/limit-burst-multiplier: "1"
  # Bucket: 5 requests, refill at 5/s

# Web application (generous burst for page loads)
annotations:
  nginx.ingress.kubernetes.io/limit-rps: "20"
  nginx.ingress.kubernetes.io/limit-burst-multiplier: "5"
  # Bucket: 100 requests, refill at 20/s

# Webhook endpoint (low rate, moderate burst)
annotations:
  nginx.ingress.kubernetes.io/limit-rps: "2"
  nginx.ingress.kubernetes.io/limit-burst-multiplier: "10"
  # Bucket: 20 requests, refill at 2/s

# Per-minute rate limit with burst
annotations:
  nginx.ingress.kubernetes.io/limit-rpm: "300"
  nginx.ingress.kubernetes.io/limit-burst-multiplier: "3"
  # Bucket: 15 requests (300/60 * 3), refill at 5/s
```

### Combine with Other Rate Limit Annotations

```yaml
annotations:
  # Request rate
  nginx.ingress.kubernetes.io/limit-rps: "10"
  nginx.ingress.kubernetes.io/limit-burst-multiplier: "3"
  
  # Connection limit (concurrent connections per IP)
  nginx.ingress.kubernetes.io/limit-connections: "10"
  
  # Whitelist IPs (bypass rate limiting)
  nginx.ingress.kubernetes.io/limit-whitelist: "10.0.0.0/8,192.168.0.0/16"
  
  # Custom response code (default: 503, change to 429)
  nginx.ingress.kubernetes.io/server-snippet: |
    limit_req_status 429;
```

### What NGINX Generates

```nginx
# The annotations translate to this nginx.conf directive:
limit_req_zone $binary_remote_addr zone=ingress_rps:10m rate=10r/s;

location / {
    limit_req zone=ingress_rps burst=30 nodelay;
    #                              ^^ 10 × 3 = 30
    #                                    ^^ Don't delay burst requests
    proxy_pass http://upstream;
}
```

### Monitor Rate Limiting

```bash
# Check NGINX controller logs for rate-limited requests
kubectl logs -n ingress-nginx deployment/ingress-nginx-controller | grep "limiting"

# Prometheus metrics
# nginx_ingress_controller_requests{status="429"} — rate-limited count
# nginx_ingress_controller_request_duration_seconds — latency impact
```

## Common Issues

**All requests getting 429 with low rps**

burst-multiplier too low. A browser loading a page sends 20+ requests. Set `limit-burst-multiplier: "5"` minimum for web apps.

**Rate limiting not working at all**

Check annotation spelling exactly: `nginx.ingress.kubernetes.io/limit-rps` (not `limit_rps`). Also verify the Ingress is using the nginx IngressClass.

**Different behavior with limit-rpm vs limit-rps**

`limit-rpm: "300"` = 5/s internally. The burst-multiplier applies to the per-second rate, so `burst = (300/60) × multiplier = 5 × 3 = 15`.

## Best Practices

- **Web apps: multiplier 5-10** — browsers send burst of requests per page load
- **APIs: multiplier 1-3** — tighter control, predictable rate
- **Webhooks: multiplier 5-10 with low rps** — handle deployment burst, prevent abuse
- **Always whitelist internal CIDRs** — don't rate limit health checks
- **Return 429 not 503** — 429 is semantically correct for rate limiting

## Key Takeaways

- `limit-burst-multiplier` sets burst bucket = rps × multiplier (default 5)
- Burst allows instant request spike, then enforces steady rate
- Set to 1 for strict limiting, 5-10 for user-facing applications
- Combine with `limit-connections` for concurrent connection control
- Whitelist internal traffic to avoid rate limiting health checks and probes
