---
title: "Canary Deployment with Gateway API Traffic Splitting"
description: "Implement canary deployments using Kubernetes Gateway API HTTPRoute traffic splitting. Gradually shift traffic from stable to canary version with weight-based"
tags:
  - "gateway-api"
  - "canary"
  - "traffic-splitting"
  - "deployments"
  - "cka"
category: "deployments"
publishDate: "2026-05-18"
author: "Luca Berton"
difficulty: "intermediate"
relatedRecipes:
  - "kubernetes-gateway-api-guide"
  - "kubernetes-readiness-probe-guide"
  - "kubernetes-hpa-custom-metrics-guide"
---

> 💡 **Quick Answer:** Use `HTTPRoute` with `backendRefs` weights to split traffic between stable (weight: 90) and canary (weight: 10) Services. Gradually increase canary weight as confidence grows. Add header-based routing to let developers test canary directly before public exposure.

## The Problem

- Rolling updates send all users to new version immediately — risky
- Need to test new version with a small percentage of real traffic
- Want ability to route specific users (developers, QA) to canary
- Must be able to instantly rollback if metrics degrade
- Traditional Ingress doesn't support traffic splitting natively

## The Solution

### Deploy Stable and Canary Versions

```yaml
# Stable deployment (current production)
apiVersion: apps/v1
kind: Deployment
metadata:
  name: my-app-stable
  namespace: production
spec:
  replicas: 3
  selector:
    matchLabels:
      app: my-app
      version: stable
  template:
    metadata:
      labels:
        app: my-app
        version: stable
    spec:
      containers:
        - name: app
          image: registry.example.com/my-app:v1.0.0
          ports:
            - containerPort: 8080
          readinessProbe:
            httpGet:
              path: /health
              port: 8080
            initialDelaySeconds: 5
            periodSeconds: 5
---
# Canary deployment (new version)
apiVersion: apps/v1
kind: Deployment
metadata:
  name: my-app-canary
  namespace: production
spec:
  replicas: 1
  selector:
    matchLabels:
      app: my-app
      version: canary
  template:
    metadata:
      labels:
        app: my-app
        version: canary
    spec:
      containers:
        - name: app
          image: registry.example.com/my-app:v1.1.0
          ports:
            - containerPort: 8080
          readinessProbe:
            httpGet:
              path: /health
              port: 8080
            initialDelaySeconds: 5
            periodSeconds: 5
---
# Separate Services for each version
apiVersion: v1
kind: Service
metadata:
  name: my-app-stable
  namespace: production
spec:
  selector:
    app: my-app
    version: stable
  ports:
    - port: 80
      targetPort: 8080
---
apiVersion: v1
kind: Service
metadata:
  name: my-app-canary
  namespace: production
spec:
  selector:
    app: my-app
    version: canary
  ports:
    - port: 80
      targetPort: 8080
```

### Gateway and HTTPRoute with Traffic Split

```yaml
# Gateway (one per cluster or namespace)
apiVersion: gateway.networking.k8s.io/v1
kind: Gateway
metadata:
  name: production-gw
  namespace: production
spec:
  gatewayClassName: istio      # or cilium, envoy, nginx
  listeners:
    - name: http
      protocol: HTTP
      port: 80
    - name: https
      protocol: HTTPS
      port: 443
      tls:
        mode: Terminate
        certificateRefs:
          - name: my-app-tls
---
# HTTPRoute with weighted traffic split
apiVersion: gateway.networking.k8s.io/v1
kind: HTTPRoute
metadata:
  name: my-app-canary-route
  namespace: production
spec:
  parentRefs:
    - name: production-gw
  hostnames:
    - "app.example.com"
  rules:
    # Rule 1: Header-based override (developers go to canary)
    - matches:
        - headers:
            - name: x-canary
              value: "true"
      backendRefs:
        - name: my-app-canary
          port: 80
          weight: 100

    # Rule 2: Weight-based split for everyone else
    - backendRefs:
        - name: my-app-stable
          port: 80
          weight: 90              # 90% → stable
        - name: my-app-canary
          port: 80
          weight: 10              # 10% → canary
```

### Progressive Traffic Shift

