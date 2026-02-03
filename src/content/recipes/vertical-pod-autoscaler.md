---
title: "How to Use Vertical Pod Autoscaler (VPA)"
description: "Automatically right-size your Kubernetes pods with Vertical Pod Autoscaler. Learn to configure VPA for optimal resource requests and limits."
category: "autoscaling"
difficulty: "intermediate"
timeToComplete: "25 minutes"
kubernetesVersion: "1.28+"
prerequisites:
  - "A running Kubernetes cluster"
  - "Metrics Server installed"
  - "kubectl configured to access your cluster"
relatedRecipes:
  - "horizontal-pod-autoscaler"
  - "resource-requests-limits"
tags:
  - autoscaling
  - vpa
  - resources
  - optimization
  - cost
publishDate: "2026-01-21"
author: "Luca Berton"
---

> **💡 Quick Answer:** VPA auto-adjusts pod CPU/memory requests based on actual usage. Install VPA, then create `VerticalPodAutoscaler` resource targeting your Deployment. Modes: `Off` (recommendations only), `Auto` (applies changes, restarts pods). Check recommendations: `kubectl describe vpa <name>`. Don't use VPA + HPA on same CPU metric. VPA restarts pods to apply changes—use PodDisruptionBudget.

## The Problem

You don't know the right CPU and memory values for your pod resource requests, leading to either wasted resources (over-provisioning) or OOM kills (under-provisioning).

## The Solution

Use Vertical Pod Autoscaler (VPA) to automatically analyze resource usage and recommend or apply optimal resource requests.

## Step 1: Install VPA

Clone and install VPA:

```bash
git clone https://github.com/kubernetes/autoscaler.git
cd autoscaler/vertical-pod-autoscaler

# Install VPA components
./hack/vpa-up.sh
```

Or with Helm:

```bash
helm repo add fairwinds-stable https://charts.fairwinds.com/stable
helm install vpa fairwinds-stable/vpa --namespace vpa --create-namespace
```

Verify installation:

```bash
kubectl get pods -n kube-system | grep vpa
```

## Step 2: Create a Test Deployment

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: hamster
spec:
  replicas: 2
  selector:
    matchLabels:
      app: hamster
  template:
    metadata:
      labels:
        app: hamster
    spec:
      containers:
      - name: hamster
        image: registry.k8s.io/ubuntu-slim:0.1
        resources:
          requests:
            cpu: 100m
            memory: 50Mi
        command: ["/bin/sh"]
        args:
          - "-c"
          - "while true; do timeout 0.5s yes >/dev/null; sleep 0.5s; done"
```

## Step 3: Create a VPA Resource

### Recommendation Mode (Off)

Get recommendations without applying changes:

```yaml
apiVersion: autoscaling.k8s.io/v1
kind: VerticalPodAutoscaler
metadata:
  name: hamster-vpa
spec:
  targetRef:
    apiVersion: "apps/v1"
    kind: Deployment
    name: hamster
  updatePolicy:
    updateMode: "Off"  # Only recommend, don't apply
```

### Auto Mode

Automatically update pod resources:

```yaml
apiVersion: autoscaling.k8s.io/v1
kind: VerticalPodAutoscaler
metadata:
  name: hamster-vpa
spec:
  targetRef:
    apiVersion: "apps/v1"
    kind: Deployment
    name: hamster
  updatePolicy:
    updateMode: "Auto"
  resourcePolicy:
    containerPolicies:
    - containerName: '*'
      minAllowed:
        cpu: 50m
        memory: 50Mi
      maxAllowed:
        cpu: 2
        memory: 2Gi
      controlledResources: ["cpu", "memory"]
```

## Step 4: View Recommendations

Check VPA status:

```bash
kubectl describe vpa hamster-vpa
```

Output shows recommendations:

```yaml
Recommendation:
  Container Recommendations:
    Container Name:  hamster
    Lower Bound:
      Cpu:     25m
      Memory:  262144k
    Target:
      Cpu:     587m
      Memory:  262144k
    Uncapped Target:
      Cpu:     587m
      Memory:  262144k
    Upper Bound:
      Cpu:     1
      Memory:  500Mi
