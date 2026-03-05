---
title: "Backup and Restore OpenClaw State on Kubernetes"
description: "Implement backup and disaster recovery for OpenClaw on Kubernetes with VolumeSnapshots, CronJobs to S3, and restore procedures for messaging sessions."
category: "storage"
difficulty: "intermediate"
timeToComplete: "20 minutes"
kubernetesVersion: "1.28+"
prerequisites:
  - "OpenClaw deployed with a PVC"
  - "A CSI driver with snapshot support or S3-compatible storage for backups"
relatedRecipes:
  - "openclaw-kubernetes-deployment"
  - "openclaw-ha-kubernetes"
  - "velero-backup-restore"
  - "velero-backup-disaster-recovery"
tags:
  - openclaw
  - backup
  - restore
  - disaster-recovery
  - volume-snapshots
  - s3
  - persistence
publishDate: "2026-02-26"
author: "Luca Berton"
---

> 💡 **Quick Answer:** Schedule VolumeSnapshots with a CronJob or use Velero to back up the OpenClaw PVC. Critical data: `~/.openclaw/` contains WhatsApp/Signal session keys, conversation history, and workspace files. Without backup, losing the PVC means re-pairing all channels and losing all memory.
>
> **Key concept:** OpenClaw state = channel auth sessions + conversation history + workspace (SOUL.md, memory, skills). All live in `~/.openclaw/`.
>
> **Gotcha:** You can't back up a WhatsApp session and restore it on a different phone number. The session is tied to the paired phone.

## The Problem

- PVC failure = loss of all messaging channel sessions (WhatsApp, Signal)
- Re-pairing requires physical access to your phone
- Conversation history and agent memory are irreplaceable
- No native backup mechanism in OpenClaw

## The Solution

Automated backups via VolumeSnapshots or S3 CronJobs, with tested restore procedures.

## What to Back Up

```
~/.openclaw/
├── agents/              # Per-agent state and sessions
│   └── main/
│       ├── agent/       # Auth profiles, model config
│       └── sessions/    # Conversation history
├── workspace/           # SOUL.md, AGENTS.md, memory/, skills/
├── openclaw.json        # Configuration
└── channels/            # WhatsApp/Signal session keys (CRITICAL)
```

## Method 1: VolumeSnapshot CronJob

```yaml
# openclaw-snapshot-cronjob.yaml
apiVersion: batch/v1
kind: CronJob
metadata:
  name: openclaw-backup-snapshot
  namespace: openclaw
spec:
  schedule: "0 */4 * * *"    # Every 4 hours
  jobTemplate:
    spec:
      template:
        spec:
          serviceAccountName: snapshot-creator
          containers:
            - name: snapshot
              image: bitnami/kubectl:latest
              command: ["sh", "-c"]
              args:
                - |
                  TIMESTAMP=$(date +%Y%m%d-%H%M%S)
                  cat <<SNAPEOF | kubectl apply -f -
                  apiVersion: snapshot.storage.k8s.io/v1
                  kind: VolumeSnapshot
                  metadata:
                    name: openclaw-backup-${TIMESTAMP}
                    namespace: openclaw
                  spec:
                    volumeSnapshotClassName: csi-snapclass
                    source:
                      persistentVolumeClaimName: openclaw-state
                  SNAPEOF
                  # Clean up old snapshots (keep last 10)
                  kubectl get volumesnapshot -n openclaw --sort-by=.metadata.creationTimestamp -o name | \
                    head -n -10 | xargs -r kubectl delete -n openclaw
          restartPolicy: OnFailure
```

## Method 2: S3 Backup CronJob

```yaml
# openclaw-s3-backup.yaml
apiVersion: batch/v1
kind: CronJob
metadata:
  name: openclaw-backup-s3
  namespace: openclaw
spec:
  schedule: "0 */6 * * *"
  jobTemplate:
    spec:
      template:
        spec:
          containers:
            - name: backup
              image: amazon/aws-cli:latest
              command: ["sh", "-c"]
              args:
                - |
                  TIMESTAMP=$(date +%Y%m%d-%H%M%S)
                  tar czf /tmp/openclaw-${TIMESTAMP}.tar.gz -C /backup .
                  aws s3 cp /tmp/openclaw-${TIMESTAMP}.tar.gz \
                    s3://my-backups/openclaw/openclaw-${TIMESTAMP}.tar.gz
                  echo "Backup complete: openclaw-${TIMESTAMP}.tar.gz"
              envFrom:
                - secretRef:
                    name: aws-backup-creds
              volumeMounts:
                - name: state
                  mountPath: /backup
                  readOnly: true
          volumes:
            - name: state
              persistentVolumeClaim:
                claimName: openclaw-state
          restartPolicy: OnFailure
```

## Restore Procedure

```bash
# 1. Scale down OpenClaw
kubectl scale deploy/openclaw-gateway -n openclaw --replicas=0

# 2. Restore from S3
kubectl run restore --rm -it --image=amazon/aws-cli \
  --overrides='{"spec":{"containers":[{"name":"restore","image":"amazon/aws-cli",
  "command":["sh","-c","aws s3 cp s3://my-backups/openclaw/openclaw-LATEST.tar.gz /tmp/ && tar xzf /tmp/openclaw-LATEST.tar.gz -C /restore"],
  "volumeMounts":[{"name":"state","mountPath":"/restore"}],
  "envFrom":[{"secretRef":{"name":"aws-backup-creds"}}]}],
  "volumes":[{"name":"state","persistentVolumeClaim":{"claimName":"openclaw-state"}}]}}' \
  -n openclaw

# 3. Scale back up
kubectl scale deploy/openclaw-gateway -n openclaw --replicas=1

# 4. Verify
kubectl exec -n openclaw deploy/openclaw-gateway -- openclaw status
```

## Best Practices

1. **Back up every 4-6 hours** — Balance between data loss risk and storage cost
2. **Test restores regularly** — A backup you can't restore is worthless
3. **Retain 7 days of backups** — Enough to recover from gradual corruption
4. **Encrypt backups** — Use S3 server-side encryption or client-side GPG
5. **Alert on backup failures** — Monitor the CronJob for failed runs

## Key Takeaways

- **OpenClaw state is critical** — Channel sessions can't be recreated without phone access
- **VolumeSnapshots** are fastest for CSI-compatible storage
- **S3 backups** work everywhere and provide offsite redundancy
- **Test restores** periodically to ensure the backup pipeline works
- **Automate with CronJobs** — Manual backups are forgotten backups
