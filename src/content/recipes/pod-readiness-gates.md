---
title: "Pod Readiness Gates for Custom Conditions"
description: "Implement Pod Readiness Gates to add custom conditions that must be satisfied before a pod is considered ready for traffic, enabling integration with external systems"
category: "deployments"
difficulty: "intermediate"
timeToComplete: "35 minutes"
kubernetesVersion: "1.28+"
prerequisites:
  - "Understanding of Pod lifecycle and readiness probes"
  - "Knowledge of Kubernetes controllers"
  - "Familiarity with custom controllers or operators"
relatedRecipes:
  - "liveness-readiness-probes"
  - "pod-disruption-budgets"
  - "rolling-update-deployment"
tags:
  - readiness-gates
  - pod-conditions
  - load-balancer
  - traffic-management
  - custom-controllers
publishDate: 2026-01-28
author: "kubernetes-recipes"
---

## Problem

Standard readiness probes may not be sufficient when pods need to wait for external systems like load balancers, service mesh sidecars, or custom health checkers before receiving traffic. You need additional conditions beyond container readiness.

## Solution

Use Pod Readiness Gates to define custom conditions that must be true before a pod is marked as Ready. External controllers can then set these conditions based on their own criteria.

### Architecture

```
┌─────────────────────────────────────────────────────┐
│                   Pod Lifecycle                      │
│                                                     │
│  ┌─────────────────────────────────────────────┐   │
│  │           Standard Conditions               │   │
│  │  • ContainersReady                          │   │
│  │  • Initialized                              │   │
│  │  • PodScheduled                             │   │
│  └─────────────────────────────────────────────┘   │
│                      +                              │
│  ┌─────────────────────────────────────────────┐   │
│  │         Readiness Gates (Custom)            │   │
│  │  • target-health.elbv2.k8s.aws/ingress      │   │
│  │  • istio-proxy-ready                        │   │
│  │  • custom.company.com/database-migrated     │   │
│  └─────────────────────────────────────────────┘   │
│                      ↓                              │
│  ┌─────────────────────────────────────────────┐   │
│  │    Pod Ready = All conditions True          │   │
│  └─────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────┘
                       │
     External Controller sets conditions
                       │
┌──────────────────────┴──────────────────────────────┐
│  ┌────────────┐  ┌────────────┐  ┌────────────┐   │
│  │    ALB     │  │   Istio    │  │   Custom   │   │
│  │ Controller │  │  Sidecar   │  │ Controller │   │
│  └────────────┘  └────────────┘  └────────────┘   │
└─────────────────────────────────────────────────────┘
```

### Step 1: Define Pod with Readiness Gates

Add readinessGates to pod specification:

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: web-app
  namespace: production
spec:
  replicas: 3
  selector:
    matchLabels:
      app: web-app
  template:
    metadata:
      labels:
        app: web-app
    spec:
      readinessGates:
      - conditionType: "custom.company.com/app-ready"
      - conditionType: "custom.company.com/config-loaded"
      containers:
      - name: web-app
        image: web-app:v1.0
        ports:
        - containerPort: 8080
        readinessProbe:
          httpGet:
            path: /healthz
            port: 8080
          initialDelaySeconds: 5
          periodSeconds: 10
```

### Step 2: AWS ALB Readiness Gate

Configure readiness gate for AWS ALB target health:

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: api-service
  namespace: production
spec:
  replicas: 3
  selector:
    matchLabels:
      app: api-service
  template:
    metadata:
      labels:
        app: api-service
    spec:
      # ALB controller automatically adds this readiness gate
      readinessGates:
      - conditionType: target-health.elbv2.k8s.aws/k8s-prod-api-xxxxx
      containers:
      - name: api
        image: api-service:v2.0
        ports:
        - containerPort: 8080
        readinessProbe:
          httpGet:
            path: /health
            port: 8080
---
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: api-ingress
  namespace: production
  annotations:
    alb.ingress.kubernetes.io/scheme: internet-facing
    alb.ingress.kubernetes.io/target-type: ip
    # Enable pod readiness gate injection
    alb.ingress.kubernetes.io/target-group-attributes: |
      deregistration_delay.timeout_seconds=30
spec:
  ingressClassName: alb
  rules:
  - host: api.example.com
    http:
      paths:
      - path: /
        pathType: Prefix
        backend:
          service:
            name: api-service
            port:
              number: 8080
```

### Step 3: Create Custom Readiness Controller

Implement a controller that sets custom conditions:

