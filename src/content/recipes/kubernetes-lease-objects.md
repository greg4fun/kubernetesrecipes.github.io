---
title: "How to Use Kubernetes Lease Objects"
description: "Implement leader election and distributed coordination with Kubernetes Lease objects. Build highly available controllers and prevent split-brain scenarios."
category: "configuration"
difficulty: "advanced"
publishDate: "2026-01-22"
tags: ["lease", "leader-election", "coordination", "high-availability", "distributed-systems"]
---

# How to Use Kubernetes Lease Objects

Lease objects provide a mechanism for distributed coordination and leader election in Kubernetes. They're used by controllers, schedulers, and custom applications to ensure only one instance is active at a time.

## Understanding Lease Objects

```yaml
# example-lease.yaml
apiVersion: coordination.k8s.io/v1
kind: Lease
metadata:
  name: my-controller-lock
  namespace: default
spec:
  holderIdentity: controller-pod-abc123
  leaseDurationSeconds: 15
  acquireTime: "2026-01-22T10:00:00Z"
  renewTime: "2026-01-22T10:00:10Z"
  leaseTransitions: 5
```

## View Existing Leases

```bash
# List all leases in kube-system (includes system components)
kubectl get leases -n kube-system

# Common system leases:
# - kube-controller-manager
# - kube-scheduler
# - cloud-controller-manager

# Describe a lease
kubectl describe lease kube-controller-manager -n kube-system

# Watch lease updates
kubectl get lease my-lease -w
```

## Leader Election in Go

```go
// main.go
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
    var leaseLockName string
    var leaseLockNamespace string
    var id string

    flag.StringVar(&leaseLockName, "lease-lock-name", "my-controller", "Name of lease lock")
    flag.StringVar(&leaseLockNamespace, "lease-lock-namespace", "default", "Namespace of lease lock")
    flag.StringVar(&id, "id", os.Getenv("POD_NAME"), "Holder identity")
    flag.Parse()

    if id == "" {
        klog.Fatal("Unable to determine holder identity")
    }

    config, err := rest.InClusterConfig()
    if err != nil {
        klog.Fatal(err)
    }

    client, err := kubernetes.NewForConfig(config)
    if err != nil {
        klog.Fatal(err)
    }

    ctx, cancel := context.WithCancel(context.Background())
    defer cancel()

    lock := &resourcelock.LeaseLock{
        LeaseMeta: metav1.ObjectMeta{
            Name:      leaseLockName,
            Namespace: leaseLockNamespace,
        },
        Client: client.CoordinationV1(),
        LockConfig: resourcelock.ResourceLockConfig{
            Identity: id,
        },
    }

    leaderelection.RunOrDie(ctx, leaderelection.LeaderElectionConfig{
        Lock:            lock,
        ReleaseOnCancel: true,
        LeaseDuration:   15 * time.Second,
        RenewDeadline:   10 * time.Second,
        RetryPeriod:     2 * time.Second,
        Callbacks: leaderelection.LeaderCallbacks{
            OnStartedLeading: func(ctx context.Context) {
                klog.Info("Started leading")
                runController(ctx)
            },
            OnStoppedLeading: func() {
                klog.Info("Stopped leading")
                os.Exit(0)
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

func runController(ctx context.Context) {
    // Main controller logic runs here
    for {
        select {
        case <-ctx.Done():
            return
        default:
            klog.Info("Controller doing work...")
            time.Sleep(5 * time.Second)
        }
    }
}
```

## Deployment with Leader Election

```yaml
# controller-deployment.yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: my-controller
spec:
  replicas: 3  # Multiple replicas for HA
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
          image: my-controller:v1
          args:
            - --lease-lock-name=my-controller
            - --lease-lock-namespace=$(NAMESPACE)
            - --id=$(POD_NAME)
          env:
            - name: POD_NAME
              valueFrom:
                fieldRef:
                  fieldPath: metadata.name
            - name: NAMESPACE
              valueFrom:
                fieldRef:
                  fieldPath: metadata.namespace
---
apiVersion: v1
kind: ServiceAccount
metadata:
  name: my-controller
---
apiVersion: rbac.authorization.k8s.io/v1
kind: Role
metadata:
  name: my-controller-leader-election
rules:
  - apiGroups: ["coordination.k8s.io"]
    resources: ["leases"]
    verbs: ["get", "create", "update"]
---
apiVersion: rbac.authorization.k8s.io/v1
kind: RoleBinding
metadata:
  name: my-controller-leader-election
subjects:
  - kind: ServiceAccount
    name: my-controller
roleRef:
  apiGroup: rbac.authorization.k8s.io
  kind: Role
  name: my-controller-leader-election
```

## Leader Election with Controller-Runtime

```go
// Using controller-runtime library
package main

import (
    "os"

    "sigs.k8s.io/controller-runtime/pkg/manager"
    "sigs.k8s.io/controller-runtime/pkg/manager/signals"
)

func main() {
    mgr, err := manager.New(cfg, manager.Options{
        LeaderElection:          true,
        LeaderElectionID:        "my-controller-lock",
        LeaderElectionNamespace: "default",
        // Lease duration and renew deadline
        LeaseDuration: durationPtr(15 * time.Second),
        RenewDeadline: durationPtr(10 * time.Second),
        RetryPeriod:   durationPtr(2 * time.Second),
    })
    if err != nil {
        os.Exit(1)
    }

    // Add controllers to manager
    // ...

    if err := mgr.Start(signals.SetupSignalHandler()); err != nil {
        os.Exit(1)
    }
}
```

## Python Leader Election

