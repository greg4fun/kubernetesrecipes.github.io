---
title: "How to Configure Cluster Autoscaler"
description: "Automatically scale your Kubernetes cluster nodes based on workload demand. Learn to configure Cluster Autoscaler for AWS, GCP, and Azure."
category: "autoscaling"
difficulty: "intermediate"
timeToComplete: "30 minutes"
kubernetesVersion: "1.28+"
prerequisites:
  - "A managed Kubernetes cluster (EKS, GKE, or AKS)"
  - "kubectl configured with admin access"
  - "Cloud provider CLI configured"
relatedRecipes:
  - "horizontal-pod-autoscaler"
  - "vertical-pod-autoscaler"
tags:
  - autoscaling
  - cluster-autoscaler
  - nodes
  - cost-optimization
  - capacity
publishDate: "2026-01-21"
author: "Luca Berton"
---

## The Problem

Your cluster runs out of resources when demand spikes, causing pods to remain Pending. Manual node scaling is slow and inefficient.

## The Solution

Use Cluster Autoscaler to automatically add nodes when pods can't be scheduled and remove underutilized nodes to save costs.

## How Cluster Autoscaler Works

1. **Scale Up**: When pods are Pending due to insufficient resources
2. **Scale Down**: When nodes are underutilized for extended periods

## AWS EKS Setup

### Prerequisites

Create an IAM policy:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "autoscaling:DescribeAutoScalingGroups",
        "autoscaling:DescribeAutoScalingInstances",
        "autoscaling:DescribeLaunchConfigurations",
        "autoscaling:DescribeScalingActivities",
        "autoscaling:DescribeTags",
        "autoscaling:SetDesiredCapacity",
        "autoscaling:TerminateInstanceInAutoScalingGroup",
        "ec2:DescribeLaunchTemplateVersions",
        "ec2:DescribeInstanceTypes"
      ],
      "Resource": "*"
    }
  ]
}
```

### Tag ASG

Add tags to your Auto Scaling Group:

```
k8s.io/cluster-autoscaler/enabled = true
k8s.io/cluster-autoscaler/<cluster-name> = owned
```

### Deploy Cluster Autoscaler

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: cluster-autoscaler
  namespace: kube-system
  labels:
    app: cluster-autoscaler
spec:
  replicas: 1
  selector:
    matchLabels:
      app: cluster-autoscaler
  template:
    metadata:
      labels:
        app: cluster-autoscaler
    spec:
      serviceAccountName: cluster-autoscaler
      containers:
      - name: cluster-autoscaler
        image: registry.k8s.io/autoscaling/cluster-autoscaler:v1.28.0
        command:
        - ./cluster-autoscaler
        - --v=4
        - --stderrthreshold=info
        - --cloud-provider=aws
        - --skip-nodes-with-local-storage=false
        - --expander=least-waste
        - --node-group-auto-discovery=asg:tag=k8s.io/cluster-autoscaler/enabled,k8s.io/cluster-autoscaler/my-cluster
        - --balance-similar-node-groups
        - --scale-down-enabled=true
        - --scale-down-delay-after-add=10m
        - --scale-down-unneeded-time=10m
        resources:
          limits:
            cpu: 100m
            memory: 600Mi
          requests:
            cpu: 100m
            memory: 600Mi
```

## GCP GKE Setup

GKE has built-in Cluster Autoscaler. Enable it:

```bash
# Enable autoscaling on a node pool
gcloud container clusters update my-cluster \
  --enable-autoscaling \
  --min-nodes=1 \
  --max-nodes=10 \
  --zone=us-central1-a \
  --node-pool=default-pool
```

Or in Terraform:

```hcl
resource "google_container_node_pool" "primary" {
  name       = "primary-pool"
  cluster    = google_container_cluster.primary.name
  location   = "us-central1-a"
  
  autoscaling {
    min_node_count = 1
    max_node_count = 10
  }
  
  node_config {
    machine_type = "e2-medium"
  }
}
```

## Azure AKS Setup

Enable cluster autoscaler:

