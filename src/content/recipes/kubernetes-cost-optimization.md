---
title: "How to Optimize Kubernetes Costs"
description: "Reduce cloud costs in Kubernetes clusters. Right-size resources, use spot instances, implement autoscaling, and monitor spending effectively."
category: "configuration"
difficulty: "intermediate"
publishDate: "2026-01-22"
tags: ["cost", "optimization", "resources", "finops", "efficiency"]
---

# How to Optimize Kubernetes Costs

Kubernetes cost optimization involves right-sizing workloads, leveraging spot instances, implementing autoscaling, and monitoring resource utilization to reduce cloud spending.

## Analyze Current Usage

```bash
# Check resource requests vs actual usage
kubectl top pods -A

# Compare requests to usage
kubectl get pods -A -o custom-columns=\
'NAMESPACE:.metadata.namespace,NAME:.metadata.name,CPU_REQ:.spec.containers[*].resources.requests.cpu,MEM_REQ:.spec.containers[*].resources.requests.memory'

# Find pods without resource limits
kubectl get pods -A -o json | jq -r '.items[] | select(.spec.containers[].resources.limits == null) | "\(.metadata.namespace)/\(.metadata.name)"'
```

## Right-Size Resources

```yaml
# Before: Over-provisioned
spec:
  containers:
    - name: app
      resources:
        requests:
          cpu: "2000m"      # Requesting 2 cores
          memory: "4Gi"     # Requesting 4GB
        limits:
          cpu: "4000m"
          memory: "8Gi"

# After: Right-sized based on actual usage
spec:
  containers:
    - name: app
      resources:
        requests:
          cpu: "250m"       # Actual avg usage + buffer
          memory: "512Mi"   # Actual avg usage + buffer
        limits:
          cpu: "500m"       # 2x request for bursting
          memory: "1Gi"
```

## Vertical Pod Autoscaler (VPA)

```yaml
# vpa.yaml - Automatically right-size pods
apiVersion: autoscaling.k8s.io/v1
kind: VerticalPodAutoscaler
metadata:
  name: myapp-vpa
spec:
  targetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: myapp
  updatePolicy:
    updateMode: "Auto"  # Or "Off" for recommendations only
  resourcePolicy:
    containerPolicies:
      - containerName: "*"
        minAllowed:
          cpu: 50m
          memory: 64Mi
        maxAllowed:
          cpu: 2000m
          memory: 4Gi
```

```bash
# View VPA recommendations
kubectl describe vpa myapp-vpa

# Recommendation output shows:
# - Lower Bound: Minimum resources needed
# - Target: Optimal recommendation
# - Upper Bound: Maximum expected usage
```

## Horizontal Pod Autoscaler (HPA)

```yaml
# hpa.yaml - Scale replicas based on usage
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
      stabilizationWindowSeconds: 300  # Wait before scaling down
      policies:
        - type: Percent
          value: 10
          periodSeconds: 60
```

## Use Spot/Preemptible Instances

```yaml
# spot-node-pool.yaml
# Configure node pool for spot instances (cloud-specific)

# AWS EKS with Karpenter
apiVersion: karpenter.sh/v1alpha5
kind: Provisioner
metadata:
  name: spot-provisioner
spec:
  requirements:
    - key: karpenter.sh/capacity-type
      operator: In
      values: ["spot"]
    - key: node.kubernetes.io/instance-type
      operator: In
      values: ["m5.large", "m5.xlarge", "m5a.large"]
  limits:
    resources:
      cpu: 100
  ttlSecondsAfterEmpty: 30
```

```yaml
# Tolerate spot node taints
apiVersion: apps/v1
kind: Deployment
metadata:
  name: batch-processor
spec:
  template:
    spec:
      tolerations:
        - key: "kubernetes.azure.com/scalesetpriority"
          operator: "Equal"
          value: "spot"
          effect: "NoSchedule"
      affinity:
        nodeAffinity:
          requiredDuringSchedulingIgnoredDuringExecution:
            nodeSelectorTerms:
              - matchExpressions:
                  - key: kubernetes.azure.com/scalesetpriority
                    operator: In
                    values:
                      - spot
      containers:
        - name: processor
          image: batch:v1
```

## Cluster Autoscaler

```yaml
# cluster-autoscaler deployment
# Scales nodes based on pending pods

# Key settings:
# --scale-down-enabled=true
# --scale-down-delay-after-add=10m
# --scale-down-unneeded-time=10m
# --scale-down-utilization-threshold=0.5

# Pods that prevent scale-down:
# - Pods with local storage
# - Pods with PodDisruptionBudget preventing eviction
# - Kube-system pods without PDB
```

