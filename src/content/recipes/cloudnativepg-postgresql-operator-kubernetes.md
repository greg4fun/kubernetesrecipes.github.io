---
title: "CloudNativePG PostgreSQL Operator on Kubernetes"
description: "Deploy production PostgreSQL on Kubernetes with CloudNativePG operator. Automated failover, continuous backup to S3, point-in-time recovery, connection pooling, and high availability with synchronous replication."
tags:
  - "cloudnativepg"
  - "postgresql"
  - "database"
  - "operator"
  - "high-availability"
category: "storage"
publishDate: "2026-06-01"
author: "Luca Berton"
difficulty: "advanced"
relatedRecipes:
  - "strimzi-kafka-operator-kubernetes"
  - "velero-kubernetes-backup-disaster-recovery"
  - "kubernetes-persistent-volumes-claims"
---

> 💡 **Quick Answer:** CloudNativePG is a CNCF-graduated PostgreSQL operator that manages the full lifecycle: provisioning, HA with automatic failover, continuous backup to object storage (S3/GCS/Azure), point-in-time recovery (PITR), rolling updates, and connection pooling via PgBouncer. Define a `Cluster` resource with 3 instances and CloudNativePG handles replication, failover, and backups automatically.

## The Problem

- Running PostgreSQL on Kubernetes without an operator requires manual replication setup
- Failover is manual — database downtime when primary pod crashes
- Backups need external cron jobs and scripts
- Connection pooling requires separate PgBouncer deployment
- Point-in-time recovery is complex without WAL archiving automation

## The Solution

### Install CloudNativePG

```bash
# Install operator
kubectl apply --server-side -f \
  https://raw.githubusercontent.com/cloudnative-pg/cloudnative-pg/release-1.25/releases/cnpg-1.25.0.yaml

# Verify
kubectl get deployment -n cnpg-system cnpg-controller-manager
```

### Basic HA Cluster (3 Instances)

```yaml
apiVersion: postgresql.cnpg.io/v1
kind: Cluster
metadata:
  name: my-database
  namespace: production
spec:
  instances: 3                    # 1 primary + 2 replicas
  imageName: ghcr.io/cloudnative-pg/postgresql:16.4

  # Storage
  storage:
    size: 50Gi
    storageClass: fast-ssd

  # Resource management
  resources:
    requests:
      cpu: "1"
      memory: "2Gi"
    limits:
      cpu: "4"
      memory: "8Gi"

  # PostgreSQL configuration
  postgresql:
    parameters:
      max_connections: "200"
      shared_buffers: "512MB"
      effective_cache_size: "2GB"
      work_mem: "16MB"
      max_wal_size: "2GB"

  # Monitoring
  monitoring:
    enablePodMonitor: true

  # Bootstrap (initialize database)
  bootstrap:
    initdb:
      database: myapp
      owner: myapp
      secret:
        name: myapp-db-credentials
```

```yaml
# Database credentials
apiVersion: v1
kind: Secret
metadata:
  name: myapp-db-credentials
  namespace: production
type: kubernetes.io/basic-auth
data:
  username: bXlhcHA=          # myapp
  password: c3VwZXJzZWNyZXQ=  # supersecret
```

### Continuous Backup to S3

```yaml
apiVersion: postgresql.cnpg.io/v1
kind: Cluster
metadata:
  name: my-database
  namespace: production
spec:
  instances: 3
  storage:
    size: 50Gi

  # Continuous backup (WAL archiving + base backups)
  backup:
    barmanObjectStore:
      destinationPath: "s3://my-backups/postgres/"
      endpointURL: "https://s3.eu-west-1.amazonaws.com"
      s3Credentials:
        accessKeyId:
          name: s3-creds
          key: ACCESS_KEY_ID
        secretAccessKey:
          name: s3-creds
          key: SECRET_ACCESS_KEY
      wal:
        compression: gzip
        maxParallel: 4
      data:
        compression: gzip
    retentionPolicy: "30d"       # Keep backups for 30 days

---
# Scheduled backup (in addition to continuous WAL)
apiVersion: postgresql.cnpg.io/v1
kind: ScheduledBackup
metadata:
  name: daily-backup
  namespace: production
spec:
  schedule: "0 2 * * *"          # 2 AM daily
  backupOwnerReference: self
  cluster:
    name: my-database
  immediate: true
```

