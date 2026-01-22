---
title: "How to Deploy Stateful Applications"
description: "Run stateful workloads on Kubernetes with StatefulSets. Manage stable identities, persistent storage, and ordered deployment for databases and caches."
category: "storage"
difficulty: "intermediate"
publishDate: "2026-01-22"
tags: ["statefulset", "databases", "persistence", "storage", "stateful"]
---

# How to Deploy Stateful Applications

StatefulSets manage stateful applications that require stable network identities, persistent storage, and ordered deployment. Essential for databases, caches, and distributed systems.

## StatefulSet vs Deployment

```yaml
# StatefulSet provides:
# - Stable, unique network identifiers (pod-0, pod-1, pod-2)
# - Stable, persistent storage per pod
# - Ordered, graceful deployment and scaling
# - Ordered, automated rolling updates

# Use StatefulSet for:
# - Databases (MySQL, PostgreSQL, MongoDB)
# - Distributed systems (Kafka, Elasticsearch, Cassandra)
# - Caches (Redis cluster)
# - Any app needing stable identity
```

## Basic StatefulSet

```yaml
# statefulset.yaml
apiVersion: apps/v1
kind: StatefulSet
metadata:
  name: web
spec:
  serviceName: "web"  # Required: Headless service name
  replicas: 3
  selector:
    matchLabels:
      app: web
  template:
    metadata:
      labels:
        app: web
    spec:
      containers:
        - name: nginx
          image: nginx:latest
          ports:
            - containerPort: 80
          volumeMounts:
            - name: data
              mountPath: /usr/share/nginx/html
  volumeClaimTemplates:
    - metadata:
        name: data
      spec:
        accessModes: ["ReadWriteOnce"]
        storageClassName: standard
        resources:
          requests:
            storage: 1Gi
```

## Headless Service

```yaml
# headless-service.yaml
# Required for StatefulSet DNS
apiVersion: v1
kind: Service
metadata:
  name: web
spec:
  clusterIP: None  # Headless service
  selector:
    app: web
  ports:
    - port: 80
      targetPort: 80
```

```bash
# DNS records created:
# web-0.web.default.svc.cluster.local
# web-1.web.default.svc.cluster.local
# web-2.web.default.svc.cluster.local

# Test DNS resolution
kubectl run -it --rm debug --image=busybox -- nslookup web-0.web
```

## PostgreSQL StatefulSet

```yaml
# postgres-statefulset.yaml
apiVersion: apps/v1
kind: StatefulSet
metadata:
  name: postgres
spec:
  serviceName: postgres
  replicas: 1
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
          image: postgres:15
          ports:
            - containerPort: 5432
          env:
            - name: POSTGRES_USER
              valueFrom:
                secretKeyRef:
                  name: postgres-credentials
                  key: username
            - name: POSTGRES_PASSWORD
              valueFrom:
                secretKeyRef:
                  name: postgres-credentials
                  key: password
            - name: PGDATA
              value: /var/lib/postgresql/data/pgdata
          volumeMounts:
            - name: data
              mountPath: /var/lib/postgresql/data
          resources:
            requests:
              cpu: 500m
              memory: 1Gi
            limits:
              cpu: 2000m
              memory: 4Gi
          livenessProbe:
            exec:
              command:
                - pg_isready
                - -U
                - postgres
            initialDelaySeconds: 30
            periodSeconds: 10
          readinessProbe:
            exec:
              command:
                - pg_isready
                - -U
                - postgres
            initialDelaySeconds: 5
            periodSeconds: 5
  volumeClaimTemplates:
    - metadata:
        name: data
      spec:
        accessModes: ["ReadWriteOnce"]
        storageClassName: fast-ssd
        resources:
          requests:
            storage: 20Gi
---
apiVersion: v1
kind: Service
metadata:
  name: postgres
spec:
  clusterIP: None
  selector:
    app: postgres
  ports:
    - port: 5432
```

## Redis Cluster

```yaml
# redis-statefulset.yaml
apiVersion: apps/v1
kind: StatefulSet
metadata:
  name: redis
spec:
  serviceName: redis
  replicas: 6  # 3 masters + 3 replicas
  selector:
    matchLabels:
      app: redis
  template:
    metadata:
      labels:
        app: redis
    spec:
      containers:
        - name: redis
          image: redis:7
          command:
            - redis-server
          args:
            - /etc/redis/redis.conf
            - --cluster-enabled
            - "yes"
            - --cluster-config-file
            - /data/nodes.conf
          ports:
            - containerPort: 6379
              name: client
            - containerPort: 16379
              name: gossip
          volumeMounts:
            - name: data
              mountPath: /data
            - name: config
              mountPath: /etc/redis
          resources:
            requests:
              cpu: 200m
              memory: 256Mi
      volumes:
        - name: config
          configMap:
            name: redis-config
  volumeClaimTemplates:
    - metadata:
        name: data
      spec:
        accessModes: ["ReadWriteOnce"]
        resources:
          requests:
            storage: 5Gi
```

