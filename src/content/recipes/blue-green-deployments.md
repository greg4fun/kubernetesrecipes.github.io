---
title: "How to Implement Blue-Green Deployments"
description: "Deploy applications using blue-green deployment strategy for zero-downtime releases. Switch traffic between versions instantly with easy rollback."
category: "deployments"
difficulty: "intermediate"
publishDate: "2026-01-22"
tags: ["blue-green", "deployment", "zero-downtime", "release", "strategy"]
---

# How to Implement Blue-Green Deployments

Blue-green deployments run two identical production environments. Deploy new versions to the idle environment and switch traffic instantly for zero-downtime releases with easy rollback.

## Basic Blue-Green Setup

```yaml
# blue-deployment.yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: myapp-blue
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
        - name: myapp
          image: myapp:v1.0.0
          ports:
            - containerPort: 8080
          readinessProbe:
            httpGet:
              path: /health
              port: 8080
            initialDelaySeconds: 5
            periodSeconds: 5
---
# green-deployment.yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: myapp-green
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
        - name: myapp
          image: myapp:v2.0.0
          ports:
            - containerPort: 8080
          readinessProbe:
            httpGet:
              path: /health
              port: 8080
            initialDelaySeconds: 5
            periodSeconds: 5
```

## Service for Traffic Switching

```yaml
# service.yaml
apiVersion: v1
kind: Service
metadata:
  name: myapp
  labels:
    app: myapp
spec:
  type: ClusterIP
  ports:
    - port: 80
      targetPort: 8080
  selector:
    app: myapp
    version: blue  # Switch to 'green' for new version
```

## Switch Traffic

```bash
# Deploy green with new version
kubectl apply -f green-deployment.yaml

# Wait for green to be ready
kubectl rollout status deployment/myapp-green

# Verify green is healthy
kubectl get pods -l version=green

# Switch traffic to green
kubectl patch service myapp -p '{"spec":{"selector":{"version":"green"}}}'

# Verify traffic switched
kubectl describe service myapp | grep Selector
```

## Rollback

```bash
# If issues detected, switch back to blue
kubectl patch service myapp -p '{"spec":{"selector":{"version":"blue"}}}'
```

## Blue-Green with Ingress

```yaml
# ingress-blue-green.yaml
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: myapp
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
                name: myapp  # Points to active service
                port:
                  number: 80
---
# Preview ingress for testing green
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: myapp-preview
spec:
  ingressClassName: nginx
  rules:
    - host: preview.myapp.example.com
      http:
        paths:
          - path: /
            pathType: Prefix
            backend:
              service:
                name: myapp-green  # Direct to green for testing
                port:
                  number: 80
```

## Separate Services

```yaml
# blue-service.yaml
apiVersion: v1
kind: Service
metadata:
  name: myapp-blue
spec:
  selector:
    app: myapp
    version: blue
  ports:
    - port: 80
      targetPort: 8080
---
# green-service.yaml
apiVersion: v1
kind: Service
metadata:
  name: myapp-green
spec:
  selector:
    app: myapp
    version: green
  ports:
    - port: 80
      targetPort: 8080
---
# Main service pointing to active version
apiVersion: v1
kind: Service
metadata:
  name: myapp
spec:
  type: ExternalName
  externalName: myapp-blue.default.svc.cluster.local
```

## Automated Blue-Green Script

```bash
#!/bin/bash
# blue-green-deploy.sh

NEW_VERSION=$1
CURRENT_VERSION=$(kubectl get svc myapp -o jsonpath='{.spec.selector.version}')

if [ "$CURRENT_VERSION" == "blue" ]; then
  NEW_COLOR="green"
  OLD_COLOR="blue"
else
  NEW_COLOR="blue"
  OLD_COLOR="green"
fi

echo "Current: $OLD_COLOR, Deploying to: $NEW_COLOR"

# Update image in new color deployment
kubectl set image deployment/myapp-$NEW_COLOR myapp=myapp:$NEW_VERSION

# Wait for rollout
kubectl rollout status deployment/myapp-$NEW_COLOR --timeout=300s
if [ $? -ne 0 ]; then
  echo "Deployment failed"
  exit 1
fi

# Health check
for i in {1..10}; do
  READY=$(kubectl get deployment myapp-$NEW_COLOR -o jsonpath='{.status.readyReplicas}')
  DESIRED=$(kubectl get deployment myapp-$NEW_COLOR -o jsonpath='{.spec.replicas}')
  if [ "$READY" == "$DESIRED" ]; then
    echo "All pods ready"
    break
  fi
  sleep 5
done

# Switch traffic
kubectl patch service myapp -p "{\"spec\":{\"selector\":{\"version\":\"$NEW_COLOR\"}}}"

echo "Traffic switched to $NEW_COLOR"

# Optional: Scale down old version
# kubectl scale deployment myapp-$OLD_COLOR --replicas=0
```

## Argo Rollouts Blue-Green

```yaml
# argo-rollout-bluegreen.yaml
apiVersion: argoproj.io/v1alpha1
kind: Rollout
metadata:
  name: myapp
spec:
  replicas: 3
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
          image: myapp:v1.0.0
          ports:
            - containerPort: 8080
  strategy:
    blueGreen:
      activeService: myapp-active
      previewService: myapp-preview
      autoPromotionEnabled: false
      scaleDownDelaySeconds: 30
      prePromotionAnalysis:
        templates:
          - templateName: success-rate
        args:
          - name: service-name
            value: myapp-preview
---
apiVersion: v1
kind: Service
metadata:
  name: myapp-active
spec:
  selector:
    app: myapp
  ports:
    - port: 80
      targetPort: 8080
---
apiVersion: v1
kind: Service
metadata:
  name: myapp-preview
spec:
  selector:
    app: myapp
  ports:
    - port: 80
      targetPort: 8080
```

## Istio Blue-Green

```yaml
# istio-blue-green.yaml
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
            subset: blue
          weight: 100
        - destination:
            host: myapp
            subset: green
          weight: 0
---
apiVersion: networking.istio.io/v1beta1
kind: DestinationRule
metadata:
  name: myapp
spec:
  host: myapp
  subsets:
    - name: blue
      labels:
        version: blue
    - name: green
      labels:
        version: green
```

```bash
# Switch traffic with Istio
kubectl patch virtualservice myapp --type='json' \
  -p='[{"op": "replace", "path": "/spec/http/0/route/0/weight", "value": 0},
       {"op": "replace", "path": "/spec/http/0/route/1/weight", "value": 100}]'
```

## Validation Before Switch

```bash
# Run smoke tests against preview
kubectl run smoke-test --rm -it --image=curlimages/curl --restart=Never -- \
  curl -s http://myapp-green/health

# Check metrics
kubectl top pods -l version=green

# Verify logs
kubectl logs -l version=green --tail=100
```

## Summary

Blue-green deployments enable instant traffic switching between versions. Deploy to the inactive environment, validate thoroughly, then switch the service selector or update routing. Keep the old version running for quick rollback. Use Argo Rollouts or Istio for automated blue-green with analysis.

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
