---
title: "How to Implement Blue-Green and Canary Deployments"
description: "Deploy applications with zero downtime using blue-green and canary strategies. Configure traffic splitting, rollbacks, and progressive delivery."
category: "deployments"
difficulty: "intermediate"
publishDate: "2026-01-22"
tags: ["blue-green", "canary", "deployment", "zero-downtime", "traffic"]
---

# How to Implement Blue-Green and Canary Deployments

Blue-green and canary deployments minimize risk when releasing new versions. Control traffic routing to gradually shift users to new releases with easy rollback.

## Blue-Green Deployment

```yaml
# Blue deployment (current production)
# blue-deployment.yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: app-blue
  labels:
    app: myapp
    version: blue
spec:
  replicas: 3
  selector:
    matchLabels:
      app: myapp
      version: blue
  template:
    metadata:
      labels:
        app: myapp
        version: blue
    spec:
      containers:
        - name: app
          image: myapp:v1
          ports:
            - containerPort: 8080
---
# Green deployment (new version)
# green-deployment.yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: app-green
  labels:
    app: myapp
    version: green
spec:
  replicas: 3
  selector:
    matchLabels:
      app: myapp
      version: green
  template:
    metadata:
      labels:
        app: myapp
        version: green
    spec:
      containers:
        - name: app
          image: myapp:v2
          ports:
            - containerPort: 8080
```

```yaml
# Service pointing to blue (current)
# service.yaml
apiVersion: v1
kind: Service
metadata:
  name: myapp
spec:
  selector:
    app: myapp
    version: blue  # Switch to 'green' for cutover
  ports:
    - port: 80
      targetPort: 8080
```

```bash
# Blue-Green switch process:
# 1. Deploy green version
kubectl apply -f green-deployment.yaml

# 2. Wait for green to be ready
kubectl rollout status deployment/app-green

# 3. Test green internally
kubectl run test --rm -it --image=busybox -- wget -qO- app-green:8080

# 4. Switch traffic to green
kubectl patch svc myapp -p '{"spec":{"selector":{"version":"green"}}}'

# 5. If issues, rollback to blue
kubectl patch svc myapp -p '{"spec":{"selector":{"version":"blue"}}}'

# 6. After validation, delete blue
kubectl delete deployment app-blue
```

## Canary with Multiple Deployments

```yaml
# stable-deployment.yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: app-stable
spec:
  replicas: 9  # 90% traffic
  selector:
    matchLabels:
      app: myapp
      track: stable
  template:
    metadata:
      labels:
        app: myapp
        track: stable
    spec:
      containers:
        - name: app
          image: myapp:v1
          ports:
            - containerPort: 8080
---
# canary-deployment.yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: app-canary
spec:
  replicas: 1  # 10% traffic
  selector:
    matchLabels:
      app: myapp
      track: canary
  template:
    metadata:
      labels:
        app: myapp
        track: canary
    spec:
      containers:
        - name: app
          image: myapp:v2
          ports:
            - containerPort: 8080
---
# Service selects both
apiVersion: v1
kind: Service
metadata:
  name: myapp
spec:
  selector:
    app: myapp  # Matches both stable and canary
  ports:
    - port: 80
      targetPort: 8080
```

```bash
# Progressive canary rollout:
# 10% -> 25% -> 50% -> 100%

# Start: stable=9, canary=1 (10%)
kubectl scale deployment app-canary --replicas=1
kubectl scale deployment app-stable --replicas=9

# Increase: stable=3, canary=1 (25%)
kubectl scale deployment app-stable --replicas=3

# Half: stable=1, canary=1 (50%)
kubectl scale deployment app-stable --replicas=1

# Full: canary=3 (100%)
kubectl scale deployment app-canary --replicas=3
kubectl delete deployment app-stable
```

## Canary with Ingress (NGINX)

```yaml
# main-ingress.yaml
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: myapp-main
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
                name: app-stable
                port:
                  number: 80
---
# canary-ingress.yaml
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: myapp-canary
  annotations:
    nginx.ingress.kubernetes.io/canary: "true"
    nginx.ingress.kubernetes.io/canary-weight: "10"  # 10% traffic
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
                name: app-canary
                port:
                  number: 80
```