```python
# leader_election.py
from kubernetes import client, config
from kubernetes.leaderelection import leaderelection
from kubernetes.leaderelection.resourcelock.configmaplock import ConfigMapLock
from kubernetes.leaderelection import electionconfig
import os
import threading

def on_started_leading():
    print("I am the leader now!")
    # Run main controller logic
    while True:
        print("Doing work as leader...")
        time.sleep(5)

def on_stopped_leading():
    print("Lost leadership, exiting...")
    os._exit(1)

def on_new_leader(identity):
    print(f"New leader elected: {identity}")

def main():
    config.load_incluster_config()
    
    # Create lock
    lock = ConfigMapLock(
        name="my-python-controller",
        namespace="default",
        identity=os.environ.get("POD_NAME", "unknown")
    )
    
    # Configure election
    election_config = electionconfig.Config(
        lock=lock,
        lease_duration=15,
        renew_deadline=10,
        retry_period=2,
        onstarted_leading=on_started_leading,
        onstopped_leading=on_stopped_leading,
    )
    
    # Start election
    leaderelection.LeaderElection(election_config).run()

if __name__ == "__main__":
    main()
```

## Monitor Leader Election

```bash
# Check current leader
kubectl get lease my-controller -o jsonpath='{.spec.holderIdentity}'

# Watch leader changes
kubectl get lease my-controller -w -o jsonpath='{.spec.holderIdentity}{"\n"}'

# View lease transitions
kubectl get lease my-controller -o jsonpath='{.spec.leaseTransitions}'

# Check renewal time
kubectl get lease my-controller -o jsonpath='{.spec.renewTime}'
```

## Lease for Node Heartbeats

```yaml
# Node heartbeat lease (created automatically)
apiVersion: coordination.k8s.io/v1
kind: Lease
metadata:
  name: node-1
  namespace: kube-node-lease
spec:
  holderIdentity: node-1
  leaseDurationSeconds: 40
  renewTime: "2026-01-22T10:00:00Z"
```

```bash
# View node leases
kubectl get leases -n kube-node-lease

# Check node health via lease
kubectl get lease node-1 -n kube-node-lease -o jsonpath='{.spec.renewTime}'
```

## Custom Lease for Application Coordination

```yaml
# application-lease.yaml
apiVersion: coordination.k8s.io/v1
kind: Lease
metadata:
  name: batch-processor-lock
  namespace: batch-jobs
spec:
  holderIdentity: ""  # Will be set by application
  leaseDurationSeconds: 30
```

```go
// Acquire and maintain lease
func acquireLease(ctx context.Context, client coordinationv1.CoordinationV1Interface, name, namespace, identity string) error {
    lease, err := client.Leases(namespace).Get(ctx, name, metav1.GetOptions{})
    if err != nil {
        return err
    }

    // Check if lease is held by someone else
    if lease.Spec.HolderIdentity != nil && *lease.Spec.HolderIdentity != "" {
        renewTime := lease.Spec.RenewTime
        if renewTime != nil {
            elapsed := time.Since(renewTime.Time)
            if elapsed < time.Duration(*lease.Spec.LeaseDurationSeconds)*time.Second {
                return fmt.Errorf("lease held by %s", *lease.Spec.HolderIdentity)
            }
        }
    }

    // Acquire lease
    now := metav1.NewMicroTime(time.Now())
    lease.Spec.HolderIdentity = &identity
    lease.Spec.AcquireTime = &now
    lease.Spec.RenewTime = &now

    _, err = client.Leases(namespace).Update(ctx, lease, metav1.UpdateOptions{})
    return err
}
```

## Lease Timing Configuration

```yaml
# Recommended settings for different scenarios

# High availability (fast failover)
# LeaseDuration: 10s
# RenewDeadline: 8s  
# RetryPeriod: 2s
# Failover time: ~10-12 seconds

# Standard (balanced)
# LeaseDuration: 15s
# RenewDeadline: 10s
# RetryPeriod: 2s
# Failover time: ~15-17 seconds

# Network tolerant (handles brief outages)
# LeaseDuration: 30s
# RenewDeadline: 20s
# RetryPeriod: 5s
# Failover time: ~30-35 seconds
```

## Troubleshooting

```bash
# Leader not renewing
kubectl describe lease my-controller-lock
# Check if renewTime is updating

# Multiple leaders (split brain)
# This shouldn't happen with proper configuration
# Check network connectivity between pods
# Verify clock synchronization

# Leader election not working
kubectl logs -l app=my-controller
# Look for lease-related errors

# RBAC issues
kubectl auth can-i update leases --as=system:serviceaccount:default:my-controller
```

## Summary

Kubernetes Lease objects enable distributed coordination and leader election. They prevent split-brain scenarios in highly available deployments. Use appropriate lease durations based on your failover requirements—shorter durations mean faster failover but more API server load. Always ensure proper RBAC permissions and implement graceful shutdown to release leases promptly.

---

## 📘 Go Further with Kubernetes Recipes

**Love this recipe? There's so much more!** This is just one of **100+ hands-on recipes** in our comprehensive **[Kubernetes Recipes book](https://amzn.to/3DzC8QA)**.

Inside the book, you'll master:
- ✅ Production-ready deployment strategies
- ✅ Advanced networking and security patterns  
- ✅ Observability, monitoring, and troubleshooting
- ✅ Real-world best practices from industry experts

> *"The practical, recipe-based approach made complex Kubernetes concepts finally click for me."*

**👉 [Get Your Copy Now](https://amzn.to/3DzC8QA)** — Start building production-grade Kubernetes skills today!
