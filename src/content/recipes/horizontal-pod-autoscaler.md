---
title: "Kubernetes HPA: Set Max Replicas and Scale"
description: "Configure Kubernetes HPA (autoscaling/v2): averageUtilization, set or change maxReplicas, CPU, memory and custom metrics, and scaling behavior."
category: "autoscaling"
difficulty: "intermediate"
timeToComplete: "20 minutes"
kubernetesVersion: "1.25+"
prerequisites:
  - "metrics-server installed in your cluster"
  - "kubectl configured to access your cluster"
  - "A Deployment to scale"
relatedRecipes:
  - "kubernetes-vertical-pod-autoscaler-vpa"
  - "llm-autoscaling-kubernetes"
  - "kubernetes-cluster-autoscaler-configuration"
  - "kubernetes-hpa-prometheus-adapter"
  - "kubernetes-keda-event-driven-autoscaling"
  - "keda-vs-hpa-autoscaling-comparison"
  - "kubernetes-horizontal-scaling-patterns"
  - "kubernetes-resource-optimization"
  - "kubernetes-resource-optimization-strategies"
tags:
  - hpa
  - autoscaling
  - metrics
  - cpu
  - memory
  - scaling
  - performance
publishDate: "2026-01-20"
author: "Luca Berton"
---

> **💡 Quick Answer:** Create an HPA with `kubectl autoscale deployment <name> --cpu-percent=70 --min=2 --max=10`, or an `autoscaling/v2` manifest with `minReplicas`, `maxReplicas` and a metric target such as `averageUtilization: 70`. Change the ceiling later with `kubectl patch hpa <name> -p '{"spec":{"maxReplicas":20}}'`. metrics-server must be running (`kubectl top pods` works) and every container needs `resources.requests` — utilization is measured against requests.

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

## Set or Change Max Replicas

`maxReplicas` is required and caps how far the HPA can scale; `minReplicas` defaults to 1.

```bash
# Change the ceiling on an existing HPA
kubectl patch hpa my-app-hpa -p '{"spec":{"maxReplicas":20}}'

# Or both bounds
kubectl patch hpa my-app-hpa --type merge -p '{"spec":{"minReplicas":3,"maxReplicas":30}}'

# Check whether the HPA is pinned at the ceiling
kubectl describe hpa my-app-hpa | grep -A5 Conditions
# ScalingLimited  True  TooManyReplicas  the desired replica count is more than the maximum replica count
```

Don't set `spec.replicas` on the Deployment in GitOps manifests managed alongside an HPA — every sync resets the replica count the HPA chose. Remove the field (or ignore it in Argo CD) and let the HPA own it.

Sizing `maxReplicas`: treat it as a cost and blast-radius cap. Keep `maxReplicas × pod requests` within the namespace ResourceQuota and what the cluster autoscaler can actually add, check downstream limits (DB connections, API rate limits), and alert when the HPA sits at the ceiling:

```promql
kube_horizontalpodautoscaler_status_current_replicas
  >= kube_horizontalpodautoscaler_spec_max_replicas
```

How the HPA computes replicas:

```text
desiredReplicas = ceil(currentReplicas * currentMetricValue / targetValue)
```

With 4 pods at 90% CPU and a 70% target: `ceil(4 * 90/70) = 6`. Changes within the 10% tolerance (ratio 0.9-1.1) are ignored, and the result is clamped to `[minReplicas, maxReplicas]`.

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

Memory can also be targeted as an absolute value per pod instead of a percentage of requests:

```yaml
    - type: Resource
      resource:
        name: memory
        target:
          type: AverageValue
          averageValue: 512Mi
```

Memory is a weak scaling signal on its own: many runtimes (JVM, Go, Python) don't return memory after load drops, so a memory-driven HPA scales up and never back down. Use CPU or a request-rate metric as the primary signal and memory as a safety net.

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

### Scaling too aggressively (flapping)

Add `behavior` with a scale-down `stabilizationWindowSeconds` (default 300s) and rate-limiting policies. Scale-up has no stabilization by default.

### HPA not scaling down on memory

The app holds on to memory after load drops. Scale on CPU or request rate instead, or raise the memory target.

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

## References

- [Horizontal Pod Autoscaler](https://kubernetes.io/docs/tasks/run-application/horizontal-pod-autoscale/)
- [HPA Walkthrough](https://kubernetes.io/docs/tasks/run-application/horizontal-pod-autoscale-walkthrough/)

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

## Frequently Asked Questions

### What is HPA in Kubernetes?

The Horizontal Pod Autoscaler is a built-in controller that changes the replica count of a Deployment, StatefulSet or other scalable resource based on CPU, memory, custom or external metrics, within `minReplicas` and `maxReplicas`.

### How do I set max replicas for an HPA?

Set `spec.maxReplicas` in the HPA manifest, pass `--max` to `kubectl autoscale`, or patch a live HPA: `kubectl patch hpa my-app-hpa -p '{"spec":{"maxReplicas":20}}'`. When the HPA wants more pods than the maximum, its `ScalingLimited` condition shows `TooManyReplicas`.

### What does averageUtilization mean?

For `type: Utilization`, `averageUtilization` is the target average usage across all pods as a percentage of their **requests**. With `requests.cpu: 200m` and `averageUtilization: 70`, the HPA aims for about 140m per pod. Pods without requests make the metric `<unknown>`.

### How does the HPA calculate the replica count?

Every 15 seconds (default sync period) it computes `ceil(currentReplicas × currentMetric / targetMetric)` per metric, takes the highest result, skips changes within a 10% tolerance, applies `behavior` policies and stabilization, and clamps to min/max.

### Why is my HPA not scaling?

Common reasons: metrics-server missing (`kubectl top pods` fails), no resource requests on the containers, already at `maxReplicas`, the scale-down stabilization window (300s default) hasn't elapsed, or a custom metric isn't served by the adapter. `kubectl describe hpa` shows the conditions and events.

### What is the default HPA stabilization window?

300 seconds for scale-down and 0 seconds for scale-up. Tune them with `behavior.scaleDown.stabilizationWindowSeconds` and `behavior.scaleUp.stabilizationWindowSeconds`.

### Can HPA scale to zero?

Not by default — `minReplicas` must be at least 1 unless the alpha `HPAScaleToZero` feature gate is enabled. Use [KEDA](/recipes/autoscaling/kubernetes-keda-event-driven-autoscaling/) for scale-to-zero on event sources.

### Can HPA and VPA be used together?

Yes, if they don't act on the same resource. A common split is [VPA](/recipes/autoscaling/kubernetes-vertical-pod-autoscaler-vpa/) for memory requests and HPA on CPU or custom metrics. If VPA changes CPU requests while the HPA targets CPU utilization, the two chase each other.
