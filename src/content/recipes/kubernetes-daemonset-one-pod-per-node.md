---
title: "Kubernetes DaemonSet One Pod Per Node Guide"
description: "Deploy DaemonSets on Kubernetes to run exactly one pod per node. Configure tolerations, node selectors, affinity rules, and resource management"
tags:
  - "daemonset"
  - "scheduling"
  - "node-management"
  - "system-workloads"
category: "deployments"
publishDate: "2026-06-01"
author: "Luca Berton"
difficulty: "beginner"
relatedRecipes:
  - "kubernetes-node-affinity-scheduling"
  - "kubernetes-taint-toleration"
---

> 💡 **Quick Answer:** A DaemonSet ensures exactly one pod runs on every (or selected) node in the cluster. Kubernetes automatically schedules a pod on each node that matches the DaemonSet's node selector and tolerations. Use DaemonSets for node-level agents: log collectors, monitoring exporters, network plugins, storage drivers, and GPU device plugins.

## The Problem

- Need exactly one instance of a workload per node (not per replica count)
- System agents must run on every node including new nodes added later
- Some agents must run on control-plane nodes despite taints
- Pod must automatically appear on new nodes without manual intervention
- Different nodes may need different DaemonSet configurations

## The Solution

### Basic DaemonSet (Every Node)

```yaml
apiVersion: apps/v1
kind: DaemonSet
metadata:
  name: node-exporter
  namespace: monitoring
  labels:
    app: node-exporter
spec:
  selector:
    matchLabels:
      app: node-exporter
  template:
    metadata:
      labels:
        app: node-exporter
    spec:
      containers:
        - name: node-exporter
          image: prom/node-exporter:v1.7.0
          ports:
            - containerPort: 9100
              hostPort: 9100
              name: metrics
          resources:
            requests:
              cpu: "50m"
              memory: "64Mi"
            limits:
              cpu: "200m"
              memory: "128Mi"
          volumeMounts:
            - name: proc
              mountPath: /host/proc
              readOnly: true
            - name: sys
              mountPath: /host/sys
              readOnly: true
      hostNetwork: true
      hostPID: true
      volumes:
        - name: proc
          hostPath:
            path: /proc
        - name: sys
          hostPath:
            path: /sys
```

### Run on All Nodes Including Control Plane

```yaml
apiVersion: apps/v1
kind: DaemonSet
metadata:
  name: fluentd
  namespace: logging
spec:
  selector:
    matchLabels:
      app: fluentd
  template:
    spec:
      # Tolerate control-plane taints
      tolerations:
        - key: node-role.kubernetes.io/control-plane
          effect: NoSchedule
        - key: node-role.kubernetes.io/master
          effect: NoSchedule
      containers:
        - name: fluentd
          image: fluent/fluentd:v1.16
```

### Run Only on Specific Nodes

```yaml
apiVersion: apps/v1
kind: DaemonSet
metadata:
  name: gpu-device-plugin
  namespace: kube-system
spec:
  selector:
    matchLabels:
      app: gpu-device-plugin
  template:
    spec:
      # Only schedule on GPU nodes
      nodeSelector:
        nvidia.com/gpu.present: "true"
      tolerations:
        - key: nvidia.com/gpu
          effect: NoSchedule
      containers:
        - name: device-plugin
          image: nvcr.io/nvidia/k8s-device-plugin:v0.15.0
```

### Update Strategy

```yaml
apiVersion: apps/v1
kind: DaemonSet
metadata:
  name: my-agent
spec:
  updateStrategy:
    type: RollingUpdate       # RollingUpdate (default) or OnDelete
    rollingUpdate:
      maxUnavailable: 1       # Max pods updated simultaneously
      maxSurge: 0             # 0 for DaemonSets (can't surge on fixed nodes)
  selector:
    matchLabels:
      app: my-agent
  template:
    spec:
      containers:
        - name: agent
          image: registry.example.com/agent:v2.0
```

### Check DaemonSet Status

```bash
# View DaemonSet rollout status
kubectl get daemonset -n monitoring
# NAME            DESIRED   CURRENT   READY   UP-TO-DATE   AVAILABLE   AGE
# node-exporter   5         5         5       5            5           30d

# DESIRED = nodes matching nodeSelector + tolerations
# CURRENT = pods created
# READY = pods passing readiness
# UP-TO-DATE = pods with latest template

# Check which nodes have/miss the DaemonSet pod
kubectl get pods -n monitoring -l app=node-exporter -o wide

# Rollout status
kubectl rollout status daemonset/node-exporter -n monitoring

# Rollback
kubectl rollout undo daemonset/node-exporter -n monitoring
```

## Common Issues

### DaemonSet pod not scheduled on a node
- **Cause**: Node has a taint the DaemonSet doesn't tolerate; or nodeSelector doesn't match
- **Fix**: Add tolerations for node taints; verify labels with `kubectl get nodes --show-labels`

### DESIRED count less than total nodes
- **Cause**: nodeSelector or affinity excludes some nodes
- **Fix**: Intentional if targeting subset; check `kubectl get nodes -l <selector>`

### DaemonSet pod evicted under memory pressure
- **Cause**: Pod has no `priorityClassName` set; evicted before system-critical pods
- **Fix**: Set `priorityClassName: system-node-critical` for essential DaemonSets

### Rolling update stuck
- **Cause**: New pod version failing readiness on one node; blocks rollout
- **Fix**: Check pod events on stuck node; fix or increase `maxUnavailable`

## Best Practices

1. **Set resource requests/limits** — DaemonSets compete with workloads on every node
2. **Use `system-node-critical` priority** — for essential agents (logging, networking)
3. **Tolerate control-plane taints** — unless intentionally excluding control plane
4. **Use `RollingUpdate` strategy** — controlled rollout, one node at a time
5. **Mount hostPath read-only** — DaemonSets often access `/proc`, `/sys`, `/var/log`
6. **Use node selectors for targeted DaemonSets** — GPU plugins only on GPU nodes

## Key Takeaways

- DaemonSets guarantee exactly one pod per matching node — automatic on new nodes
- Use tolerations to include tainted nodes (control-plane, GPU, dedicated)
- Use nodeSelector/affinity to target specific node subsets
- Common use cases: log collection, node monitoring, network plugins, device plugins, storage drivers
- Update strategies: `RollingUpdate` (default, one at a time) or `OnDelete` (manual)
- Set `priorityClassName: system-node-critical` for infrastructure DaemonSets
- `DESIRED` count reflects nodes matching selector + tolerations
