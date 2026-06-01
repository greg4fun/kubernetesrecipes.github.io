---
title: "Kubernetes Finalizers Explained and Troubleshooting"
description: "Understand Kubernetes finalizers for resource cleanup. How finalizers block deletion, common stuck resource scenarios, manual removal techniques, and implementing custom finalizers in controllers."
tags:
  - "finalizers"
  - "resource-lifecycle"
  - "troubleshooting"
  - "deletion"
  - "controllers"
category: "troubleshooting"
publishDate: "2026-06-01"
author: "Luca Berton"
difficulty: "intermediate"
relatedRecipes:
  - "kubernetes-resource-management"
  - "kubernetes-operator-development-guide"
  - "kubernetes-namespace-best-practices"
---

> 💡 **Quick Answer:** Finalizers are metadata keys that tell Kubernetes "don't delete this resource until I've cleaned up." A resource with a finalizer gets a `deletionTimestamp` but remains until the controller removes the finalizer. Stuck resources (namespace stuck in Terminating) are usually caused by orphaned finalizers — remove them with `kubectl patch` or edit the resource's `metadata.finalizers` field.

## The Problem

- Namespace stuck in "Terminating" forever after `kubectl delete ns`
- PersistentVolume won't delete — stuck with finalizer
- Custom resources can't be removed after CRD controller is uninstalled
- Need to understand why deletion is blocked
- Want to implement cleanup logic before resource deletion

## The Solution

### How Finalizers Work

```text
Normal deletion (no finalizer):
  kubectl delete pod/x → Pod removed immediately

With finalizer:
  kubectl delete pod/x
  → deletionTimestamp set (marks for deletion)
  → Pod still exists (finalizer blocking)
  → Controller sees deletionTimestamp, runs cleanup
  → Controller removes finalizer from metadata
  → Kubernetes garbage collector deletes the resource
```

### View Finalizers on a Resource

```bash
# Check what finalizers exist
kubectl get namespace production -o jsonpath='{.metadata.finalizers}'
# ["kubernetes"]

kubectl get pv my-volume -o jsonpath='{.metadata.finalizers}'
# ["kubernetes.io/pv-protection"]

kubectl get pod my-pod -o jsonpath='{.metadata.finalizers}'
# [] (most pods have none)

# Find all resources with specific finalizer
kubectl get all -A -o json | jq '.items[] | select(.metadata.finalizers != null) | {name: .metadata.name, ns: .metadata.namespace, finalizers: .metadata.finalizers}'
```

### Common Kubernetes Finalizers

```text
Finalizer                              │ Purpose
───────────────────────────────────────┼────────────────────────────────────
kubernetes.io/pv-protection            │ Prevent PV deletion while bound
kubernetes.io/pvc-protection           │ Prevent PVC deletion while in use
kubernetes                             │ Namespace cleanup (delete all resources)
foregroundDeletion                     │ Delete dependents before owner
orphan                                 │ Don't delete dependents
helm.sh/hook-delete-policy             │ Helm hook cleanup
finalizer.argocd.argoproj.io           │ ArgoCD app resource cleanup
───────────────────────────────────────┴────────────────────────────────────
```

### Fix Stuck Namespace (Terminating)

```bash
# 1. Check what's blocking
kubectl get namespace production -o json | jq '.status.conditions'

# 2. Find resources still in namespace
kubectl api-resources --verbs=list --namespaced -o name | \
  xargs -n 1 kubectl get -n production --no-headers 2>/dev/null

# 3. If controller is gone, force-remove finalizer
kubectl get namespace production -o json | \
  jq '.spec.finalizers = []' | \
  kubectl replace --raw "/api/v1/namespaces/production/finalize" -f -
```

### Fix Stuck PV/PVC

```bash
# PVC stuck in Terminating (still mounted by a pod)
kubectl get pods -A -o json | jq '.items[] | select(.spec.volumes[]?.persistentVolumeClaim.claimName == "my-pvc") | .metadata.name'

# If no pod is using it, remove protection finalizer
kubectl patch pvc my-pvc -p '{"metadata":{"finalizers":null}}'

# PV stuck in Terminating
kubectl patch pv my-pv -p '{"metadata":{"finalizers":null}}'
```

