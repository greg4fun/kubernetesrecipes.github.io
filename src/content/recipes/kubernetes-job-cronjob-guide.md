---
title: "K8s Jobs and CronJobs: Complete Guide"
description: "Create Kubernetes Jobs and CronJobs for batch processing. Parallelism, backoff limits, completion counts, cron schedules, and failure handling patterns."
publishDate: "2026-05-02"
author: "Luca Berton"
category: "deployments"
difficulty: "beginner"
timeToComplete: "10 minutes"
kubernetesVersion: "1.28+"
tags:
  - "jobs"
  - "cronjobs"
  - "batch"
  - "scheduling"
  - "cka"
relatedRecipes:
  - "cronjob-concurrency-policy"
  - "kubernetes-init-containers-guide"
  - "kubernetes-deployment-rolling-update"
---

> 💡 **Quick Answer:** A Job runs a pod to completion: `kubectl create job myjob --image=busybox -- echo hello`. A CronJob runs Jobs on a schedule: `schedule: "0 * * * *"` (hourly). Key settings: `backoffLimit: 4` (retries), `completions: 5` (run 5 times), `parallelism: 3` (3 pods at once), `concurrencyPolicy: Forbid` (skip if previous still running).

## The Problem

Not all workloads run forever — some need to:

- Process a batch of items and exit
- Run database migrations once
- Generate reports on a schedule
- Clean up old resources periodically

## The Solution

### Basic Job

```yaml
apiVersion: batch/v1
kind: Job
metadata:
  name: data-migration
spec:
  backoffLimit: 4           # Retry up to 4 times on failure
  activeDeadlineSeconds: 600  # Kill after 10 minutes
  template:
    spec:
      containers:
      - name: migrate
        image: myapp:v2
        command: ["./migrate", "--target", "latest"]
        env:
        - name: DATABASE_URL
          valueFrom:
            secretKeyRef:
              name: db-creds
              key: url
      restartPolicy: Never    # Required: Never or OnFailure
```

```bash
# Create job imperatively
kubectl create job myjob --image=busybox -- echo "hello world"

# Watch job status
kubectl get jobs -w
# NAME             COMPLETIONS   DURATION   AGE
# data-migration   1/1           45s        2m

# Check logs
kubectl logs job/data-migration

# Delete job (and its pods)
kubectl delete job data-migration
```

### Parallel Jobs

```yaml
# Process 10 items, 3 at a time
apiVersion: batch/v1
kind: Job
metadata:
  name: batch-processor
spec:
  completions: 10     # Total successful completions needed
  parallelism: 3      # Run 3 pods simultaneously
  backoffLimit: 5
  template:
    spec:
      containers:
      - name: worker
        image: myworker:v1
        env:
        - name: JOB_COMPLETION_INDEX
          valueFrom:
            fieldRef:
              fieldPath: metadata.annotations['batch.kubernetes.io/job-completion-index']
      restartPolicy: Never

---
# Indexed job (K8s 1.24+) — each pod gets unique index
apiVersion: batch/v1
kind: Job
metadata:
  name: indexed-job
spec:
  completions: 5
  parallelism: 5
  completionMode: Indexed    # Each pod gets JOB_COMPLETION_INDEX 0-4
  template:
    spec:
      containers:
      - name: worker
        image: myworker:v1
        command: ["./process", "--partition"]
        env:
        - name: PARTITION
          valueFrom:
            fieldRef:
              fieldPath: metadata.annotations['batch.kubernetes.io/job-completion-index']
      restartPolicy: Never
```

### CronJob

```yaml
apiVersion: batch/v1
kind: CronJob
metadata:
  name: daily-report
spec:
  schedule: "0 6 * * *"          # 6 AM daily
  timeZone: "Europe/Rome"        # K8s 1.27+
  concurrencyPolicy: Forbid      # Skip if previous still running
  successfulJobsHistoryLimit: 3  # Keep last 3 successful
  failedJobsHistoryLimit: 1      # Keep last 1 failed
  startingDeadlineSeconds: 300   # Don't start if 5min late
  jobTemplate:
    spec:
      backoffLimit: 2
      template:
        spec:
          containers:
          - name: reporter
            image: myapp:v2
            command: ["./generate-report"]
          restartPolicy: OnFailure
```

### Cron Schedule Syntax

```
┌───────── minute (0-59)
│ ┌───────── hour (0-23)
│ │ ┌───────── day of month (1-31)
│ │ │ ┌───────── month (1-12)
│ │ │ │ ┌───────── day of week (0-6, Sun=0)
│ │ │ │ │
* * * * *

# Examples:
"0 * * * *"      # Every hour
"*/15 * * * *"   # Every 15 minutes
"0 6 * * *"      # Daily at 6 AM
"0 6 * * 1-5"    # Weekdays at 6 AM
"0 0 1 * *"      # First day of month at midnight
"0 6,18 * * *"   # 6 AM and 6 PM daily
```

### ConcurrencyPolicy Options

| Policy | Behavior |
|--------|----------|
| `Allow` (default) | Multiple jobs can run simultaneously |
| `Forbid` | Skip new job if previous still running |
| `Replace` | Kill running job, start new one |

### Manage Jobs

```bash
# Create CronJob
kubectl create cronjob hourly-cleanup --image=busybox \
  --schedule="0 * * * *" -- /bin/sh -c "echo cleanup"

# Trigger CronJob manually
kubectl create job manual-run --from=cronjob/daily-report

# Suspend CronJob
kubectl patch cronjob daily-report -p '{"spec":{"suspend":true}}'

# Resume
kubectl patch cronjob daily-report -p '{"spec":{"suspend":false}}'

# List recent jobs from a CronJob
kubectl get jobs -l job-name -o wide
```

## Common Issues

**Job pods not cleaned up**

Set `ttlSecondsAfterFinished: 300` to auto-delete completed job pods after 5 minutes.

**CronJob missed schedule**

If `startingDeadlineSeconds` passed, the run is skipped. Check controller logs: `kubectl logs -n kube-system -l component=kube-controller-manager`.

**Job stuck — pods keep failing**

`backoffLimit` reached. Check pod logs: `kubectl logs <pod>`. Exponential backoff: 10s, 20s, 40s...

## Best Practices

- **Set `activeDeadlineSeconds`** — prevent runaway jobs from consuming resources forever
- **Set `backoffLimit`** — don't retry infinitely on permanent failures
- **Use `concurrencyPolicy: Forbid`** for CronJobs — prevent overlap
- **Set `ttlSecondsAfterFinished`** — auto-cleanup completed job pods
- **Use `timeZone`** (K8s 1.27+) — avoid UTC confusion for scheduled tasks

## Key Takeaways

- Jobs run pods to completion with configurable retries and parallelism
- CronJobs create Jobs on a cron schedule with concurrency control
- `completions` × `parallelism` controls total work and concurrent pods
- `concurrencyPolicy: Forbid` prevents overlapping runs
- Always set `backoffLimit` and `activeDeadlineSeconds` for safety