```bash
az aks update \
  --resource-group myResourceGroup \
  --name myAKSCluster \
  --enable-cluster-autoscaler \
  --min-count 1 \
  --max-count 10
```

Or update a specific node pool:

```bash
az aks nodepool update \
  --resource-group myResourceGroup \
  --cluster-name myAKSCluster \
  --name nodepool1 \
  --enable-cluster-autoscaler \
  --min-count 1 \
  --max-count 10
```

## Configuration Options

### Expander Strategies

Choose how Cluster Autoscaler selects which node group to scale:

| Expander | Strategy |
|----------|----------|
| `random` | Random selection |
| `most-pods` | Add node that fits the most pending pods |
| `least-waste` | Add node with least idle CPU/memory after scaling |
| `price` | Add cheapest node (cloud provider specific) |
| `priority` | Use priority-based configuration |

```yaml
- --expander=least-waste
```

### Scale Down Configuration

```yaml
- --scale-down-enabled=true
- --scale-down-delay-after-add=10m      # Wait after adding node
- --scale-down-delay-after-delete=0s    # Wait after deleting node
- --scale-down-unneeded-time=10m        # Node must be unneeded for this long
- --scale-down-utilization-threshold=0.5 # Scale down if utilization below 50%
```

### Node Group Limits

```yaml
- --nodes=1:10:my-node-group  # min:max:name
```

## Preventing Scale Down

### Pod Annotations

Prevent scaling down a node running specific pods:

```yaml
apiVersion: v1
kind: Pod
metadata:
  name: important-pod
  annotations:
    cluster-autoscaler.kubernetes.io/safe-to-evict: "false"
```

### Node Annotations

Mark a node as non-scalable:

```bash
kubectl annotate node my-node cluster-autoscaler.kubernetes.io/scale-down-disabled=true
```

## Pod Disruption Budget

Protect workloads during scale down:

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

## Multiple Node Pools

Use different node pools for different workloads:

```yaml
# High-memory node pool
apiVersion: v1
kind: Pod
metadata:
  name: memory-intensive
spec:
  nodeSelector:
    node-pool: high-memory
  containers:
  - name: app
    image: myapp:latest
    resources:
      requests:
        memory: "8Gi"
```

## Monitoring Cluster Autoscaler

### Check Status

```bash
kubectl get configmap cluster-autoscaler-status -n kube-system -o yaml
```

### View Logs

```bash
kubectl logs -n kube-system -l app=cluster-autoscaler -f
```

### Key Metrics

```promql
# Pending pods
sum(kube_pod_status_phase{phase="Pending"})

# Node count
count(kube_node_info)

# Cluster autoscaler scaling events
cluster_autoscaler_scaled_up_nodes_total
cluster_autoscaler_scaled_down_nodes_total
```

## Troubleshooting

### Pods Stuck Pending

Check why autoscaler isn't adding nodes:

```bash
kubectl get events --field-selector reason=NotTriggerScaleUp
```

Common causes:
- Max nodes reached
- No suitable node group
- Pod has unsatisfiable constraints

### Nodes Not Scaling Down

Check for blockers:

```bash
kubectl get nodes -o custom-columns='NAME:.metadata.name,ANNOTATIONS:.metadata.annotations'
```

Common blockers:
- Pods with `safe-to-evict: false`
- Pods with local storage
- System pods on dedicated nodes
- PodDisruptionBudgets

## Best Practices

### 1. Set Appropriate Min/Max

```yaml
--nodes=2:20:my-pool  # Minimum 2 for HA
```

### 2. Use Pod Priorities

```yaml
apiVersion: scheduling.k8s.io/v1
kind: PriorityClass
metadata:
  name: high-priority
value: 1000000
```

### 3. Configure Proper Timeouts

Don't set delays too low—it causes thrashing.

### 4. Use Pod Disruption Budgets

Ensure workload availability during scale-down.

### 5. Monitor Costs

Use cloud cost tools to track scaling impact.

## Key Takeaways

- Cluster Autoscaler adds/removes nodes automatically
- Scale up triggered by Pending pods
- Scale down triggered by low utilization
- Use PDBs to protect workloads
- Monitor to ensure expected behavior
