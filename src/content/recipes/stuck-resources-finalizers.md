---
title: "Kubernetes Finalizers: Remove Stuck Finalizers"
description: "What Kubernetes finalizers are and how to safely remove stuck ones with kubectl patch. Fix namespaces, PVCs, CRDs and Helm releases stuck in Terminating."
category: "troubleshooting"
difficulty: "intermediate"
publishDate: "2026-01-22"
author: "Luca Berton"
tags: ["finalizers", "deletion", "cleanup", "stuck-resources", "terminating", "garbage-collection", "owner-references", "controllers", "namespace", "pvc"]
relatedRecipes:
  - "namespace-stuck-terminating"
  - "persistent-volume-stuck-terminating"
  - "kubernetes-operator-sdk-guide"
  - "kubernetes-namespace-best-practices"
  - "kubernetes-pod-lifecycle-guide"
  - "argocd-gitops"
  - "debug-node-issues"
  - "kubernetes-kubectl-plugins-guide"
---

> 💡 **Quick Answer:** A finalizer is a string in `metadata.finalizers[]` that tells Kubernetes "don't delete this object until a controller has cleaned up." Resources stuck in **Terminating** usually have a finalizer whose controller is gone or failing. Remove it to force delete: `kubectl patch <resource> <name> -p '{"metadata":{"finalizers":null}}' --type=merge`. Finalizers exist for a reason—investigate why cleanup failed before removing.
>
> **Key command (namespaces):** `kubectl get ns stuck-namespace -o json | jq '.spec.finalizers = []' | kubectl replace --raw "/api/v1/namespaces/stuck-namespace/finalize" -f -`
>
> **Gotcha:** Force-removing finalizers can leave orphaned resources (cloud load balancers, disks, DNS records). Check for dependent resources first with `kubectl get all -n <namespace>`.


Finalizers prevent resources from being deleted until cleanup tasks complete. They're used by controllers to ensure proper cleanup of dependent or external resources, but can cause resources to get stuck when that controller is missing or broken.

## Understanding Finalizers

```yaml
# Finalizers are metadata strings that block deletion
apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: my-data
  finalizers:
    - kubernetes.io/pvc-protection  # Added automatically; blocks deletion while mounted
```

```bash
# How deletion works with finalizers:
# 1. kubectl delete issued
# 2. API server sets deletionTimestamp (object is NOT removed yet)
# 3. Resource enters "Terminating" state
# 4. Controllers see deletionTimestamp, perform cleanup
# 5. Each controller removes its own finalizer
# 6. When metadata.finalizers is empty, the object is deleted from etcd
```

This is why `kubectl delete` can "lie":

```bash
kubectl delete namespace test-ns
# namespace "test-ns" deleted   ← request accepted, not completed

kubectl get namespace test-ns
# NAME      STATUS        AGE
# test-ns   Terminating   30m   ← blocked by a finalizer
```

Once `deletionTimestamp` is set, deletion cannot be cancelled, and new finalizers cannot be added—only removed.

## View Finalizers

```bash
# Check finalizers on a resource
kubectl get pvc data-postgres-0 -o jsonpath='{.metadata.finalizers}'
# ["kubernetes.io/pvc-protection"]

# Namespaces have BOTH metadata.finalizers and spec.finalizers
kubectl get namespace my-namespace -o jsonpath='{.spec.finalizers}'
# ["kubernetes"]

# Check deletionTimestamp (indicates deletion in progress)
kubectl get namespace my-namespace -o jsonpath='{.metadata.deletionTimestamp}'

# Find all Terminating namespaces
kubectl get namespaces --field-selector status.phase=Terminating

# Find stuck pods (deletionTimestamp set but still present)
kubectl get pods -A -o json | \
  jq '.items[] | select(.metadata.deletionTimestamp != null) | {ns: .metadata.namespace, name: .metadata.name, finalizers: .metadata.finalizers}'

# Find every object with finalizers in a namespace (all API types, incl. CRs)
kubectl api-resources --verbs=list --namespaced -o name | \
  xargs -I{} kubectl get {} -n my-namespace -o json 2>/dev/null | \
  jq '.items[] | select(.metadata.finalizers != null) | {kind: .kind, name: .metadata.name, finalizers: .metadata.finalizers}'
```

## Common Finalizers

