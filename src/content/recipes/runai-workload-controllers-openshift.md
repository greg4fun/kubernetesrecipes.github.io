---
title: "Run:ai Workload Controllers on OpenShift"
description: "Understand Run:ai cluster-level workload controllers on OpenShift including workload-controller, workload-overseer, workload-exporter, status-updater, and shared-objects-controller."
tags:
  - "runai"
  - "openshift"
  - "controllers"
  - "scheduling"
  - "gpu"
category: "ai"
publishDate: "2026-05-05"
author: "Luca Berton"
difficulty: "advanced"
relatedRecipes:
  - "runai-backend-architecture-openshift"
  - "runai-distributed-training-openshift"
  - "runai-observability-opentelemetry-openshift"
  - "openshift-gpu-node-resource-planning"
---

> 💡 **Quick Answer:** Run:ai deploys 5 cluster-level controllers in the `runai` namespace that manage GPU workload lifecycle: scheduling, status tracking, metrics export, and shared resource coordination. These run on infra nodes alongside per-node DaemonSets (node-exporter, runtime-installer, container-toolkit).

## The Problem

When GPU workloads don't schedule, metrics are missing, or job status is stale, you need to know which Run:ai controller to investigate.

## The Solution

### Cluster-Level Controllers

```bash
oc get pods -n runai

# NAME                                      READY   STATUS    AGE
# shared-objects-controller-<hash>          1/1     Running   23h
# status-updater-<hash>                     1/1     Running   0
# workload-controller-<hash>                1/1     Running   0
# workload-exporter-<hash>                  1/1     Running   2 (23h)
# workload-overseer-<hash>                  1/1     Running   0
```

### Controller Responsibilities

| Controller | Purpose | Failure Impact |
|-----------|---------|----------------|
| `workload-controller` | Reconciles Run:ai workloads → K8s Pods/Jobs | Jobs won't start/stop |
| `workload-overseer` | Monitors workload health, enforces policies | No preemption, no fairness |
| `workload-exporter` | Exports workload metrics to Prometheus | Missing dashboard data |
| `status-updater` | Syncs workload status to Run:ai backend | UI shows stale status |
| `shared-objects-controller` | Manages shared ConfigMaps, Secrets, PVCs | Shared resources unavailable |

### Per-Node DaemonSets

```bash
# These run on every GPU node
oc get ds -n runai

# NAME                       DESIRED   CURRENT   READY
# runai-node-exporter        8         8         8      # GPU metrics
# runai-runtime-installer    8         8         8      # Container runtime hooks
# runai-container-toolkit    8         8         8      # GPU toolkit injection
```

### Workload Controller Deep Dive

```text
workload-controller watches:
├── RunaiJob CRD           → Creates K8s Jobs/Pods
├── RunaiTrainingWorkload  → Multi-node training setup
├── RunaiInferenceWorkload → Deployment with GPU scheduling
└── RunaiInteractiveWorkload → Notebook/IDE Pods

Reconciliation loop:
1. User submits workload via UI/CLI
2. Run:ai backend creates CRD in cluster
3. workload-controller detects new CRD
4. Creates K8s resources (Pod, Service, PVC)
5. GPU scheduler places Pod on best node
6. status-updater reports back to backend
```

### Workload Exporter Metrics

```text
# Metrics exported by workload-exporter:
runai_workload_status          — Current state (pending/running/completed/failed)
runai_workload_gpu_allocation  — GPUs allocated per workload
runai_workload_runtime_seconds — Total runtime
runai_workload_queue_time      — Time spent waiting for resources
runai_workload_preemptions     — Number of preemptions
```

### Troubleshooting Controllers

```bash
# Check controller logs
oc logs -n runai deploy/workload-controller --tail=50
oc logs -n runai deploy/workload-overseer --tail=50
oc logs -n runai deploy/status-updater --tail=50

# Check if controllers are leader-elected
oc get lease -n runai

# Restart a specific controller
oc rollout restart deploy/workload-controller -n runai

# Check workload CRDs
oc get runaiworkloads -A
oc get runaijobs -A
```

### Workload Exporter Restart Count

```text
# workload-exporter shows "2 (23h)" restarts
# This means 2 restarts over 23 hours — likely:
# - One OOMKill during metric spike
# - One restart during node maintenance

# Check restart reason:
oc get pod -n runai -l app=workload-exporter -o jsonpath='{.items[0].status.containerStatuses[0].lastState}'
```

### Integration with Run:ai Backend

```text
runai namespace (cluster agents)          runai-backend namespace (control plane)
┌─────────────────────────────┐          ┌─────────────────────────────────┐
│ workload-controller         │──NATS──▶│ cluster-service                  │
│ status-updater              │──NATS──▶│ workloads-service                │
│ workload-exporter           │──Prom──▶│ metrics-service → thanos-receive │
│ workload-overseer           │──NATS──▶│ policy-service                   │
│ shared-objects-controller   │         │                                   │
└─────────────────────────────┘          └─────────────────────────────────┘
         │                                           │
         ▼                                           ▼
    GPU Nodes (DaemonSets)                     PostgreSQL + NATS
    - node-exporter                            (persistent state)
    - runtime-installer
    - container-toolkit
```

## Common Issues

### Workloads stuck in "Pending" forever
- **Cause**: `workload-controller` can't create Pods (RBAC, quota, or crash)
- **Fix**: Check controller logs; verify ClusterRole bindings

### Dashboard shows "Unknown" status
- **Cause**: `status-updater` can't reach Run:ai backend (NATS down)
- **Fix**: Check NATS cluster health; verify network policies

### GPU metrics missing from Grafana
- **Cause**: `workload-exporter` crashing or node-exporter DaemonSet not ready
- **Fix**: Check exporter Pod restarts; verify ServiceMonitor exists

### Preemption not working
- **Cause**: `workload-overseer` not running or policy-service unreachable
- **Fix**: Check overseer logs; verify NATS connectivity to backend

## Best Practices

1. **Monitor controller restarts** — more than 5/day indicates resource issues
2. **Check NATS connectivity** — all controllers depend on NATS for backend comms
3. **DaemonSets must be 100% ready** — missing node-exporter = missing GPU metrics
4. **Don't scale controllers** — they use leader election (only 1 active)
5. **Log level info is sufficient** — debug level causes excessive NATS traffic

## Key Takeaways

- 5 controllers in `runai` namespace manage the full workload lifecycle
- Communication to backend is via NATS (events, status) and Prometheus (metrics)
- Per-node DaemonSets (node-exporter, runtime-installer, container-toolkit) run on every GPU node
- `workload-controller` is the most critical — without it, no Pods get created
- Restart counts of 1-2 over 23h are normal; 100+ indicates OOM or crash loop
- All controllers are stateless — restart fixes most transient issues