```yaml
apiVersion: v1
kind: ServiceAccount
metadata:
  name: readiness-controller
  namespace: kube-system
---
apiVersion: rbac.authorization.k8s.io/v1
kind: ClusterRole
metadata:
  name: readiness-controller
rules:
- apiGroups: [""]
  resources: ["pods"]
  verbs: ["get", "list", "watch"]
- apiGroups: [""]
  resources: ["pods/status"]
  verbs: ["patch", "update"]
---
apiVersion: rbac.authorization.k8s.io/v1
kind: ClusterRoleBinding
metadata:
  name: readiness-controller
roleRef:
  apiGroup: rbac.authorization.k8s.io
  kind: ClusterRole
  name: readiness-controller
subjects:
- kind: ServiceAccount
  name: readiness-controller
  namespace: kube-system
---
apiVersion: apps/v1
kind: Deployment
metadata:
  name: readiness-controller
  namespace: kube-system
spec:
  replicas: 1
  selector:
    matchLabels:
      app: readiness-controller
  template:
    metadata:
      labels:
        app: readiness-controller
    spec:
      serviceAccountName: readiness-controller
      containers:
      - name: controller
        image: readiness-controller:v1.0
        env:
        - name: CONDITION_TYPE
          value: "custom.company.com/app-ready"
```

Controller implementation (Go example):

```go
// readiness_controller.go
package main

import (
    "context"
    "time"
    
    corev1 "k8s.io/api/core/v1"
    metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
    "k8s.io/client-go/kubernetes"
)

func setPodCondition(clientset *kubernetes.Clientset, pod *corev1.Pod, conditionType string, status bool) error {
    conditionStatus := corev1.ConditionFalse
    if status {
        conditionStatus = corev1.ConditionTrue
    }
    
    // Create new condition
    newCondition := corev1.PodCondition{
        Type:               corev1.PodConditionType(conditionType),
        Status:             conditionStatus,
        LastTransitionTime: metav1.Now(),
        Reason:             "CustomCheck",
        Message:            "Custom readiness check completed",
    }
    
    // Update pod conditions
    pod.Status.Conditions = updateConditions(pod.Status.Conditions, newCondition)
    
    _, err := clientset.CoreV1().Pods(pod.Namespace).
        UpdateStatus(context.TODO(), pod, metav1.UpdateOptions{})
    return err
}
```

### Step 4: Database Migration Readiness Gate

Wait for database migrations before receiving traffic:

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: backend-app
  namespace: production
spec:
  replicas: 3
  selector:
    matchLabels:
      app: backend-app
  template:
    metadata:
      labels:
        app: backend-app
      annotations:
        # Custom annotation for migration controller
        migrations.company.com/required-version: "v42"
    spec:
      readinessGates:
      - conditionType: "migrations.company.com/database-ready"
      initContainers:
      - name: run-migrations
        image: backend-app:v1.0
        command: ["./migrate", "--target", "v42"]
        env:
        - name: DATABASE_URL
          valueFrom:
            secretKeyRef:
              name: database-credentials
              key: url
      containers:
      - name: app
        image: backend-app:v1.0
        ports:
        - containerPort: 8080
        readinessProbe:
          httpGet:
            path: /ready
            port: 8080
```

Migration controller logic:

```yaml
apiVersion: v1
kind: ConfigMap
metadata:
  name: migration-controller-script
  namespace: kube-system
data:
  check-migrations.sh: |
    #!/bin/bash
    
    NAMESPACE=$1
    POD_NAME=$2
    REQUIRED_VERSION=$3
    
    # Check if migrations are complete
    CURRENT_VERSION=$(kubectl exec -n $NAMESPACE $POD_NAME -- \
      ./check-migration-version 2>/dev/null)
    
    if [ "$CURRENT_VERSION" == "$REQUIRED_VERSION" ]; then
      # Set condition to True
      kubectl patch pod $POD_NAME -n $NAMESPACE --type=json \
        -p='[{"op": "add", "path": "/status/conditions/-", "value": {
          "type": "migrations.company.com/database-ready",
          "status": "True",
          "lastTransitionTime": "'$(date -u +%Y-%m-%dT%H:%M:%SZ)'",
          "reason": "MigrationComplete",
          "message": "Database migrations completed to version '$REQUIRED_VERSION'"
        }}]'
    fi
```

### Step 5: Service Mesh Sidecar Readiness

Wait for Istio sidecar to be ready:

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: mesh-app
  namespace: production
spec:
  replicas: 3
  selector:
    matchLabels:
      app: mesh-app
  template:
    metadata:
      labels:
        app: mesh-app
      annotations:
        # Istio annotations
        sidecar.istio.io/inject: "true"
        proxy.istio.io/config: |
          holdApplicationUntilProxyStarts: true
    spec:
      readinessGates:
      - conditionType: "istio.io/sidecar-ready"
      containers:
      - name: app
        image: mesh-app:v1.0
        ports:
        - containerPort: 8080
```

