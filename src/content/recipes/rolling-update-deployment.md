---
title: "How to Perform Rolling Updates with Zero Downtime"
description: "Master Kubernetes rolling updates to deploy new application versions without service interruption. Learn update strategies, rollback procedures, and best practices."
category: "deployments"
difficulty: "beginner"
timeToComplete: "15 minutes"
kubernetesVersion: "1.28+"
prerequisites:
  - "A running Kubernetes cluster"
  - "kubectl configured to access your cluster"
  - "Basic understanding of Deployments"
relatedRecipes:
  - "liveness-readiness-probes"
  - "horizontal-pod-autoscaler"
tags:
  - deployment
  - rolling-update
  - zero-downtime
  - rollback
  - strategy
publishDate: "2026-01-21"
author: "Luca Berton"
---

## The Problem

You need to update your application to a new version without causing downtime or disrupting active users.

## The Solution

Use Kubernetes rolling update strategy to gradually replace old pods with new ones, ensuring continuous availability.

## Understanding Rolling Updates

A rolling update incrementally replaces instances of the old version with the new version:

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: myapp
  labels:
    app: myapp
spec:
  replicas: 4
  strategy:
    type: RollingUpdate
    rollingUpdate:
      maxSurge: 1        # Max pods above desired count
      maxUnavailable: 1  # Max pods that can be unavailable
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
        readinessProbe:
          httpGet:
            path: /health
            port: 8080
          initialDelaySeconds: 5
          periodSeconds: 5
```

## Step 1: Deploy the Initial Version

Apply your deployment:

```bash
kubectl apply -f deployment.yaml
```

Verify the deployment:

```bash
kubectl get deployment myapp
kubectl get pods -l app=myapp
```

## Step 2: Trigger a Rolling Update

Update the image version:

```bash
kubectl set image deployment/myapp myapp=myapp:v2.0.0
```

Or edit the deployment directly:

```bash
kubectl edit deployment myapp
```

## Step 3: Monitor the Rollout

Watch the rollout progress:

```bash
kubectl rollout status deployment/myapp
```

View rollout history:

```bash
kubectl rollout history deployment/myapp
```

## Step 4: Rollback if Needed

If something goes wrong, rollback to the previous version:

```bash
# Rollback to previous version
kubectl rollout undo deployment/myapp

# Rollback to specific revision
kubectl rollout undo deployment/myapp --to-revision=2
```

## Best Practices

### 1. Always Use Readiness Probes

Readiness probes ensure traffic is only sent to healthy pods:

```yaml
readinessProbe:
  httpGet:
    path: /ready
    port: 8080
  initialDelaySeconds: 10
  periodSeconds: 5
  failureThreshold: 3
```

### 2. Set Resource Requests and Limits

```yaml
resources:
  requests:
    memory: "128Mi"
    cpu: "100m"
  limits:
    memory: "256Mi"
    cpu: "500m"
```

### 3. Use Pod Disruption Budgets

Ensure minimum availability during updates:

```yaml
apiVersion: policy/v1
kind: PodDisruptionBudget
metadata:
  name: myapp-pdb
spec:
  minAvailable: 2
  selector:
    matchLabels:
      app: myapp
```

## Complete Example

Here's a production-ready deployment with all best practices:

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: myapp
  annotations:
    kubernetes.io/change-cause: "Initial deployment v1.0.0"
spec:
  replicas: 4
  revisionHistoryLimit: 10
  strategy:
    type: RollingUpdate
    rollingUpdate:
      maxSurge: 25%
      maxUnavailable: 25%
  selector:
    matchLabels:
      app: myapp
  template:
    metadata:
      labels:
        app: myapp
        version: v1.0.0
    spec:
      terminationGracePeriodSeconds: 30
      containers:
      - name: myapp
        image: myapp:v1.0.0
        ports:
        - containerPort: 8080
        readinessProbe:
          httpGet:
            path: /health
            port: 8080
          initialDelaySeconds: 10
          periodSeconds: 5
        livenessProbe:
          httpGet:
            path: /health
            port: 8080
          initialDelaySeconds: 30
          periodSeconds: 10
        resources:
          requests:
            memory: "128Mi"
            cpu: "100m"
          limits:
            memory: "256Mi"
            cpu: "500m"
        lifecycle:
          preStop:
            exec:
              command: ["/bin/sh", "-c", "sleep 10"]
```

## Common Issues

### Pods Stuck in Pending
Check resource availability and node capacity.

### Rollout Taking Too Long
Review readiness probe configuration and increase failure thresholds.

### Traffic Sent to Unhealthy Pods
Ensure readiness probes are properly configured with appropriate thresholds.

## Key Takeaways

- Rolling updates provide zero-downtime deployments
- Always use readiness probes to control traffic routing
- Keep revision history for easy rollbacks
- Use PodDisruptionBudgets for high availability
