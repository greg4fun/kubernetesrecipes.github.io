---
title: "Kubernetes Lease API Leader Election Guide"
description: "Implement leader election with the Kubernetes Lease API (coordination.k8s.io). Configure lease-based election for controllers, operators, and distributed apps."
tags:
  - "leases"
  - "leader-election"
  - "coordination"
  - "high-availability"
  - "controllers"
category: "configuration"
publishDate: "2026-06-01"
author: "Luca Berton"
difficulty: "intermediate"
relatedRecipes:
  - "kubernetes-operator-sdk-guide"
---

> 💡 **Quick Answer:** Kubernetes Leases (`coordination.k8s.io/v1`) provide leader election by having candidates race to acquire/renew a Lease object. Only the holder (leader) performs work; others stand by. Use `client-go/tools/leaderelection` or controller-runtime's built-in leader election. The `kube-node-lease` namespace uses Leases for node heartbeats.

## The Problem

- Distributed applications need exactly one active instance (leader) to avoid duplicate work
- Traditional leader election requires external systems (ZooKeeper, etcd direct access, Consul)
- Kubernetes controllers must elect a leader when running multiple replicas for HA
- Node heartbeats need an efficient, low-overhead mechanism
- Stale leaders must be detected and replaced quickly

## The Solution

### What Is a Kubernetes Lease?

```yaml
apiVersion: coordination.k8s.io/v1
kind: Lease
metadata:
  name: my-controller-leader
  namespace: my-system
spec:
  holderIdentity: "pod-abc123"        # Current leader
  leaseDurationSeconds: 15            # How long lease is valid
  acquireTime: "2026-06-01T10:00:00Z" # When lease was acquired
  renewTime: "2026-06-01T10:00:10Z"   # Last renewal
  leaseTransitions: 3                 # Number of leader changes
```

```text
Lease uses in Kubernetes:
├── Leader election for controllers/operators
├── Node heartbeats (kube-node-lease namespace)
├── API server identity (kube-system, k8s 1.26+)
└── Custom distributed application coordination
```

### Leader Election with client-go

```go
package main

import (
    "context"
    "fmt"
    "os"
    "time"

    metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
    "k8s.io/client-go/kubernetes"
    "k8s.io/client-go/rest"
    "k8s.io/client-go/tools/leaderelection"
    "k8s.io/client-go/tools/leaderelection/resourcelock"
)

func main() {
    config, _ := rest.InClusterConfig()
    client, _ := kubernetes.NewForConfig(config)

    // Unique identity for this candidate (usually pod name)
    id := os.Getenv("POD_NAME")

    // Create lease-based lock
    lock := &resourcelock.LeaseLock{
        LeaseMeta: metav1.ObjectMeta{
            Name:      "my-controller-leader",
            Namespace: "my-system",
        },
        Client: client.CoordinationV1(),
        LockConfig: resourcelock.ResourceLockConfig{
            Identity: id,
        },
    }

    // Run leader election
    leaderelection.RunOrDie(context.Background(), leaderelection.LeaderElectionConfig{
        Lock:            lock,
        LeaseDuration:   15 * time.Second,  // How long lease is valid
        RenewDeadline:   10 * time.Second,  // Max time to renew
        RetryPeriod:     2 * time.Second,   // Time between retries
        Callbacks: leaderelection.LeaderCallbacks{
            OnStartedLeading: func(ctx context.Context) {
                // This pod is now the leader — start work
                fmt.Println("I am the leader!")
                runController(ctx)
            },
            OnStoppedLeading: func() {
                // Lost leadership — stop work, exit
                fmt.Println("Lost leadership, exiting")
                os.Exit(0)
            },
            OnNewLeader: func(identity string) {
                if identity == id {
                    return
                }
                fmt.Printf("New leader elected: %s\n", identity)
            },
        },
    })
}
```

### Leader Election with controller-runtime

```go
// Most operators use controller-runtime which has built-in leader election
import (
    ctrl "sigs.k8s.io/controller-runtime"
)

func main() {
    mgr, err := ctrl.NewManager(ctrl.GetConfigOrDie(), ctrl.Options{
        LeaderElection:          true,
        LeaderElectionID:        "my-operator-leader",
        LeaderElectionNamespace: "my-system",
        // Optional tuning:
        LeaseDuration: durationPtr(15 * time.Second),
        RenewDeadline: durationPtr(10 * time.Second),
        RetryPeriod:   durationPtr(2 * time.Second),
    })
    // Controllers only run on the leader pod
}
```

