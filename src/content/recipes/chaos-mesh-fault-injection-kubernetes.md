---
title: "Chaos Mesh Fault Injection on Kubernetes"
description: "Deploy Chaos Mesh for chaos engineering on Kubernetes. Covers PodChaos, NetworkChaos, IOChaos, StressChaos experiments, scheduling, RBAC scoping, and integrating chaos tests into CI/CD pipelines."
tags:
  - "chaos-engineering"
  - "chaos-mesh"
  - "fault-injection"
  - "resilience"
  - "testing"
category: "troubleshooting"
publishDate: "2026-05-09"
author: "Luca Berton"
difficulty: "intermediate"
relatedRecipes:
  - "litmus-chaos-engineering-kubernetes"
  - "kubernetes-pod-disruption-budget"
  - "network-policy-debug-connectivity"
  - "kubernetes-oomkilled-fix"
---

> 💡 **Quick Answer:** Chaos Mesh is a CNCF incubating project that injects faults into Kubernetes workloads — Pod kills, network delays, disk I/O errors, CPU/memory stress — via CRDs. Install with Helm, define experiments as YAML, scope with namespace selectors, and integrate into CI/CD for automated resilience testing.

## The Problem

You can't know if your application is resilient until something breaks:

- What happens when a Pod is killed mid-request?
- How does your app behave with 200ms network latency?
- Does your database failover work when the primary Pod dies?
- Will your HPA react fast enough under CPU stress?
- Testing these manually is slow, inconsistent, and scary in production

## The Solution

### Install Chaos Mesh

```bash
# Add Helm repo
helm repo add chaos-mesh https://charts.chaos-mesh.org
helm repo update

# Install (with dashboard)
helm install chaos-mesh chaos-mesh/chaos-mesh \
  --namespace chaos-mesh \
  --create-namespace \
  --set chaosDaemon.runtime=containerd \
  --set chaosDaemon.socketPath=/run/containerd/containerd.sock \
  --set dashboard.create=true \
  --set dashboard.securityMode=true

# Verify
kubectl get pods -n chaos-mesh
# NAME                                  READY   STATUS
# chaos-controller-manager-xxx          1/1     Running
# chaos-daemon-xxxxx                    1/1     Running  (DaemonSet)
# chaos-dashboard-xxx                   1/1     Running
```

### PodChaos: Kill Pods

```yaml
# Kill random Pods to test self-healing
apiVersion: chaos-mesh.org/v1alpha1
kind: PodChaos
metadata:
  name: pod-kill-test
  namespace: chaos-mesh
spec:
  action: pod-kill
  mode: one                    # Kill one random matching Pod
  selector:
    namespaces:
      - production
    labelSelectors:
      app: my-api
  # Schedule: every 10 minutes during business hours
  scheduler:
    cron: "*/10 9-17 * * 1-5"
---
# Pod failure (container exit 137) instead of delete
apiVersion: chaos-mesh.org/v1alpha1
kind: PodChaos
metadata:
  name: pod-failure-test
  namespace: chaos-mesh
spec:
  action: pod-failure
  mode: fixed-percent
  value: "30"                  # Kill 30% of matching Pods
  duration: "60s"              # Pods stay failed for 60s
  selector:
    namespaces:
      - production
    labelSelectors:
      app: my-api
```

### NetworkChaos: Latency, Loss, Partition

```yaml
# Add 200ms latency to all traffic
apiVersion: chaos-mesh.org/v1alpha1
kind: NetworkChaos
metadata:
  name: network-delay-test
  namespace: chaos-mesh
spec:
  action: delay
  mode: all
  selector:
    namespaces:
      - production
    labelSelectors:
      app: my-api
  delay:
    latency: "200ms"
    correlation: "50"          # 50% correlation between packets
    jitter: "50ms"             # ±50ms variation
  direction: to               # Only outgoing traffic
  target:
    selector:
      namespaces:
        - production
      labelSelectors:
        app: my-database       # Delay only traffic TO database
    mode: all
  duration: "5m"
---
# Network partition between frontend and backend
apiVersion: chaos-mesh.org/v1alpha1
kind: NetworkChaos
metadata:
  name: network-partition-test
  namespace: chaos-mesh
spec:
  action: partition
  mode: all
  selector:
    namespaces:
      - production
    labelSelectors:
      tier: frontend
  direction: both
  target:
    selector:
      namespaces:
        - production
      labelSelectors:
        tier: backend
    mode: all
  duration: "2m"
---
# 10% packet loss
apiVersion: chaos-mesh.org/v1alpha1
kind: NetworkChaos
metadata:
  name: packet-loss-test
  namespace: chaos-mesh
spec:
  action: loss
  mode: all
  selector:
    namespaces:
      - production
    labelSelectors:
      app: my-api
  loss:
    loss: "10"
    correlation: "25"
  duration: "5m"
```

### StressChaos: CPU and Memory Pressure

