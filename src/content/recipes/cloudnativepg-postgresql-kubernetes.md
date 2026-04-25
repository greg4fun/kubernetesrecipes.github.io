---
title: "CloudNativePG PostgreSQL on Kubernetes"
description: "Deploy PostgreSQL on Kubernetes with CloudNativePG operator. Cluster setup, affinity, backups to S3, connection pooling, and high availability configuration."
category: "deployments"
publishDate: "2026-04-20"
author: "Luca Berton"
difficulty: "intermediate"
timeToComplete: "20 minutes"
kubernetesVersion: "1.25+"
tags: ["cloudnativepg", "postgresql", "database", "operator", "backup", "high-availability"]
relatedRecipes:
  - "kubernetes-readiness-liveness-startup"
  - "kubernetes-graceful-shutdown-guide"
  - mariadb-scc-openshift-deployment
  - kubernetes-persistent-volumes
  - kubernetes-storage-best-practices
---

> 💡 **Quick Answer:** CloudNativePG is a Kubernetes operator that manages PostgreSQL clusters natively. Define a `Cluster` CRD with instances, storage, and backup config — the operator handles replication, failover, and WAL archiving automatically.

## The Problem

Running PostgreSQL on Kubernetes requires:
- Automated primary/replica failover
- Continuous WAL backup to object storage
- Connection pooling (PgBouncer)
- Pod anti-affinity for high availability
- Point-in-time recovery (PITR)

## The Solution

### Install CloudNativePG Operator

```bash
# Install via kubectl
kubectl apply --server-side -f \
  https://raw.githubusercontent.com/cloudnative-pg/cloudnative-pg/release-1.25/releases/cnpg-1.25.0.yaml

# Or via Helm
helm repo add cnpg https://cloudnative-pg.github.io/charts
helm repo update
helm install cnpg cnpg/cloudnative-pg \
  --namespace cnpg-system \
  --create-namespace

# Verify
kubectl get pods -n cnpg-system
```

### Basic PostgreSQL Cluster

```yaml
apiVersion: postgresql.cnpg.io/v1
kind: Cluster
metadata:
  name: postgres-cluster
  namespace: default
spec:
  instances: 3
  imageName: ghcr.io/cloudnative-pg/postgresql:16.4

  storage:
    size: 20Gi
    storageClass: standard

  postgresql:
    parameters:
      max_connections: "200"
      shared_buffers: "256MB"
      effective_cache_size: "768MB"
      work_mem: "8MB"
      maintenance_work_mem: "128MB"

  bootstrap:
    initdb:
      database: app
      owner: app
      secret:
        name: app-db-credentials

  resources:
    requests:
      memory: "512Mi"
      cpu: "500m"
    limits:
      memory: "1Gi"
      cpu: "2"
```

### High Availability with Anti-Affinity

```yaml
apiVersion: postgresql.cnpg.io/v1
kind: Cluster
metadata:
  name: postgres-ha
spec:
  instances: 3

  affinity:
    enablePodAntiAffinity: true
    topologyKey: kubernetes.io/hostname
    # Pods spread across nodes
    podAntiAffinityType: required  # or "preferred"

  # Node affinity for dedicated database nodes
  affinity:
    nodeSelector:
      node-role: database
    tolerations:
      - key: "dedicated"
        value: "database"
        effect: NoSchedule

  storage:
    size: 100Gi
    storageClass: fast-ssd
```

### Backup to S3

```yaml
apiVersion: postgresql.cnpg.io/v1
kind: Cluster
metadata:
  name: postgres-backup
spec:
  instances: 3

  storage:
    size: 50Gi

  backup:
    barmanObjectStore:
      destinationPath: s3://my-pg-backups/postgres-cluster/
      endpointURL: https://s3.us-east-1.amazonaws.com
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

    retentionPolicy: "30d"
---
# Scheduled backup
apiVersion: postgresql.cnpg.io/v1
kind: ScheduledBackup
metadata:
  name: daily-backup
spec:
  schedule: "0 2 * * *"  # 2 AM daily
  cluster:
    name: postgres-backup
  backupOwnerReference: self
```

