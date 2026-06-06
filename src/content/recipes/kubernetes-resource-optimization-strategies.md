---
title: "Kubernetes Right-Sizing and Cost Optimization"
description: "Optimize Kubernetes resource allocation with right-sizing, VPA recommendations, bin packing, request-to-limit ratios, and cost reduction best practices."
publishDate: "2026-05-02"
author: "Luca Berton"
category: "autoscaling"
difficulty: "intermediate"
timeToComplete: "20 minutes"
kubernetesVersion: "1.28+"
tags:
  - "resources"
  - "optimization"
  - "cost"
  - "vpa"
  - "right-sizing"
  - "autoscaling"
relatedRecipes:
  - "horizontal-pod-autoscaler"
  - "vpa-hack-vpa-up-sh-install-kubernetes"
---

> 💡 **Quick Answer:** Kubernetes resource optimization means right-sizing requests and limits to match actual usage. Start by deploying VPA in recommendation mode (`kubectl get vpa -o yaml`), then adjust requests to P95 usage + 20% buffer. Set CPU limits to 2-5x requests (CPU is compressible) and memory limits to 1.2-1.5x requests (memory is not). Use Goldilocks or Kubecost for continuous recommendations.

## The Problem

Most Kubernetes clusters waste 60-80% of provisioned resources:

- Developers request 1 CPU / 1Gi but pods use 50m / 128Mi
- Over-provisioning wastes money on cloud ($$$)
- Under-provisioning causes OOMKill and CPU throttling
- No visibility into actual vs requested resource usage
- Teams don't update requests after initial deployment

## The Solution

### Step 1: Measure Actual Usage

```bash
# Check current requests vs actual usage
kubectl top pods -n production --sort-by=cpu
kubectl top pods -n production --sort-by=memory

# Compare requests vs usage for all pods in namespace
kubectl get pods -n production -o json | jq -r '
  .items[] | 
  .metadata.name as $name |
  .spec.containers[] |
  "\($name) | req: \(.resources.requests.cpu // "none") cpu, \(.resources.requests.memory // "none") mem"'

# Prometheus query: CPU request vs actual (ratio)
# container_cpu_usage_seconds_total / kube_pod_container_resource_requests{resource="cpu"}
```

### Step 2: Deploy VPA for Recommendations

```yaml
apiVersion: autoscaling.k8s.io/v1
kind: VerticalPodAutoscaler
metadata:
  name: my-app-vpa
  namespace: production
spec:
  targetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: my-app
  updatePolicy:
    updateMode: "Off"  # Recommendation only — won't change pods
  resourcePolicy:
    containerPolicies:
    - containerName: '*'
      minAllowed:
        cpu: 50m
        memory: 64Mi
      maxAllowed:
        cpu: 4
        memory: 8Gi
```

```bash
# Apply and wait for recommendations (needs 24h+ of data)
kubectl apply -f vpa.yaml

# Check recommendations
kubectl get vpa my-app-vpa -o yaml | grep -A20 recommendation
# recommendation:
#   containerRecommendations:
#   - containerName: my-app
#     lowerBound:
#       cpu: 25m
#       memory: 131072k
#     target:        ← Use this for requests
#       cpu: 100m
#       memory: 256Mi
#     upperBound:    ← Use this for limits
#       cpu: 500m
#       memory: 512Mi
```

### Step 3: Right-Size Resources

```yaml
# Before (over-provisioned):
resources:
  requests:
    cpu: "1"
    memory: 1Gi
  limits:
    cpu: "2"
    memory: 2Gi

# After (right-sized based on VPA target + buffer):
resources:
  requests:
    cpu: 120m        # VPA target 100m + 20% buffer
    memory: 300Mi    # VPA target 256Mi + ~20% buffer
  limits:
    cpu: 500m        # 4x requests (CPU is compressible)
    memory: 400Mi    # 1.3x requests (memory is NOT compressible)
```

### Right-Sizing Rules

