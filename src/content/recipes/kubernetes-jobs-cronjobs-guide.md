---
title: "Kubernetes Jobs CronJobs Guide"
description: "Run batch workloads with Kubernetes Jobs and CronJobs. Parallel execution, completion tracking, failure handling, TTL cleanup, and scheduled tasks."
publishDate: "2026-04-29"
author: "Luca Berton"
category: "deployments"
difficulty: "beginner"
timeToComplete: "15 minutes"
kubernetesVersion: "1.28+"
tags:
  - "jobs"
  - "cronjobs"
  - "batch"
  - "scheduling"
  - "automation"
relatedRecipes:
  - "kubernetes-init-containers-guide"
  - "kubernetes-pod-lifecycle-hooks"
  - "kubernetes-resource-quotas-limitranges"
---

> 💡 **Quick Answer:** A Job runs a pod to completion (exit 0) and tracks success. A CronJob creates Jobs on a schedule (cron syntax). Use `backoffLimit` for retry control, `parallelism` for concurrent execution, `ttlSecondsAfterFinished` for auto-cleanup, and `concurrencyPolicy` to control overlapping CronJob runs.

## The Problem

Not all workloads are long-running services. Kubernetes needs to handle:

- Database backups on a schedule
- ETL pipelines and data processing
- Report generation
- Email campaigns
- Cleanup and maintenance tasks
- One-off migrations

## The Solution

### Basic Job

```yaml
apiVersion: batch/v1
kind: Job
metadata:
  name: db-backup
spec:
  ttlSecondsAfterFinished: 3600   # Auto-delete after 1 hour
  backoffLimit: 3                  # Retry 3 times on failure
  activeDeadlineSeconds: 600       # Timeout after 10 minutes
  template:
    spec:
      containers:
      - name: backup
        image: postgres:16
        command:
        - pg_dump
        - -h
        - postgres-svc
        - -U
        - admin
        - -d
        - production
        - -f
        - /backup/dump.sql
        volumeMounts:
        - name: backup
          mountPath: /backup
      volumes:
      - name: backup
        persistentVolumeClaim:
          claimName: backup-pvc
      restartPolicy: OnFailure
```

### Parallel Job

```yaml
apiVersion: batch/v1
kind: Job
metadata:
  name: image-processor
spec:
  completions: 10       # Total pods to run successfully
  parallelism: 3        # Run 3 pods at a time
  completionMode: Indexed  # Each pod gets $JOB_COMPLETION_INDEX
  template:
    spec:
      containers:
      - name: processor
        image: myapp/processor:v1
        command:
        - python
        - process.py
        - --shard=$(JOB_COMPLETION_INDEX)
      restartPolicy: Never
```

### CronJob

```yaml
apiVersion: batch/v1
kind: CronJob
metadata:
  name: nightly-backup
spec:
  schedule: "0 2 * * *"          # 2 AM daily
  timeZone: "Europe/Rome"        # v1.27+ timezone support
  concurrencyPolicy: Forbid      # Don't overlap
  successfulJobsHistoryLimit: 3
  failedJobsHistoryLimit: 5
  startingDeadlineSeconds: 600   # Skip if 10min late
  jobTemplate:
    spec:
      ttlSecondsAfterFinished: 86400
      template:
        spec:
          containers:
          - name: backup
            image: backup-tool:v1
            command: ["/backup.sh"]
          restartPolicy: OnFailure
```

### Concurrency Policies

| Policy | Behavior |
|--------|----------|
| `Allow` (default) | Multiple concurrent Jobs allowed |
| `Forbid` | Skip new Job if previous still running |
| `Replace` | Kill running Job, start new one |

### Monitor Jobs

```bash
# List jobs
kubectl get jobs
kubectl get cronjobs

# Watch job pods
kubectl get pods -l job-name=db-backup -w

# Check job status
kubectl describe job db-backup

# View logs
kubectl logs job/db-backup

# Manually trigger a CronJob
kubectl create job manual-backup --from=cronjob/nightly-backup
```

## Common Issues

**Job pods remain after completion**

Set `ttlSecondsAfterFinished` to auto-cleanup. Without it, completed pods stay until manually deleted or hit `successfulJobsHistoryLimit`.

**CronJob creates duplicate runs**

Using `Allow` concurrency with slow jobs. Switch to `Forbid` to prevent overlap.

**Job never completes — stuck at 0/1**

Pod is CrashLooping. Check `backoffLimit` — once exhausted, the Job fails permanently. Check pod logs for the error.

## Best Practices

- **Always set `ttlSecondsAfterFinished`** — prevent pod accumulation
- **Use `Forbid` for CronJobs** that shouldn't overlap
- **Set `activeDeadlineSeconds`** — prevent runaway jobs
- **Use `startingDeadlineSeconds`** on CronJobs — skip stale schedules after downtime
- **`restartPolicy: Never` for debugging** — keeps failed pods for log inspection
- **`restartPolicy: OnFailure` for production** — automatic retry within the pod

## Key Takeaways

- Jobs run pods to completion with retry and parallelism support
- CronJobs create Jobs on a cron schedule with overlap control
- `ttlSecondsAfterFinished` prevents completed pod accumulation
- `concurrencyPolicy: Forbid` prevents overlapping scheduled runs
- Use `Indexed` completion mode for sharded parallel processing
- `activeDeadlineSeconds` is your timeout safety net
