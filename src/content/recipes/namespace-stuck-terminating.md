---
title: "Fix Namespace Stuck in Terminating"
description: "Remove Kubernetes namespaces stuck in Terminating state. Identify blocking finalizers, orphaned API resources, and safely force namespace cleanup procedures."
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
relatedRecipes:
  - "debug-crashloopbackoff"
  - "persistent-volume-stuck-terminating"
---
> 💡 **Quick Answer:** A namespace stuck in Terminating has resources with unresolvable finalizers. Check `kubectl get all -n <ns>` for remaining resources, then `kubectl get ns <ns> -o json | jq '.status.conditions'` for the reason. Remove stuck finalizers or delete orphaned resources to unblock.

## The Problem

You ran `kubectl delete namespace myapp` but it's been stuck at `Terminating` for hours or days. The namespace won't go away, you can't create a new namespace with the same name, and `kubectl get ns` shows it perpetually Terminating.

## The Solution

### Step 1: Check What's Blocking

```bash
# Check namespace conditions
kubectl get ns myapp -o json | jq '.status.conditions'
# Look for "NamespaceDeletionContentFailure" or "NamespaceDeletionDiscoveryFailure"

# List ALL resources in the namespace
kubectl api-resources --verbs=list --namespaced -o name | \
  xargs -I{} kubectl get {} -n myapp --ignore-not-found --show-kind 2>/dev/null
```

### Step 2: Delete Remaining Resources

```bash
# Common culprits: CRDs, PVCs, Secrets with finalizers
kubectl get pvc -n myapp
kubectl get secrets -n myapp
kubectl get sa -n myapp

# Delete stuck resources
kubectl delete pvc --all -n myapp --force --grace-period=0
```

### Step 3: Remove Namespace Finalizer (Last Resort)

```bash
# Export namespace JSON
kubectl get ns myapp -o json > /tmp/ns.json

# Remove the kubernetes finalizer
cat /tmp/ns.json | jq '.spec.finalizers = []' > /tmp/ns-clean.json

# Replace via API (bypass kubectl)
kubectl replace --raw "/api/v1/namespaces/myapp/finalize" -f /tmp/ns-clean.json
```

### Step 4: Verify

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

## Key Takeaways

- Stuck namespaces have resources or finalizers that can't be resolved
- Use `kubectl api-resources` to find ALL remaining resources (not just `kubectl get all`)
- Removing the namespace finalizer via `/finalize` API is the nuclear option
- Prevent this by deleting CRD instances before CRDs, and resources before namespaces
