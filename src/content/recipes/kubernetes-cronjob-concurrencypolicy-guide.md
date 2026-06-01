---
title: "Kubernetes CronJob ConcurrencyPolicy Guide"
description: "Configure Kubernetes CronJob concurrencyPolicy with Allow, Forbid, and Replace options. Control concurrent job execution, prevent overlapping runs, and handle long-running cron workloads."
tags:
  - "cronjob"
  - "scheduling"
  - "concurrency"
  - "batch"
  - "jobs"
category: "configuration"
publishDate: "2026-06-01"
author: "Luca Berton"
difficulty: "beginner"
relatedRecipes:
  - "kubernetes-jobs-batch-processing"
  - "kubernetes-resource-management"
---

> 💡 **Quick Answer:** `concurrencyPolicy` controls what happens when a CronJob's next schedule fires while a previous run is still active. `Allow` (default) runs jobs concurrently. `Forbid` skips the new run if previous is still running. `Replace` cancels the running job and starts a new one. Use `Forbid` for most production workloads to prevent resource contention.

## The Problem

- CronJob fires every 5 minutes but the job takes 7 minutes — overlapping runs compete for resources
- Concurrent database backup jobs corrupt data
- Multiple parallel report generators consume all available memory
- Need to guarantee only one instance of a periodic job runs at a time
- Long-running jobs should be replaced by fresh runs (not accumulate)

## The Solution

### ConcurrencyPolicy Options

```text
┌────────┬──────────────────────────────────────────────────────────────┐
│ Allow  │ Default. Multiple jobs can run simultaneously.               │
│        │ Good for: stateless, independent tasks (send emails)         │
│        │ Risk: resource contention, duplicate processing              │
├────────┼──────────────────────────────────────────────────────────────┤
│ Forbid │ Skip new run if previous is still active.                    │
│        │ Good for: database backups, exclusive locks, ETL pipelines   │
│        │ Behavior: "missed" schedule is simply skipped                │
├────────┼──────────────────────────────────────────────────────────────┤
│ Replace│ Cancel running job, start new one.                           │
│        │ Good for: cache refresh, status sync, "latest wins"          │
│        │ Behavior: old job terminated, new job starts fresh           │
└────────┴──────────────────────────────────────────────────────────────┘
```

### Allow (Default)

```yaml
apiVersion: batch/v1
kind: CronJob
metadata:
  name: send-notifications
spec:
  schedule: "*/5 * * * *"
  concurrencyPolicy: Allow     # Multiple can run in parallel
  jobTemplate:
    spec:
      template:
        spec:
          containers:
            - name: notify
              image: registry.example.com/notify:v1
          restartPolicy: Never
```

### Forbid (Exclusive Execution)

```yaml
apiVersion: batch/v1
kind: CronJob
metadata:
  name: database-backup
spec:
  schedule: "0 2 * * *"           # Daily at 2 AM
  concurrencyPolicy: Forbid       # Never run 2 backups simultaneously
  startingDeadlineSeconds: 3600   # Allow 1h late start
  successfulJobsHistoryLimit: 3
  failedJobsHistoryLimit: 3
  jobTemplate:
    spec:
      activeDeadlineSeconds: 7200  # Kill if running > 2 hours
      template:
        spec:
          containers:
            - name: backup
              image: registry.example.com/db-backup:v1
              env:
                - name: DATABASE_URL
                  valueFrom:
                    secretKeyRef:
                      name: db-credentials
                      key: url
          restartPolicy: Never
```

### Replace (Latest Wins)

```yaml
apiVersion: batch/v1
kind: CronJob
metadata:
  name: cache-refresh
spec:
  schedule: "*/10 * * * *"
  concurrencyPolicy: Replace    # Kill old, start fresh
  jobTemplate:
    spec:
      template:
        spec:
          containers:
            - name: refresh
              image: registry.example.com/cache-refresh:v1
          restartPolicy: Never
```

### Check CronJob Status

```bash
# List CronJobs and last schedule
kubectl get cronjobs
# NAME              SCHEDULE      SUSPEND   ACTIVE   LAST SCHEDULE   AGE
# database-backup   0 2 * * *     False     0        8h              30d
# cache-refresh     */10 * * * *  False     1        2m              7d

# Check active (running) jobs
kubectl get jobs --selector=job-name -l cronjob=database-backup

# See if jobs were skipped (Forbid policy)
kubectl describe cronjob database-backup
# Events:
#   Normal  SawCompletedJob     5m    cronjob-controller  Saw completed job: database-backup-xxx
#   Normal  SkippedConcurrent   2m    cronjob-controller  Skipped concurrent run (Forbid)
```

## Common Issues

### Jobs accumulating with `Allow` policy — resource exhaustion
- **Cause**: Jobs take longer than schedule interval; unlimited concurrency
- **Fix**: Switch to `Forbid` or `Replace`; set `activeDeadlineSeconds` on jobs

### CronJob "missed starting window" — job never runs
- **Cause**: `startingDeadlineSeconds` too short; scheduler was down during window
- **Fix**: Set `startingDeadlineSeconds: 200` (or higher); check scheduler health

### Replace terminates job mid-work — data corruption
- **Cause**: `Replace` kills running job without graceful shutdown
- **Fix**: Use `Forbid` instead for data-sensitive jobs; or implement graceful shutdown handling

## Best Practices

1. **Default to `Forbid`** — safest for most production workloads
2. **Set `activeDeadlineSeconds`** — prevent runaway jobs from blocking forever
3. **Set `startingDeadlineSeconds`** — allow late starts after brief scheduler unavailability
4. **Use `Replace` only for idempotent tasks** — where "latest data wins" is acceptable
5. **Set history limits** — `successfulJobsHistoryLimit: 3` prevents old job accumulation
6. **Monitor skipped runs** — alert if `Forbid` is consistently skipping schedules

## Key Takeaways

- `concurrencyPolicy` controls behavior when CronJob schedule fires during active run
- `Allow`: concurrent runs OK (default, risky for stateful jobs)
- `Forbid`: skip if still running (safest for exclusive workloads)
- `Replace`: kill running job, start fresh (for "latest wins" scenarios)
- Always pair with `activeDeadlineSeconds` to prevent infinite-running jobs
- Check for skipped runs in CronJob events when using `Forbid`
