---
title: "Kubernetes Blue-Green and Canary Deployment Strategies"
description: "Implement blue-green and canary deployment strategies on Kubernetes. Zero-downtime releases using Service label switching, traffic splitting, progressive rollouts with Argo Rollouts, and instant rollback techniques."
tags:
  - "blue-green"
  - "canary"
  - "deployment-strategy"
  - "argo-rollouts"
  - "zero-downtime"
category: "deployments"
publishDate: "2026-06-01"
author: "Luca Berton"
difficulty: "intermediate"
relatedRecipes:
  - "kubernetes-rolling-update-strategies"
  - "kubernetes-graceful-shutdown-pod-termination"
  - "kubernetes-gitops-argocd"
---

> 💡 **Quick Answer:** **Blue-Green**: run two identical environments (blue=current, green=new), switch traffic instantly by updating the Service selector. **Canary**: gradually shift traffic (5%→25%→50%→100%) to the new version while monitoring errors. Use native K8s Services for simple blue-green, or Argo Rollouts for automated canary with analysis and auto-rollback.

## The Problem

- Rolling updates can leave both old and new versions serving simultaneously
- No instant rollback — rolling back takes as long as rolling forward
- Can't test new version with real traffic before full deployment
- Need to validate metrics (error rate, latency) before committing to new version
- Want zero-downtime deployments with confidence

## The Solution

### Blue-Green with Native Kubernetes

```yaml
# Blue deployment (current production)
apiVersion: apps/v1
kind: Deployment
metadata:
  name: my-app-blue
  namespace: production
spec:
  replicas: 3
  selector:
    matchLabels:
      app: my-app
      version: blue
  template:
    metadata:
      labels:
        app: my-app
        version: blue
    spec:
      containers:
        - name: app
          image: registry.example.com/my-app:v1.0.0
---
# Green deployment (new version)
apiVersion: apps/v1
kind: Deployment
metadata:
  name: my-app-green
  namespace: production
spec:
  replicas: 3
  selector:
    matchLabels:
      app: my-app
      version: green
  template:
    metadata:
      labels:
        app: my-app
        version: green
    spec:
      containers:
        - name: app
          image: registry.example.com/my-app:v2.0.0
---
# Service points to blue (current)
apiVersion: v1
kind: Service
metadata:
  name: my-app
  namespace: production
spec:
  selector:
    app: my-app
    version: blue    # ← Switch to "green" to cut over
  ports:
    - port: 80
      targetPort: 8080
```

```bash
# Switch traffic from blue to green (instant)
kubectl patch service my-app -n production \
  -p '{"spec":{"selector":{"version":"green"}}}'

# Rollback (instant)
kubectl patch service my-app -n production \
  -p '{"spec":{"selector":{"version":"blue"}}}'

# After validation, scale down old version
kubectl scale deployment my-app-blue --replicas=0 -n production
```

### Canary with Argo Rollouts

```bash
# Install Argo Rollouts
kubectl create namespace argo-rollouts
kubectl apply -n argo-rollouts -f \
  https://github.com/argoproj/argo-rollouts/releases/latest/download/install.yaml

# Install kubectl plugin
curl -LO https://github.com/argoproj/argo-rollouts/releases/latest/download/kubectl-argo-rollouts-linux-amd64
chmod +x kubectl-argo-rollouts-linux-amd64
mv kubectl-argo-rollouts-linux-amd64 /usr/local/bin/kubectl-argo-rollouts
```

```yaml
# Canary Rollout with automated analysis
apiVersion: argoproj.io/v1alpha1
kind: Rollout
metadata:
  name: my-app
  namespace: production
spec:
  replicas: 5
  selector:
    matchLabels:
      app: my-app
  template:
    metadata:
      labels:
        app: my-app
    spec:
      containers:
        - name: app
          image: registry.example.com/my-app:v2.0.0
          ports:
            - containerPort: 8080
  strategy:
    canary:
      canaryService: my-app-canary
      stableService: my-app-stable
      steps:
        - setWeight: 5           # 5% traffic to canary
        - pause: {duration: 5m}  # Wait 5 min
        - analysis:              # Run analysis
            templates:
              - templateName: success-rate
        - setWeight: 25          # 25% if analysis passes
        - pause: {duration: 5m}
        - setWeight: 50          # 50%
        - pause: {duration: 10m}
        - setWeight: 100         # Full rollout
      analysis:
        successfulRunHistoryLimit: 3
        unsuccessfulRunHistoryLimit: 3
---
# Services for canary traffic splitting
apiVersion: v1
kind: Service
metadata:
  name: my-app-stable
spec:
  selector:
    app: my-app
  ports:
    - port: 80
      targetPort: 8080
---
apiVersion: v1
kind: Service
metadata:
  name: my-app-canary
spec:
  selector:
    app: my-app
  ports:
    - port: 80
      targetPort: 8080
```