## Ordered Pod Management

```yaml
# Default: OrderedReady
# Pods created in order: pod-0, pod-1, pod-2
# Pods deleted in reverse: pod-2, pod-1, pod-0
# Each pod must be Running and Ready before next starts

apiVersion: apps/v1
kind: StatefulSet
metadata:
  name: ordered-app
spec:
  podManagementPolicy: OrderedReady  # Default
  # Or: Parallel - create/delete all at once
  replicas: 3
  # ...
```

## Update Strategies

```yaml
apiVersion: apps/v1
kind: StatefulSet
metadata:
  name: app
spec:
  updateStrategy:
    type: RollingUpdate  # Default
    rollingUpdate:
      partition: 0  # Update all pods
      # partition: 2  # Only update pods >= 2 (canary)
      maxUnavailable: 1  # Kubernetes 1.24+
  # ...
```

```bash
# Canary update with partition
# Only pods with ordinal >= partition are updated

# Set partition to 2 (only update pod-2)
kubectl patch statefulset app -p '{"spec":{"updateStrategy":{"rollingUpdate":{"partition":2}}}}'

# Update image
kubectl set image statefulset/app nginx=nginx:1.25

# Only pod-2 gets new image
# Verify, then lower partition
kubectl patch statefulset app -p '{"spec":{"updateStrategy":{"rollingUpdate":{"partition":0}}}}'
```

## Scaling StatefulSets

```bash
# Scale up (pods added in order)
kubectl scale statefulset web --replicas=5

# Scale down (pods removed in reverse order)
kubectl scale statefulset web --replicas=2

# PVCs are NOT deleted when scaling down
# Manual cleanup if needed:
kubectl delete pvc data-web-3 data-web-4
```

## Init Containers for StatefulSets

```yaml
# init-container-statefulset.yaml
apiVersion: apps/v1
kind: StatefulSet
metadata:
  name: mysql
spec:
  serviceName: mysql
  replicas: 3
  selector:
    matchLabels:
      app: mysql
  template:
    metadata:
      labels:
        app: mysql
    spec:
      initContainers:
        - name: init-mysql
          image: mysql:8
          command:
            - bash
            - -c
            - |
              # Generate server-id from pod ordinal
              [[ `hostname` =~ -([0-9]+)$ ]] || exit 1
              ordinal=${BASH_REMATCH[1]}
              echo "[mysqld]" > /mnt/conf.d/server-id.cnf
              echo "server-id=$((100 + $ordinal))" >> /mnt/conf.d/server-id.cnf
              
              # Copy config based on primary/replica
              if [[ $ordinal -eq 0 ]]; then
                cp /mnt/config-map/primary.cnf /mnt/conf.d/
              else
                cp /mnt/config-map/replica.cnf /mnt/conf.d/
              fi
          volumeMounts:
            - name: conf
              mountPath: /mnt/conf.d
            - name: config-map
              mountPath: /mnt/config-map
      containers:
        - name: mysql
          image: mysql:8
          # ...
```

## Pod Identity in Container

```bash
# Get pod ordinal from hostname
hostname  # Returns: web-0, web-1, etc.

# Extract ordinal number
ORDINAL=$(hostname | grep -oE '[0-9]+$')

# Use in application logic
if [ "$ORDINAL" == "0" ]; then
  echo "I am the primary"
else
  echo "I am replica $ORDINAL"
fi
```

## Persistent Volume Retention

```yaml
# Kubernetes 1.27+
apiVersion: apps/v1
kind: StatefulSet
metadata:
  name: app
spec:
  persistentVolumeClaimRetentionPolicy:
    whenDeleted: Retain   # Keep PVCs when StatefulSet deleted
    whenScaled: Delete    # Delete PVCs when scaling down
  # Options: Retain (default) or Delete
```

## Summary

StatefulSets provide stable identities (pod-0, pod-1), persistent storage via volumeClaimTemplates, and ordered deployment/scaling for stateful applications. Always create a headless Service for DNS-based discovery. Use init containers to configure pods based on their ordinal. Update strategies support rolling updates with partitions for canary deployments. PVCs persist by default when scaling down or deleting - configure retention policies as needed. Essential for running databases, distributed systems, and any workload requiring stable network identity.