```bash
# Phase 1: Initial canary (5%)
kubectl patch httproute my-app-canary-route -n production --type=merge -p '
spec:
  rules:
    - matches:
        - headers:
            - name: x-canary
              value: "true"
      backendRefs:
        - name: my-app-canary
          port: 80
          weight: 100
    - backendRefs:
        - name: my-app-stable
          port: 80
          weight: 95
        - name: my-app-canary
          port: 80
          weight: 5'

# Monitor metrics for 10 minutes...
# If OK:

# Phase 2: Increase to 25%
# ... change weight: 75 / weight: 25

# Phase 3: Increase to 50%
# ... change weight: 50 / weight: 50

# Phase 4: Full rollout (100% canary)
# ... change weight: 0 / weight: 100

# Phase 5: Promote canary → stable
# Update stable Deployment image to v1.1.0
# Delete canary Deployment
# Reset HTTPRoute to single backend
```

```text
Canary Progression:
──────────────────────────────────────────────────────────────────
Time      Stable    Canary    Action
──────────────────────────────────────────────────────────────────
T+0       100%      0%        Deploy canary, header-only access
T+5min    95%       5%        Initial traffic split
T+15min   75%       25%       Metrics look good, increase
T+30min   50%       50%       Half traffic on canary
T+60min   0%        100%      Full shift
T+90min   —         —         Promote: canary becomes stable
```

### Instant Rollback

```yaml
# Emergency rollback — send 100% to stable immediately
apiVersion: gateway.networking.k8s.io/v1
kind: HTTPRoute
metadata:
  name: my-app-canary-route
  namespace: production
spec:
  parentRefs:
    - name: production-gw
  hostnames:
    - "app.example.com"
  rules:
    - backendRefs:
        - name: my-app-stable
          port: 80
          weight: 100
        - name: my-app-canary
          port: 80
          weight: 0              # Zero traffic to canary
```

```bash
# One-liner rollback:
kubectl patch httproute my-app-canary-route -n production --type=json \
  -p '[{"op":"replace","path":"/spec/rules/1/backendRefs/0/weight","value":100},
       {"op":"replace","path":"/spec/rules/1/backendRefs/1/weight","value":0}]'
```

### Canary with Request Mirroring

```yaml
# Mirror traffic to canary without affecting responses
apiVersion: gateway.networking.k8s.io/v1
kind: HTTPRoute
metadata:
  name: my-app-mirror
  namespace: production
spec:
  parentRefs:
    - name: production-gw
  hostnames:
    - "app.example.com"
  rules:
    - backendRefs:
        - name: my-app-stable
          port: 80
      filters:
        - type: RequestMirror
          requestMirror:
            backendRef:
              name: my-app-canary
              port: 80
      # 100% traffic to stable; copy of requests also sent to canary
      # Canary responses are discarded — safe to test
```

### Verify Traffic Distribution

```bash
# Send 100 requests and count responses
for i in $(seq 1 100); do
  curl -s http://app.example.com/version
done | sort | uniq -c
# Expected (with 90/10 split):
#   89 v1.0.0
#   11 v1.1.0

# Test header-based routing
curl -H "x-canary: true" http://app.example.com/version
# Always returns: v1.1.0

# Without header — follows weight distribution
curl http://app.example.com/version
# ~90% chance: v1.0.0
```

## Common Issues

### Traffic not splitting (all goes to stable)
- **Cause**: Gateway controller doesn't support weighted backendRefs
- **Fix**: Verify gatewayClassName supports traffic splitting (Istio, Cilium, Envoy Gateway do)

### Canary gets more traffic than expected
- **Cause**: Sticky sessions or connection reuse skews distribution
- **Fix**: Disable session affinity; test with many unique clients

### HTTPRoute not accepted
- **Cause**: parentRef doesn't match any Gateway listener
- **Fix**: Check `kubectl get httproute -o yaml` for conditions/status

## Best Practices

1. **Start with header-based routing** — let developers test before public traffic
2. **5% initial split** — catches major issues with minimal blast radius
3. **Monitor error rate and latency** between phases — automate with Prometheus
4. **Set readiness probes** — unhealthy canary Pods should not receive traffic
5. **One change at a time** — don't canary multiple services simultaneously
6. **Automate with Argo Rollouts or Flagger** for production use

## Key Takeaways

- Gateway API `HTTPRoute` supports native traffic splitting via `weight` on `backendRefs`
- Two Services (stable + canary) pointed at two Deployments with different versions
- Header-based routing (`x-canary: true`) for developer/QA pre-testing
- Progressive: 5% → 25% → 50% → 100% with monitoring between phases
- Instant rollback: set canary weight to 0
- Request mirroring for shadow testing without user impact
- Works with Istio, Cilium, Envoy Gateway, and other Gateway API implementations
