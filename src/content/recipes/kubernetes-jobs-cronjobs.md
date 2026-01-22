---
title: "How to Run Batch Workloads with Jobs and CronJobs"
description: "Execute one-time and scheduled tasks in Kubernetes. Configure job parallelism, retries, deadlines, and cron schedules for batch processing."
category: "deployments"
difficulty: "beginner"
publishDate: "2026-01-22"
tags: ["jobs", "cronjobs", "batch", "scheduling", "automation"]
---

# How to Run Batch Workloads with Jobs and CronJobs

Jobs run tasks to completion, while CronJobs schedule recurring jobs. Use them for batch processing, data pipelines, backups, and maintenance tasks.

## Basic Job

```yaml
# simple-job.yaml
apiVersion: batch/v1
kind: Job
metadata:
  name: data-import
spec:
  template:
    spec:
      containers:
        - name: import
          image: data-processor:v1
          command: ["python", "import.py"]
          env:
            - name: SOURCE_URL
              value: "https://data.example.com/dataset.csv"
      restartPolicy: Never  # Required for Jobs
  backoffLimit: 4  # Retry up to 4 times on failure
```

```bash
# Create and monitor job
kubectl apply -f simple-job.yaml
kubectl get jobs
kubectl describe job data-import

# View job logs
kubectl logs job/data-import

# Delete completed job
kubectl delete job data-import
```

## Job with Parallelism

```yaml
# parallel-job.yaml
apiVersion: batch/v1
kind: Job
metadata:
  name: batch-processor
spec:
  completions: 10      # Total tasks to complete
  parallelism: 3       # Run 3 pods at a time
  completionMode: Indexed  # Each pod gets unique index
  template:
    spec:
      containers:
        - name: processor
          image: processor:v1
          command: ["process-chunk"]
          env:
            - name: JOB_INDEX
              valueFrom:
                fieldRef:
                  fieldPath: metadata.annotations['batch.kubernetes.io/job-completion-index']
      restartPolicy: Never
```

## Job with Deadline

```yaml
# deadline-job.yaml
apiVersion: batch/v1
kind: Job
metadata:
  name: time-sensitive-job
spec:
  activeDeadlineSeconds: 600  # Kill after 10 minutes
  backoffLimit: 3
  template:
    spec:
      containers:
        - name: worker
          image: worker:v1
          resources:
            limits:
              cpu: "2"
              memory: "4Gi"
      restartPolicy: Never
```

## Job TTL (Auto-Cleanup)

```yaml
# ttl-job.yaml
apiVersion: batch/v1
kind: Job
metadata:
  name: cleanup-job
spec:
  ttlSecondsAfterFinished: 3600  # Delete 1 hour after completion
  template:
    spec:
      containers:
        - name: cleanup
          image: cleanup:v1
      restartPolicy: Never
```

## Basic CronJob

```yaml
# cronjob.yaml
apiVersion: batch/v1
kind: CronJob
metadata:
  name: daily-backup
spec:
  schedule: "0 2 * * *"  # 2 AM daily
  jobTemplate:
    spec:
      template:
        spec:
          containers:
            - name: backup
              image: backup-tool:v1
              command: ["backup.sh"]
              env:
                - name: BACKUP_DESTINATION
                  value: "s3://backups/daily"
          restartPolicy: OnFailure
```

## Cron Schedule Syntax

```yaml
# Cron format: minute hour day-of-month month day-of-week
# ┌───────────── minute (0 - 59)
# │ ┌───────────── hour (0 - 23)
# │ │ ┌───────────── day of month (1 - 31)
# │ │ │ ┌───────────── month (1 - 12)
# │ │ │ │ ┌───────────── day of week (0 - 6) (Sunday = 0)
# │ │ │ │ │
# * * * * *

# Examples:
schedule: "*/15 * * * *"     # Every 15 minutes
schedule: "0 * * * *"        # Every hour
schedule: "0 0 * * *"        # Daily at midnight
schedule: "0 2 * * 0"        # Weekly on Sunday at 2 AM
schedule: "0 0 1 * *"        # Monthly on 1st at midnight
schedule: "30 4 * * 1-5"     # Weekdays at 4:30 AM
```

## CronJob Concurrency Policy

