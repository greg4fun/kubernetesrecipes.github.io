---
title: "How to Implement Canary Deployments"
description: "Learn to implement canary deployments in Kubernetes for gradual rollouts. Use native features and Ingress-based traffic splitting for safe releases."
category: "deployments"
difficulty: "advanced"
publishDate: "2026-01-22"
tags: ["canary", "deployments", "rollout", "traffic-splitting", "release"]
---

# How to Implement Canary Deployments

Canary deployments gradually shift traffic from the stable version to the new version, allowing you to detect issues before full rollout. Learn both native Kubernetes and Ingress-based approaches.

## Strategy Overview

```
Traffic Distribution During Canary:

Phase 1: 95% stable → 5% canary
Phase 2: 80% stable → 20% canary  
Phase 3: 50% stable → 50% canary
Phase 4: 0% stable → 100% canary (promote)
```

## Native Kubernetes Canary (Replica-Based)

```yaml
# stable-deployment.yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: myapp-stable
  labels:
    app: myapp
    track: stable
spec:
  replicas: 9  # 90% of traffic
  selector:
    matchLabels:
      app: myapp
      track: stable
  template:
    metadata:
      labels:
        app: myapp
        track: stable
        version: v1.0.0
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
# canary-deployment.yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: myapp-canary
  labels:
    app: myapp
    track: canary
spec:
  replicas: 1  # 10% of traffic
  selector:
    matchLabels:
      app: myapp
      track: canary
  template:
    metadata:
      labels:
        app: myapp
        track: canary
        version: v1.1.0
    spec:
      containers:
        - name: myapp
          image: myapp:v1.1.0
          ports:
            - containerPort: 8080
          readinessProbe:
            httpGet:
              path: /health
              port: 8080
---
# Service selects both stable and canary
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

## NGINX Ingress Canary (Weight-Based)

```yaml
# stable-ingress.yaml
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: myapp-stable
  annotations:
    nginx.ingress.kubernetes.io/rewrite-target: /
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
                name: myapp-stable
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
                name: myapp-canary
                port:
                  number: 80
```

## Header-Based Canary Routing

```yaml
# Route specific users to canary via header
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: myapp-canary-header
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
                name: myapp-canary
                port:
                  number: 80
```

Test with:

```bash
# Route to canary
curl -H "X-Canary: true" https://myapp.example.com

# Route to stable (default)
curl https://myapp.example.com
```

## Cookie-Based Canary

```yaml
# Route users with specific cookie to canary
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: myapp-canary-cookie
  annotations:
    nginx.ingress.kubernetes.io/canary: "true"
    nginx.ingress.kubernetes.io/canary-by-cookie: "canary"
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
                name: myapp-canary
                port:
                  number: 80
```

## Canary Rollout Script

```bash
#!/bin/bash
# canary-rollout.sh

STABLE_DEPLOYMENT="myapp-stable"
CANARY_DEPLOYMENT="myapp-canary"
CANARY_INGRESS="myapp-canary"
NAMESPACE="default"

# Function to update canary weight
update_weight() {
    local weight=$1
    echo "Setting canary weight to ${weight}%"
    kubectl annotate ingress ${CANARY_INGRESS} \
        nginx.ingress.kubernetes.io/canary-weight="${weight}" \
        --overwrite -n ${NAMESPACE}
}

# Function to check canary health
check_health() {
    local errors=$(kubectl logs -l track=canary --since=1m -n ${NAMESPACE} | grep -c "ERROR" || true)
    if [ "$errors" -gt 5 ]; then
        echo "Too many errors detected: $errors"
        return 1
    fi
    return 0
}

# Gradual rollout
for weight in 10 25 50 75 100; do
    update_weight $weight
    echo "Waiting 60 seconds to observe..."
    sleep 60
    
    if ! check_health; then
        echo "Canary failed! Rolling back..."
        update_weight 0
        exit 1
    fi
    echo "Canary healthy at ${weight}%"
