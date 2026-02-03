---
title: "How to Implement Blue-Green Deployments"
description: "Deploy applications with zero downtime using blue-green deployment strategy. Switch traffic instantly between two identical environments for safe releases."
category: "deployments"
difficulty: "intermediate"
publishDate: "2026-01-22"
tags: ["blue-green", "deployment", "zero-downtime", "release", "traffic-switching"]
author: "Luca Berton"
---

> 💡 **Quick Answer:** Run two identical environments (blue=current, green=new). Deploy to green, test it, then switch Service selector from `version: blue` to `version: green`. Instant rollback by switching back. Requires 2x resources during deployment.
>
> **Key command:** `kubectl patch svc my-app -p '{"spec":{"selector":{"version":"green"}}}'`
>
> **Gotcha:** Both environments must be fully running before switch—no gradual traffic shift. Database migrations need careful planning (both versions must work with same schema).

# How to Implement Blue-Green Deployments

Blue-green deployments eliminate downtime by running two identical production environments. Only one serves live traffic while the other stands ready for the next release.

## How It Works

```yaml
# Blue deployment (current production)
apiVersion: apps/v1
kind: Deployment
metadata:
  name: app-blue
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
          image: my-app:1.0.0
          ports:
            - containerPort: 8080
---
# Green deployment (new version)
apiVersion: apps/v1
kind: Deployment
metadata:
  name: app-green
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
          image: my-app:2.0.0
          ports:
            - containerPort: 8080
```

## Service Configuration

```yaml
# Service that switches between blue and green
apiVersion: v1
kind: Service
metadata:
  name: my-app
spec:
  selector:
    app: my-app
    version: blue  # Change to 'green' to switch
  ports:
    - port: 80
      targetPort: 8080
```

## Switching Traffic

```bash
# Switch from blue to green
kubectl patch svc my-app -p '{"spec":{"selector":{"version":"green"}}}'

# Verify the switch
kubectl get svc my-app -o jsonpath='{.spec.selector.version}'

# Rollback to blue if needed
kubectl patch svc my-app -p '{"spec":{"selector":{"version":"blue"}}}'
```

## Deployment Script

```bash
#!/bin/bash
# blue-green-deploy.sh

APP_NAME="my-app"
NEW_VERSION=$1
CURRENT_COLOR=$(kubectl get svc $APP_NAME -o jsonpath='{.spec.selector.version}')

if [ "$CURRENT_COLOR" == "blue" ]; then
  NEW_COLOR="green"
else
  NEW_COLOR="blue"
fi

echo "Current: $CURRENT_COLOR, Deploying to: $NEW_COLOR"

# Update the inactive deployment
kubectl set image deployment/app-$NEW_COLOR app=my-app:$NEW_VERSION

# Wait for rollout
kubectl rollout status deployment/app-$NEW_COLOR

# Run smoke tests against new deployment
# kubectl run test --rm -it --image=curlimages/curl -- curl app-$NEW_COLOR:8080/health

# Switch traffic
kubectl patch svc $APP_NAME -p "{\"spec\":{\"selector\":{\"version\":\"$NEW_COLOR\"}}}"

echo "Traffic switched to $NEW_COLOR"
```

## Testing Before Switch

```yaml
# Temporary service to test green before switching
apiVersion: v1
kind: Service
metadata:
  name: my-app-green-test
spec:
  selector:
    app: my-app
    version: green
  ports:
    - port: 80
      targetPort: 8080
```

## Best Practices

1. **Test thoroughly** before switching traffic
2. **Keep blue running** for quick rollback
3. **Automate the switch** to reduce human error
4. **Monitor after switch** for any issues
5. **Plan database migrations** carefully—both versions need to work

## When to Use Blue-Green

| Use Case | Recommendation |
|----------|----------------|
| Zero-downtime required | ✅ Blue-Green |
| Need instant rollback | ✅ Blue-Green |
| Limited resources | ❌ Use Rolling Update |
| Gradual traffic shift | ❌ Use Canary |
| Database schema changes | ⚠️ Requires careful planning |

## Cleanup

```bash
# After successful deployment, scale down old version
kubectl scale deployment app-blue --replicas=0

# Or delete when confident
kubectl delete deployment app-blue
```