### Deployment with Leader Election

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: my-controller
  namespace: my-system
spec:
  replicas: 3    # Multiple replicas for HA
  selector:
    matchLabels:
      app: my-controller
  template:
    metadata:
      labels:
        app: my-controller
    spec:
      serviceAccountName: my-controller
      containers:
        - name: controller
          image: registry.example.com/my-controller:v1.0
          env:
            - name: POD_NAME
              valueFrom:
                fieldRef:
                  fieldPath: metadata.name
          args:
            - "--leader-elect=true"
            - "--leader-election-id=my-controller-leader"
            - "--leader-election-namespace=my-system"
---
apiVersion: rbac.authorization.k8s.io/v1
kind: Role
metadata:
  name: my-controller-leader-election
  namespace: my-system
rules:
  - apiGroups: ["coordination.k8s.io"]
    resources: ["leases"]
    verbs: ["get", "create", "update"]
  - apiGroups: [""]
    resources: ["events"]
    verbs: ["create", "patch"]
---
apiVersion: rbac.authorization.k8s.io/v1
kind: RoleBinding
metadata:
  name: my-controller-leader-election
  namespace: my-system
roleRef:
  apiGroup: rbac.authorization.k8s.io
  kind: Role
  name: my-controller-leader-election
subjects:
  - kind: ServiceAccount
    name: my-controller
    namespace: my-system
```

### Node Heartbeats via Lease (kube-node-lease)

```bash
# Every node maintains a Lease in kube-node-lease namespace
kubectl get leases -n kube-node-lease
# NAME          HOLDER        AGE
# worker-01     worker-01     30d
# worker-02     worker-02     30d
# control-01    control-01    30d

kubectl describe lease worker-01 -n kube-node-lease
# Spec:
#   Holder Identity:        worker-01
#   Lease Duration Seconds: 40
#   Renew Time:             2026-06-01T10:00:05Z
```

### Inspect Leader Election Status

```bash
# Check who holds the lease
kubectl get lease my-controller-leader -n my-system -o yaml

# Quick check current leader
kubectl get lease my-controller-leader -n my-system \
  -o jsonpath='{.spec.holderIdentity}'

# Watch leader transitions
kubectl get lease my-controller-leader -n my-system -w
```

## Common Issues

### Leader election takes too long after leader pod dies
- **Cause**: `leaseDurationSeconds` too high
- **Fix**: Reduce to 10-15s; `renewDeadline` should be ~2/3 of `leaseDuration`

### "failed to acquire lease" errors in non-leader pods
- **Cause**: Normal behavior — standby pods continuously try to acquire
- **Fix**: These are informational at `INFO` level; not actual errors

### Leader election RBAC error (forbidden: leases)
- **Cause**: ServiceAccount missing `coordination.k8s.io/leases` permissions
- **Fix**: Add Role with `get`, `create`, `update` on `leases` resource

### Split-brain: two pods think they're leader
- **Cause**: Clock skew between nodes exceeding lease duration
- **Fix**: Ensure NTP sync; increase `leaseDuration` to account for clock drift

## Best Practices

1. **Use Lease (not ConfigMap/Endpoints)** — purpose-built, lower overhead
2. **Set replicas ≥ 2** — leader election only useful with multiple candidates
3. **LeaseDuration > RenewDeadline > RetryPeriod** — typical ratio 15:10:2 seconds
4. **Exit on leadership loss** — prevents stale leader processing
5. **Use POD_NAME as identity** — unique per pod, visible in lease status
6. **Namespace-scoped leases** — avoid cluster-wide lock contention
7. **Monitor leaseTransitions** — high transitions indicate instability

## Key Takeaways

- Leases (`coordination.k8s.io/v1`) are the standard Kubernetes leader election mechanism
- Only the lease holder (leader) performs work; other replicas are standby
- controller-runtime provides built-in leader election with `LeaderElection: true`
- Node heartbeats use Leases in `kube-node-lease` namespace (since K8s 1.14)
- RBAC requires `get`, `create`, `update` on `leases` in `coordination.k8s.io`
- Typical timing: 15s lease duration, 10s renew deadline, 2s retry period
- Preferred over ConfigMap/Endpoints-based election (deprecated pattern)
