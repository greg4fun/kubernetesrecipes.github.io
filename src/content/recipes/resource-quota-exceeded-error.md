---
title: "Fix ResourceQuota Exceeded Errors"
description: "Debug resource quota violations preventing pod scheduling. Understand LimitRange defaults, ResourceQuota, and namespace management."
publishDate: "2026-03-19"
author: "Luca Berton"
category: "troubleshooting"
difficulty: "beginner"
timeToComplete: "15 minutes"
kubernetesVersion: "1.28+"
tags:
  - resourcequota
  - limitrange
  - scheduling
  - resources
  - troubleshooting
relatedRecipes:
  - "debug-pod-eviction-reasons"
  - "fix-oomkilled-pod"
---
> 💡 **Quick Answer:** `forbidden: exceeded quota` means the namespace has a ResourceQuota and your pod's requests exceed the remaining budget. Check `kubectl describe quota -n <ns>` to see used vs. hard limits. Free up quota by deleting unused pods or increasing the quota.

## The Problem

Pod creation fails with:
```
Error from server (Forbidden): pods "myapp-xyz" is forbidden:
  exceeded quota: compute-quota, requested: cpu=500m,memory=512Mi,
  used: cpu=3500m,memory=7Gi, limited: cpu=4,memory=8Gi
```

## The Solution

### Step 1: Check Current Quota Usage

```bash
kubectl describe quota -n myapp
# Name:           compute-quota
# Resource        Used    Hard
# --------        ----    ----
# cpu             3500m   4       ← Only 500m remaining
# memory          7Gi     8Gi     ← Only 1Gi remaining
# pods            7       20
# requests.cpu    3500m   4
# requests.memory 7Gi     8Gi
```

### Step 2: Find What's Consuming Quota

```bash
# List all pods and their resource requests
kubectl get pods -n myapp -o json | jq -r '
  .items[] |
  .metadata.name as $name |
  .spec.containers[] |
  "\($name): cpu=\(.resources.requests.cpu // "none") memory=\(.resources.requests.memory // "none")"
'
```

### Step 3: Fix — Free Up or Increase Quota

```bash
# Option A: Delete unused pods/deployments
kubectl delete deploy old-service -n myapp

# Option B: Reduce resource requests
kubectl set resources deploy myapp --requests=cpu=200m,memory=256Mi -n myapp

# Option C: Increase quota (requires cluster-admin)
kubectl patch resourcequota compute-quota -n myapp --type merge -p '{
  "spec": {"hard": {"cpu": "8", "memory": "16Gi"}}
}'
```

### LimitRange Defaults

If pods don't specify resources, a LimitRange may inject defaults that count against quota:

```bash
kubectl describe limitrange -n myapp
# Default Request: cpu=250m, memory=256Mi
# Even pods WITHOUT explicit requests get these defaults → they consume quota
```

## Common Issues

### Quota Counts Terminating Pods

Pods in Terminating state still count. Force-delete stuck terminating pods to free quota.

### Quota Blocks Scaling

HPA can't scale up because quota is exhausted. Either increase quota or set conservative HPA maxReplicas.

## Best Practices

- **Always set resource requests** — without them, LimitRange defaults apply (which may be too high)
- **Monitor quota usage** — alert at 80% to prevent surprise failures
- **Use separate quotas per team** — prevents one team from consuming all resources
- **Set both requests and limits quotas** — `requests.cpu` for scheduling, `limits.cpu` for burst

## Key Takeaways

- ResourceQuota caps total resource requests per namespace
- `kubectl describe quota` shows used vs hard limits at a glance
- LimitRange injects default requests — these count against quota even if you didn't set them
- Free quota by deleting pods, reducing requests, or increasing the quota
