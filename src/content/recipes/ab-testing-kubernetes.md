---
title: "How to Implement A/B Testing with Kubernetes"
description: "Route traffic between application versions for A/B testing. Use service mesh, ingress, and custom routing rules to validate features with real users."
category: "deployments"
difficulty: "advanced"
publishDate: "2026-01-22"
tags: ["a-b-testing", "traffic-routing", "feature-flags", "deployment", "experimentation"]
---

# How to Implement A/B Testing with Kubernetes

A/B testing routes traffic between different application versions based on specific criteria like headers, cookies, or user attributes. This enables data-driven decisions about new features.

## A/B Testing Concepts

```
A/B Testing in Kubernetes:
                    ┌─────────────────┐
                    │     Ingress/    │
   Request ──────►  │   Service Mesh  │
   (with header)    └────────┬────────┘
                             │
              ┌──────────────┼──────────────┐
              │              │              │
              ▼              ▼              ▼
        ┌─────────┐    ┌─────────┐    ┌─────────┐
        │ Version │    │ Version │    │ Version │
        │    A    │    │    B    │    │    C    │
        │  (80%)  │    │  (15%)  │    │   (5%)  │
        └─────────┘    └─────────┘    └─────────┘
```

## Deploy Multiple Versions

```yaml
# version-a-deployment.yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: myapp-v1
  labels:
    app: myapp
    version: v1
spec:
  replicas: 3
  selector:
    matchLabels:
      app: myapp
      version: v1
  template:
    metadata:
      labels:
        app: myapp
        version: v1
    spec:
      containers:
        - name: myapp
          image: myapp:v1.0.0
          ports:
            - containerPort: 8080
---
# version-b-deployment.yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: myapp-v2
  labels:
    app: myapp
    version: v2
spec:
  replicas: 1
  selector:
    matchLabels:
      app: myapp
      version: v2
  template:
    metadata:
      labels:
        app: myapp
        version: v2
    spec:
      containers:
        - name: myapp
          image: myapp:v2.0.0
          ports:
            - containerPort: 8080
```

## Services for Each Version

```yaml
# services.yaml
apiVersion: v1
kind: Service
metadata:
  name: myapp-v1
spec:
  selector:
    app: myapp
    version: v1
  ports:
    - port: 80
      targetPort: 8080
---
apiVersion: v1
kind: Service
metadata:
  name: myapp-v2
spec:
  selector:
    app: myapp
    version: v2
  ports:
    - port: 80
      targetPort: 8080
```

## NGINX Ingress A/B Testing

```yaml
# Primary ingress (Version A - default)
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: myapp-main
  annotations:
    nginx.ingress.kubernetes.io/canary: "false"
spec:
  ingressClassName: nginx
  rules:
    - host: myapp.example.com
      http:
        paths:
          - path: /
            pathType: Prefix
            backend:
              service:
                name: myapp-v1
                port:
                  number: 80
---
# Canary ingress (Version B - by header)
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: myapp-canary
  annotations:
    nginx.ingress.kubernetes.io/canary: "true"
    nginx.ingress.kubernetes.io/canary-by-header: "X-Version"
    nginx.ingress.kubernetes.io/canary-by-header-value: "v2"
spec:
  ingressClassName: nginx
  rules:
    - host: myapp.example.com
      http:
        paths:
          - path: /
            pathType: Prefix
            backend:
              service:
                name: myapp-v2
                port:
                  number: 80
```

```bash
# Test A/B routing
# Default version (A)
curl https://myapp.example.com

# Version B with header
curl -H "X-Version: v2" https://myapp.example.com
```

## Cookie-Based A/B Testing

```yaml
# cookie-based-canary.yaml
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: myapp-canary-cookie
  annotations:
    nginx.ingress.kubernetes.io/canary: "true"
    nginx.ingress.kubernetes.io/canary-by-cookie: "ab-test-v2"
spec:
  ingressClassName: nginx
  rules:
    - host: myapp.example.com
      http:
        paths:
          - path: /
            pathType: Prefix
            backend:
              service:
                name: myapp-v2
                port:
                  number: 80
```

```bash
# Users with cookie "ab-test-v2=always" get version B
curl -b "ab-test-v2=always" https://myapp.example.com
```

## Weight-Based A/B Testing

```yaml
# weight-based-canary.yaml
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: myapp-canary-weight
  annotations:
    nginx.ingress.kubernetes.io/canary: "true"
    nginx.ingress.kubernetes.io/canary-weight: "20"  # 20% to version B
spec:
  ingressClassName: nginx
  rules:
    - host: myapp.example.com
      http:
        paths:
          - path: /
            pathType: Prefix
            backend:
              service:
                name: myapp-v2
                port:
                  number: 80
```

## Istio A/B Testing

```yaml
# istio-virtual-service.yaml
apiVersion: networking.istio.io/v1beta1
kind: VirtualService
metadata:
  name: myapp
spec:
  hosts:
    - myapp.example.com
  http:
    # Route by header
    - match:
        - headers:
            x-version:
              exact: "v2"
      route:
        - destination:
            host: myapp-v2
            port:
              number: 80
    
    # Route by user-agent (mobile users)
    - match:
        - headers:
            user-agent:
              regex: ".*Mobile.*"
      route:
        - destination:
            host: myapp-v2
            port:
              number: 80
          weight: 50
        - destination:
            host: myapp-v1
            port:
              number: 80
          weight: 50
    
    # Default weighted routing
    - route:
        - destination:
            host: myapp-v1
            port:
              number: 80
          weight: 80
        - destination:
            host: myapp-v2
            port:
              number: 80
          weight: 20
```