```yaml
# concurrency-cronjob.yaml
apiVersion: batch/v1
kind: CronJob
metadata:
  name: report-generator
spec:
  schedule: "0 */6 * * *"  # Every 6 hours
  concurrencyPolicy: Forbid  # Don't start new if previous running
  # Options:
  # - Allow: Default, concurrent jobs allowed
  # - Forbid: Skip if previous job still running
  # - Replace: Cancel running job, start new one
  jobTemplate:
    spec:
      template:
        spec:
          containers:
            - name: report
              image: reporter:v1
          restartPolicy: OnFailure
```

## CronJob History Limits

```yaml
# history-cronjob.yaml
apiVersion: batch/v1
kind: CronJob
metadata:
  name: cleanup-task
spec:
  schedule: "0 3 * * *"
  successfulJobsHistoryLimit: 3   # Keep last 3 successful jobs
  failedJobsHistoryLimit: 1       # Keep last 1 failed job
  jobTemplate:
    spec:
      template:
        spec:
          containers:
            - name: cleanup
              image: cleanup:v1
          restartPolicy: OnFailure
```

## Suspend CronJob

```yaml
# suspended-cronjob.yaml
apiVersion: batch/v1
kind: CronJob
metadata:
  name: maintenance
spec:
  schedule: "0 4 * * *"
  suspend: true  # Paused - won't create new jobs
  jobTemplate:
    spec:
      template:
        spec:
          containers:
            - name: maintenance
              image: maintenance:v1
          restartPolicy: OnFailure
```

```bash
# Toggle suspend
kubectl patch cronjob maintenance -p '{"spec":{"suspend":true}}'
kubectl patch cronjob maintenance -p '{"spec":{"suspend":false}}'
```

## Starting Deadline

```yaml
# deadline-cronjob.yaml
apiVersion: batch/v1
kind: CronJob
metadata:
  name: time-critical
spec:
  schedule: "0 * * * *"
  startingDeadlineSeconds: 300  # Must start within 5 min of schedule
  # If missed by more than 300s, skip this run
  jobTemplate:
    spec:
      template:
        spec:
          containers:
            - name: task
              image: task:v1
          restartPolicy: OnFailure
```

## Job with Init Container

```yaml
# job-with-init.yaml
apiVersion: batch/v1
kind: Job
metadata:
  name: data-pipeline
spec:
  template:
    spec:
      initContainers:
        - name: download-data
          image: curlimages/curl
          command: ["curl", "-o", "/data/input.csv", "https://data.example.com/data.csv"]
          volumeMounts:
            - name: data
              mountPath: /data
      containers:
        - name: process
          image: processor:v1
          command: ["python", "process.py", "/data/input.csv"]
          volumeMounts:
            - name: data
              mountPath: /data
      volumes:
        - name: data
          emptyDir: {}
      restartPolicy: Never
```

## Monitor Jobs

```bash
# List jobs
kubectl get jobs
kubectl get jobs -w  # Watch

# List cronjobs
kubectl get cronjobs

# View job pods
kubectl get pods -l job-name=data-import

# Job status
kubectl describe job data-import

# View recent executions
kubectl get jobs --selector=job-name=daily-backup

# Manually trigger cronjob
kubectl create job --from=cronjob/daily-backup manual-backup
```

## Job Patterns

```yaml
# Work Queue Pattern
apiVersion: batch/v1
kind: Job
metadata:
  name: queue-worker
spec:
  parallelism: 5
  completions: 5
  template:
    spec:
      containers:
        - name: worker
          image: queue-worker:v1
          env:
            - name: QUEUE_URL
              value: "redis://queue:6379"
      restartPolicy: OnFailure
---
# Single Leader Pattern
apiVersion: batch/v1
kind: Job
metadata:
  name: coordinator
spec:
  completions: 1
  parallelism: 1
  template:
    spec:
      containers:
        - name: leader
          image: coordinator:v1
      restartPolicy: Never
```

## Cleanup Old Jobs

```bash
# Delete completed jobs older than 1 hour
kubectl delete jobs --field-selector status.successful=1 \
  --all-namespaces

# Delete failed jobs
kubectl delete jobs --field-selector status.failed=1

# Delete all jobs in namespace
kubectl delete jobs --all -n batch-jobs
```

## Summary

Jobs run tasks to completion with configurable parallelism and retry policies. Use `completions` for total tasks and `parallelism` for concurrent pods. Set `activeDeadlineSeconds` for timeouts and `ttlSecondsAfterFinished` for auto-cleanup. CronJobs schedule recurring jobs using cron syntax. Control concurrency with `concurrencyPolicy` (Allow/Forbid/Replace). Use `startingDeadlineSeconds` for time-sensitive jobs. Manually trigger CronJobs with `kubectl create job --from=cronjob/name`.
