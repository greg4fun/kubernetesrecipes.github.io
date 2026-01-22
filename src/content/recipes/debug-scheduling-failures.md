---
title: "How to Debug Pod Scheduling Failures"
description: "Troubleshoot pods stuck in Pending state due to scheduling issues. Learn to diagnose resource constraints, node affinity, taints, and topology spread problems."
category: "troubleshooting"
difficulty: "intermediate"
publishDate: "2026-01-22"
tags: ["scheduling", "pending", "troubleshooting", "resources", "affinity"]
---

# How to Debug Pod Scheduling Failures

Pods stuck in Pending state indicate scheduling failures. Learn to diagnose resource constraints, affinity rules, taints, tolerations, and other scheduling issues.

## Identify the Problem

```bash
# Find pending pods
kubectl get pods --field-selector=status.phase=Pending -A

# Get scheduling failure reason
kubectl describe pod <pod-name>
```

Look for scheduler events:
```
Events:
  Type     Reason            Age   Message
  ----     ------            ----  -------
  Warning  FailedScheduling  1m    0/3 nodes are available: 
                                   1 node(s) had untolerated taint {node-role.kubernetes.io/control-plane: }, 
                                   2 node(s) didn't have free ports for the requested pod ports.
```

## Common Scheduling Failures

### 1. Insufficient Resources

```bash
# Check node resources
kubectl describe nodes | grep -A 5 "Allocated resources"

# Check available capacity
kubectl top nodes

# Detailed node capacity
kubectl get nodes -o custom-columns=\
NAME:.metadata.name,\
CPU:.status.capacity.cpu,\
MEMORY:.status.capacity.memory,\
PODS:.status.capacity.pods
```

```yaml
# Pod requesting too many resources
apiVersion: v1
kind: Pod
metadata:
  name: resource-heavy
spec:
  containers:
    - name: app
      image: nginx
      resources:
        requests:
          memory: "64Gi"  # Too high!
          cpu: "32"       # Too high!
```

**Fix:** Reduce resource requests or add nodes

```yaml
# Reasonable resources
resources:
  requests:
    memory: "256Mi"
    cpu: "100m"
  limits:
    memory: "512Mi"
    cpu: "500m"
```

### 2. Node Selector Mismatch

```bash
# Check node labels
kubectl get nodes --show-labels

# Find nodes with specific label
kubectl get nodes -l gpu=nvidia
```

```yaml
# Pod requires label that doesn't exist
apiVersion: v1
kind: Pod
spec:
  nodeSelector:
    gpu: nvidia  # No nodes have this label!
```

**Fix:** Add label to nodes or remove selector

```bash
# Add label to node
kubectl label nodes node-1 gpu=nvidia
```

### 3. Node Affinity Issues

```yaml
# Check pod's affinity requirements
apiVersion: v1
kind: Pod
spec:
  affinity:
    nodeAffinity:
      requiredDuringSchedulingIgnoredDuringExecution:
        nodeSelectorTerms:
          - matchExpressions:
              - key: topology.kubernetes.io/zone
                operator: In
                values:
                  - us-east-1a  # No nodes in this zone!
```

**Diagnose:**

```bash
# Find nodes matching affinity
kubectl get nodes -l topology.kubernetes.io/zone=us-east-1a

# List all zones
kubectl get nodes -o jsonpath='{.items[*].metadata.labels.topology\.kubernetes\.io/zone}' | tr ' ' '\n' | sort -u
```

### 4. Taints and Tolerations

```bash
# Check node taints
kubectl describe nodes | grep -A 3 Taints

# List all taints
kubectl get nodes -o custom-columns=NAME:.metadata.name,TAINTS:.spec.taints
```

```yaml
# Pod needs toleration for tainted node
apiVersion: v1
kind: Pod
spec:
  tolerations:
    - key: "dedicated"
      operator: "Equal"
      value: "gpu"
      effect: "NoSchedule"
    # Tolerate control plane nodes
    - key: "node-role.kubernetes.io/control-plane"
      operator: "Exists"
      effect: "NoSchedule"
```

### 5. Pod Disruption Budget Blocking

```bash
# Check PDBs
kubectl get pdb -A

# Find blocking PDB
kubectl describe pdb <pdb-name>
```

**Fix:** Ensure PDB allows some disruptions

### 6. Topology Spread Constraint Failures

```yaml
# Strict constraint with insufficient domains
topologySpreadConstraints:
  - maxSkew: 1
    topologyKey: topology.kubernetes.io/zone
    whenUnsatisfiable: DoNotSchedule  # Blocks if can't spread
    minDomains: 5  # Requires 5 zones!
```

**Fix:** Reduce minDomains or use ScheduleAnyway

### 7. Port Conflicts

```yaml
# Using hostPort
apiVersion: v1
kind: Pod
spec:
  containers:
    - name: app
      ports:
        - containerPort: 80
          hostPort: 80  # Only one pod per node can use this!
```

**Diagnose:**

```bash
# Find pods using hostPort 80
kubectl get pods -A -o json | jq '.items[] | select(.spec.containers[].ports[]?.hostPort == 80) | .metadata.name'
```

### 8. PersistentVolumeClaim Not Bound

```bash
# Check PVC status
kubectl get pvc

# Check PV availability
kubectl get pv
```

**Fix:** Create matching PV or use dynamic provisioning

### 9. Volume Node Affinity

```bash
# Check PV node affinity
kubectl describe pv <pv-name> | grep -A 5 "Node Affinity"
```

Volume might be bound to a specific node/zone.

## Debugging Commands

```bash
# Scheduler debug
kubectl get events --field-selector reason=FailedScheduling -A

# Check scheduler logs
kubectl logs -n kube-system -l component=kube-scheduler

# Simulate scheduling
kubectl get pod <pod-name> -o yaml | kubectl apply --dry-run=server -f -

# Force reschedule
kubectl delete pod <pod-name>
```

## Check Cluster Capacity

```bash
# Total cluster resources
kubectl describe nodes | grep -E "cpu|memory" | head -20

# Resource summary
kubectl top nodes

# Pods per node
kubectl get pods -A -o wide | awk '{print $8}' | sort | uniq -c | sort -rn
```

## Priority and Preemption

```yaml
# High priority pod can preempt lower priority
apiVersion: scheduling.k8s.io/v1
kind: PriorityClass
metadata:
  name: high-priority
value: 1000000
globalDefault: false
preemptionPolicy: PreemptLowerPriority
---
apiVersion: v1
kind: Pod
spec:
  priorityClassName: high-priority
```

## Quick Troubleshooting Checklist

```bash
# 1. Get exact failure reason
kubectl describe pod <pod> | grep -A 10 "Events"

# 2. Check resource availability
kubectl describe nodes | grep -A 6 "Allocated resources"

# 3. Check for taints
kubectl get nodes -o custom-columns=NAME:.metadata.name,TAINTS:.spec.taints

# 4. Check node labels for nodeSelector/affinity
kubectl get nodes --show-labels

# 5. Check PVCs if using storage
kubectl get pvc

# 6. Check PDBs if upgrading/draining
kubectl get pdb -A
```

## Summary

Pending pods result from scheduling constraints not being met. Check resource availability first, then verify node selectors, affinity rules, taints/tolerations, and topology constraints. Use `kubectl describe pod` to see the exact scheduling failure reason.
