---
title: "Kubernetes Cost Optimization Strategies"
description: "Comprehensive cost reduction strategies for Kubernetes clusters: right-sizing, spot instances, autoscaling, idle resource detection, namespace budgets, and GPU"
tags:
  - "cost-optimization"
  - "finops"
  - "autoscaling"
  - "resource-management"
  - "spot-instances"
category: "configuration"
publishDate: "2026-05-06"
author: "Luca Berton"
difficulty: "intermediate"
relatedRecipes:
  - "kubernetes-vpa-vertical-pod-autoscaler"
  - "kubernetes-goldilocks-vpa-dashboard"
  - "kubernetes-horizontal-pod-autoscaler-v2"
  - "kubernetes-resource-quota-limitrange"
---

> 💡 **Quick Answer:** Kubernetes cost optimization combines right-sizing (VPA), horizontal scaling (HPA), cluster autoscaling (Karpenter/CA), spot instances for fault-tolerant workloads, idle resource detection, and GPU time-sharing — typically achieving 30-60% cost reduction.

## The Problem

Kubernetes clusters waste money through:

- Over-provisioned containers (requesting 4x what they use)
- Always-on nodes for variable workloads
- Idle GPUs ($10-30/hour doing nothing)
- No visibility into per-team/per-workload costs
- Paying on-demand prices for fault-tolerant workloads

## The Solution

### Cost Optimization Framework

```text
Impact    Strategy                        Typical Savings
──────────────────────────────────────────────────────────
HIGH      Right-size containers (VPA)      30-50%
HIGH      Spot/preemptible instances       60-90% per node
HIGH      GPU time-sharing/MIG             2-7x utilization
MEDIUM    Cluster autoscaler (scale to 0)  20-40%
MEDIUM    HPA (scale with demand)          20-30%
MEDIUM    Namespace resource quotas        Prevent sprawl
LOW       Pod priority/preemption          5-10%
LOW       Storage class tiering            10-20%
```

### Right-Sizing with VPA

```yaml
# Step 1: Deploy VPA in recommendation mode
apiVersion: autoscaling.k8s.io/v1
kind: VerticalPodAutoscaler
metadata:
  name: api-vpa
spec:
  targetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: api-server
  updatePolicy:
    updateMode: "Off"

# Step 2: After 1 week, read recommendations
# kubectl describe vpa api-vpa
# Target: CPU 150m, Memory 256Mi
# Current: CPU 1000m, Memory 2Gi
# Savings: 850m CPU, 1.75Gi memory PER POD
```

### Spot Instance Node Pools

```yaml
# Karpenter NodePool for spot instances
apiVersion: karpenter.sh/v1
kind: NodePool
metadata:
  name: spot-general
spec:
  template:
    spec:
      requirements:
        - key: karpenter.sh/capacity-type
          operator: In
          values: ["spot"]
        - key: node.kubernetes.io/instance-type
          operator: In
          values: ["m5.xlarge", "m5a.xlarge", "m6i.xlarge", "m6a.xlarge"]
      nodeClassRef:
        name: default
  disruption:
    consolidationPolicy: WhenEmpty
    consolidateAfter: 30s
  limits:
    cpu: "100"
    memory: 400Gi
---
# Workloads opt-in to spot via tolerations
apiVersion: apps/v1
kind: Deployment
metadata:
  name: batch-processor
spec:
  template:
    spec:
      tolerations:
        - key: "karpenter.sh/capacity-type"
          operator: "Equal"
          value: "spot"
          effect: "NoSchedule"
      nodeSelector:
        karpenter.sh/capacity-type: spot
```

### GPU Cost Management

```yaml
# MIG slicing: 1 A100 → 7 workloads
# Time-slicing: share GPU across Pods
apiVersion: v1
kind: ConfigMap
metadata:
  name: gpu-sharing-config
  namespace: gpu-operator
data:
  config.yaml: |
    version: v1
    sharing:
      timeSlicing:
        resources:
          - name: nvidia.com/gpu
            replicas: 4    # 4 Pods share each physical GPU

# Result: 8-GPU node serves 32 inference workloads
# Cost: $30/hr shared across 32 → $0.94/hr per workload
# vs. $30/hr for 1 dedicated workload
```

### Idle Resource Detection

```bash
# Find Pods using < 10% of their CPU request
kubectl top pods -A --sort-by=cpu | awk '
  NR>1 {
    split($3, cpu, "m");
    if (cpu[1] < 10) print $1, $2, $3, "← IDLE"
  }
'

# Find Deployments with 0 traffic (scale to 0 candidates)
# Requires Prometheus
curl -s "http://prometheus:9090/api/v1/query?query=
  sum(rate(http_requests_total[24h])) by (deployment) == 0"

# Find PVCs with no Pod attached
kubectl get pvc -A --no-headers | while read ns name _ _ _ _ sc _; do
  if ! kubectl get pods -n $ns -o json | grep -q $name; then
    echo "ORPHAN PVC: $ns/$name ($sc)"
  fi
done
```

### Namespace Cost Budgets

```yaml
# ResourceQuota as cost guardrail
apiVersion: v1
kind: ResourceQuota
metadata:
  name: team-budget
  namespace: team-alpha
spec:
  hard:
    requests.cpu: "16"       # ~$200/month at on-demand
    requests.memory: "64Gi"
    requests.nvidia.com/gpu: "2"  # ~$1500/month
    persistentvolumeclaims: "20"
    services.loadbalancers: "2"   # ~$36/month each
```

### Scale-to-Zero for Dev/Staging

```yaml
# KEDA ScaledObject: scale to 0 when no traffic
apiVersion: keda.sh/v1alpha1
kind: ScaledObject
metadata:
  name: api-scaledobject
spec:
  scaleTargetRef:
    name: staging-api
  minReplicaCount: 0    # Scale to zero!
  maxReplicaCount: 5
  cooldownPeriod: 300
  triggers:
    - type: prometheus
      metadata:
        serverAddress: http://prometheus.monitoring:9090
        query: sum(rate(http_requests_total{deployment="staging-api"}[5m]))
        threshold: "1"
```

## Common Issues

### Spot instance interruption causes downtime
- **Cause**: Only 1 replica on spot; no graceful handling
- **Fix**: Run 2+ replicas across multiple instance types; handle SIGTERM

### VPA evictions during peak
- **Cause**: Auto mode evicts to apply new resource values
- **Fix**: Use Initial mode; or schedule VPA updates during maintenance windows

### GPU idle but can't reclaim
- **Cause**: Pod holds GPU allocation even when not computing
- **Fix**: Use Run:ai fractional GPU or time-slicing; set idle timeout

## Best Practices

1. **Right-size first** — biggest bang for least effort (VPA + Goldilocks)
2. **Spot for stateless** — web servers, batch jobs, CI runners
3. **On-demand for stateful** — databases, message queues, critical services
4. **GPU time-sharing** for inference — most LLM inference is bursty
5. **Scale to zero** in dev/staging — nobody works at 3 AM
6. **Tag everything** — team labels enable cost attribution
7. **Review monthly** — workload patterns change; savings drift

## Key Takeaways

- Average K8s cluster wastes 40-60% of resources (over-provisioned)
- VPA + Goldilocks identifies right-size targets across all workloads
- Spot instances save 60-90% for fault-tolerant workloads
- GPU time-slicing/MIG: share expensive GPUs across multiple workloads
- Scale-to-zero (KEDA): eliminate cost for idle dev/staging environments
- ResourceQuotas prevent uncontrolled spending per team/namespace
- Combined strategy typically achieves 30-60% total cluster cost reduction
