---
title: "Fix Kubernetes Namespace Stuck in Terminating"
description: "Fix a Kubernetes namespace stuck in Terminating: find leftover resources, finalizers and broken APIServices, then force-remove the namespace finalizer safely."
publishDate: "2026-03-19"
author: "Luca Berton"
category: "troubleshooting"
difficulty: "beginner"
timeToComplete: "15 minutes"
kubernetesVersion: "1.28+"
tags:
  - namespace
  - terminating
  - finalizer
  - cleanup
  - troubleshooting
  - stuck
  - apiservice
relatedRecipes:
  - "stuck-resources-finalizers"
  - "kubernetes-namespace-guide"
  - "crashloopbackoff-troubleshooting"
  - "persistent-volume-stuck-terminating"
  - "fix-kubernetes-certificate-errors"
---
> 💡 **Quick Answer:** A namespace stuck in Terminating has resources with unresolvable finalizers. Check `kubectl get all -n <ns>` for remaining resources, then `kubectl get ns <ns> -o json | jq '.status.conditions'` for the reason. Remove stuck finalizers or delete orphaned resources to unblock.
>
> **Key command (last resort):** `kubectl get ns myapp -o json | jq '.spec.finalizers = []' | kubectl replace --raw "/api/v1/namespaces/myapp/finalize" -f -`
>
> **Gotcha:** `NamespaceDeletionDiscoveryFailure` means an aggregated APIService (often `v1beta1.metrics.k8s.io`) is down — fix or delete that APIService and the namespace finishes on its own.

## The Problem

You ran `kubectl delete namespace myapp` but it's been stuck at `Terminating` for hours or days. The namespace won't go away, you can't create a new namespace with the same name, and `kubectl get ns` shows it perpetually Terminating.

## The Solution

### Step 1: Check What's Blocking

```bash
# Check namespace conditions
kubectl get ns myapp -o json | jq '.status.conditions'
# NamespaceDeletionDiscoveryFailure -> an APIService is unavailable (see below)
# NamespaceContentRemaining / NamespaceFinalizersRemaining -> leftover objects with finalizers
# NamespaceDeletionContentFailure -> a delete call failed (often an admission webhook)

# List ALL resources in the namespace
kubectl api-resources --verbs=list --namespaced -o name | \
  xargs -I{} kubectl get {} -n myapp --ignore-not-found --show-kind 2>/dev/null
```

### Step 2: Fix Unavailable APIServices

```bash
kubectl get apiservice | grep -v True
# v1beta1.metrics.k8s.io   kube-system/metrics-server   False (MissingEndpoints)
```

The namespace controller must list every namespaced API before it can finish. Restore the backing service, or delete the stale APIService if the add-on was removed: `kubectl delete apiservice v1beta1.metrics.k8s.io`.

### Step 3: Clear Remaining Resources

```bash
# Find what's left and which finalizer holds it
kubectl api-resources --verbs=list --namespaced -o name \
  | xargs -n1 kubectl get -n myapp --ignore-not-found -o name 2>/dev/null \
  | xargs -r -n1 kubectl get -n myapp -o jsonpath='{.kind}/{.metadata.name}: {.metadata.finalizers}{"\n"}'

# Let the owning controller clean up if it still exists; otherwise drop the finalizer
kubectl patch <kind>/<name> -n myapp --type=merge -p '{"metadata":{"finalizers":null}}'
```

`--force --grace-period=0` does **not** bypass finalizers — it only skips graceful pod termination. PVCs held by `kubernetes.io/pvc-protection` release once no pod uses them. More on finalizers: [stuck resources and finalizers](/recipes/troubleshooting/stuck-resources-finalizers/).

### Step 4: Remove Namespace Finalizer (Last Resort)

```bash
# Export namespace JSON
kubectl get ns myapp -o json > /tmp/ns.json

# Remove the kubernetes finalizer
cat /tmp/ns.json | jq '.spec.finalizers = []' > /tmp/ns-clean.json

# Replace via API (bypass kubectl)
kubectl replace --raw "/api/v1/namespaces/myapp/finalize" -f /tmp/ns-clean.json
```

On OpenShift the same works with `oc`; do this only after Steps 2–3, because anything still inside becomes orphaned in etcd and external resources (load balancers, cloud disks, DNS) are never cleaned up.

### Step 5: Verify

```bash
kubectl get ns myapp
# Should return: Error from server (NotFound)
```

## Common Issues

### CRD Resources Blocking Deletion

If a CRD was deleted before the CR instances, the namespace can't clean up the orphaned custom resources:
```bash
# Reinstall the CRD temporarily
kubectl apply -f crd.yaml
# Delete the CR instances
kubectl delete <cr-kind> --all -n myapp
# Then delete namespace again
```

### Webhook Blocking Deletion

A validating webhook that matches DELETE operations can block namespace cleanup. Check webhooks and temporarily set `failurePolicy: Ignore`.

## Best Practices

- **Delete resources before namespaces** — especially CRD instances
- **Don't delete CRDs before their instances** — creates orphaned resources
- **Use `--force --grace-period=0`** only as a last resort
- **Check for operator-managed resources** — operators may recreate resources during deletion

## Frequently Asked Questions

### Why is my namespace stuck in Terminating?

Either an object inside still has a finalizer whose controller is gone or failing, or the namespace controller can't enumerate resources because an aggregated APIService is unavailable. `kubectl get ns <ns> -o json | jq .status.conditions` tells you which.

### How do I force delete a namespace stuck in Terminating?

Clear the namespace's `spec.finalizers` through the finalize subresource: `kubectl get ns <ns> -o json | jq '.spec.finalizers = []' | kubectl replace --raw "/api/v1/namespaces/<ns>/finalize" -f -`. `kubectl delete ns --force --grace-period=0` alone does not work.

### Is it safe to remove the namespace finalizer?

It completes the deletion, but any remaining objects are orphaned and their external resources may leak. Fix APIServices and clean up finalizers on the contained objects first; use the finalize call only when nothing important remains.

## Key Takeaways

- Stuck namespaces have resources or finalizers that can't be resolved
- Use `kubectl api-resources` to find ALL remaining resources (not just `kubectl get all`)
- Removing the namespace finalizer via `/finalize` API is the nuclear option
- Prevent this by deleting CRD instances before CRDs, and resources before namespaces
