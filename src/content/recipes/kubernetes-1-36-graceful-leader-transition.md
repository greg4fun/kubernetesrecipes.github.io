---
title: "Kubernetes 1.36 Graceful Leader Transition"
description: "Configure graceful leader transitions in Kubernetes 1.36 control plane components. Eliminate brief outages during leader election failovers."
tags:
  - "kubernetes-1.36"
  - "high-availability"
  - "control-plane"
  - "leader-election"
  - "operations"
category: "configuration"
publishDate: "2026-05-03"
author: "Luca Berton"
difficulty: "advanced"
relatedRecipes:
  - "etcd-backup-restore-kubernetes"
  - "kubernetes-kubeadm-upgrade-guide"
  - "kubernetes-1-36-external-sa-token-signing"
---

> 💡 **Quick Answer:** Kubernetes 1.36 introduces **Graceful Leader Transition** (KEP-5366). When a control plane component steps down as leader (e.g., during rolling upgrade), it gracefully hands off leadership instead of forcing a timeout-based failover — reducing control plane gaps from 15+ seconds to near-zero.

## The Problem

In HA Kubernetes clusters, control plane components (controller-manager, scheduler) use leader election. When the leader Pod restarts:

1. Leader stops and releases the lease
2. **15-second lease timeout** before other replicas detect the vacancy
3. New leader acquires the lease and starts processing
4. During this gap: no new deployments reconciled, no Pods scheduled, no scaling actions

This 15-30 second gap happens during **every rolling upgrade** of the control plane.

## The Solution

Graceful leader transition lets the outgoing leader notify a candidate directly, enabling instant handoff.

### Enable Graceful Leader Transition

```yaml
# kube-controller-manager configuration
apiVersion: kubecontrollermanager.config.k8s.io/v1alpha1
kind: KubeControllerManagerConfiguration
leaderElection:
  leaderElect: true
  leaseDuration: 15s
  renewDeadline: 10s
  retryPeriod: 2s
  gracefulTransition: true    # NEW in 1.36
```

### API Server Flag Configuration

```bash
# Controller Manager
kube-controller-manager \
  --leader-elect=true \
  --leader-elect-graceful-transition=true \
  --feature-gates=GracefulLeaderTransition=true

# Scheduler
kube-scheduler \
  --leader-elect=true \
  --leader-elect-graceful-transition=true \
  --feature-gates=GracefulLeaderTransition=true
```

### kubeadm Configuration

```yaml
apiVersion: kubeadm.k8s.io/v1beta4
kind: ClusterConfiguration
controllerManager:
  extraArgs:
    - name: leader-elect-graceful-transition
      value: "true"
    - name: feature-gates
      value: "GracefulLeaderTransition=true"
scheduler:
  extraArgs:
    - name: leader-elect-graceful-transition
      value: "true"
    - name: feature-gates
      value: "GracefulLeaderTransition=true"
```

### How It Works

```
Traditional failover:
  Leader A stops → 15s timeout → Leader B detects → B acquires lease → B starts
  Gap: ~15-20 seconds

Graceful transition:
  Leader A signals "stepping down" → Leader B immediately acquires → B starts
  Gap: ~0.5 seconds
```

### Monitor Leader Transitions

```bash
# Watch lease objects
kubectl get lease -n kube-system -w

# Check controller-manager leader
kubectl get lease kube-controller-manager -n kube-system \
  -o jsonpath='{.spec.holderIdentity}'

# Check scheduler leader
kubectl get lease kube-scheduler -n kube-system \
  -o jsonpath='{.spec.holderIdentity}'

# View transition events
kubectl get events -n kube-system --field-selector reason=LeaderTransition
```

### Verify During Rolling Upgrade

```bash
# Start a watcher before upgrading
kubectl get events -n kube-system -w --field-selector reason=LeaderElection &

# Perform rolling upgrade
kubeadm upgrade apply v1.36.0

# Observe near-instant leader transitions instead of 15s gaps
```

## Common Issues

### Transition not working — still seeing 15s gaps
- **Cause**: Feature gate not enabled on all control plane replicas
- **Fix**: Enable `GracefulLeaderTransition` on ALL replicas, not just one

### Leader election conflicts during mixed-version upgrade
- **Cause**: Old replicas don't understand graceful transition signals
- **Fix**: Upgrade all control plane replicas before relying on graceful transition

## Best Practices

1. **Enable on all replicas** — graceful transition requires both outgoing and incoming leaders to support it
2. **Upgrade control plane components together** — mixed versions fall back to timeout-based election
3. **Monitor lease transitions** — verify gap reduction with metrics
4. **Keep lease timeouts as safety net** — graceful transition is best-effort; timeouts are the fallback
5. **Test during maintenance windows** — verify behavior before relying on it in production

## Key Takeaways

- Graceful Leader Transition is available in **Kubernetes 1.36** (KEP-5366)
- Reduces control plane failover gaps from **15+ seconds to sub-second**
- Applies to controller-manager and scheduler leader election
- Critical for rolling upgrades in production HA clusters
- Falls back to timeout-based election if the feature isn't enabled on both sides
