---
title: "How to Use Helm Hooks for Lifecycle Management"
description: "Master Helm hooks for pre-install, post-install, pre-upgrade, and post-delete operations. Learn to run database migrations, backups, and cleanup tasks."
category: "helm"
difficulty: "intermediate"
publishDate: "2026-01-22"
tags: ["helm", "hooks", "lifecycle", "migrations", "automation"]
---

# How to Use Helm Hooks for Lifecycle Management

Helm hooks allow you to execute operations at specific points during a release lifecycle. Use them for database migrations, backups, notifications, and cleanup tasks.

## Understanding Hook Types

```yaml
# Hook annotations for different lifecycle events
annotations:
  "helm.sh/hook": pre-install        # Before resources installed
  "helm.sh/hook": post-install       # After resources installed
  "helm.sh/hook": pre-upgrade        # Before upgrade
  "helm.sh/hook": post-upgrade       # After upgrade
  "helm.sh/hook": pre-delete         # Before deletion
  "helm.sh/hook": post-delete        # After deletion
  "helm.sh/hook": pre-rollback       # Before rollback
  "helm.sh/hook": post-rollback      # After rollback
```

## Database Migration Hook

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
                secretKeyRef:
                  name: {{ .Release.Name }}-db-secret
                  key: url
  backoffLimit: 3
```

## Pre-Install Validation Hook

```yaml
# templates/pre-install-check.yaml
apiVersion: batch/v1
kind: Job
metadata:
  name: {{ .Release.Name }}-pre-check
  annotations:
    "helm.sh/hook": pre-install
    "helm.sh/hook-weight": "-10"
    "helm.sh/hook-delete-policy": hook-succeeded,hook-failed
spec:
  template:
    spec:
      restartPolicy: Never
      containers:
        - name: check
          image: bitnami/kubectl:latest
          command:
            - /bin/sh
            - -c
            - |
              echo "Checking prerequisites..."
              # Verify namespace exists
              kubectl get namespace {{ .Values.targetNamespace }} || exit 1
              # Check for required secrets
              kubectl get secret required-secret -n {{ .Values.targetNamespace }} || exit 1
              echo "All checks passed!"
  backoffLimit: 1
```

## Post-Install Notification Hook

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
                -d '{
                  "text": "✅ {{ .Release.Name }} deployed successfully to {{ .Release.Namespace }}",
                  "attachments": [{
                    "color": "good",
                    "fields": [
                      {"title": "Version", "value": "{{ .Chart.Version }}", "short": true},
                      {"title": "App Version", "value": "{{ .Chart.AppVersion }}", "short": true}
                    ]
                  }]
                }'
  backoffLimit: 1
```

## Pre-Delete Backup Hook

```yaml
# templates/pre-delete-backup.yaml
apiVersion: batch/v1
kind: Job
metadata:
  name: {{ .Release.Name }}-backup
  annotations:
    "helm.sh/hook": pre-delete
    "helm.sh/hook-weight": "-5"
    "helm.sh/hook-delete-policy": before-hook-creation
spec:
  template:
    spec:
      restartPolicy: Never
      containers:
        - name: backup
          image: postgres:15
          command:
            - /bin/sh
            - -c
            - |
              TIMESTAMP=$(date +%Y%m%d-%H%M%S)
              pg_dump $DATABASE_URL > /backup/{{ .Release.Name }}-$TIMESTAMP.sql
              echo "Backup completed: {{ .Release.Name }}-$TIMESTAMP.sql"
          env:
            - name: DATABASE_URL
              valueFrom:
                secretKeyRef:
                  name: {{ .Release.Name }}-db-secret
                  key: url
          volumeMounts:
            - name: backup-storage
              mountPath: /backup
      volumes:
        - name: backup-storage
          persistentVolumeClaim:
            claimName: backup-pvc
  backoffLimit: 1
```

## Hook Weight for Ordering

```yaml
# Run in order: -10 → -5 → 0 → 5 → 10
# templates/hook-order-example.yaml

# First: Create config
---
apiVersion: v1
kind: ConfigMap
metadata:
  name: {{ .Release.Name }}-init-config
  annotations:
    "helm.sh/hook": pre-install
    "helm.sh/hook-weight": "-10"
data:
  init.sql: |
    CREATE DATABASE IF NOT EXISTS myapp;

# Second: Run migrations
---
apiVersion: batch/v1
kind: Job
metadata:
  name: {{ .Release.Name }}-schema
  annotations:
    "helm.sh/hook": pre-install
    "helm.sh/hook-weight": "-5"
spec:
  template:
    spec:
      restartPolicy: Never
      containers:
        - name: schema
          image: myapp:migrate
          command: ["./schema.sh"]

# Third: Seed data
---
apiVersion: batch/v1
kind: Job
metadata:
  name: {{ .Release.Name }}-seed
  annotations:
    "helm.sh/hook": pre-install
    "helm.sh/hook-weight": "0"
spec:
  template:
    spec:
      restartPolicy: Never
      containers:
        - name: seed
          image: myapp:seed
          command: ["./seed.sh"]
```

## Hook Delete Policies

```yaml
# Delete policy options
annotations:
  # Delete hook resource before new hook is launched
  "helm.sh/hook-delete-policy": before-hook-creation
  
  # Delete when hook succeeds
  "helm.sh/hook-delete-policy": hook-succeeded
  
  # Delete when hook fails
  "helm.sh/hook-delete-policy": hook-failed
  
  # Combine multiple policies
  "helm.sh/hook-delete-policy": before-hook-creation,hook-succeeded
```

## Test Hook for Validation

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
      command:
        - /bin/sh
        - -c
        - |
          echo "Testing {{ .Release.Name }} connectivity..."
          wget -qO- http://{{ .Release.Name }}-service:{{ .Values.service.port }}/health
          echo "Test passed!"
```

Run tests with:

```bash
helm test my-release
```

## Common Pitfalls

1. **Hook resources are not managed** - They're not part of the release
2. **Failed hooks block installation** - Use appropriate delete policies
3. **Hook weight is string** - Must be quoted in YAML
4. **Hooks run every upgrade** - Design for idempotency

## Summary

Helm hooks enable powerful lifecycle automation for your releases. Use pre-install hooks for setup and validation, post-install for notifications, and pre-delete for backups and cleanup.

---

## 📘 Go Further with Kubernetes Recipes

**Love this recipe? There's so much more!** This is just one of **100+ hands-on recipes** in our comprehensive **[Kubernetes Recipes book](https://amzn.to/3DzC8QA)**.

Inside the book, you'll master:
- ✅ Production-ready deployment strategies
- ✅ Advanced networking and security patterns  
- ✅ Observability, monitoring, and troubleshooting
- ✅ Real-world best practices from industry experts

> *"The practical, recipe-based approach made complex Kubernetes concepts finally click for me."*

**👉 [Get Your Copy Now](https://amzn.to/3DzC8QA)** — Start building production-grade Kubernetes skills today!