```bash
# Increase canary traffic
kubectl annotate ingress myapp-canary \
  nginx.ingress.kubernetes.io/canary-weight="25" --overwrite

# 50% traffic
kubectl annotate ingress myapp-canary \
  nginx.ingress.kubernetes.io/canary-weight="50" --overwrite

# Full rollout - delete canary ingress, update main
kubectl delete ingress myapp-canary
kubectl set image deployment/app-stable app=myapp:v2
```

## Header-Based Canary

```yaml
# canary-header.yaml
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: myapp-canary
  annotations:
    nginx.ingress.kubernetes.io/canary: "true"
    nginx.ingress.kubernetes.io/canary-by-header: "X-Canary"
    nginx.ingress.kubernetes.io/canary-by-header-value: "true"
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
                name: app-canary
                port:
                  number: 80
```

```bash
# Test canary with header
curl -H "X-Canary: true" https://myapp.example.com

# Normal traffic goes to stable
curl https://myapp.example.com
```

## Argo Rollouts (Advanced)

```yaml
# Install Argo Rollouts
# kubectl create namespace argo-rollouts
# kubectl apply -n argo-rollouts -f https://github.com/argoproj/argo-rollouts/releases/latest/download/install.yaml

# rollout.yaml
apiVersion: argoproj.io/v1alpha1
kind: Rollout
metadata:
  name: myapp
spec:
  replicas: 5
  selector:
    matchLabels:
      app: myapp
  template:
    metadata:
      labels:
        app: myapp
    spec:
      containers:
        - name: app
          image: myapp:v1
          ports:
            - containerPort: 8080
  strategy:
    canary:
      steps:
        - setWeight: 10
        - pause: {duration: 5m}
        - setWeight: 25
        - pause: {duration: 5m}
        - setWeight: 50
        - pause: {duration: 10m}
        - setWeight: 100
      canaryService: myapp-canary
      stableService: myapp-stable
```

```bash
# Trigger rollout
kubectl argo rollouts set image myapp app=myapp:v2

# Watch progress
kubectl argo rollouts get rollout myapp -w

# Promote immediately
kubectl argo rollouts promote myapp

# Abort rollout
kubectl argo rollouts abort myapp
```

## Flagger (Progressive Delivery)

```yaml
# flagger-canary.yaml
apiVersion: flagger.app/v1beta1
kind: Canary
metadata:
  name: myapp
spec:
  targetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: myapp
  service:
    port: 80
    targetPort: 8080
  analysis:
    interval: 1m
    threshold: 5
    maxWeight: 50
    stepWeight: 10
    metrics:
      - name: request-success-rate
        thresholdRange:
          min: 99
        interval: 1m
      - name: request-duration
        thresholdRange:
          max: 500
        interval: 1m
```

## Monitor Deployment

```bash
# Watch deployments
kubectl get deployments -w

# Check rollout status
kubectl rollout status deployment/app-canary

# Compare versions
kubectl get pods -l app=myapp -L version

# Check endpoint distribution
kubectl get endpoints myapp

# Monitor traffic split (if using service mesh)
kubectl get virtualservice myapp -o yaml
```

## Rollback Strategies

```bash
# Blue-Green rollback
kubectl patch svc myapp -p '{"spec":{"selector":{"version":"blue"}}}'

# Canary rollback - scale down canary
kubectl scale deployment app-canary --replicas=0

# Argo Rollouts rollback
kubectl argo rollouts undo myapp

# Standard deployment rollback
kubectl rollout undo deployment/myapp
kubectl rollout undo deployment/myapp --to-revision=2
```

## Summary

Blue-green deployments maintain two identical environments and switch traffic instantly via service selector changes. Canary deployments gradually shift traffic using replica ratios or ingress weight annotations. Use header-based routing for testing specific users. For advanced scenarios, Argo Rollouts and Flagger provide automated progressive delivery with metric-based promotion. Always have a rollback plan ready - switch service selectors for blue-green, scale down canary for canary deployments.
