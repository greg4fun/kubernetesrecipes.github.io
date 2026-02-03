---
title: "How to Use Kubernetes Jobs and CronJobs"
description: "Run batch workloads and scheduled tasks with Jobs and CronJobs. Configure retries, parallelism, and completion tracking for reliable task execution."
category: "configuration"
difficulty: "beginner"
publishDate: "2026-01-22"
tags: ["jobs", "cronjobs", "batch", "scheduling", "automation"]
author: "Luca Berton"
---

> 💡 **Quick Answer:** **Job** = run-to-completion task (backups, migrations). **CronJob** = scheduled Job (like cron: `schedule: "0 2 * * *"`). Jobs track completions and retry on failure. Set `backoffLimit` for retries, `activeDeadlineSeconds` for timeout, `ttlSecondsAfterFinished` for auto-cleanup.
>
> **Key difference:** Deployments run forever; Jobs run until `completions` count is reached.
>
> **Gotcha:** CronJobs create new Jobs each run—set `successfulJobsHistoryLimit` and `failedJobsHistoryLimit` to avoid accumulating old Jobs.

# How to Use Kubernetes Jobs and CronJobs

Jobs run tasks to completion. CronJobs schedule Jobs to run periodically. Essential for batch processing, backups, and maintenance tasks.

## Basic Job

```yaml
# job.yaml
apiVersion: batch/v1
kind: Job
metadata:
  name: backup-database
spec:
  template:
    spec:
      containers:
        - name: backup
          image: postgres:15
          command: ["pg_dump"]
          args: ["-h", "postgres", "-U", "admin", "-d", "mydb", "-f", "/backup/dump.sql"]
          volumeMounts:
            - name: backup
              mountPath: /backup
      volumes:
        - name: backup
          persistentVolumeClaim:
            claimName: backup-pvc
      restartPolicy: Never
  backoffLimit: 3
```

## Job with Completions and Parallelism

```yaml
# parallel-job.yaml
apiVersion: batch/v1
kind: Job
metadata:
  name: process-queue
spec:
  completions: 10    # Total tasks to complete
  parallelism: 3     # Run 3 pods at a time
  template:
    spec:
      containers:
        - name: worker
          image: my-worker:latest
          env:
            - name: QUEUE_URL
              value: "redis://redis:6379"
      restartPolicy: Never
  backoffLimit: 5
```

## Job with Timeout

```yaml
# job-with-timeout.yaml
apiVersion: batch/v1
kind: Job
metadata:
  name: long-running-task
spec:
  activeDeadlineSeconds: 600  # 10 minute timeout
  ttlSecondsAfterFinished: 3600  # Auto-delete after 1 hour
  template:
    spec:
      containers:
        - name: task
          image: my-task:latest
      restartPolicy: Never
```

## Basic CronJob

```yaml
# cronjob.yaml
apiVersion: batch/v1
kind: CronJob
metadata:
  name: nightly-backup
spec:
  schedule: "0 2 * * *"  # 2 AM daily
  jobTemplate:
    spec:
      template:
        spec:
          containers:
            - name: backup
              image: backup-tool:latest
              command: ["/backup.sh"]
          restartPolicy: OnFailure
  successfulJobsHistoryLimit: 3
  failedJobsHistoryLimit: 3
```

## CronJob with Concurrency Policy

```yaml
# cronjob-concurrency.yaml
apiVersion: batch/v1
kind: CronJob
metadata:
  name: metrics-aggregator
spec:
  schedule: "*/5 * * * *"  # Every 5 minutes
  concurrencyPolicy: Forbid  # Skip if previous still running
  # Options: Allow (default), Forbid, Replace
  startingDeadlineSeconds: 60  # Must start within 60s of scheduled time
  jobTemplate:
    spec:
      template:
        spec:
          containers:
            - name: aggregator
              image: metrics-agg:latest
          restartPolicy: OnFailure
```

## Cron Schedule Examples

```yaml
# Common cron patterns
schedule: "0 * * * *"      # Every hour
schedule: "0 0 * * *"      # Daily at midnight
schedule: "0 2 * * *"      # Daily at 2 AM
schedule: "0 0 * * 0"      # Weekly on Sunday
schedule: "0 0 1 * *"      # Monthly on 1st
schedule: "*/15 * * * *"   # Every 15 minutes
schedule: "0 9-17 * * 1-5" # Hourly 9-5 weekdays
```

## Indexed Job (Work Queue)

```yaml
# indexed-job.yaml
apiVersion: batch/v1
kind: Job
metadata:
  name: indexed-job
spec:
  completions: 5
  parallelism: 5
  completionMode: Indexed  # Each pod gets JOB_COMPLETION_INDEX
  template:
    spec:
      containers:
        - name: worker
          image: my-worker:latest
          command: ["./process.sh"]
          env:
            - name: PARTITION
              valueFrom:
                fieldRef:
                  fieldPath: metadata.annotations['batch.kubernetes.io/job-completion-index']
      restartPolicy: Never
```

## Monitor Jobs

```bash
# List jobs
kubectl get jobs

# Watch job progress
kubectl get jobs -w

# Get job details
kubectl describe job backup-database

# Get pods created by job
kubectl get pods -l job-name=backup-database

# View logs
kubectl logs job/backup-database

# Delete completed jobs
kubectl delete jobs --field-selector status.successful=1
```

## Monitor CronJobs

```bash
# List cronjobs
kubectl get cronjobs

# Manually trigger a cronjob
kubectl create job --from=cronjob/nightly-backup manual-backup

# Suspend a cronjob
kubectl patch cronjob nightly-backup -p '{"spec":{"suspend":true}}'

# Resume a cronjob
kubectl patch cronjob nightly-backup -p '{"spec":{"suspend":false}}'
```

## Best Practices

1. **Always set `backoffLimit`** to prevent infinite retries
2. **Use `activeDeadlineSeconds`** for tasks that might hang
3. **Set `ttlSecondsAfterFinished`** for automatic cleanup
4. **Limit history** with `successfulJobsHistoryLimit` and `failedJobsHistoryLimit`
5. **Use `concurrencyPolicy: Forbid`** for jobs that shouldn't overlap
6. **Test with `kubectl create job --from=cronjob/`** before waiting for schedule