done

echo "Canary rollout complete! Promoting to stable..."

# Promote canary to stable
kubectl set image deployment/${STABLE_DEPLOYMENT} \
    myapp=$(kubectl get deployment ${CANARY_DEPLOYMENT} -o jsonpath='{.spec.template.spec.containers[0].image}') \
    -n ${NAMESPACE}

# Scale down canary
kubectl scale deployment ${CANARY_DEPLOYMENT} --replicas=0 -n ${NAMESPACE}

echo "Deployment complete!"
```

## Automated Canary with Metrics

```yaml
# canary-with-analysis.yaml
apiVersion: batch/v1
kind: CronJob
metadata:
  name: canary-analysis
spec:
  schedule: "*/5 * * * *"  # Every 5 minutes
  jobTemplate:
    spec:
      template:
        spec:
          serviceAccountName: canary-analyzer
          containers:
            - name: analyzer
              image: bitnami/kubectl:latest
              command:
                - /bin/sh
                - -c
                - |
                  # Query Prometheus for error rate
                  ERROR_RATE=$(curl -s "http://prometheus:9090/api/v1/query?query=sum(rate(http_requests_total{app='myapp',track='canary',status=~'5..'}[5m]))/sum(rate(http_requests_total{app='myapp',track='canary'}[5m]))" | jq -r '.data.result[0].value[1]')
                  
                  if (( $(echo "$ERROR_RATE > 0.05" | bc -l) )); then
                    echo "Error rate too high: ${ERROR_RATE}"
                    kubectl annotate ingress myapp-canary \
                      nginx.ingress.kubernetes.io/canary-weight="0" --overwrite
                    exit 1
                  fi
                  
                  # Query latency
                  P99_LATENCY=$(curl -s "http://prometheus:9090/api/v1/query?query=histogram_quantile(0.99,rate(http_request_duration_seconds_bucket{app='myapp',track='canary'}[5m]))" | jq -r '.data.result[0].value[1]')
                  
                  if (( $(echo "$P99_LATENCY > 1.0" | bc -l) )); then
                    echo "Latency too high: ${P99_LATENCY}s"
                    kubectl annotate ingress myapp-canary \
                      nginx.ingress.kubernetes.io/canary-weight="0" --overwrite
                    exit 1
                  fi
                  
                  echo "Canary healthy!"
          restartPolicy: OnFailure
```

## Monitoring Canary vs Stable

```yaml
# prometheus-rules.yaml
apiVersion: monitoring.coreos.com/v1
kind: PrometheusRule
metadata:
  name: canary-alerts
spec:
  groups:
    - name: canary
      rules:
        - alert: CanaryHighErrorRate
          expr: |
            (
              sum(rate(http_requests_total{track="canary",status=~"5.."}[5m]))
              /
              sum(rate(http_requests_total{track="canary"}[5m]))
            ) > 0.05
          for: 2m
          labels:
            severity: critical
          annotations:
            summary: "Canary error rate is high"
            description: "Canary has {{ $value | humanizePercentage }} error rate"
        
        - alert: CanaryHighLatency
          expr: |
            histogram_quantile(0.99,
              rate(http_request_duration_seconds_bucket{track="canary"}[5m])
            ) > 1.0
          for: 2m
          labels:
            severity: warning
          annotations:
            summary: "Canary latency is high"
```

## Rollback Canary

```bash
# Immediate rollback - set weight to 0
kubectl annotate ingress myapp-canary \
  nginx.ingress.kubernetes.io/canary-weight="0" --overwrite

# Or delete canary entirely
kubectl delete deployment myapp-canary
kubectl delete ingress myapp-canary
```

## Summary

Canary deployments minimize risk by gradually exposing users to new versions. Use replica-based splitting for simple cases, Ingress annotations for precise traffic control, and combine with monitoring for automated analysis and rollback.