| Finalizer | Used on | Purpose |
|-----------|---------|---------|
| `kubernetes` (in `spec.finalizers`) | Namespace | Waits until every object in the namespace is deleted |
| `kubernetes.io/pvc-protection` | PersistentVolumeClaim | Blocks deletion while a pod mounts the PVC |
| `kubernetes.io/pv-protection` | PersistentVolume | Blocks deletion while bound to a PVC |
| `external-provisioner.volume.kubernetes.io/finalizer` | PersistentVolume | CSI provisioner must delete the backing disk |
| `external-attacher/<csi-driver>` | VolumeAttachment | CSI attacher must detach the volume |
| `customresourcecleanup.apiextensions.k8s.io` | CustomResourceDefinition | Deletes all CR instances before the CRD |
| `foregroundDeletion` | Any owner | Owner waits for dependents to be deleted first |
| `orphan` | Any owner | Dependents are kept (ownerReferences stripped) |
| `resources-finalizer.argocd.argoproj.io` | Argo CD Application | Deletes the app's managed resources first |
| `<domain>/<name>` (e.g. `example.com/cleanup`) | Custom resources | Operator cleans up external resources |

## Diagnose Stuck Namespace

```bash
# Check what's blocking — the conditions usually name the culprit
kubectl get namespace stuck-ns -o json | jq '.status.conditions'
# NamespaceDeletionDiscoveryFailure  → a broken APIService (see below)
# NamespaceDeletionContentFailure    → some objects couldn't be deleted
# NamespaceContentRemaining          → objects still exist
# NamespaceFinalizersRemaining       → objects still have finalizers

# Find remaining resources in namespace
kubectl api-resources --verbs=list --namespaced -o name | \
  xargs -I {} kubectl get {} -n stuck-ns --ignore-not-found

# Check for stuck API resources (common cause of DiscoveryFailure)
kubectl get apiservices | grep False

# Delete leftovers normally before touching finalizers
kubectl delete all --all -n stuck-ns
kubectl delete configmaps,secrets,pvc --all -n stuck-ns
```

## Remove Stuck Finalizers

```bash
# WARNING: Only do this after understanding why finalizer exists
# Removing finalizers bypasses cleanup - may leave orphaned resources

# Remove ALL finalizers (merge patch)
kubectl patch pv my-pv -p '{"metadata":{"finalizers":null}}' --type=merge

# Remove ONE finalizer by index (JSON patch) — check the order first
kubectl patch configmap my-cm --type=json \
  -p='[{"op":"remove","path":"/metadata/finalizers/0"}]'

# Remove ONE finalizer by name, keep the others
kubectl get mycr my-resource -o json | \
  jq '.metadata.finalizers |= map(select(. != "example.com/cleanup"))' | \
  kubectl replace -f -

# Bulk: strip finalizers from every CR of a kind (controller uninstalled)
kubectl get mycustomresource -A -o name | \
  xargs -I {} kubectl patch {} --type=merge -p '{"metadata":{"finalizers":[]}}'

# Namespace: spec.finalizers can ONLY be cleared via the /finalize subresource
kubectl get namespace stuck-ns -o json | \
  jq '.spec.finalizers = []' | \
  kubectl replace --raw "/api/v1/namespaces/stuck-ns/finalize" -f -

# Using kubectl edit
kubectl edit pvc my-pvc
# Delete the finalizers list and save
```

To add a finalizer (e.g. when testing an operator), use `kubectl patch configmap my-cm --type=json -p='[{"op":"add","path":"/metadata/finalizers/-","value":"example.com/cleanup"}]'`.

## Fix Stuck PV/PVC

```bash
# PVC stuck in Terminating (kubernetes.io/pvc-protection — still in use)
kubectl get pods --all-namespaces -o json | \
  jq -r '.items[] | select(.spec.volumes[]?.persistentVolumeClaim.claimName == "my-pvc") | .metadata.namespace + "/" + .metadata.name'

# Remove the pod (or scale down its Deployment/StatefulSet) first
kubectl delete pod <pod-using-pvc>

# If still stuck, remove finalizer (after confirming no usage)
kubectl patch pvc my-pvc -p '{"metadata":{"finalizers":null}}' --type=merge

# PV stuck after PVC deleted (kubernetes.io/pv-protection or CSI finalizer)
kubectl patch pv my-pv -p '{"metadata":{"finalizers":null}}' --type=merge
# If a CSI finalizer was removed, delete the backing disk in the cloud console manually
```

## Fix Stuck CRDs and Custom Resources

```bash
# CRD stuck in deletion — customresourcecleanup finalizer waits for all instances
kubectl get crd stuck-crd.example.com -o jsonpath='{.metadata.finalizers}'

# Delete all instances of the CRD first
kubectl delete <crd-kind> --all -A

# Instances hang too? Their operator is gone — strip their finalizers (bulk command above),
# then the CRD finishes deleting on its own. Last resort:
kubectl patch crd stuck-crd.example.com -p '{"metadata":{"finalizers":null}}' --type=merge
```