### Analysis Template (Auto-Rollback)

```yaml
apiVersion: argoproj.io/v1alpha1
kind: AnalysisTemplate
metadata:
  name: success-rate
  namespace: production
spec:
  metrics:
    - name: success-rate
      interval: 1m
      count: 5
      successCondition: result[0] >= 0.95    # 95% success rate required
      failureLimit: 2
      provider:
        prometheus:
          address: http://prometheus.monitoring:9090
          query: |
            sum(rate(http_requests_total{status=~"2..",app="my-app",version="canary"}[5m]))
            /
            sum(rate(http_requests_total{app="my-app",version="canary"}[5m]))
    - name: latency-p99
      interval: 1m
      count: 5
      successCondition: result[0] <= 500     # P99 ≤ 500ms
      failureLimit: 2
      provider:
        prometheus:
          address: http://prometheus.monitoring:9090
          query: |
            histogram_quantile(0.99,
              sum(rate(http_request_duration_seconds_bucket{app="my-app",version="canary"}[5m])) by (le)
            ) * 1000
```

### Blue-Green with Argo Rollouts

```yaml
apiVersion: argoproj.io/v1alpha1
kind: Rollout
metadata:
  name: my-app
spec:
  replicas: 3
  selector:
    matchLabels:
      app: my-app
  template:
    metadata:
      labels:
        app: my-app
    spec:
      containers:
        - name: app
          image: registry.example.com/my-app:v2.0.0
  strategy:
    blueGreen:
      activeService: my-app-active
      previewService: my-app-preview
      autoPromotionEnabled: false    # Manual promotion
      prePromotionAnalysis:
        templates:
          - templateName: success-rate
      scaleDownDelaySeconds: 300     # Keep old version 5min after switch
```

```bash
# Monitor rollout
kubectl argo rollouts get rollout my-app -n production --watch

# Promote canary / blue-green
kubectl argo rollouts promote my-app -n production

# Abort (auto-rollback)
kubectl argo rollouts abort my-app -n production

# Rollback to previous
kubectl argo rollouts undo my-app -n production
```

## Common Issues

### Blue-green doubles resource usage
- **Cause**: Both versions running simultaneously
- **Fix**: Expected trade-off for instant rollback. Scale down old version after validation window

### Canary traffic not splitting correctly
- **Cause**: Ingress controller doesn't support traffic splitting; or wrong service references
- **Fix**: Use NGINX ingress canary annotations, Istio VirtualService, or Argo Rollouts with supported mesh

### Analysis always failing
- **Cause**: Prometheus query returns no data (wrong labels); or threshold too strict
- **Fix**: Test query in Prometheus UI first; use `failureLimit` > 1 for noisy metrics

### Rollback not instant with Argo Rollouts
- **Cause**: Using canary strategy (gradual); blue-green is instant
- **Fix**: `kubectl argo rollouts abort` immediately routes 100% to stable

## Best Practices

1. **Blue-green for instant rollback** — double the resources, zero the risk
2. **Canary for gradual validation** — catch issues with minimal user impact
3. **Automated analysis** — don't rely on humans watching dashboards
4. **Set `failureLimit`** — tolerate metric noise without false rollbacks
5. **Keep old version running briefly** — 5-10 min after switch for safety
6. **Test rollback procedure** — practice aborting/reverting in staging
7. **Use feature flags alongside** — canary for infrastructure, flags for features

## Key Takeaways

- Blue-green: two full environments, instant traffic switch via Service selector
- Canary: gradual traffic shift (5%→25%→50%→100%) with metric validation between steps
- Native K8s: manual blue-green via `kubectl patch service`; limited canary support
- Argo Rollouts: automated canary/blue-green with analysis, auto-rollback, and promotion
- AnalysisTemplate validates metrics (success rate, latency) before proceeding
- `kubectl argo rollouts abort` — instant rollback to stable version
- Blue-green costs 2x resources; canary uses minimal extra resources
