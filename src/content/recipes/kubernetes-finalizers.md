---
title: "How to Use Kubernetes Finalizers"
description: "Manage resource cleanup with Kubernetes finalizers. Implement custom cleanup logic and understand how finalizers prevent premature resource deletion."
category: "configuration"
difficulty: "advanced"
publishDate: "2026-01-22"
tags: ["finalizers", "cleanup", "deletion", "controllers", "garbage-collection"]
---

# How to Use Kubernetes Finalizers

Finalizers are keys on resources that signal pre-delete hooks. They block resource deletion until the finalizer is removed, allowing controllers to perform cleanup operations.

## Understanding Finalizers

```yaml
# resource-with-finalizer.yaml
apiVersion: v1
kind: ConfigMap
metadata:
  name: my-config
  finalizers:
    - example.com/cleanup
data:
  key: value
```

When you delete this resource:
1. Kubernetes sets `deletionTimestamp`
2. Resource enters "terminating" state
3. Controllers process their finalizers
4. Each controller removes its finalizer when done
5. Resource is deleted when all finalizers are removed

## Common Built-in Finalizers

```bash
# Kubernetes built-in finalizers
kubernetes.io/pvc-protection      # Prevents PVC deletion while bound
kubernetes.io/pv-protection       # Prevents PV deletion while bound
foregroundDeletion               # Waits for dependents to be deleted
orphan                           # Orphans dependents
```

## View Finalizers

```bash
# Check finalizers on a resource
kubectl get configmap my-config -o jsonpath='{.metadata.finalizers}'

# View all resources with specific finalizer
kubectl get all -A -o json | jq '.items[] | select(.metadata.finalizers != null) | {name: .metadata.name, namespace: .metadata.namespace, finalizers: .metadata.finalizers}'

# Find stuck resources (has deletionTimestamp but still exists)
kubectl get pods -A -o json | jq '.items[] | select(.metadata.deletionTimestamp != null) | {name: .metadata.name, namespace: .metadata.namespace}'
```

## Add Finalizers

```bash
# Add finalizer to existing resource
kubectl patch configmap my-config -p '{"metadata":{"finalizers":["example.com/cleanup"]}}'

# Add finalizer with strategic merge
kubectl patch configmap my-config --type=json -p='[{"op":"add","path":"/metadata/finalizers/-","value":"example.com/my-finalizer"}]'
```

## Remove Finalizers (Force Delete)

```bash
# Remove specific finalizer
kubectl patch configmap my-config --type=json -p='[{"op":"remove","path":"/metadata/finalizers/0"}]'

# Remove all finalizers (force delete stuck resource)
kubectl patch configmap my-config -p '{"metadata":{"finalizers":null}}'

# For namespaces stuck in Terminating
kubectl get namespace stuck-ns -o json | jq '.spec.finalizers = []' | kubectl replace --raw "/api/v1/namespaces/stuck-ns/finalize" -f -
```

## Implement Custom Finalizer Controller (Go)

```go
// controller.go
package main

import (
    "context"
    "fmt"

    corev1 "k8s.io/api/core/v1"
    "k8s.io/apimachinery/pkg/runtime"
    ctrl "sigs.k8s.io/controller-runtime"
    "sigs.k8s.io/controller-runtime/pkg/client"
    "sigs.k8s.io/controller-runtime/pkg/controller/controllerutil"
)

const finalizerName = "example.com/cleanup"

type ConfigMapReconciler struct {
    client.Client
    Scheme *runtime.Scheme
}

func (r *ConfigMapReconciler) Reconcile(ctx context.Context, req ctrl.Request) (ctrl.Result, error) {
    var configMap corev1.ConfigMap
    if err := r.Get(ctx, req.NamespacedName, &configMap); err != nil {
        return ctrl.Result{}, client.IgnoreNotFound(err)
    }

    // Check if resource is being deleted
    if !configMap.DeletionTimestamp.IsZero() {
        if controllerutil.ContainsFinalizer(&configMap, finalizerName) {
            // Perform cleanup logic
            if err := r.cleanupExternalResources(&configMap); err != nil {
                return ctrl.Result{}, err
            }

            // Remove finalizer after cleanup
            controllerutil.RemoveFinalizer(&configMap, finalizerName)
            if err := r.Update(ctx, &configMap); err != nil {
                return ctrl.Result{}, err
            }
        }
        return ctrl.Result{}, nil
    }

    // Add finalizer if not present
    if !controllerutil.ContainsFinalizer(&configMap, finalizerName) {
        controllerutil.AddFinalizer(&configMap, finalizerName)
        if err := r.Update(ctx, &configMap); err != nil {
            return ctrl.Result{}, err
        }
    }

    return ctrl.Result{}, nil
}

func (r *ConfigMapReconciler) cleanupExternalResources(cm *corev1.ConfigMap) error {
    // Implement cleanup logic here
    // - Delete external resources
    // - Clean up cloud resources
    // - Notify external systems
    fmt.Printf("Cleaning up external resources for %s\n", cm.Name)
    return nil
}
```

