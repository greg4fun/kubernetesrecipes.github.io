---
title: "Kubernetes StatefulSet Headless Service Guide"
description: "Deploy stateful applications with Kubernetes StatefulSets. Stable network identity, ordered deployment, persistent storage per pod, headless services for DNS, and patterns for databases and distributed systems."
tags:
  - "statefulset"
  - "headless-service"
  - "persistent-storage"
  - "databases"
  - "ordered-deployment"
category: "deployments"
publishDate: "2026-06-01"
author: "Luca Berton"
difficulty: "intermediate"
relatedRecipes:
  - "cloudnativepg-postgresql-operator-kubernetes"
  - "kubernetes-persistent-volumes-claims"
  - "kubernetes-service-types-loadbalancer-guide"
---

> 💡 **Quick Answer:** StatefulSet provides stable pod identity (pod-0, pod-1, pod-2), ordered creation/deletion, and persistent storage per replica via `volumeClaimTemplates`. Pair with a headless Service (`clusterIP: None`) for stable DNS: `pod-0.my-service.namespace.svc.cluster.local`. Use for databases, message queues, and any workload needing stable network identity or dedicated storage.

## The Problem

- Deployments give random pod names — databases need stable identity for replication
- Regular Services load-balance — distributed systems need to address specific instances
- PVCs can't be automatically created per replica with Deployments
- Need ordered startup (primary first, then replicas) for database clusters
- Pod rescheduling shouldn't lose its data or change its network identity

## The Solution

### StatefulSet with Headless Service

```yaml
# Headless Service (required for StatefulSet DNS)
apiVersion: v1
kind: Service
metadata:
  name: database
  namespace: production
spec:
  clusterIP: None    # Headless — no load balancing
  selector:
    app: database
  ports:
    - port: 5432
      name: postgres
---
apiVersion: apps/v1
kind: StatefulSet
metadata:
  name: database
  namespace: production
spec:
  serviceName: database    # Must match headless Service name
  replicas: 3
  selector:
    matchLabels:
      app: database
  template:
    metadata:
      labels:
        app: database
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
                  name: db-credentials
                  key: password
          volumeMounts:
            - name: data
              mountPath: /var/lib/postgresql/data

  # Each pod gets its own PVC (persists across restarts)
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

### DNS Records Created

```text
StatefulSet: database (3 replicas)
Headless Service: database

DNS records:
├── database-0.database.production.svc.cluster.local → 10.0.1.5
├── database-1.database.production.svc.cluster.local → 10.0.1.6
├── database-2.database.production.svc.cluster.local → 10.0.1.7
└── database.production.svc.cluster.local → [10.0.1.5, 10.0.1.6, 10.0.1.7]
                                            (returns all pod IPs)

PVCs created:
├── data-database-0    (50Gi, bound)
├── data-database-1    (50Gi, bound)
└── data-database-2    (50Gi, bound)
```

```bash
# Verify DNS from another pod
kubectl run dns-test --rm -it --image=busybox -- nslookup database-0.database.production
# Server: 10.96.0.10
# Name: database-0.database.production.svc.cluster.local
# Address: 10.0.1.5
```

### Ordered vs Parallel Pod Management

```yaml
spec:
  # Default: OrderedReady — pods created 0,1,2 sequentially
  # Each must be Running+Ready before next starts
  podManagementPolicy: OrderedReady

  # Alternative: Parallel — all pods start simultaneously
  # podManagementPolicy: Parallel
  # Use when pods don't depend on startup order
```

### Update Strategies

```yaml
spec:
  updateStrategy:
    type: RollingUpdate
    rollingUpdate:
      partition: 0        # Update all pods
      maxUnavailable: 1   # One at a time (K8s 1.24+)

  # Canary update: set partition to only update pods >= partition number
  # partition: 2 → only database-2 gets updated (test before rolling to all)
```

### StatefulSet Scaling

```bash
# Scale up (adds database-3, database-4)
kubectl scale statefulset database --replicas=5

# Scale down (removes highest ordinal first: database-4, database-3)
kubectl scale statefulset database --replicas=3

# PVCs are NOT deleted on scale-down (data preserved for scale-up)
# Manual cleanup:
kubectl delete pvc data-database-3 data-database-4
```

### Client Service (Load-Balanced)

```yaml
# Headless for pod-specific access (replication, peer discovery)
apiVersion: v1
kind: Service
metadata:
  name: database
spec:
  clusterIP: None
  selector:
    app: database
  ports:
    - port: 5432
---
# Regular service for client connections (load-balanced reads)
apiVersion: v1
kind: Service
metadata:
  name: database-read
spec:
  type: ClusterIP    # Normal — load-balances across all pods
  selector:
    app: database
  ports:
    - port: 5432
```

### Init Container for Cluster Bootstrap

```yaml
spec:
  template:
    spec:
      initContainers:
        - name: init-cluster
          image: postgres:16
          command:
            - bash
            - -c
            - |
              # Determine role from hostname ordinal
              ORDINAL=${HOSTNAME##*-}
              if [ "$ORDINAL" = "0" ]; then
                echo "I am the primary"
                # Initialize as primary
              else
                echo "I am replica $ORDINAL, waiting for primary..."
                until pg_isready -h database-0.database.production; do
                  sleep 2
                done
                # Clone from primary
              fi
```

## Common Issues

### Pods stuck in Pending (PVC not binding)
- **Cause**: StorageClass doesn't support dynamic provisioning; or no available PVs
- **Fix**: Verify StorageClass exists and has provisioner; check PV availability

### Pod stuck in Terminating during deletion
- **Cause**: Finalizers on pod or PVC; or pod has long terminationGracePeriod
- **Fix**: Wait for grace period; check finalizers; force delete as last resort

### DNS not resolving pod names
- **Cause**: Headless service name doesn't match `spec.serviceName`; or pod not Ready
- **Fix**: Ensure `serviceName` matches Service name exactly; pod must pass readiness probe

### Scale-down data loss concern
- **Cause**: PVCs persist after scale-down but pod is gone
- **Fix**: PVCs are intentionally retained — data safe. Delete PVCs manually only when confirmed unnecessary

## Best Practices

1. **Always pair with headless Service** — required for stable DNS identity
2. **Use `volumeClaimTemplates`** — each pod gets dedicated persistent storage
3. **OrderedReady for databases** — primary must start before replicas
4. **Partition for canary updates** — test on highest ordinal before rolling to all
5. **Separate read/write services** — headless for peer discovery, ClusterIP for client reads
6. **Don't delete PVCs automatically** — prevents accidental data loss on scale-down
7. **Set `podAntiAffinity`** — spread StatefulSet pods across nodes for HA

## Key Takeaways

- StatefulSet: stable identity (pod-0, pod-1), ordered lifecycle, dedicated storage
- Headless Service (`clusterIP: None`) enables DNS: `pod-0.svc.ns.svc.cluster.local`
- `volumeClaimTemplates`: auto-create PVC per pod (persists across restarts/rescheduling)
- `podManagementPolicy: OrderedReady` (sequential) vs `Parallel` (simultaneous)
- Scale-down removes highest ordinal first; PVCs retained for data safety
- `partition` in updateStrategy enables canary: only update pods ≥ partition number
- Use for: databases, message queues, distributed caches, consensus systems (etcd, ZooKeeper)
