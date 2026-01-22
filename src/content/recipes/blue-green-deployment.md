---
title: "How to Implement Blue-Green Deployments"
description: "Learn how to implement blue-green deployments in Kubernetes for instant rollbacks and zero-downtime releases. Complete guide with Service switching techniques."
category: "deployments"
difficulty: "intermediate"
timeToComplete: "25 minutes"
kubernetesVersion: "1.28+"
prerequisites:
  - "A running Kubernetes cluster"
  - "kubectl configured to access your cluster"
  - "Understanding of Services and Deployments"
relatedRecipes:
  - "rolling-update-deployment"
  - "canary-deployment-istio"
tags:
  - deployment
  - blue-green
  - zero-downtime
  - release-strategy
  - service
publishDate: "2026-01-21"
author: "Luca Berton"
---

## The Problem

You want to deploy a new version of your application with the ability to instantly switch back to the old version if issues arise.

## The Solution

Implement blue-green deployments where two identical environments run simultaneously, and traffic is switched between them instantly via Service selector changes.

## How Blue-Green Works

1. **Blue** = Current production version
2. **Green** = New version being deployed
3. Switch traffic by updating Service selector
4. Keep blue running for instant rollback

## Step 1: Create the Blue Deployment

Deploy the current (blue) version:

```yaml
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
        resources:
          requests:
            memory: "128Mi"
            cpu: "100m"
```

## Step 2: Create the Service

Create a Service pointing to the blue deployment:

```yaml
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
    protocol: TCP
  selector:
    app: myapp
    version: blue  # Currently pointing to blue
```

## Step 3: Deploy the Green Version

Deploy the new (green) version alongside blue:

```yaml
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
        resources:
          requests:
            memory: "128Mi"
            cpu: "100m"
```

## Step 4: Test Green Before Switching

Create a test service to verify green:

```yaml
apiVersion: v1
kind: Service
metadata:
  name: myapp-test
spec:
  type: ClusterIP
  ports:
  - port: 80
    targetPort: 8080
  selector:
    app: myapp
    version: green
```

Test the green deployment:

```bash
kubectl run test-pod --rm -it --image=curlimages/curl -- \
  curl http://myapp-test/health
```

## Step 5: Switch Traffic to Green

Update the Service selector to point to green:

```bash
kubectl patch service myapp -p '{"spec":{"selector":{"version":"green"}}}'
```

Verify the switch:

```bash
kubectl describe service myapp | grep Selector
```

## Step 6: Rollback if Needed

If issues arise, switch back to blue instantly:

```bash
kubectl patch service myapp -p '{"spec":{"selector":{"version":"blue"}}}'
```

## Step 7: Cleanup Old Version

Once confident, delete the blue deployment:

```bash
kubectl delete deployment myapp-blue
```

## Automation Script

Create a script for blue-green deployments:

```bash
#!/bin/bash
# blue-green-switch.sh

SERVICE_NAME=${1:-myapp}
TARGET_VERSION=${2:-green}

echo "Switching $SERVICE_NAME to $TARGET_VERSION..."

kubectl patch service $SERVICE_NAME \
  -p "{\"spec\":{\"selector\":{\"version\":\"$TARGET_VERSION\"}}}"

echo "Verifying switch..."
kubectl get endpoints $SERVICE_NAME

echo "Current selector:"
kubectl get service $SERVICE_NAME -o jsonpath='{.spec.selector}' | jq .
```

## Best Practices

### 1. Ensure Both Environments Are Identical

Use the same:
- Resource requests/limits
- ConfigMaps and Secrets
- Environment variables

### 2. Implement Health Checks

Always verify the new version before switching:

```bash
# Wait for green to be ready
kubectl rollout status deployment/myapp-green

# Run smoke tests
kubectl exec -it test-pod -- curl http://myapp-test/health
```

### 3. Monitor After Switch

```bash
# Watch pod status
kubectl get pods -l app=myapp -w

# Check logs for errors
kubectl logs -l app=myapp,version=green --tail=100
```

## Pros and Cons

### Advantages
- Instant rollback capability
- Full testing of new version before switch
- No mixed versions serving traffic

### Disadvantages
- Requires double the resources temporarily
- Database migrations need special handling
- More complex than rolling updates

## Key Takeaways

- Blue-green provides instant rollback capability
- Test the green environment before switching
- Keep the old version running until confident
- Automate the switching process for reliability
