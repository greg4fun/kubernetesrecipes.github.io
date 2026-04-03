---
title: "Fix Kubernetes Job Failures and Retries"
description: "Debug Kubernetes Jobs stuck in backoff or hitting retry limits. Covers backoffLimit, activeDeadlineSeconds, and CronJob overlap."
category: "troubleshooting"
difficulty: "intermediate"
publishDate: "2026-04-02"
tags: ["jobs", "cronjob", "backoff", "retry", "troubleshooting"]
author: "Luca Berton"
relatedRecipes:
  - "debug-crashloopbackoff"
  - "cronjob-concurrency-policy"
---

> 💡 **Quick Answer:** Debug Jobs stuck in backoff, hitting retry limits, or producing wrong completions count. Covers backoffLimit, activeDeadlineSeconds, TTL cleanup, and indexed Jobs.

## The Problem

This is a common issue in Kubernetes troubleshooting that catches both beginners and experienced operators.

## The Solution

### Step 1: Check Job Status

```bash
kubectl describe job my-job | grep -A10 "Pods Statuses\|Events"
# Pods Statuses:  0 Active / 0 Succeeded / 6 Failed

# Check why pods failed
kubectl logs job/my-job
kubectl logs job/my-job --previous
```

### Step 2: Common Fixes

**Job hit backoffLimit:**
```yaml
apiVersion: batch/v1
kind: Job
metadata:
  name: my-job
spec:
  backoffLimit: 6          # Default: 6 retries
  activeDeadlineSeconds: 600  # Kill after 10 minutes total
  template:
    spec:
      restartPolicy: Never   # Never = new pod per retry
                              # OnFailure = restart same pod
```

**CronJob overlap:**
```yaml
apiVersion: batch/v1
kind: CronJob
metadata:
  name: my-cronjob
spec:
  schedule: "*/5 * * * *"
  concurrencyPolicy: Forbid    # Skip if previous still running
  startingDeadlineSeconds: 300  # Skip if >5min late
  successfulJobsHistoryLimit: 3
  failedJobsHistoryLimit: 5
```

**Job completed but pods not cleaned up:**
```yaml
spec:
  ttlSecondsAfterFinished: 3600  # Auto-delete 1h after completion
```

**Job needs to run on specific node:**
```yaml
template:
  spec:
    nodeSelector:
      node-type: compute
    tolerations:
      - key: workload
        value: batch
        effect: NoSchedule
```

## Best Practices

- **Monitor proactively** with Prometheus alerts before issues become incidents
- **Document runbooks** for your team's most common failure scenarios
- **Use `kubectl describe` and events** as your first debugging tool
- **Automate recovery** where possible with operators or scripts

## Key Takeaways

- Always check events and logs first — Kubernetes tells you what's wrong
- Most issues have clear error messages pointing to the root cause
- Prevention through monitoring and proper configuration beats reactive debugging
- Keep this recipe bookmarked for quick reference during incidents