### Point-in-Time Recovery (PITR)

```yaml
# Recover to a specific timestamp
apiVersion: postgresql.cnpg.io/v1
kind: Cluster
metadata:
  name: my-database-restored
  namespace: production
spec:
  instances: 3
  storage:
    size: 50Gi

  bootstrap:
    recovery:
      source: my-database-backup
      recoveryTarget:
        targetTime: "2026-06-01T14:30:00Z"    # Recover to this point

  externalClusters:
    - name: my-database-backup
      barmanObjectStore:
        destinationPath: "s3://my-backups/postgres/"
        endpointURL: "https://s3.eu-west-1.amazonaws.com"
        s3Credentials:
          accessKeyId:
            name: s3-creds
            key: ACCESS_KEY_ID
          secretAccessKey:
            name: s3-creds
            key: SECRET_ACCESS_KEY
```

### Connection Pooling (PgBouncer)

```yaml
apiVersion: postgresql.cnpg.io/v1
kind: Pooler
metadata:
  name: my-database-pooler
  namespace: production
spec:
  cluster:
    name: my-database
  instances: 2
  type: rw                       # rw (primary) or ro (replicas)
  pgbouncer:
    poolMode: transaction
    parameters:
      max_client_conn: "1000"
      default_pool_size: "25"
      min_pool_size: "5"
```

### Connect to the Database

```bash
# Services created automatically:
# my-database-rw   → primary (read-write)
# my-database-ro   → replicas (read-only)
# my-database-r    → any instance (read)

# Connection string:
# postgresql://myapp:supersecret@my-database-rw.production:5432/myapp

# From another pod:
kubectl run psql --rm -it --image=postgres:16 -- \
  psql "postgresql://myapp:supersecret@my-database-rw.production:5432/myapp"

# Check cluster status
kubectl cnpg status my-database -n production
```

### Synchronous Replication

```yaml
spec:
  instances: 3
  minSyncReplicas: 1     # At least 1 sync replica
  maxSyncReplicas: 2     # Up to 2 sync replicas
  # Ensures zero data loss on failover (RPO=0)
```

## Common Issues

### Primary failover — brief connection interruption
- **Cause**: Primary pod crashed; replica promoting to primary (5-10s)
- **Fix**: Normal behavior. Use connection pooler; retry logic in app. Services auto-update endpoints

### WAL archiving failing — backup lag growing
- **Cause**: S3 credentials expired or network issue
- **Fix**: Check `kubectl cnpg status`; verify S3 credentials; check operator logs

### Out of disk space on PVCs
- **Cause**: WAL accumulation, table bloat, or insufficient initial size
- **Fix**: Increase PVC size (if storageClass supports expansion); or VACUUM full

### Cluster stuck in "Setting up primary"
- **Cause**: Init job failing (wrong credentials, insufficient resources)
- **Fix**: Check pod logs of first instance; verify Secret exists; check resource limits

## Best Practices

1. **Always 3 instances** — minimum for HA (1 primary, 2 replicas)
2. **Enable continuous backup** — WAL archiving to S3/GCS for PITR
3. **Use connection pooler** — PgBouncer handles connection spikes
4. **Separate rw/ro services** — route read traffic to replicas
5. **Set resource limits** — prevent PostgreSQL from consuming all node memory
6. **Monitor with PodMonitor** — CloudNativePG exports Prometheus metrics
7. **Test recovery regularly** — create restore Cluster from backup to verify

## Key Takeaways

- CloudNativePG: CNCF-graduated PostgreSQL operator for full lifecycle management
- `Cluster` resource defines instances, storage, backup, and HA configuration
- Automatic failover: replica promotes to primary in 5-10s (zero data loss with sync replication)
- Continuous backup: WAL archiving + scheduled base backups to S3/GCS/Azure
- PITR: recover to any point in time using `bootstrap.recovery.recoveryTarget.targetTime`
- Connection pooling via `Pooler` resource (PgBouncer) — handles 1000+ connections
- Services: `-rw` (primary), `-ro` (replicas), `-r` (any) created automatically