### Connection Pooling (PgBouncer)

```yaml
apiVersion: postgresql.cnpg.io/v1
kind: Pooler
metadata:
  name: postgres-pooler-rw
spec:
  cluster:
    name: postgres-cluster
  instances: 2
  type: rw  # or "ro" for read replicas

  pgbouncer:
    poolMode: transaction
    parameters:
      max_client_conn: "1000"
      default_pool_size: "25"
      min_pool_size: "5"

  template:
    spec:
      containers:
        - name: pgbouncer
          resources:
            requests:
              memory: "128Mi"
              cpu: "100m"
```

### Point-in-Time Recovery

```yaml
apiVersion: postgresql.cnpg.io/v1
kind: Cluster
metadata:
  name: postgres-restored
spec:
  instances: 3
  storage:
    size: 50Gi

  bootstrap:
    recovery:
      source: postgres-backup
      recoveryTarget:
        targetTime: "2026-04-20T10:30:00Z"  # Restore to this point

  externalClusters:
    - name: postgres-backup
      barmanObjectStore:
        destinationPath: s3://my-pg-backups/postgres-cluster/
        s3Credentials:
          accessKeyId:
            name: s3-creds
            key: ACCESS_KEY_ID
          secretAccessKey:
            name: s3-creds
            key: SECRET_ACCESS_KEY
```

### Architecture

```mermaid
graph TD
    A[App Pods] --> B[PgBouncer Pooler]
    B --> C[Primary Instance]
    C -->|Streaming Replication| D[Replica 1]
    C -->|Streaming Replication| E[Replica 2]
    
    C -->|WAL Archive| F[S3 Object Storage]
    
    G[CloudNativePG Operator] -->|Manages| C
    G -->|Manages| D
    G -->|Manages| E
    G -->|Failover| H{Primary fails?}
    H -->|Yes| I[Promote Replica]
```

### Monitoring

```bash
# Check cluster status
kubectl get cluster postgres-cluster

# Detailed status
kubectl cnpg status postgres-cluster

# Connection info
kubectl get secret postgres-cluster-app -o jsonpath='{.data.uri}' | base64 -d
# postgresql://app:password@postgres-cluster-rw:5432/app

# Services created:
# postgres-cluster-rw    → Primary (read-write)
# postgres-cluster-ro    → Replicas (read-only)
# postgres-cluster-r     → Any instance (read)
```

## Common Issues

| Issue | Cause | Fix |
|-------|-------|-----|
| Pod stuck Pending | No storage available | Check StorageClass and PV capacity |
| Failover not triggering | Health check too lenient | Tune `failoverDelay` |
| WAL backup failing | S3 credentials wrong | Check secret, test with `aws s3 ls` |
| Connection refused after failover | App caching old IP | Use Service DNS names, not pod IPs |
| High replication lag | Under-resourced replicas | Increase CPU/memory limits |
| enablePodAntiAffinity fails | Not enough nodes | Use `preferred` instead of `required` |

## Best Practices

1. **Always 3+ instances** — enables automated failover without data loss
2. **Use `enablePodAntiAffinity: true`** — spread pods across nodes
3. **Configure WAL archiving to S3** — enables PITR and disaster recovery
4. **Use PgBouncer pooler** — reduces connection overhead for microservices
5. **Connect via `-rw` and `-ro` Services** — automatic read/write splitting

## Key Takeaways

- CloudNativePG manages full PostgreSQL lifecycle: deploy, replicate, failover, backup, restore
- `Cluster` CRD defines everything: instances, storage, parameters, backup config
- Automatic failover promotes a replica within seconds of primary failure
- WAL archiving to S3 enables point-in-time recovery to any second
- PgBouncer `Pooler` CRD handles connection pooling natively
