---
title: "Horizontal Pod Autoscaler (HPA) Configuration Guide"
description: "Set up automatic pod scaling based on CPU, memory, or custom metrics using Kubernetes Horizontal Pod Autoscaler. Includes examples for scaling based on requests per second."
category: "autoscaling"
difficulty: "intermediate"
timeToComplete: "20 minutes"
kubernetesVersion: "1.25+"
prerequisites:
  - "metrics-server installed in your cluster"
  - "kubectl configured to access your cluster"
  - "A Deployment to scale"
relatedRecipes:
  - "vpa-configuration"
  - "cluster-autoscaler"
tags:
  - hpa
  - autoscaling
  - metrics
  - cpu
  - memory
  - scaling
publishDate: "2026-01-20"
author: "Luca Berton"
---

## The Problem

Your application traffic varies throughout the day. Running too few pods causes performance issues during peak times, while running too many wastes resources during quiet periods.

## The Solution

Use Horizontal Pod Autoscaler (HPA) to automatically scale your pods based on observed metrics like CPU utilization, memory usage, or custom application metrics.

## Prerequisites: Install metrics-server

HPA requires metrics-server to get resource metrics:

```bash
# Check if metrics-server is installed
kubectl get deployment metrics-server -n kube-system

# If not installed, install it
kubectl apply -f https://github.com/kubernetes-sigs/metrics-server/releases/latest/download/components.yaml
```

Verify it's working:

```bash
kubectl top nodes
kubectl top pods
```

## Basic HPA: Scale on CPU

### Step 1: Create a Deployment with Resource Requests

HPA needs resource requests to calculate utilization:

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: my-app
spec:
  replicas: 2
  selector:
    matchLabels:
      app: my-app
  template:
    metadata:
      labels:
        app: my-app
    spec:
      containers:
        - name: my-app
          image: my-app:1.0
          ports:
            - containerPort: 8080
          resources:
            requests:
              cpu: 100m      # Required for HPA!
              memory: 128Mi
            limits:
              cpu: 500m
              memory: 256Mi
```

### Step 2: Create HPA

Using kubectl:

```bash
kubectl autoscale deployment my-app \
  --min=2 \
  --max=10 \
  --cpu-percent=70
```

Or using YAML:

```yaml
apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata:
  name: my-app-hpa
spec:
  scaleTargetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: my-app
  minReplicas: 2
  maxReplicas: 10
  metrics:
    - type: Resource
      resource:
        name: cpu
        target:
          type: Utilization
          averageUtilization: 70
```

## HPA with Multiple Metrics

Scale based on both CPU and memory:

```yaml
apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata:
  name: my-app-hpa
spec:
  scaleTargetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: my-app
  minReplicas: 2
  maxReplicas: 20
  metrics:
    # Scale up if CPU > 70%
    - type: Resource
      resource:
        name: cpu
        target:
          type: Utilization
          averageUtilization: 70
    # OR if memory > 80%
    - type: Resource
      resource:
        name: memory
        target:
          type: Utilization
          averageUtilization: 80
```

> **Note:** HPA uses the metric that results in the highest replica count.

## Scale Based on Custom Metrics

For advanced scenarios, scale based on application metrics like requests per second.

### Using Prometheus Adapter

First, install Prometheus and the Prometheus Adapter:

```bash
# Add Prometheus community charts
helm repo add prometheus-community https://prometheus-community.github.io/helm-charts

# Install kube-prometheus-stack
helm install prometheus prometheus-community/kube-prometheus-stack

# Install prometheus-adapter
helm install prometheus-adapter prometheus-community/prometheus-adapter
```

### HPA with Custom Metrics

Scale based on HTTP requests per second:

```yaml
apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata:
  name: my-app-hpa
spec:
  scaleTargetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: my-app
  minReplicas: 2
  maxReplicas: 50
  metrics:
    # Scale based on requests per second per pod
    - type: Pods
      pods:
        metric:
          name: http_requests_per_second
        target:
          type: AverageValue
          averageValue: "100"  # 100 RPS per pod