## Resource Quotas per Namespace

```yaml
# quota.yaml - Prevent over-provisioning
apiVersion: v1
kind: ResourceQuota
metadata:
  name: team-quota
  namespace: team-a
spec:
  hard:
    requests.cpu: "20"
    requests.memory: 40Gi
    limits.cpu: "40"
    limits.memory: 80Gi
    pods: "50"
```

## Limit Ranges

```yaml
# limit-range.yaml - Default and max limits
apiVersion: v1
kind: LimitRange
metadata:
  name: default-limits
  namespace: team-a
spec:
  limits:
    - type: Container
      default:
        cpu: "200m"
        memory: "256Mi"
      defaultRequest:
        cpu: "100m"
        memory: "128Mi"
      max:
        cpu: "2"
        memory: "4Gi"
```

## Schedule Non-Critical Workloads Off-Peak

```yaml
# cronjob-off-peak.yaml
apiVersion: batch/v1
kind: CronJob
metadata:
  name: batch-job
spec:
  schedule: "0 2 * * *"  # Run at 2 AM (off-peak)
  jobTemplate:
    spec:
      template:
        spec:
          tolerations:
            - key: "spot"
              operator: "Exists"
          containers:
            - name: batch
              image: batch:v1
```

## Cost Monitoring with Kubecost

```bash
# Install Kubecost
helm repo add kubecost https://kubecost.github.io/cost-analyzer/
helm install kubecost kubecost/cost-analyzer \
  --namespace kubecost \
  --create-namespace

# Access dashboard
kubectl port-forward -n kubecost deployment/kubecost-cost-analyzer 9090

# Key metrics:
# - Cost by namespace
# - Cost by deployment
# - Idle resources
# - Right-sizing recommendations
```

## Prometheus Cost Queries

```yaml
# Cost-related metrics
# CPU cost estimation (simplified)
sum(rate(container_cpu_usage_seconds_total{namespace!=""}[5m])) by (namespace)

# Memory cost estimation
sum(container_memory_working_set_bytes{namespace!=""}) by (namespace)

# Resource efficiency (usage vs request)
sum(rate(container_cpu_usage_seconds_total[5m])) / sum(kube_pod_container_resource_requests{resource="cpu"})
```

## Pod Priority for Cost Control

```yaml
# priority-class.yaml
apiVersion: scheduling.k8s.io/v1
kind: PriorityClass
metadata:
  name: low-priority
value: 100
preemptionPolicy: PreemptLowerPriority
description: "Low priority for batch jobs - can be preempted"
---
apiVersion: scheduling.k8s.io/v1
kind: PriorityClass
metadata:
  name: high-priority
value: 1000
preemptionPolicy: PreemptLowerPriority
description: "High priority for production services"
```

## Cleanup Unused Resources

```bash
# Find unused PVCs
kubectl get pvc -A -o json | jq -r '.items[] | select(.status.phase == "Bound") | "\(.metadata.namespace)/\(.metadata.name)"' | while read pvc; do
  ns=$(echo $pvc | cut -d'/' -f1)
  name=$(echo $pvc | cut -d'/' -f2)
  if ! kubectl get pods -n $ns -o json | grep -q "\"claimName\": \"$name\""; then
    echo "Unused PVC: $pvc"
  fi
done

# Find orphaned PVs
kubectl get pv -o json | jq -r '.items[] | select(.status.phase == "Released") | .metadata.name'

# Clean up completed jobs
kubectl delete jobs --field-selector status.successful=1 -A
```

## Cost Optimization Checklist

```markdown
1. Right-size workloads
   □ Set resource requests based on actual usage
   □ Use VPA for recommendations
   □ Review and adjust monthly

2. Autoscaling
   □ HPA for variable workloads
   □ Cluster autoscaler enabled
   □ Scale to zero for dev/test

3. Spot instances
   □ Use for stateless workloads
   □ Batch processing on spot
   □ Mix on-demand and spot

4. Resource governance
   □ Quotas per namespace/team
   □ LimitRanges for defaults
   □ Chargeback by namespace

5. Cleanup
   □ Delete unused resources
   □ TTL on completed jobs
   □ Review orphaned PVs/PVCs
```

## Summary

Kubernetes cost optimization starts with right-sizing: use VPA recommendations and actual metrics to set appropriate requests and limits. Implement HPA for horizontal scaling and cluster autoscaler for node efficiency. Leverage spot instances for fault-tolerant workloads. Set resource quotas and limit ranges to prevent over-provisioning. Use tools like Kubecost for visibility and cleanup unused resources regularly. Continuous monitoring and adjustment are key to maintaining cost efficiency.

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