```yaml
# CPU stress — test HPA reaction time
apiVersion: chaos-mesh.org/v1alpha1
kind: StressChaos
metadata:
  name: cpu-stress-test
  namespace: chaos-mesh
spec:
  mode: one
  selector:
    namespaces:
      - production
    labelSelectors:
      app: my-api
  stressors:
    cpu:
      workers: 4               # 4 CPU-burning threads
      load: 80                  # Target 80% CPU usage
  duration: "10m"
---
# Memory stress — test OOMKill recovery
apiVersion: chaos-mesh.org/v1alpha1
kind: StressChaos
metadata:
  name: memory-stress-test
  namespace: chaos-mesh
spec:
  mode: one
  selector:
    namespaces:
      - production
    labelSelectors:
      app: my-api
  stressors:
    memory:
      workers: 2
      size: "512MB"             # Allocate 512MB
  duration: "5m"
```

### IOChaos: Disk Faults

```yaml
# Inject I/O latency on filesystem operations
apiVersion: chaos-mesh.org/v1alpha1
kind: IOChaos
metadata:
  name: io-latency-test
  namespace: chaos-mesh
spec:
  action: latency
  mode: one
  selector:
    namespaces:
      - production
    labelSelectors:
      app: my-database
  volumePath: /var/lib/postgresql/data
  path: "**/*"
  delay: "100ms"
  percent: 50                  # 50% of I/O operations affected
  duration: "5m"
---
# I/O errors (simulate disk failure)
apiVersion: chaos-mesh.org/v1alpha1
kind: IOChaos
metadata:
  name: io-error-test
  namespace: chaos-mesh
spec:
  action: fault
  mode: one
  selector:
    namespaces:
      - production
    labelSelectors:
      app: my-database
  volumePath: /var/lib/postgresql/data
  path: "**/*.dat"
  errno: 5                     # EIO — Input/output error
  percent: 10                  # 10% of operations fail
  duration: "2m"
```

### Workflow: Multi-Step Chaos Scenarios

```yaml
# Sequential chaos: network delay → pod kill → verify recovery
apiVersion: chaos-mesh.org/v1alpha1
kind: Workflow
metadata:
  name: resilience-workflow
  namespace: chaos-mesh
spec:
  entry: resilience-test
  templates:
    - name: resilience-test
      templateType: Serial
      children:
        - network-degradation
        - pod-kill-primary
        - verify-recovery
    - name: network-degradation
      templateType: NetworkChaos
      deadline: "5m"
      networkChaos:
        action: delay
        mode: all
        selector:
          namespaces: [production]
          labelSelectors: {app: my-api}
        delay:
          latency: "100ms"
    - name: pod-kill-primary
      templateType: PodChaos
      deadline: "30s"
      podChaos:
        action: pod-kill
        mode: one
        selector:
          namespaces: [production]
          labelSelectors: {app: my-database, role: primary}
    - name: verify-recovery
      templateType: Suspend
      deadline: "2m"           # Wait for recovery, check manually or via webhook
```

### RBAC: Scope Chaos to Namespaces

```yaml
# Prevent chaos experiments from targeting system namespaces
apiVersion: rbac.authorization.k8s.io/v1
kind: Role
metadata:
  name: chaos-runner
  namespace: staging
rules:
  - apiGroups: ["chaos-mesh.org"]
    resources: ["*"]
    verbs: ["create", "delete", "get", "list", "watch"]
---
# Chaos Mesh namespace annotation — protect critical namespaces
# Add to namespaces that should NEVER be targeted:
kubectl annotate namespace kube-system \
  chaos-mesh.org/inject=disabled
kubectl annotate namespace chaos-mesh \
  chaos-mesh.org/inject=disabled
```

## Common Issues

### Chaos experiment stuck in "Running" after duration
- **Cause**: chaos-daemon on target node crashed or restarted
- **Fix**: Delete the experiment; check chaos-daemon Pod logs

### IOChaos not working
- **Cause**: Container filesystem not using the expected mount path
- **Fix**: Check `volumePath` matches actual mount inside container

### NetworkChaos affects all Pods, not just target
- **Cause**: Selector too broad; missing `target` field
- **Fix**: Use `target.selector` to scope the other end of the partition

## Best Practices

1. **Start in staging** — never run untested experiments in production
2. **Set duration always** — experiments without duration run forever
3. **Protect system namespaces** — annotate with `chaos-mesh.org/inject=disabled`
4. **Use Workflows** for multi-step scenarios — serial or parallel
5. **Monitor during chaos** — watch Prometheus/Grafana for SLO violations
6. **Integrate in CI/CD** — run chaos tests before promoting to production
7. **Start small** — one Pod, short duration, then expand

## Key Takeaways

- Chaos Mesh injects faults via CRDs: PodChaos, NetworkChaos, IOChaos, StressChaos
- Every experiment needs `selector` (what to target) and `duration` (how long)
- `mode`: one, all, fixed, fixed-percent, random-max-percent
- NetworkChaos supports delay, loss, partition, duplicate, corrupt
- Workflows chain multiple experiments into resilience test suites
- Protect namespaces with `chaos-mesh.org/inject=disabled` annotation
- Dashboard provides visual experiment management and status