```

## VPA Update Modes

| Mode | Behavior |
|------|----------|
| **Off** | VPA only provides recommendations |
| **Initial** | VPA sets resources only at pod creation |
| **Recreate** | VPA updates by evicting and recreating pods |
| **Auto** | Currently same as Recreate |

## Production Configuration

```yaml
apiVersion: autoscaling.k8s.io/v1
kind: VerticalPodAutoscaler
metadata:
  name: myapp-vpa
  namespace: production
spec:
  targetRef:
    apiVersion: "apps/v1"
    kind: Deployment
    name: myapp
  updatePolicy:
    updateMode: "Auto"
    minReplicas: 2  # Don't evict if less than 2 replicas
  resourcePolicy:
    containerPolicies:
    - containerName: myapp
      minAllowed:
        cpu: 100m
        memory: 128Mi
      maxAllowed:
        cpu: 4
        memory: 8Gi
      controlledResources: ["cpu", "memory"]
      controlledValues: RequestsAndLimits
    - containerName: sidecar
      mode: "Off"  # Don't autoscale the sidecar
```

## VPA with Resource Policies

Control what gets scaled:

```yaml
resourcePolicy:
  containerPolicies:
  - containerName: app
    controlledResources: ["memory"]  # Only scale memory
    controlledValues: RequestsOnly   # Don't change limits
```

## Combining VPA and HPA

⚠️ **Warning**: Don't use VPA and HPA on the same resource (CPU/memory).

Safe combination:

```yaml
# VPA controls memory
apiVersion: autoscaling.k8s.io/v1
kind: VerticalPodAutoscaler
metadata:
  name: myapp-vpa
spec:
  targetRef:
    apiVersion: "apps/v1"
    kind: Deployment
    name: myapp
  resourcePolicy:
    containerPolicies:
    - containerName: '*'
      controlledResources: ["memory"]  # Only memory
---
# HPA scales on CPU
apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata:
  name: myapp-hpa
spec:
  scaleTargetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: myapp
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

## Monitoring VPA

Get all VPA resources:

```bash
kubectl get vpa -A
```

Watch recommendations:

```bash
kubectl get vpa hamster-vpa -o jsonpath='{.status.recommendation.containerRecommendations}' | jq
```

## Goldilocks: VPA Dashboard

Install Goldilocks for a UI:

```bash
helm repo add fairwinds-stable https://charts.fairwinds.com/stable
helm install goldilocks fairwinds-stable/goldilocks --namespace goldilocks --create-namespace
```

Enable for namespace:

```bash
kubectl label namespace production goldilocks.fairwinds.com/enabled=true
```

## Best Practices

### 1. Start with Off Mode
Get recommendations first, then apply manually:
```yaml
updateMode: "Off"
```

### 2. Set Min/Max Bounds
Prevent extreme values:
```yaml
minAllowed:
  cpu: 50m
  memory: 64Mi
maxAllowed:
  cpu: 4
  memory: 8Gi
```

### 3. Use PodDisruptionBudget
Ensure availability during updates:
```yaml
apiVersion: policy/v1
kind: PodDisruptionBudget
metadata:
  name: myapp-pdb
spec:
  minAvailable: 1
  selector:
    matchLabels:
      app: myapp
```

### 4. Monitor OOMKilled Events
If pods still get OOMKilled, adjust maxAllowed.

## Key Takeaways

- VPA automatically right-sizes pod resources
- Use Off mode to get recommendations first
- Set min/max bounds to prevent extreme values
- Don't use VPA and HPA on the same metric
- Combine with PDB for safe updates

---

## 📘 Go Further with Kubernetes Recipes

**Love this recipe? There's so much more!** This is just one of **100+ hands-on recipes** in our comprehensive **[Kubernetes Recipes book](https://amzn.to/3DzC8QA)**.

Inside the book, you'll master:
- ✅ Production-ready deployment strategies
- ✅ Advanced networking and security patterns  
- ✅ Observability, monitoring, and troubleshooting
- ✅ Real-world best practices from industry experts

> *"The practical, recipe-based approach made complex Kubernetes concepts finally click for me."*

**👉 [Get Your Copy Now](https://amzn.to/3DzC8QA)** — Start building production-grade Kubernetes skills today!