| Resource | Requests | Limits | Why |
|----------|----------|--------|-----|
| **CPU** | P95 usage + 20% | 2-5x requests (or no limit) | CPU is compressible — throttled, not killed |
| **Memory** | P95 usage + 20% | 1.2-1.5x requests | Memory is NOT compressible — OOMKill if exceeded |
| **Ephemeral storage** | Based on log/tmp volume | 2x requests | Evicted if exceeded |

### Step 4: Automated Optimization Tools

```bash
# Goldilocks — VPA recommendations for every deployment
kubectl create namespace goldilocks
helm install goldilocks fairwinds-stable/goldilocks -n goldilocks
# Label namespaces to enable
kubectl label namespace production goldilocks.fairwinds.com/enabled=true
# Access dashboard
kubectl port-forward -n goldilocks svc/goldilocks-dashboard 8080:80

# Kubecost — cost visibility
helm install kubecost kubecost/cost-analyzer -n kubecost \
  --set prometheus.server.global.external_labels.cluster_id=my-cluster

# kubectl-view-allocations plugin
kubectl krew install view-allocations
kubectl view-allocations -n production
```

### Step 5: Cluster-Level Optimization

```yaml
# LimitRange — prevent absurd requests
apiVersion: v1
kind: LimitRange
metadata:
  name: resource-constraints
  namespace: production
spec:
  limits:
  - type: Container
    default:
      cpu: 200m
      memory: 256Mi
    defaultRequest:
      cpu: 50m
      memory: 128Mi
    max:
      cpu: "4"
      memory: 8Gi
    min:
      cpu: 10m
      memory: 32Mi

---
# ResourceQuota — cap namespace total
apiVersion: v1
kind: ResourceQuota
metadata:
  name: compute-quota
  namespace: production
spec:
  hard:
    requests.cpu: "20"
    requests.memory: 40Gi
    limits.cpu: "40"
    limits.memory: 80Gi
```

### Step 6: Node Bin Packing

```yaml
# Scheduler profile for bin packing (pack pods tightly onto fewer nodes)
apiVersion: kubescheduler.config.k8s.io/v1
kind: KubeSchedulerConfiguration
profiles:
- schedulerName: default-scheduler
  plugins:
    score:
      enabled:
      - name: NodeResourcesFit
        weight: 1
  pluginConfig:
  - name: NodeResourcesFit
    args:
      scoringStrategy:
        type: MostAllocated    # Bin packing (vs LeastAllocated = spreading)
        resources:
        - name: cpu
          weight: 1
        - name: memory
          weight: 1
```

## Common Issues

**VPA and HPA conflict on CPU**

VPA adjusts CPU requests, HPA scales replicas on CPU utilization. The metric basis shifts. Use VPA for memory only, HPA for CPU scaling.

**Pods OOMKilled after right-sizing memory**

Buffer too small. Memory usage has spikes — use P99 (not P95) for bursty workloads, and set limit to 1.5x requests.

**CPU throttling after reducing limits**

Check `container_cpu_cfs_throttled_periods_total`. If >5% throttled, increase CPU limit or remove it entirely (burstable QoS is often fine).

## Best Practices

- **Start with VPA in `Off` mode** — get recommendations before auto-applying
- **Right-size requests first, limits second** — requests affect scheduling
- **Don't set CPU limits on non-batch workloads** — CPU throttling hurts latency
- **Always set memory limits** — memory is not compressible, leaks cause node pressure
- **Review monthly** — usage patterns change with traffic and features
- **Use namespace quotas** — prevent any team from over-provisioning

## Key Takeaways

- Most clusters waste 60-80% of resources — right-sizing saves real money
- VPA recommendations give data-driven request/limit targets
- CPU requests = P95 + 20%, memory requests = P95 + 20%, memory limits = 1.2-1.5x requests
- Use Goldilocks or Kubecost for continuous optimization visibility
- Bin packing (MostAllocated scoring) reduces node count and cost
