---
title: "K8s DaemonSet: Run Pod on Every Node"
description: "Deploy Kubernetes DaemonSets to run one pod per node. Log collectors, monitoring agents, node-level networking, tolerations, and update strategies."
publishDate: "2026-05-02"
author: "Luca Berton"
category: "deployments"
difficulty: "beginner"
timeToComplete: "10 minutes"
kubernetesVersion: "1.28+"
tags:
  - "daemonset"
  - "deployments"
  - "monitoring"
  - "logging"
  - "cka"
relatedRecipes:
  - "kubernetes-taints-tolerations-guide"
  - "kubernetes-efk-logging-stack"
  - "prometheus-monitoring-kubernetes-guide"
  - "kubernetes-topology-spread-constraints"
---

> 💡 **Quick Answer:** A DaemonSet ensures one pod runs on every node (or a subset). Define like a Deployment but with `kind: DaemonSet` and no `replicas`. Common uses: log collectors (Fluentd/Fluent Bit), monitoring agents (node-exporter, DCGM), CNI plugins (Calico, Cilium), and storage daemons (CSI node plugins). Use `nodeSelector` or tolerations to target specific nodes.

## The Problem

Some workloads must run on every node:

- Log collection — every node generates logs
- Metrics — node-level CPU/memory/disk monitoring
- Networking — CNI plugins, kube-proxy
- Security — runtime scanning, audit logging
- Storage — CSI node drivers, local volume provisioner

Deployments can't guarantee one-per-node placement.

## The Solution

### Basic DaemonSet

```yaml
apiVersion: apps/v1
kind: DaemonSet
metadata:
  name: fluent-bit
  namespace: logging
spec:
  selector:
    matchLabels:
      app: fluent-bit
  template:
    metadata:
      labels:
        app: fluent-bit
    spec:
      containers:
      - name: fluent-bit
        image: fluent/fluent-bit:3.0
        volumeMounts:
        - name: varlog
          mountPath: /var/log
          readOnly: true
        - name: containers
          mountPath: /var/lib/docker/containers
          readOnly: true
        resources:
          requests:
            cpu: 50m
            memory: 64Mi
          limits:
            cpu: 200m
            memory: 128Mi
      volumes:
      - name: varlog
        hostPath:
          path: /var/log
      - name: containers
        hostPath:
          path: /var/lib/docker/containers
      tolerations:
      - operator: Exists    # Run on ALL nodes including tainted
```

### Target Specific Nodes

```yaml
spec:
  template:
    spec:
      # Only GPU nodes
      nodeSelector:
        nvidia.com/gpu.present: "true"
      
      # Or use affinity
      affinity:
        nodeAffinity:
          requiredDuringSchedulingIgnoredDuringExecution:
            nodeSelectorTerms:
            - matchExpressions:
              - key: node-role
                operator: In
                values: ["worker", "gpu"]
```

### Update Strategy

```yaml
spec:
  updateStrategy:
    type: RollingUpdate        # Default
    rollingUpdate:
      maxUnavailable: 1        # Update 1 node at a time
      maxSurge: 0              # No extra pods (K8s 1.22+)
  
  # Or OnDelete — manual control
  # updateStrategy:
  #   type: OnDelete
  # Pods only update when manually deleted
```

### Common DaemonSet Patterns

```yaml
# Node Exporter (Prometheus monitoring)
apiVersion: apps/v1
kind: DaemonSet
metadata:
  name: node-exporter
  namespace: monitoring
spec:
  selector:
    matchLabels:
      app: node-exporter
  template:
    metadata:
      labels:
        app: node-exporter
    spec:
      hostNetwork: true        # Access host network metrics
      hostPID: true            # Access host processes
      containers:
      - name: node-exporter
        image: prom/node-exporter:v1.8.0
        ports:
        - containerPort: 9100
          hostPort: 9100
        args:
        - --path.procfs=/host/proc
        - --path.sysfs=/host/sys
        - --path.rootfs=/host/root
        volumeMounts:
        - name: proc
          mountPath: /host/proc
          readOnly: true
        - name: sys
          mountPath: /host/sys
          readOnly: true
        - name: root
          mountPath: /host/root
          readOnly: true
      volumes:
      - name: proc
        hostPath:
          path: /proc
      - name: sys
        hostPath:
          path: /sys
      - name: root
        hostPath:
          path: /
      tolerations:
      - operator: Exists
```

### DaemonSet vs Deployment

| Feature | DaemonSet | Deployment |
|---------|-----------|-----------|
| Replicas | 1 per node (automatic) | Fixed count |
| Scaling | Follows node count | Manual or HPA |
| Scheduling | Guaranteed per-node | Best-effort placement |
| Update | Rolling per-node | Rolling per-replica |
| Use case | Node agents | Application workloads |

### Manage DaemonSets

```bash
# Check DaemonSet status
kubectl get daemonset -n logging
# NAME        DESIRED   CURRENT   READY   UP-TO-DATE   AVAILABLE
# fluent-bit  5         5         5       5            5

# Rollout status
kubectl rollout status daemonset/fluent-bit -n logging

# Rollback
kubectl rollout undo daemonset/fluent-bit -n logging

# Restart all pods
kubectl rollout restart daemonset/fluent-bit -n logging
```

## Common Issues

**DaemonSet pod not running on a node**

Node is tainted and DaemonSet doesn't have matching toleration. Add `tolerations: [{operator: "Exists"}]` to run on all nodes.

**DESIRED shows fewer than total nodes**

nodeSelector or affinity restricts which nodes get pods. Check: `kubectl describe daemonset <name>`.

**DaemonSet using too much node resources**

Set resource `requests` and `limits`. Use `PriorityClass` to ensure DaemonSet pods aren't evicted before application pods.

## Best Practices

- **Always set resource requests/limits** — DaemonSets run on every node, waste adds up
- **Use `tolerations: [{operator: "Exists"}]`** for system DaemonSets — must run everywhere
- **RollingUpdate with `maxUnavailable: 1`** — safe default for production
- **Use `hostPath` volumes sparingly** — security risk, prefer CSI drivers
- **Set `priorityClassName: system-node-critical`** for essential DaemonSets

## Key Takeaways

- DaemonSets run exactly one pod per node (or subset with nodeSelector)
- Automatically adds/removes pods as nodes join/leave the cluster
- Essential for logging, monitoring, networking, and storage agents
- Use tolerations to ensure DaemonSets run on tainted nodes
- Rolling update strategy updates one node at a time for safety
