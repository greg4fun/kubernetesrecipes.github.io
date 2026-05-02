---
title: "K8s CronJob: Advanced Scheduling Patterns"
description: "Configure Kubernetes CronJobs with concurrency policies, deadlines, history limits, and suspend/resume. Timezone scheduling, failure handling, and monitoring."
publishDate: "2026-05-02"
author: "Luca Berton"
category: "deployments"
difficulty: "intermediate"
timeToComplete: "10 minutes"
kubernetesVersion: "1.28+"
tags:
  - "cronjob"
  - "scheduling"
  - "batch"
  - "automation"
  - "cka"
relatedRecipes:
  - "kubernetes-job-cronjob-guide"
  - "kubernetes-serviceaccount-guide"
  - "kubernetes-rbac-role-rolebinding"
---

> 💡 **Quick Answer:** CronJob uses standard cron syntax: `schedule: "0 2 * * *"` (2 AM daily). Key settings: `concurrencyPolicy: Forbid` (skip if previous still running), `startingDeadlineSeconds: 300` (skip if >5min late), `successfulJobsHistoryLimit: 3`, `failedJobsHistoryLimit: 3`. Timezone support (K8s 1.27+): `timeZone: "America/New_York"`. Suspend without deleting: `spec.suspend: true`.

## The Problem

Scheduled tasks in Kubernetes need:

