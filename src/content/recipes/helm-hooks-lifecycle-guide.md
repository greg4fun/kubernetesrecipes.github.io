---
title: "Helm Hooks and Lifecycle Management Guide"
description: "Master Helm hooks for Kubernetes deployments. Pre-install, post-install, pre-upgrade, hook weights, deletion policies, and database migration patterns."
publishDate: "2026-04-25"
author: "Luca Berton"
category: "helm"
difficulty: "intermediate"
timeToComplete: "15 minutes"
kubernetesVersion: "1.28+"
tags:
  - "helm"
  - "hooks"
  - "lifecycle"
  - "migration"
relatedRecipes:
  - "kubernetes-pod-security-standards"
  - "kubernetes-rbac-least-privilege"
  - "helm-chart-dependencies-guide"
---

> 💡 **Quick Answer:** Master Helm hooks for Kubernetes deployments. Pre-install, post-install, pre-upgrade, hook weights, deletion policies, and database migration patterns.
>
> Add the `helm.sh/hook` annotation to a Job or Pod to run it at a lifecycle point: `pre-install`, `post-install`, `pre-upgrade`, `post-upgrade`, `pre-delete`, `post-delete`, `pre-rollback`, `post-rollback`, or `test`. Use `helm.sh/hook-weight` to order multiple hooks and `helm.sh/hook-delete-policy` to control cleanup.
>
> **Gotcha:** Hooks run to completion before Helm continues — set `activeDeadlineSeconds` and a `hook-failed` delete policy so a stuck hook doesn't leave the release hanging.

## The Problem

Some release steps don't belong in a Deployment's normal rollout — a database migration must run once, before the new app version starts; a backup must run before a release is deleted; a Slack notification should fire only after a successful install. Helm hooks run these as one-off Jobs/Pods at specific points in the release lifecycle, outside the normal set of tracked resources.

## The Solution

### Hook Lifecycle Points

```yaml
annotations:
  "helm.sh/hook": pre-install        # before resources are installed
  # post-install, pre-upgrade, post-upgrade, pre-delete, post-delete,
  # pre-rollback, post-rollback, test
```

### Database Migration on Upgrade

```yaml
# templates/migration-job.yaml
apiVersion: batch/v1
kind: Job
metadata:
  name: {{ .Release.Name }}-db-migrate
  annotations:
    "helm.sh/hook": pre-upgrade,pre-install
    "helm.sh/hook-weight": "-5"
    "helm.sh/hook-delete-policy": before-hook-creation,hook-succeeded
spec:
  backoffLimit: 3
  template:
    spec:
      restartPolicy: Never
      containers:
        - name: migrate
          image: {{ .Values.image.repository }}:{{ .Values.image.tag }}
          command: ["./migrate.sh"]
          env:
            - name: DATABASE_URL
              valueFrom:
                secretKeyRef: {name: "{{ .Release.Name }}-db-secret", key: url}
```

### Ordering Multiple Hooks with Weight

Hooks at the same lifecycle point run in ascending weight order (most negative first):

```yaml
# -10: pre-install check that required secrets/namespaces exist
annotations: {"helm.sh/hook": pre-install, "helm.sh/hook-weight": "-10"}
---
# -5: run schema migration
annotations: {"helm.sh/hook": pre-install, "helm.sh/hook-weight": "-5"}
---
# 0: seed initial data
annotations: {"helm.sh/hook": pre-install, "helm.sh/hook-weight": "0"}
```

### Post-Install Notification

```yaml
# templates/post-install-notify.yaml
apiVersion: batch/v1
kind: Job
metadata:
  name: {{ .Release.Name }}-notify
  annotations:
    "helm.sh/hook": post-install,post-upgrade
    "helm.sh/hook-weight": "5"
    "helm.sh/hook-delete-policy": hook-succeeded
spec:
  backoffLimit: 1
  template:
    spec:
      restartPolicy: Never
      containers:
        - name: notify
          image: curlimages/curl:latest
          command:
            - /bin/sh
            - -c
            - |
              curl -X POST {{ .Values.slack.webhookUrl }} \
                -H 'Content-Type: application/json' \
                -d '{"text": "✅ {{ .Release.Name }} deployed to {{ .Release.Namespace }} (v{{ .Chart.Version }})"}'
```

