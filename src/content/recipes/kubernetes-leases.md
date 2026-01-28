---
title: "How to Use Kubernetes Leases for Leader Election"
description: "Implement distributed coordination with Kubernetes Leases. Configure leader election, distributed locks, and high availability patterns."
category: "deployments"
difficulty: "advanced"
publishDate: "2026-01-22"
tags: ["leases", "leader-election", "coordination", "high-availability", "distributed"]
---

# How to Use Kubernetes Leases for Leader Election

Kubernetes Leases provide distributed coordination primitives. Use them for leader election, preventing split-brain, and ensuring only one active instance for critical operations.

## Lease Resource

```yaml
# manual-lease.yaml
apiVersion: coordination.k8s.io/v1
kind: Lease
metadata:
  name: my-app-leader
  namespace: default
spec:
  holderIdentity: "pod-abc123"
  leaseDurationSeconds: 15
  acquireTime: "2026-01-22T10:00:00Z"
  renewTime: "2026-01-22T10:00:10Z"
  leaseTransitions: 5
```

```bash
# View leases
kubectl get leases
kubectl describe lease my-app-leader

# System leases (node heartbeats)
kubectl get leases -n kube-node-lease
```

## Leader Election in Go

```go
// leader-election.go
package main

import (
    "context"
    "flag"
    "os"
    "time"

    metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
    "k8s.io/client-go/kubernetes"
    "k8s.io/client-go/rest"
    "k8s.io/client-go/tools/leaderelection"
    "k8s.io/client-go/tools/leaderelection/resourcelock"
    "k8s.io/klog/v2"
)

func main() {
    var leaseName string
    var namespace string
    flag.StringVar(&leaseName, "lease-name", "my-app-leader", "Lease name")
    flag.StringVar(&namespace, "namespace", "default", "Namespace")
    flag.Parse()

    // Get pod identity
    id, _ := os.Hostname()

    // In-cluster config
    config, _ := rest.InClusterConfig()
    client, _ := kubernetes.NewForConfig(config)

    // Create lease lock
    lock := &resourcelock.LeaseLock{
        LeaseMeta: metav1.ObjectMeta{
            Name:      leaseName,
            Namespace: namespace,
        },
        Client: client.CoordinationV1(),
        LockConfig: resourcelock.ResourceLockConfig{
            Identity: id,
        },
    }

    ctx, cancel := context.WithCancel(context.Background())
    defer cancel()

    // Start leader election
    leaderelection.RunOrDie(ctx, leaderelection.LeaderElectionConfig{
        Lock:            lock,
        ReleaseOnCancel: true,
        LeaseDuration:   15 * time.Second,
        RenewDeadline:   10 * time.Second,
        RetryPeriod:     2 * time.Second,
        Callbacks: leaderelection.LeaderCallbacks{
            OnStartedLeading: func(ctx context.Context) {
                klog.Info("Started leading")
                runLeaderTasks(ctx)
            },
            OnStoppedLeading: func() {
                klog.Info("Stopped leading")
            },
            OnNewLeader: func(identity string) {
                if identity == id {
                    return
                }
                klog.Infof("New leader elected: %s", identity)
            },
        },
    })
}

func runLeaderTasks(ctx context.Context) {
    // Only leader runs these tasks
    ticker := time.NewTicker(5 * time.Second)
    defer ticker.Stop()
    
    for {
        select {
        case <-ctx.Done():
            return
        case <-ticker.C:
            klog.Info("Performing leader-only task")
        }
    }
}
```

## Deployment with Leader Election

```yaml
# leader-election-deployment.yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: controller
spec:
  replicas: 3  # Multiple replicas for HA
  selector:
    matchLabels:
      app: controller
  template:
    metadata:
      labels:
        app: controller
    spec:
      serviceAccountName: controller
      containers:
        - name: controller
          image: controller:v1
          args:
            - --lease-name=controller-leader
            - --namespace=$(POD_NAMESPACE)
          env:
            - name: POD_NAMESPACE
              valueFrom:
                fieldRef:
                  fieldPath: metadata.namespace
            - name: POD_NAME
              valueFrom:
                fieldRef:
                  fieldPath: metadata.name
---
apiVersion: v1
kind: ServiceAccount
metadata:
  name: controller
---
apiVersion: rbac.authorization.k8s.io/v1
kind: Role
metadata:
  name: leader-election
rules:
  - apiGroups: ["coordination.k8s.io"]
    resources: ["leases"]
    verbs: ["get", "create", "update"]
---
apiVersion: rbac.authorization.k8s.io/v1
kind: RoleBinding
metadata:
  name: controller-leader-election
subjects:
  - kind: ServiceAccount
    name: controller
roleRef:
  kind: Role
  name: leader-election
  apiGroup: rbac.authorization.k8s.io
```

## Python Leader Election