## Istio with DestinationRule

```yaml
# destination-rule.yaml
apiVersion: networking.istio.io/v1beta1
kind: DestinationRule
metadata:
  name: myapp
spec:
  host: myapp
  subsets:
    - name: v1
      labels:
        version: v1
    - name: v2
      labels:
        version: v2
---
apiVersion: networking.istio.io/v1beta1
kind: VirtualService
metadata:
  name: myapp
spec:
  hosts:
    - myapp
  http:
    - route:
        - destination:
            host: myapp
            subset: v1
          weight: 90
        - destination:
            host: myapp
            subset: v2
          weight: 10
```

## User-Based A/B Testing

```yaml
# Route specific users to new version
apiVersion: networking.istio.io/v1beta1
kind: VirtualService
metadata:
  name: myapp-user-routing
spec:
  hosts:
    - myapp
  http:
    # Beta users (by cookie)
    - match:
        - headers:
            cookie:
              regex: ".*user_group=beta.*"
      route:
        - destination:
            host: myapp
            subset: v2
    
    # Specific user IDs (by header)
    - match:
        - headers:
            x-user-id:
              regex: "^(user1|user2|user3)$"
      route:
        - destination:
            host: myapp
            subset: v2
    
    # Default
    - route:
        - destination:
            host: myapp
            subset: v1
```

## Argo Rollouts A/B Testing

```yaml
# argo-rollout-experiment.yaml
apiVersion: argoproj.io/v1alpha1
kind: Rollout
metadata:
  name: myapp
spec:
  replicas: 10
  selector:
    matchLabels:
      app: myapp
  template:
    metadata:
      labels:
        app: myapp
    spec:
      containers:
        - name: myapp
          image: myapp:v1
          ports:
            - containerPort: 8080
  strategy:
    canary:
      canaryService: myapp-canary
      stableService: myapp-stable
      trafficRouting:
        nginx:
          stableIngress: myapp-ingress
          additionalIngressAnnotations:
            canary-by-header: X-Version
            canary-by-header-value: canary
      steps:
        - setWeight: 10
        - pause: {}
        - setWeight: 20
        - pause: {duration: 1h}
        - setWeight: 50
        - pause: {duration: 2h}
        - setWeight: 100
```

## Monitoring A/B Tests

```yaml
# Track metrics per version
# Prometheus queries:

# Request rate by version
sum(rate(http_requests_total{app="myapp"}[5m])) by (version)

# Error rate by version
sum(rate(http_requests_total{app="myapp",status=~"5.."}[5m])) by (version) /
sum(rate(http_requests_total{app="myapp"}[5m])) by (version)

# Latency by version
histogram_quantile(0.95, 
  sum(rate(http_request_duration_seconds_bucket{app="myapp"}[5m])) by (version, le)
)
```

## Application-Level A/B Testing

```yaml
# Feature flag service
apiVersion: v1
kind: ConfigMap
metadata:
  name: feature-flags
data:
  flags.json: |
    {
      "new_checkout_flow": {
        "enabled": true,
        "percentage": 20,
        "targeting": {
          "user_groups": ["beta"],
          "user_ids": ["user123", "user456"]
        }
      }
    }
```

```python
# Application code example
import random

def should_show_feature(user_id, feature_name, flags):
    feature = flags.get(feature_name, {})
    
    if not feature.get('enabled'):
        return False
    
    # Check user targeting
    if user_id in feature.get('targeting', {}).get('user_ids', []):
        return True
    
    # Check percentage rollout
    return random.random() * 100 < feature.get('percentage', 0)
```

## Gradual Rollout Script

```bash
#!/bin/bash
# gradual-rollout.sh

# Start with 10% traffic
kubectl annotate ingress myapp-canary \
  nginx.ingress.kubernetes.io/canary-weight="10" --overwrite

sleep 3600  # Wait 1 hour, monitor metrics

# Increase to 25%
kubectl annotate ingress myapp-canary \
  nginx.ingress.kubernetes.io/canary-weight="25" --overwrite

sleep 3600  # Wait 1 hour

# Increase to 50%
kubectl annotate ingress myapp-canary \
  nginx.ingress.kubernetes.io/canary-weight="50" --overwrite

sleep 3600  # Wait 1 hour

# Full rollout
kubectl annotate ingress myapp-canary \
  nginx.ingress.kubernetes.io/canary-weight="100" --overwrite
```

## Best Practices

```markdown
1. Start Small
   - Begin with 5-10% traffic to new version
   - Gradually increase based on metrics

2. Define Success Metrics
   - Conversion rate
   - Error rate
   - Latency
   - User engagement

3. Use Consistent Routing
   - Same user should see same version
   - Use cookies or user ID for consistency

4. Monitor Both Versions
   - Compare metrics side by side
   - Set up alerts for regressions

5. Have Rollback Ready
   - Quick switch back to stable version
   - Automated rollback on errors
```

## Summary

A/B testing in Kubernetes routes traffic between versions based on headers, cookies, weights, or user attributes. Use NGINX Ingress annotations for simple setups, Istio for advanced traffic management, or Argo Rollouts for automated progressive delivery. Always monitor both versions with clear success metrics and maintain quick rollback capability. Consistent user routing ensures accurate test results.

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
