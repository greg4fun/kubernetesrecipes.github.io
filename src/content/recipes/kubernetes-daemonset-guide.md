---
title: "Kubernetes DaemonSet: One Pod Per Node Guide"
description: "Kubernetes DaemonSet: run one pod on every node (or a subset). Log collectors, node-exporter, GPU nodes, control-plane tolerations, maxSurge updates."
publishDate: "2026-05-02"
author: "Luca Berton"
category: "deployments"
difficulty: "beginner"
timeToComplete: "10 minutes"
kubernetesVersion: "1.28+"
tags:
  - "daemonset"
  - "deployments"
  - "per-node"
  - "monitoring"
  - "logging"
  - "cka"
relatedRecipes:
  - "kubernetes-daemonset-update-strategies"
  - "kubernetes-taint-toleration-guide"
  - "kubernetes-efk-logging-stack"
  - "kubernetes-prometheus-monitoring-guide"
  - "pod-topology-constraints"
  - "service-accounts-rbac"
  - "kubernetes-headless-service"
---

> 💡 **Quick Answer:** A DaemonSet ensures one pod runs on every node (or a subset). Define like a Deployment but with `kind: DaemonSet` and no `replicas`. Common uses: log collectors (Fluentd/Fluent Bit), monitoring agents (node-exporter, DCGM), CNI plugins (Calico, Cilium), and storage daemons (CSI node plugins). Use `nodeSelector` or tolerations to target specific nodes.

## The Problem

Some workloads must run on every node:

- Log collection — every node generates logs
- Metrics — node-level CPU/memory/disk monitoring
- Networking — CNI plugins, kube-proxy
- Security — runtime scanning, audit logging
- Storage — CSI node drivers, local volume provisioner

Deployments can't guarantee one-per-node placement, and they don't follow node count as the cluster scales.

| Use case | Examples |
|----------|----------|
| Monitoring | Prometheus node-exporter, NVIDIA DCGM exporter, Datadog agent |
| Logging | Fluent Bit, Fluentd, Vector, Filebeat |
| Networking | Calico, Cilium, kube-proxy, OVN-Kubernetes |
| Storage | CSI node plugins, Longhorn, local-path provisioners |
| Security | Falco, Tetragon, runtime scanners |
| Hardware | NVIDIA device plugin / GPU Operator components |

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
      tolerations:
      - operator: Exists    # Run on ALL nodes including tainted
```

On containerd/CRI-O nodes (every current distro, OpenShift included) container logs live under `/var/log/pods` and `/var/log/containers`, so mounting `/var/log` is enough. `/var/lib/docker/containers` only exists on legacy dockershim nodes.

The DaemonSet controller automatically adds tolerations for `node.kubernetes.io/not-ready`, `unreachable` (NoExecute), `disk-pressure`, `memory-pressure`, `pid-pressure` and `unschedulable`, so agents keep running on cordoned or unhealthy nodes. `kubectl drain` needs `--ignore-daemonsets` for the same reason.

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

### Run on Every Node Including Control Plane

By default, control-plane (master) nodes are tainted, so a DaemonSet skips them. To run one pod on **every** node — control plane included — tolerate the control-plane taints:

```yaml
spec:
  template:
    spec:
      tolerations:
        # Run on control-plane / master nodes too
        - key: node-role.kubernetes.io/control-plane
          effect: NoSchedule
        - key: node-role.kubernetes.io/master
          effect: NoSchedule
      containers:
        - name: fluentd
          image: fluent/fluentd:v1.16
```

> To tolerate **all** taints (truly one pod per node, no exceptions), use a single blanket toleration: `tolerations: [{operator: "Exists"}]`.

### Update Strategy

```yaml
spec:
  updateStrategy:
    type: RollingUpdate        # Default
    rollingUpdate:
      maxUnavailable: 1        # Update 1 node at a time
      maxSurge: 0              # >0 starts the new pod before killing the old one (GA 1.25)
  
  # Or OnDelete — manual control
  # updateStrategy:
  #   type: OnDelete
  # Pods only update when manually deleted
```

`maxSurge` and `maxUnavailable` can't both be 0. Surge (`maxSurge: 1, maxUnavailable: 0`) avoids a per-node gap in log/metric collection but fails for pods using `hostPort` or `hostNetwork` ports, since old and new pods would bind the same port on the node. See [DaemonSet update strategies](/recipes/deployments/kubernetes-daemonset-update-strategies/).

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

A Deployment with pod anti-affinity only approximates this: it doesn't grow with new nodes and leaves pods Pending when replicas exceed nodes.

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

## Frequently Asked Questions

### How do I make Kubernetes run one pod per node?

Use a DaemonSet. Kubernetes automatically schedules exactly one copy of the pod on each node that matches the DaemonSet's `nodeSelector`/tolerations — and adds or removes pods as nodes join or leave. You do not set `replicas`; the node count determines the pod count.

### What is the Kubernetes object that runs a copy of a pod on every node?

The **DaemonSet** (`apps/v1`). A DaemonSet ensures all (or a selected subset of) nodes run a copy of a pod. This is the official mechanism for node-level agents such as log collectors, monitoring exporters, CNI plugins, and CSI storage drivers.

### Does a DaemonSet run on every node including control-plane nodes?

Not by default — control-plane nodes are tainted, so DaemonSet pods skip them. Add tolerations for `node-role.kubernetes.io/control-plane` (and the legacy `master` key), or use `tolerations: [{operator: "Exists"}]` to run on every node with no exceptions.

### How do I run a DaemonSet on only some nodes?

Add a `nodeSelector` (e.g. `nvidia.com/gpu.present: "true"`) or `nodeAffinity` to the pod template. The DaemonSet then places one pod only on nodes matching those rules — useful for GPU device plugins or storage daemons that belong on specific hardware.

### DaemonSet or Deployment with pod anti-affinity?

Use a DaemonSet for anything that must exist once per node. Deployment + anti-affinity needs a manually maintained replica count, doesn't place pods on new nodes automatically, and leaves extra replicas Pending.

### Why does DESIRED show fewer pods than my node count?

A `nodeSelector`, affinity rule, or missing toleration is excluding nodes. Run `kubectl describe daemonset <name>` to see why pods aren't scheduled, and confirm the DaemonSet tolerates any taints on the missing nodes.

## Key Takeaways

- DaemonSets run exactly one pod per node (or subset with nodeSelector)
- Automatically adds/removes pods as nodes join/leave the cluster
- Essential for logging, monitoring, networking, and storage agents
- Use tolerations to ensure DaemonSets run on tainted nodes
- Rolling update strategy updates one node at a time for safety