```

## Scaling Behavior Configuration

Control how fast HPA scales up and down:

```yaml
apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata:
  name: my-app-hpa
spec:
  scaleTargetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: my-app
  minReplicas: 2
  maxReplicas: 20
  metrics:
    - type: Resource
      resource:
        name: cpu
        target:
          type: Utilization
          averageUtilization: 70
  behavior:
    scaleDown:
      stabilizationWindowSeconds: 300  # Wait 5 min before scaling down
      policies:
        - type: Percent
          value: 10           # Scale down max 10% at a time
          periodSeconds: 60
        - type: Pods
          value: 2            # Or max 2 pods at a time
          periodSeconds: 60
      selectPolicy: Min       # Use the policy that removes fewer pods
    scaleUp:
      stabilizationWindowSeconds: 0    # Scale up immediately
      policies:
        - type: Percent
          value: 100          # Can double pods
          periodSeconds: 15
        - type: Pods
          value: 4            # Or add 4 pods at a time
          periodSeconds: 15
      selectPolicy: Max       # Use the policy that adds more pods
```

## Monitoring HPA

Check HPA status:

```bash
kubectl get hpa my-app-hpa

# Output:
# NAME         REFERENCE           TARGETS   MINPODS   MAXPODS   REPLICAS   AGE
# my-app-hpa   Deployment/my-app   45%/70%   2         10        3          5m
```

Detailed view:

```bash
kubectl describe hpa my-app-hpa
```

Watch scaling events:

```bash
kubectl get hpa my-app-hpa -w
```

## Testing HPA

Generate load to trigger scaling:

```bash
# Run a load generator
kubectl run load-generator --image=busybox -- /bin/sh -c "while true; do wget -q -O- http://my-app-service; done"

# Watch HPA react
kubectl get hpa my-app-hpa -w

# Clean up
kubectl delete pod load-generator
```

## Common Issues

### HPA shows "unknown" for metrics

```bash
kubectl get hpa
# NAME         TARGETS       MINPODS   MAXPODS
# my-app-hpa   <unknown>/70%  2         10
```

**Causes:**
1. metrics-server not installed
2. No resource requests defined on containers
3. Pods haven't started yet

### HPA not scaling up

Check if your Deployment has reached maxReplicas:

```bash
kubectl describe hpa my-app-hpa | grep -A5 Conditions
```

### Scaling too aggressively

Adjust the behavior section to add stabilization windows and limit scale velocity.

## Complete Production Example

```yaml
apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata:
  name: production-hpa
  namespace: production
spec:
  scaleTargetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: api-server
  minReplicas: 3
  maxReplicas: 100
  metrics:
    # Primary: CPU utilization
    - type: Resource
      resource:
        name: cpu
        target:
          type: Utilization
          averageUtilization: 70
    # Secondary: Memory utilization
    - type: Resource
      resource:
        name: memory
        target:
          type: Utilization
          averageUtilization: 80
  behavior:
    scaleDown:
      stabilizationWindowSeconds: 300
      policies:
        - type: Percent
          value: 10
          periodSeconds: 60
    scaleUp:
      stabilizationWindowSeconds: 0
      policies:
        - type: Percent
          value: 50
          periodSeconds: 30
        - type: Pods
          value: 5
          periodSeconds: 30
      selectPolicy: Max
```

## Summary

You've learned how to:

1. Set up metrics-server for resource metrics
2. Create HPA for CPU-based scaling
3. Configure multi-metric scaling
4. Control scaling behavior
5. Troubleshoot common HPA issues

**Key takeaway:** Always define resource requests on your containers for HPA to work correctly.

## References

- [Horizontal Pod Autoscaler](https://kubernetes.io/docs/tasks/run-application/horizontal-pod-autoscale/)
- [HPA Walkthrough](https://kubernetes.io/docs/tasks/run-application/horizontal-pod-autoscale-walkthrough/)