## Custom Resource with Finalizer

```yaml
# custom-resource-finalizer.yaml
apiVersion: apiextensions.k8s.io/v1
kind: CustomResourceDefinition
metadata:
  name: databases.example.com
spec:
  group: example.com
  names:
    kind: Database
    plural: databases
  scope: Namespaced
  versions:
    - name: v1
      served: true
      storage: true
      schema:
        openAPIV3Schema:
          type: object
          properties:
            spec:
              type: object
              properties:
                size:
                  type: string
---
apiVersion: example.com/v1
kind: Database
metadata:
  name: my-database
  finalizers:
    - databases.example.com/cleanup
spec:
  size: 10Gi
```

## Pre-Delete Hook Pattern

```yaml
# pre-delete-job.yaml
apiVersion: batch/v1
kind: Job
metadata:
  name: cleanup-job
  annotations:
    helm.sh/hook: pre-delete
    helm.sh/hook-delete-policy: hook-succeeded
spec:
  template:
    spec:
      containers:
        - name: cleanup
          image: myapp/cleanup:v1
          command: ["./cleanup.sh"]
          env:
            - name: RESOURCE_NAME
              value: "my-resource"
      restartPolicy: Never
```

## Debugging Stuck Resources

```bash
# Find resources stuck in Terminating
kubectl get all -A | grep Terminating

# Check why namespace is stuck
kubectl get namespace stuck-ns -o yaml

# View events for stuck resource
kubectl describe pod stuck-pod

# Check for blocking finalizers
kubectl get pod stuck-pod -o jsonpath='{.metadata.finalizers}'

# Force delete pod (last resort)
kubectl delete pod stuck-pod --grace-period=0 --force
```

## Namespace Finalizer Stuck

```bash
# Export namespace
kubectl get namespace stuck-ns -o json > ns.json

# Remove finalizers from JSON
cat ns.json | jq '.spec.finalizers = []' > ns-clean.json

# Replace namespace spec
kubectl replace --raw "/api/v1/namespaces/stuck-ns/finalize" -f ns-clean.json
```

## PVC Protection Finalizer

```yaml
# pvc-with-protection.yaml
apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: my-pvc
  # This finalizer is automatically added
  finalizers:
    - kubernetes.io/pvc-protection
spec:
  accessModes:
    - ReadWriteOnce
  resources:
    requests:
      storage: 10Gi
```

```bash
# PVC won't delete while pods are using it
kubectl delete pvc my-pvc
# PVC stays in Terminating until all pods release it

# Check what's using the PVC
kubectl get pods -A -o json | jq '.items[] | select(.spec.volumes[]?.persistentVolumeClaim.claimName == "my-pvc") | .metadata.name'
```

## Owner References vs Finalizers

```yaml
# Owner references for automatic cleanup
apiVersion: apps/v1
kind: Deployment
metadata:
  name: parent-deployment
---
apiVersion: v1
kind: ConfigMap
metadata:
  name: child-config
  ownerReferences:
    - apiVersion: apps/v1
      kind: Deployment
      name: parent-deployment
      uid: <deployment-uid>
      controller: true
      blockOwnerDeletion: true  # Acts like a finalizer
```

## Best Practices

```go
// Always handle finalizer idempotently
func (r *Reconciler) cleanupExternalResources(obj *MyResource) error {
    // Check if resource exists before deleting
    exists, err := r.externalResourceExists(obj.Spec.ExternalID)
    if err != nil {
        return err
    }
    
    if exists {
        if err := r.deleteExternalResource(obj.Spec.ExternalID); err != nil {
            return err
        }
    }
    
    return nil
}

// Use unique finalizer names
const finalizerName = "mycompany.com/mycontroller-cleanup"

// Set timeouts for cleanup operations
ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
defer cancel()
```

## Finalizer Lifecycle Diagram

```
Resource Created
      │
      ▼
┌─────────────────┐
│ Add Finalizer   │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ Resource Active │◄────────┐
└────────┬────────┘         │
         │                  │
         ▼                  │
   Delete Request           │
         │                  │
         ▼                  │
┌─────────────────┐         │
│ Set Deletion    │         │
│ Timestamp       │         │
└────────┬────────┘         │
         │                  │
         ▼                  │
┌─────────────────┐         │
│ Run Cleanup     │─────────┘
│ (on error)      │   Retry
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ Remove Finalizer│
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ Resource Deleted│
└─────────────────┘
```

## Summary

Finalizers ensure cleanup operations complete before resource deletion. They're essential for managing external resources, preventing data loss, and maintaining consistency. Always implement cleanup logic idempotently, handle errors gracefully, and include timeout mechanisms. Use owner references for simple parent-child relationships and finalizers for complex cleanup scenarios.

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