```python
# leader_election.py
import os
import time
import threading
from kubernetes import client, config
from kubernetes.client.rest import ApiException

class LeaderElector:
    def __init__(self, lease_name, namespace, identity):
        config.load_incluster_config()
        self.api = client.CoordinationV1Api()
        self.lease_name = lease_name
        self.namespace = namespace
        self.identity = identity
        self.lease_duration = 15
        self.renew_deadline = 10
        self.is_leader = False
    
    def try_acquire(self):
        try:
            lease = self.api.read_namespaced_lease(
                self.lease_name, self.namespace
            )
            # Check if lease is expired
            if self._is_expired(lease):
                return self._update_lease(lease)
            # Check if we're the holder
            if lease.spec.holder_identity == self.identity:
                return self._renew_lease(lease)
            return False
        except ApiException as e:
            if e.status == 404:
                return self._create_lease()
            raise
    
    def _create_lease(self):
        lease = client.V1Lease(
            metadata=client.V1ObjectMeta(name=self.lease_name),
            spec=client.V1LeaseSpec(
                holder_identity=self.identity,
                lease_duration_seconds=self.lease_duration,
                acquire_time=client.V1MicroTime(time.time()),
                renew_time=client.V1MicroTime(time.time())
            )
        )
        self.api.create_namespaced_lease(self.namespace, lease)
        return True
    
    def _is_expired(self, lease):
        if not lease.spec.renew_time:
            return True
        elapsed = time.time() - lease.spec.renew_time.timestamp()
        return elapsed > self.lease_duration
    
    def _renew_lease(self, lease):
        lease.spec.renew_time = client.V1MicroTime(time.time())
        self.api.replace_namespaced_lease(
            self.lease_name, self.namespace, lease
        )
        return True
    
    def _update_lease(self, lease):
        lease.spec.holder_identity = self.identity
        lease.spec.acquire_time = client.V1MicroTime(time.time())
        lease.spec.renew_time = client.V1MicroTime(time.time())
        lease.spec.lease_transitions = (lease.spec.lease_transitions or 0) + 1
        self.api.replace_namespaced_lease(
            self.lease_name, self.namespace, lease
        )
        return True
    
    def run(self, on_started_leading, on_stopped_leading):
        while True:
            acquired = self.try_acquire()
            if acquired and not self.is_leader:
                self.is_leader = True
                threading.Thread(target=on_started_leading).start()
            elif not acquired and self.is_leader:
                self.is_leader = False
                on_stopped_leading()
            time.sleep(2)

# Usage
def main():
    elector = LeaderElector(
        lease_name="my-app-leader",
        namespace=os.environ.get("POD_NAMESPACE", "default"),
        identity=os.environ.get("POD_NAME", "unknown")
    )
    
    elector.run(
        on_started_leading=lambda: print("Now leading!"),
        on_stopped_leading=lambda: print("Lost leadership")
    )
```

## Controller-Runtime Leader Election

```go
// Using controller-runtime (common in operators)
import (
    "sigs.k8s.io/controller-runtime/pkg/manager"
)

func main() {
    mgr, _ := manager.New(config, manager.Options{
        LeaderElection:          true,
        LeaderElectionID:        "my-controller-leader",
        LeaderElectionNamespace: "default",
        LeaseDuration:           15 * time.Second,
        RenewDeadline:           10 * time.Second,
        RetryPeriod:             2 * time.Second,
    })
    
    // Controllers only run when this instance is the leader
    mgr.Start(context.Background())
}
```

## Monitor Leader Election

```bash
# Watch lease changes
kubectl get lease my-app-leader -w

# Check current leader
kubectl get lease my-app-leader -o jsonpath='{.spec.holderIdentity}'

# View lease details
kubectl describe lease my-app-leader

# Lease transitions count
kubectl get lease my-app-leader -o jsonpath='{.spec.leaseTransitions}'
```

## Graceful Leadership Handoff

```go
// Handle SIGTERM for clean handoff
import (
    "os"
    "os/signal"
    "syscall"
)

func main() {
    ctx, cancel := context.WithCancel(context.Background())
    
    // Handle shutdown signals
    sigChan := make(chan os.Signal, 1)
    signal.Notify(sigChan, syscall.SIGTERM, syscall.SIGINT)
    
    go func() {
        <-sigChan
        cancel() // Triggers ReleaseOnCancel
    }()
    
    leaderelection.RunOrDie(ctx, config)
}
```

## Lease-Based Distributed Lock

```yaml
# For short-term locks (not leader election)
apiVersion: coordination.k8s.io/v1
kind: Lease
metadata:
  name: migration-lock
  namespace: default
spec:
  holderIdentity: "migration-job-xyz"
  leaseDurationSeconds: 300  # 5 minute lock
```

## Summary

Kubernetes Leases enable distributed coordination and leader election. Configure lease duration, renew deadline, and retry period for your availability requirements. Use client-go's leaderelection package for Go applications. Ensure RBAC allows get, create, and update on leases. Multiple replicas with leader election provide high availability - only the leader performs critical operations. Handle graceful shutdown to release leadership quickly. Monitor leases with kubectl to track leader changes and transitions.

---

## 📘 Go Further with Kubernetes Recipes

**Love this recipe? There's so much more!** This is just one of **100+ hands-on recipes** in our comprehensive **[Kubernetes Recipes book](/book)**.

Inside the book, you'll master:
- ✅ Production-ready deployment strategies
- ✅ Advanced networking and security patterns  
- ✅ Observability, monitoring, and troubleshooting
- ✅ Real-world best practices from industry experts

> *"The practical, recipe-based approach made complex Kubernetes concepts finally click for me."*

**👉 [Get Your Copy Now](/book)** — Start building production-grade Kubernetes skills today!