### Backup Before Deletion

```yaml
# templates/pre-delete-backup.yaml
apiVersion: batch/v1
kind: Job
metadata:
  name: {{ .Release.Name }}-backup
  annotations:
    "helm.sh/hook": pre-delete
    "helm.sh/hook-delete-policy": before-hook-creation
spec:
  backoffLimit: 1
  template:
    spec:
      restartPolicy: Never
      containers:
        - name: backup
          image: postgres:15
          command: ["/bin/sh", "-c", "pg_dump $DATABASE_URL > /backup/{{ .Release.Name }}-$(date +%Y%m%d-%H%M%S).sql"]
          env:
            - name: DATABASE_URL
              valueFrom:
                secretKeyRef: {name: "{{ .Release.Name }}-db-secret", key: url}
          volumeMounts:
            - {name: backup-storage, mountPath: /backup}
      volumes:
        - name: backup-storage
          persistentVolumeClaim: {claimName: backup-pvc}
```

### Delete Policies

```yaml
"helm.sh/hook-delete-policy": before-hook-creation   # remove the previous hook run before creating a new one
"helm.sh/hook-delete-policy": hook-succeeded          # remove after success
"helm.sh/hook-delete-policy": hook-failed             # remove after failure
"helm.sh/hook-delete-policy": before-hook-creation,hook-succeeded   # combine both
```

### Validation with `helm test`

```yaml
# templates/tests/test-connection.yaml
apiVersion: v1
kind: Pod
metadata:
  name: {{ .Release.Name }}-test
  annotations:
    "helm.sh/hook": test
    "helm.sh/hook-delete-policy": before-hook-creation,hook-succeeded
spec:
  restartPolicy: Never
  containers:
    - name: test
      image: busybox:latest
      command: ["/bin/sh", "-c", "wget -qO- http://{{ .Release.Name }}-service:{{ .Values.service.port }}/health"]
```

```bash
helm test my-release
```

## Common Issues

| Issue | Cause | Fix |
|-------|-------|-----|
| Hook resource left behind after a failed release | No delete policy set, or it only covers success | Add `hook-succeeded,hook-failed` or `before-hook-creation` |
| `helm upgrade` fails with "resource already exists" | A previous hook Job from a prior release wasn't deleted | Use `before-hook-creation` so Helm removes the old one first |
| Migration runs twice on the same data | Hook re-runs on every upgrade — migration script isn't idempotent | Design migration scripts to be safely re-runnable (check-then-apply) |
| `hook-weight` doesn't seem respected | Weight value isn't quoted | `helm.sh/hook-weight` must be a quoted string, e.g. `"-5"`, not a bare number |

## Best Practices

- **Hooks aren't managed release resources** — `helm uninstall` doesn't track or clean them up automatically; delete policies are what control their lifecycle
- **Design hook scripts to be idempotent** — hooks re-run on every matching event (every upgrade re-runs `pre-upgrade` hooks), not just once
- **Set `activeDeadlineSeconds`** on hook Jobs so a stuck hook doesn't block the release indefinitely
- **Use weight to sequence, not to parallelize** — hooks at the same weight run concurrently; only different weights guarantee order
- **Pair `pre-delete` backup hooks with `before-hook-creation`** so re-running an uninstall doesn't collide with a leftover backup Job

## Key Takeaways

- Hooks run one-off Jobs/Pods at lifecycle points (`pre-install`, `post-upgrade`, `pre-delete`, etc.) outside the normal set of release-managed resources
- `helm.sh/hook-weight` (a quoted string) orders multiple hooks at the same lifecycle point
- `helm.sh/hook-delete-policy` controls cleanup — without it, hook resources accumulate across releases
- Hooks re-run on every matching event, so migration/backup scripts must be idempotent
- `helm test` uses the same hook mechanism with `"helm.sh/hook": test` to validate a release after install