### Step 6: Multi-Condition Readiness

Combine multiple readiness gates:

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: complex-app
  namespace: production
spec:
  replicas: 3
  selector:
    matchLabels:
      app: complex-app
  template:
    metadata:
      labels:
        app: complex-app
    spec:
      readinessGates:
      # External load balancer registered
      - conditionType: "lb.company.com/registered"
      # Cache warmed up
      - conditionType: "cache.company.com/warmed"
      # Feature flags loaded
      - conditionType: "flags.company.com/loaded"
      # DNS propagated
      - conditionType: "dns.company.com/propagated"
      containers:
      - name: app
        image: complex-app:v1.0
        ports:
        - containerPort: 8080
        readinessProbe:
          httpGet:
            path: /healthz
            port: 8080
        lifecycle:
          postStart:
            exec:
              command:
              - /bin/sh
              - -c
              - |
                # Warm up cache
                curl -X POST localhost:8080/admin/warm-cache
                # Load feature flags
                curl -X POST localhost:8080/admin/load-flags
```

### Step 7: Monitor Readiness Gate Status

Check pod conditions:

```bash
# View all pod conditions
kubectl get pod <pod-name> -o jsonpath='{.status.conditions}' | jq

# Filter for custom conditions
kubectl get pods -o custom-columns=\
NAME:.metadata.name,\
READY:.status.conditions[?(@.type==\"Ready\")].status,\
CUSTOM:.status.conditions[?(@.type==\"custom.company.com/app-ready\")].status

# Describe pod to see all conditions
kubectl describe pod <pod-name> | grep -A 20 Conditions
```

## Verification

Check readiness gates are configured:

```bash
# List pods with readiness gates
kubectl get pods -o jsonpath='{range .items[*]}{.metadata.name}: {.spec.readinessGates[*].conditionType}{"\n"}{end}'

# View pod status conditions
kubectl get pod web-app-xxxxx -o yaml | yq '.status.conditions'

# Check if pod is truly ready
kubectl get pods -o wide
```

Test readiness gate behavior:

```bash
# Create pod with unset readiness gate
kubectl apply -f deployment.yaml

# Pod should show 0/1 Ready until gate is set
kubectl get pods -w

# Manually set condition (for testing)
kubectl patch pod web-app-xxxxx --type=json -p='[{
  "op": "add",
  "path": "/status/conditions/-",
  "value": {
    "type": "custom.company.com/app-ready",
    "status": "True",
    "lastTransitionTime": "'$(date -u +%Y-%m-%dT%H:%M:%SZ)'",
    "reason": "ManualSet",
    "message": "Manually set for testing"
  }
}]'

# Verify pod becomes ready
kubectl get pods
```

Monitor condition transitions:

```bash
# Watch condition changes
kubectl get pods -w -o custom-columns=\
NAME:.metadata.name,\
PHASE:.status.phase,\
CONDITIONS:.status.conditions[*].type

# Check events for readiness issues
kubectl get events --field-selector involvedObject.name=web-app-xxxxx
```

## Best Practices

1. **Use descriptive condition types** with domain prefix
2. **Set meaningful reason and message** for debugging
3. **Implement controllers** to manage conditions automatically
4. **Set conditions promptly** to avoid deployment delays
5. **Monitor condition transition times** for performance
6. **Combine with PodDisruptionBudgets** for safe rollouts
7. **Test gate behavior** before production deployment
8. **Document custom conditions** for operators
9. **Implement timeouts** for condition setting
10. **Use proper RBAC** for condition controllers

## Common Issues

**Pod stuck in not-ready state:**
- Check if readiness gate controller is running
- Verify condition type matches exactly
- Check controller RBAC permissions

**Rolling update stuck:**
- Ensure old pods have conditions set
- Check if minReadySeconds is appropriate
- Verify controller processes all pods

**Condition not being set:**
- Check controller logs for errors
- Verify pod has correct labels/annotations
- Ensure controller has pods/status update permission

## Related Resources

- [Pod Readiness Gates](https://kubernetes.io/docs/concepts/workloads/pods/pod-lifecycle/#pod-readiness-gate)
- [AWS ALB Controller Readiness Gates](https://kubernetes-sigs.github.io/aws-load-balancer-controller/latest/deploy/pod_readiness_gate/)
- [Custom Controllers](https://kubernetes.io/docs/concepts/extend-kubernetes/api-extension/custom-resources/)

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