### Fix Stuck Custom Resources

```bash
# CRD controller uninstalled but CRs still have finalizers
kubectl get mycustomresource -A -o name | \
  xargs -I {} kubectl patch {} --type=merge -p '{"metadata":{"finalizers":[]}}'

# Or for a specific resource
kubectl patch mycr my-resource --type=json \
  -p='[{"op": "remove", "path": "/metadata/finalizers"}]'
```

### Implement Custom Finalizer (Controller Pattern)

```go
const myFinalizer = "example.com/cleanup"

func (r *Reconciler) Reconcile(ctx context.Context, req ctrl.Request) (ctrl.Result, error) {
    obj := &v1alpha1.MyResource{}
    if err := r.Get(ctx, req.NamespacedName, obj); err != nil {
        return ctrl.Result{}, client.IgnoreNotFound(err)
    }

    // Check if being deleted
    if !obj.DeletionTimestamp.IsZero() {
        if controllerutil.ContainsFinalizer(obj, myFinalizer) {
            // Run cleanup logic
            if err := r.cleanupExternalResources(obj); err != nil {
                return ctrl.Result{}, err
            }
            // Remove finalizer after cleanup
            controllerutil.RemoveFinalizer(obj, myFinalizer)
            if err := r.Update(ctx, obj); err != nil {
                return ctrl.Result{}, err
            }
        }
        return ctrl.Result{}, nil
    }

    // Add finalizer if not present
    if !controllerutil.ContainsFinalizer(obj, myFinalizer) {
        controllerutil.AddFinalizer(obj, myFinalizer)
        if err := r.Update(ctx, obj); err != nil {
            return ctrl.Result{}, err
        }
    }

    // Normal reconciliation...
    return ctrl.Result{}, nil
}
```

### Add/Remove Finalizers with kubectl

```bash
# Add a finalizer
kubectl patch configmap my-config --type=merge \
  -p '{"metadata":{"finalizers":["example.com/my-finalizer"]}}'

# Remove all finalizers (force deletion)
kubectl patch configmap my-config --type=merge \
  -p '{"metadata":{"finalizers":null}}'

# Remove specific finalizer (JSON patch)
kubectl patch configmap my-config --type=json \
  -p='[{"op": "remove", "path": "/metadata/finalizers/0"}]'
```

## Common Issues

### Namespace stuck Terminating — "DiscoveryFailed" condition
- **Cause**: API service unavailable (metrics-server down, custom APIService broken)
- **Fix**: `kubectl get apiservices | grep False` — fix or delete broken APIService

### Force-deleting finalizer didn't work on namespace
- **Cause**: Must use the `/finalize` subresource endpoint for namespaces
- **Fix**: Use the `kubectl replace --raw` method shown above

### Pods re-creating after forced finalizer removal
- **Cause**: Owner resource (Deployment/StatefulSet) still exists and recreates pods
- **Fix**: Delete the owner resource first, then clean up remaining stuck resources

### Removing finalizer causes data loss
- **Cause**: Finalizer was protecting external resources (cloud storage, DNS records)
- **Fix**: Manually clean up external resources before removing finalizer

## Best Practices

1. **Never remove finalizers blindly** — understand what cleanup they protect
2. **Check for stuck APIServices** — common cause of namespace termination hangs
3. **Delete owner resources first** — then dependents clean up naturally
4. **Custom controllers must handle finalizers** — add on create, run cleanup on delete, remove after cleanup
5. **Use `kubernetes.io/pv-protection`** — prevents accidental PV deletion while pods use it
6. **Monitor for stuck resources** — alert on resources in Terminating > 5 minutes
7. **Test finalizer removal in non-prod** — especially for custom operators

## Key Takeaways

- Finalizers block resource deletion until a controller removes them
- `deletionTimestamp` is set immediately; resource persists until finalizers are cleared
- Stuck Terminating namespace: check broken APIServices first, then force-remove finalizers
- `kubectl patch <resource> -p '{"metadata":{"finalizers":null}}'` — nuclear option
- Namespace finalizer removal requires `/finalize` subresource endpoint
- Custom controllers: add finalizer on creation, cleanup + remove on deletion
- PV/PVC protection finalizers prevent deletion while volumes are in use
