---
title: "K8s StatefulSet: Stable Identity Guide"
description: "Deploy stateful applications with Kubernetes StatefulSets. Stable network identity, ordered deployment, persistent storage, and headless service patterns."
publishDate: "2026-05-02"
author: "Luca Berton"
category: "deployments"
difficulty: "intermediate"
timeToComplete: "12 minutes"
kubernetesVersion: "1.28+"
tags:
  - "statefulset"
  - "deployments"
  - "storage"
  - "databases"
  - "cka"
relatedRecipes:
  - "kubernetes-persistent-volume-guide"
  - "kubernetes-service-types-explained"
  - "kubernetes-deployment-rolling-update"
  - "kubernetes-init-containers-guide"
---

> 💡 **Quick Answer:** StatefulSet gives each pod a stable hostname (`web-0`, `web-1`, `web-2`), stable persistent storage (one PVC per pod), and ordered deployment/scaling. Requires a headless Service (`clusterIP: None`). Use for databases (PostgreSQL, MySQL), distributed systems (Kafka, ZooKeeper, etcd), and any workload needing stable identity.

## The Problem

Deployments treat pods as interchangeable — but some workloads need:

- **Stable hostnames** — database replicas need to know who is primary vs replica
- **Stable storage** — each pod needs its own persistent volume, even after rescheduling
- **Ordered startup** — pod-0 must be ready before pod-1 starts
- **Ordered termination** — scale down from highest ordinal first

## The Solution

### StatefulSet with Headless Service

```yaml
# Headless Service (required for StatefulSet DNS)
apiVersion: v1
kind: Service
metadata:
  name: postgres
spec:
  clusterIP: None      # Headless — no virtual IP
  selector:
    app: postgres
  ports:
  - port: 5432

---
apiVersion: apps/v1
kind: StatefulSet
metadata:
  name: postgres
spec:
  serviceName: postgres    # Must match headless service name
  replicas: 3
  selector:
    matchLabels:
      app: postgres
  template:
    metadata:
      labels:
        app: postgres
    spec:
      containers:
      - name: postgres
        image: postgres:16
        ports:
        - containerPort: 5432
        env:
        - name: POSTGRES_PASSWORD
          valueFrom:
            secretKeyRef:
              name: pg-creds
              key: password
        volumeMounts:
        - name: data
          mountPath: /var/lib/postgresql/data
  volumeClaimTemplates:
  - metadata:
      name: data
    spec:
      accessModes: ["ReadWriteOnce"]
      storageClassName: fast-ssd
      resources:
        requests:
          storage: 50Gi
```

### Stable Network Identity

```bash
# StatefulSet pods get predictable hostnames
kubectl get pods
# postgres-0   1/1   Running
# postgres-1   1/1   Running
# postgres-2   1/1   Running

# DNS records (headless service)
# postgres-0.postgres.default.svc.cluster.local
# postgres-1.postgres.default.svc.cluster.local
# postgres-2.postgres.default.svc.cluster.local

# From inside any pod:
nslookup postgres-0.postgres
# Address: 10.244.1.5

# The service itself returns all pod IPs
nslookup postgres
# Address: 10.244.1.5
# Address: 10.244.2.3
# Address: 10.244.3.7
```

### Stable Storage

```bash
# Each pod gets its own PVC
kubectl get pvc
# NAME              STATUS   VOLUME       CAPACITY
# data-postgres-0   Bound    pv-abc123    50Gi
# data-postgres-1   Bound    pv-def456    50Gi
# data-postgres-2   Bound    pv-ghi789    50Gi

# If postgres-1 is rescheduled to another node,
# it reattaches to data-postgres-1 (same data!)
```

### Ordered Operations

```bash
# Startup: 0 → 1 → 2 (sequential)
# postgres-0 must be Running+Ready before postgres-1 starts

# Scale up: adds next ordinal
kubectl scale statefulset postgres --replicas=5
# postgres-3 created, then postgres-4

# Scale down: removes highest ordinal first
kubectl scale statefulset postgres --replicas=2
# postgres-4 deleted, then postgres-3, then postgres-2

# Parallel startup (opt-in, K8s 1.27+)
spec:
  podManagementPolicy: Parallel  # All pods start simultaneously
  # Default: OrderedReady
```

### Update Strategies

```yaml
spec:
  updateStrategy:
    type: RollingUpdate      # Default
    rollingUpdate:
      partition: 2           # Only update pods with ordinal >= 2
      maxUnavailable: 1      # K8s 1.24+

# Canary: set partition=2 → only postgres-2 gets new image
# Verify, then set partition=0 → updates all

# OnDelete: manual control
spec:
  updateStrategy:
    type: OnDelete
# Pods only update when manually deleted
```

### StatefulSet vs Deployment

| Feature | Deployment | StatefulSet |
|---------|-----------|-------------|
| Pod names | Random suffix | Ordered (0, 1, 2) |
| DNS per pod | ❌ | ✅ (via headless service) |
| Storage per pod | Shared PVC | Individual PVCs |
| Startup order | Parallel | Sequential (default) |
| Scale down order | Random | Highest ordinal first |
| Rolling update | All at once | One at a time, highest first |
| Use case | Stateless apps | Databases, distributed systems |

### Common StatefulSet Workloads

```bash
# Databases
# PostgreSQL, MySQL, MongoDB, CockroachDB

# Message queues
# Kafka, RabbitMQ, NATS

# Distributed coordination
# etcd, ZooKeeper, Consul

# Search engines
# Elasticsearch, OpenSearch

# Caches with persistence
# Redis (with AOF/RDB)
```

## Common Issues

**StatefulSet pods stuck in Pending**

PVC can't be provisioned. Check StorageClass: `kubectl describe pvc data-postgres-0`.

**Pod won't start — waiting for predecessor**

Previous pod not Ready. Check: `kubectl describe pod postgres-0`. Fix the earlier pod first.

**PVCs not deleted when StatefulSet is deleted**

By design — PVCs are retained to prevent data loss. Delete manually: `kubectl delete pvc -l app=postgres`.

**Split-brain after network partition**

Application-level concern. Use proper leader election (Kubernetes Leases) or database-native replication.

## Best Practices

- **Always use headless Service** — required for stable DNS per pod
- **Use `volumeClaimTemplates`** — automatic PVC per replica
- **Keep `podManagementPolicy: OrderedReady`** for databases — startup order matters
- **Use `partition` for canary updates** — test on highest ordinal first
- **Don't delete PVCs automatically** — data loss protection

## Key Takeaways

- StatefulSets provide stable hostnames, persistent storage, and ordered operations
- Requires a headless Service (`clusterIP: None`) for DNS-based identity
- Each pod gets its own PVC via `volumeClaimTemplates`
- Pods start in order (0, 1, 2) and scale down in reverse
- Use `partition` in rolling updates for canary deployments