- Reliable cron-like scheduling
- Handling of overlapping executions
- Failure detection and retry policies
- History management (don't fill etcd with old Jobs)
- Timezone-aware scheduling

## The Solution

### Full CronJob Configuration

```yaml
apiVersion: batch/v1
kind: CronJob
metadata:
  name: daily-backup
  namespace: production
spec:
  schedule: "0 2 * * *"              # 2 AM daily
  timeZone: "Europe/Rome"            # K8s 1.27+ timezone support
  concurrencyPolicy: Forbid          # Skip if previous still running
  startingDeadlineSeconds: 300       # Skip if >5 min late
  suspend: false                     # Set true to pause
  successfulJobsHistoryLimit: 3      # Keep last 3 successful Jobs
  failedJobsHistoryLimit: 5          # Keep last 5 failed Jobs
  
  jobTemplate:
    spec:
      backoffLimit: 3                # Retry failed jobs 3 times
      activeDeadlineSeconds: 3600    # Kill if running >1 hour
      ttlSecondsAfterFinished: 86400 # Auto-delete after 24h
      template:
        spec:
          restartPolicy: OnFailure
          serviceAccountName: backup-sa
          containers:
          - name: backup
            image: backup-tool:v2
            command: ["/backup.sh"]
            env:
            - name: S3_BUCKET
              valueFrom:
                secretKeyRef:
                  name: backup-secrets
                  key: bucket
            resources:
              requests:
                cpu: 500m
                memory: 512Mi
              limits:
                cpu: "2"
                memory: 2Gi
```

### Cron Schedule Syntax

```
┌───────────── minute (0-59)
│ ┌───────────── hour (0-23)
│ │ ┌───────────── day of month (1-31)
│ │ │ ┌───────────── month (1-12)
│ │ │ │ ┌───────────── day of week (0-6, Sun=0)
│ │ │ │ │
* * * * *

Examples:
"*/5 * * * *"      Every 5 minutes
"0 * * * *"        Every hour
"0 2 * * *"        Daily at 2 AM
"0 9 * * 1"        Monday at 9 AM
"0 0 1 * *"        First of every month
"0 */6 * * *"      Every 6 hours
"30 8 * * 1-5"     Weekdays at 8:30 AM
"0 0 * * 0"        Weekly on Sunday midnight
```

### Concurrency Policies

```yaml
# Allow — default, multiple Jobs can run simultaneously
concurrencyPolicy: Allow
# Previous Job still running + new schedule → BOTH run

# Forbid — skip new if previous still running
concurrencyPolicy: Forbid
# Previous Job still running + new schedule → new SKIPPED

# Replace — kill previous, start new
concurrencyPolicy: Replace
# Previous Job still running + new schedule → previous KILLED, new starts
```

### Manage CronJobs

```bash
# List CronJobs
kubectl get cronjob -n production
# NAME           SCHEDULE      SUSPEND   ACTIVE   LAST SCHEDULE
# daily-backup   0 2 * * *     False     0        2h ago

# Trigger manually (create Job from CronJob)
kubectl create job --from=cronjob/daily-backup manual-backup-001

# Suspend (pause without deleting)
kubectl patch cronjob daily-backup -p '{"spec":{"suspend":true}}'

# Resume
kubectl patch cronjob daily-backup -p '{"spec":{"suspend":false}}'

# View Job history
kubectl get jobs -l job-name -n production --sort-by=.status.startTime

# Check last Job logs
kubectl logs job/daily-backup-28456320 -n production

# Delete CronJob (also deletes owned Jobs)
kubectl delete cronjob daily-backup
```

### Common Patterns

```yaml
# Pattern 1: Database cleanup (skip if previous still running)
apiVersion: batch/v1
kind: CronJob
metadata:
  name: db-cleanup
spec:
  schedule: "0 3 * * *"
  concurrencyPolicy: Forbid
  jobTemplate:
    spec:
      template:
        spec:
          restartPolicy: Never
          containers:
          - name: cleanup
            image: postgres:16
            command:
            - psql
            - -h
            - $(DB_HOST)
            - -U
            - $(DB_USER)
            - -c
            - "DELETE FROM logs WHERE created_at < NOW() - INTERVAL '30 days'"

---
# Pattern 2: Report generation with email
apiVersion: batch/v1
kind: CronJob
metadata:
  name: weekly-report
spec:
  schedule: "0 9 * * 1"           # Monday 9 AM
  timeZone: "Europe/Rome"
  jobTemplate:
    spec:
      backoffLimit: 2
      template:
        spec:
          restartPolicy: OnFailure
          containers:
          - name: report
            image: report-gen:v3
            env:
            - name: REPORT_TYPE
              value: weekly
            - name: EMAIL_TO
              value: team@example.com

---
# Pattern 3: Certificate renewal check
apiVersion: batch/v1
kind: CronJob
metadata:
  name: cert-check
spec:
  schedule: "0 8 * * *"           # Daily 8 AM
  successfulJobsHistoryLimit: 1
  failedJobsHistoryLimit: 3
  jobTemplate:
    spec:
      template:
        spec:
          restartPolicy: Never
          containers:
          - name: check
            image: bitnami/kubectl:1.30
            command:
            - sh
            - -c
            - |
              for ns in $(kubectl get ns -o name); do
                kubectl get secret -n ${ns##*/} -o json | \
                  jq -r '.items[] | select(.type=="kubernetes.io/tls") | .metadata.name'
              done
```

## Common Issues

**CronJob not triggering**

Check `startingDeadlineSeconds` — if controller was down and missed the window, the Job is skipped. Also check `suspend: false`.

**Too many Jobs accumulating**

Set `successfulJobsHistoryLimit` and `failedJobsHistoryLimit`. Also use `ttlSecondsAfterFinished` on the Job spec.

**Job runs twice at the same time**

Default `concurrencyPolicy: Allow`. Change to `Forbid` or `Replace`.

**Timezone not working**

Requires K8s 1.27+. Check: `kubectl version`. Older versions use UTC only.

## Best Practices

- **`concurrencyPolicy: Forbid`** for most jobs — prevent overlap
- **Set `startingDeadlineSeconds`** — avoid running stale schedules after downtime
- **Keep history limits low** — 3-5 prevents etcd bloat
- **`restartPolicy: Never`** for debugging (keep failed pods for log inspection)
- **`restartPolicy: OnFailure`** for automatic retries within a Job
- **Monitor CronJob execution** — alert on missed schedules or failures

## Key Takeaways

- CronJobs create Jobs on a cron schedule — standard 5-field syntax
- Concurrency policies: Allow (default), Forbid (skip), Replace (kill+restart)
- `startingDeadlineSeconds` prevents stale executions after missed schedules
- Set history limits and TTL to prevent resource accumulation
- Timezone support in K8s 1.27+ — no more UTC-only scheduling
