---
title: "How to Configure CronJob Concurrency Policy"
description: "Master Kubernetes CronJob concurrency policies to control parallel execution. Learn when to use Allow, Forbid, and Replace with real-world examples and troubleshooting tips."
category: "deployments"
difficulty: "intermediate"
timeToComplete: "15 minutes"
kubernetesVersion: "1.28+"
prerequisites:
  - "A running Kubernetes cluster"
  - "kubectl configured with appropriate permissions"
  - "Basic understanding of CronJobs"
relatedRecipes:
  - "jobs-cronjobs"
  - "cronjob-timezone-handling"
  - "job-parallelism-completions"
tags:
  - cronjob
  - concurrency
  - scheduling
  - batch
  - kubernetes
publishDate: "2026-02-03"
author: "Luca Berton"
---

## The Problem

Your CronJob runs every 5 minutes, but sometimes the previous job hasn't finished when the next one starts. This leads to:
- Resource contention
- Duplicate processing
- Database locks
- Unexpected behavior

You need to control what happens when a new CronJob schedule triggers while a previous job is still running.

## The Solution

Kubernetes provides three concurrency policies via `spec.concurrencyPolicy`:

| Policy | Behavior | Use When |
|--------|----------|----------|
| **Allow** (default) | Multiple jobs can run simultaneously | Jobs are idempotent and independent |
| **Forbid** | Skip new job if previous is still running | Jobs must run sequentially |
| **Replace** | Cancel running job and start new one | Only latest data matters |

## Quick Start

```yaml
apiVersion: batch/v1
kind: CronJob
metadata:
  name: data-sync
spec:
  schedule: "*/5 * * * *"
  concurrencyPolicy: Forbid  # Change this based on your needs
  jobTemplate:
    spec:
      template:
        spec:
          containers:
          - name: sync
            image: myapp/sync:v1
          restartPolicy: OnFailure
```

## Concurrency Policy: Allow (Default)

With `Allow`, multiple Job instances can run at the same time.

```yaml
apiVersion: batch/v1
kind: CronJob
metadata:
  name: parallel-reports
spec:
  schedule: "0 * * * *"
  concurrencyPolicy: Allow
  jobTemplate:
    spec:
      template:
        spec:
          containers:
          - name: report
            image: reports:v1
            env:
            - name: REPORT_TIME
              value: "$(date +%H)"
          restartPolicy: OnFailure
```

**When to use Allow:**
- Jobs process independent data (e.g., different time ranges)
- Jobs are fully idempotent
- Jobs don't share resources (databases, files, APIs)
- You want maximum throughput

**⚠️ Warning:** If your job takes longer than the schedule interval, you'll accumulate running jobs, potentially exhausting cluster resources.

## Concurrency Policy: Forbid

With `Forbid`, the new job is skipped if the previous one is still running.

```yaml
apiVersion: batch/v1
kind: CronJob
metadata:
  name: database-backup
spec:
  schedule: "0 2 * * *"
  concurrencyPolicy: Forbid
  startingDeadlineSeconds: 3600  # Important: allow delayed start
  jobTemplate:
    spec:
      template:
        spec:
          containers:
          - name: backup
            image: backup:v1
            volumeMounts:
            - name: backup-volume
              mountPath: /backups
          restartPolicy: OnFailure
          volumes:
          - name: backup-volume
            persistentVolumeClaim:
              claimName: backup-pvc
```

**When to use Forbid:**
- Jobs must not overlap (database backups, file processing)
- Missing an occasional run is acceptable
- Jobs share external resources with locks
- Data integrity is critical

**💡 Tip:** Always set `startingDeadlineSeconds` with Forbid. If a job is blocked for longer than this deadline, Kubernetes will skip it entirely rather than running it late.

## Concurrency Policy: Replace

With `Replace`, the currently running job is terminated and a new one starts.

```yaml
apiVersion: batch/v1
kind: CronJob
metadata:
  name: cache-refresh
spec:
  schedule: "*/10 * * * *"
  concurrencyPolicy: Replace
  jobTemplate:
    spec:
      activeDeadlineSeconds: 540  # Kill if running > 9 minutes
      template:
        spec:
          containers:
          - name: refresh
            image: cache-refresh:v1
          restartPolicy: OnFailure
```

**When to use Replace:**
- Only the latest run matters (cache refresh, status updates)
- Stale data is worse than interrupted processing
- Jobs should never run past their next scheduled time

**⚠️ Warning:** The terminated job's pods receive SIGTERM. Ensure your application handles graceful shutdown.

## Monitoring CronJob Concurrency

Check if jobs are being skipped or replaced:

```bash
# List recent CronJob events
kubectl describe cronjob <name> | grep -A 20 "Events:"

# Check for skipped executions
kubectl get events --field-selector reason=MissSchedule

# See active vs completed jobs
kubectl get jobs -l app=<cronjob-name> --sort-by=.status.startTime
```

## Common Mistakes ⚠️

### 1. Using Allow without resource limits
```yaml
# ❌ Bad: Unbounded jobs can accumulate
spec:
  concurrencyPolicy: Allow
  # No resource limits or activeDeadlineSeconds

# ✅ Good: Add safeguards
spec:
  concurrencyPolicy: Allow
  jobTemplate:
    spec:
      activeDeadlineSeconds: 1800
      template:
        spec:
          containers:
          - name: job
            resources:
              limits:
                memory: "512Mi"
                cpu: "500m"
```

### 2. Forbid without startingDeadlineSeconds
```yaml
# ❌ Bad: Missed jobs disappear silently
spec:
  concurrencyPolicy: Forbid
  
# ✅ Good: Set a reasonable deadline
spec:
  concurrencyPolicy: Forbid
  startingDeadlineSeconds: 600  # Allow 10 min delay
```

### 3. Replace without graceful shutdown handling
```yaml
# ❌ Bad: Job gets killed mid-transaction
containers:
- name: db-job
  command: ["./process.sh"]

# ✅ Good: Handle SIGTERM
containers:
- name: db-job
  command: ["./process.sh"]
  lifecycle:
    preStop:
      exec:
        command: ["/bin/sh", "-c", "cleanup.sh"]
```

## Decision Flowchart

```
Is the job idempotent?
├── YES → Can multiple instances run safely?
│   ├── YES → Use Allow (with resource limits)
│   └── NO → Use Forbid
└── NO → Does only the latest run matter?
    ├── YES → Use Replace
    └── NO → Use Forbid + fix your job to be idempotent
```

## Troubleshooting

**Jobs keep piling up:**
- Check if jobs are taking longer than schedule interval
- Add `activeDeadlineSeconds` to kill slow jobs
- Consider increasing schedule interval or using Forbid

**Jobs are being skipped:**
- Check events for `MissSchedule` or `FailedNeedsStart`
- Increase `startingDeadlineSeconds`
- Check if nodes have enough resources to schedule pods

**Jobs terminated unexpectedly:**
- With Replace policy, previous job is killed when new one starts
- Check pod logs for SIGTERM handling
- Add graceful shutdown handling

## Summary

| Policy | Overlap Allowed | Missed Runs | Best For |
|--------|-----------------|-------------|----------|
| Allow | ✅ Yes | None | Idempotent, independent jobs |
| Forbid | ❌ No | Possible | Sequential processing, shared resources |
| Replace | ❌ No | None (old killed) | Latest-data-only scenarios |

Choose based on your job's characteristics and what's worse: duplicate runs or missed runs.