While a CRD is terminating, any attempt to create an instance fails with `create not allowed while custom resource definition is terminating`. Wait for (or unblock) the CRD deletion, then re-apply the CRD before recreating resources—common when reinstalling an operator or Helm chart that ships CRDs.

**Argo CD Application stuck deleting** (`resources-finalizer.argocd.argoproj.io` can't reach the destination cluster):

```bash
kubectl patch application my-app -n argocd --type=json \
  -p='[{"op":"remove","path":"/metadata/finalizers"}]'
```

## Foreground vs Background Deletion

```bash
# Background deletion (default)
# - Owner deleted immediately
# - Dependents deleted asynchronously by the garbage collector
kubectl delete deployment my-deploy

# Foreground deletion
# - Owner gets the foregroundDeletion finalizer and stays Terminating
#   until all dependents with blockOwnerDeletion=true are gone
kubectl delete deployment my-deploy --cascade=foreground

# Orphan dependents
# - Owner deleted, dependents kept (orphan finalizer strips ownerReferences)
kubectl delete deployment my-deploy --cascade=orphan
```

Garbage collection is driven by `ownerReferences` on the child, not by finalizers on the parent:

```yaml
apiVersion: v1
kind: Pod
metadata:
  name: web-abc123
  ownerReferences:
    - apiVersion: apps/v1
      kind: ReplicaSet
      name: web-5d8c4b7f6
      uid: a1b2c3d4-e5f6-7890-abcd-ef1234567890
      controller: true
      blockOwnerDeletion: true  # Owner can't finish foreground deletion until this pod is gone
```

Use owner references for in-cluster parent/child cleanup; use finalizers when cleanup involves something outside Kubernetes.

## Implement a Custom Finalizer (Operator Pattern)

Add the finalizer on create, clean up when `deletionTimestamp` is set, then remove it:

```go
const finalizerName = "example.com/cleanup" // domain-qualified to avoid collisions

func (r *Reconciler) Reconcile(ctx context.Context, req ctrl.Request) (ctrl.Result, error) {
    obj := &v1alpha1.MyResource{}
    if err := r.Get(ctx, req.NamespacedName, obj); err != nil {
        return ctrl.Result{}, client.IgnoreNotFound(err)
    }

    if !obj.DeletionTimestamp.IsZero() {
        if controllerutil.ContainsFinalizer(obj, finalizerName) {
            // Must be idempotent: may run again after a controller restart
            if err := r.cleanupExternalResources(ctx, obj); err != nil {
                return ctrl.Result{}, err // requeued with backoff
            }
            controllerutil.RemoveFinalizer(obj, finalizerName)
            if err := r.Update(ctx, obj); err != nil {
                return ctrl.Result{}, err
            }
        }
        return ctrl.Result{}, nil
    }

    if controllerutil.AddFinalizer(obj, finalizerName) {
        if err := r.Update(ctx, obj); err != nil {
            return ctrl.Result{}, err
        }
    }
    return ctrl.Result{}, nil
}
```

Only add a finalizer if a controller will always be running to remove it—otherwise every delete gets stuck.

## Debug Finalizer Issues

```bash
# Check controller logs for finalizer
kubectl logs -n kube-system deployment/kube-controller-manager | grep -i finalizer

# For custom controllers
kubectl logs deployment/my-controller | grep -i cleanup

# Check events
kubectl get events --field-selector involvedObject.name=stuck-resource

# Check if API services are healthy (can block namespace deletion)
kubectl get apiservices | grep False
```

## Common Issues

| Symptom | Cause | Fix |
|---------|-------|-----|
| Namespace stuck, `DiscoveryFailed` condition | Broken APIService (e.g. metrics-server down) | Fix or `kubectl delete apiservice <name>` |
| `kubectl patch ns ... finalizers:null` does nothing | Namespace's `kubernetes` finalizer lives in `spec`, not `metadata` | Use the `/finalize` subresource |
| Pods reappear after removing finalizers | Owner (Deployment/StatefulSet) still exists | Delete the owner first |
| Pod stuck Terminating, no finalizers | Node is dead/unreachable, kubelet can't confirm | `kubectl delete pod <pod> --grace-period=0 --force` |
| `kubectl delete` hangs | Client waits for finalizers | `--wait=false` returns immediately (object still exists) |
| Cloud disk/LB left behind | Finalizer was protecting an external resource | Clean it up manually in the provider |

## Automated Cleanup Script

```bash
#!/bin/bash
# force-delete-namespace.sh
NS=$1

if [ -z "$NS" ]; then
  echo "Usage: $0 <namespace>"
  exit 1
fi

echo "Checking namespace $NS..."

# Check if namespace exists and is terminating
STATUS=$(kubectl get namespace $NS -o jsonpath='{.status.phase}' 2>/dev/null)
if [ "$STATUS" != "Terminating" ]; then
  echo "Namespace is not in Terminating state (status: $STATUS)"
  exit 1
fi

# Remove finalizers
echo "Removing finalizers from namespace $NS..."
kubectl get namespace $NS -o json | \
  jq 'del(.spec.finalizers)' | \
  kubectl replace --raw "/api/v1/namespaces/$NS/finalize" -f -

echo "Done. Check namespace status:"
kubectl get namespace $NS
```

## Prevent Stuck Resources

```bash
# Monitor for stuck resources
kubectl get namespaces --field-selector status.phase=Terminating
```

```yaml
# Prometheus alert (kube-state-metrics) for long-terminating namespaces
- alert: NamespaceStuckTerminating
  expr: kube_namespace_status_phase{phase="Terminating"} == 1
  for: 1h
```

Uninstall in reverse order: delete custom resources while their operator is still running, then the operator, then the CRDs.

## Best Practices

```markdown
1. Understand before removing
   - Finalizers exist for a reason
   - Removing may leave orphaned resources
   - Check what controller owns the finalizer

2. Fix root cause first
   - Delete dependent resources properly
   - Ensure controllers are running
   - Check for unhealthy API services

3. Custom controllers
   - Use domain-qualified finalizer names
   - Make cleanup idempotent and retry on error
   - Implement timeouts and log cleanup progress

4. Monitor stuck resources
   - Alert on Terminating state > threshold
   - Regular audit of orphaned resources
```

## Frequently Asked Questions

### What is a finalizer in Kubernetes?

A finalizer is a key in an object's `metadata.finalizers` list that makes deletion a two-phase process. `kubectl delete` only sets `deletionTimestamp`; the object stays (in `Terminating`) until every controller that added a finalizer has done its cleanup and removed its entry. Finalizers in k8s protect things like in-use volumes, namespace contents, and cloud resources managed by operators.

### How do I remove a finalizer with kubectl patch?

Clear all of them with `kubectl patch <kind> <name> --type=merge -p '{"metadata":{"finalizers":null}}'`, or remove one with a JSON patch: `kubectl patch <kind> <name> --type=json -p='[{"op":"remove","path":"/metadata/finalizers/0"}]'`. Namespaces are the exception—use the `/finalize` subresource shown above.

### What is the foregroundDeletion finalizer?

`foregroundDeletion` is added by the API server when you delete with `--cascade=foreground` (or `propagationPolicy: Foreground`). The owner stays in `Terminating` until the garbage collector deletes all dependents that have `blockOwnerDeletion: true`. If a dependent is itself stuck, the owner is stuck too—fix the dependent rather than removing `foregroundDeletion`.

### Why is my namespace stuck in Terminating?

Either an object inside it still has a finalizer (often a custom resource whose operator was uninstalled), or an unavailable APIService prevents the namespace controller from listing all resource types. Check `.status.conditions`, run `kubectl get apiservices | grep False`, and delete leftovers before clearing `spec.finalizers` via `/finalize`.

### What is kubernetes.io/pvc-protection?

It's a finalizer automatically added to every PVC. It keeps a PVC in `Terminating` while any pod still mounts it, preventing data loss. Delete or scale down the pods using the PVC and it completes on its own; only patch it out if you've confirmed nothing mounts the volume. `kubernetes.io/pv-protection` does the same for a PV bound to a PVC.

### Why is my Helm chart stuck uninstalling?

Helm itself doesn't use finalizers, but `helm uninstall` waits on the resources it deletes. Common causes: a `pre-delete` hook Job that never succeeds (skip it with `helm uninstall <release> --no-hooks`), custom resources whose operator the same chart just removed (their finalizers can never be processed), or `--wait` blocking on PVCs held by `pvc-protection`. Find the Terminating objects with the namespace commands above and fix or patch them.

### What does "create not allowed while custom resource definition is terminating" mean?

The CRD has been deleted but its `customresourcecleanup.apiextensions.k8s.io` finalizer is still waiting for existing instances to go away, so the API server rejects new instances. Remove the remaining custom resources (patching out their finalizers if their operator is gone), let the CRD finish deleting, then re-create the CRD and your resources.

## Summary

Finalizers ensure proper cleanup before resource deletion by blocking removal until controllers complete their work. When resources get stuck in Terminating state, diagnose by checking remaining finalizers, dependent resources, and API service health. Remove finalizers only after understanding the implications - this bypasses cleanup and may leave orphaned resources. For stuck namespaces, use the finalize API endpoint. Always try to fix the root cause (delete dependents, restart controllers) before force-removing finalizers.

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
